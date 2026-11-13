import { expect, test } from "./fixtures.js";
import { openApp, sampleApplications, savedNotebook, seedNotebook } from "./helpers.js";

test.use({ serviceWorkers: "block" });

const SUPABASE = "https://test.supabase.co";
const USER_ID = "synthetic-ui-user";
const card = page => page.locator('[aria-labelledby="cloud-sync-title"]');

async function mockSupabase(page, { remote = null, offline = false, beforePull } = {}) {
  const requests = [];
  let stored = remote;
  await page.addInitScript(url => {
    window.__SUPABASE__ = { url, anonKey: "test-anon-key" };
  }, SUPABASE);
  await page.route(`${SUPABASE}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "apikey, authorization, content-type, prefer",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    requests.push({ url, method: request.method(), body: request.postDataJSON(), headers: request.headers() });
    const respond = body => route.fulfill({ json: body, headers });
    if (url.pathname === "/auth/v1/token") {
      return respond({ access_token: "test-session-token", user: { id: USER_ID, email: "owner@example.test" } });
    }
    if (url.pathname === "/auth/v1/logout") return route.fulfill({ status: 204, headers });
    if (offline) return route.abort("internetdisconnected");
    if (request.method() === "GET") {
      await beforePull?.();
      return respond(stored ? [{ user_id: USER_ID, data: stored }] : []);
    }
    stored = request.postDataJSON().data;
    return respond([{ user_id: USER_ID, data: stored }]);
  });
  return { requests, remote: () => stored };
}

async function signIn(page) {
  const cloud = card(page);
  await cloud.getByLabel("Email", { exact: true }).fill("owner@example.test");
  await cloud.getByLabel("Password", { exact: true }).fill("test-password");
  await cloud.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(cloud.getByRole("button", { name: "Sync now", exact: true })).toBeEnabled();
}

test("empty config hides cloud settings and makes no cloud requests", async ({ page }) => {
  // A deployment without a Supabase project ships empty config; simulate that here instead of
  // relying on the committed runtime-config.js, which now points at a real project.
  await page.addInitScript(() => { window.__SUPABASE__ = { url: "", anonKey: "" }; });
  const cloudRequests = [];
  page.on("request", request => {
    if (/supabase|firebase|gstatic|googleapis/.test(request.url())) cloudRequests.push(request.url());
  });
  await seedNotebook(page);
  await openApp(page, "#/settings");
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Cloud sync", exact: true })).toHaveCount(0);
  expect(cloudRequests).toEqual([]);
});

test("sign-in waits for Sync now before uploading and keeps tokens out of storage", async ({ page }) => {
  const mock = await mockSupabase(page);
  await seedNotebook(page);
  await openApp(page, "#/settings");
  await expect(card(page).locator("[data-cloud-status]")).toHaveText("Not signed in");
  const original = await savedNotebook(page);
  await signIn(page);
  expect(mock.requests.map(request => request.url.pathname)).toEqual(["/auth/v1/token"]);
  expect(await savedNotebook(page)).toEqual(original);
  await card(page).getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(card(page).locator("[data-cloud-status]")).toHaveText("Synced just now");
  const upload = mock.requests.find(request => request.url.pathname === "/rest/v1/notebooks" && request.method === "POST");
  expect(upload.body.user_id).toBe(USER_ID);
  expect(upload.body.data.applications).toEqual(original.applications);
  expect(upload.body.data.recentlyDeleted).toEqual(original.recentlyDeleted);
  expect(upload.headers.apikey).toBe("test-anon-key");
  expect(upload.headers.authorization).toBe("Bearer test-session-token");
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain("test-session-token");
  await card(page).getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(card(page).locator("[data-cloud-status]")).toHaveText("Not signed in");
  expect((await savedNotebook(page)).applications).toEqual(original.applications);
});

test("a newer cloud notebook is sanitized before replacing local data", async ({ page }) => {
  const remote = {
    nextId: 90,
    applications: [{ ...sampleApplications()[0], id: 41, company: "Cloud copy", link: "javascript:alert(1)" }],
    recentlyDeleted: [],
    updatedAt: "2099-01-01T00:00:00.000Z"
  };
  const mock = await mockSupabase(page, { remote });
  await seedNotebook(page);
  await openApp(page, "#/settings");
  await signIn(page);
  await card(page).getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(card(page).locator("[data-cloud-status]")).toHaveText("Synced just now");
  const stored = await savedNotebook(page);
  expect(stored.applications).toHaveLength(1);
  expect(stored.applications[0].company).toBe("Cloud copy");
  expect(stored.applications[0].link).toBe("");
  expect(stored.updatedAt).toBe(remote.updatedAt);
  expect(stored.nextId).toBe(remote.nextId);
  expect(mock.requests.filter(request => request.method === "POST" && request.url.pathname === "/rest/v1/notebooks")).toHaveLength(0);
});

test("purging a page advances the notebook clock and uploads its removal", async ({ page }) => {
  const deleted = { ...sampleApplications()[1], deletedAt: new Date().toISOString() };
  const mock = await mockSupabase(page);
  await seedNotebook(page, [sampleApplications()[0]], { recentlyDeleted: [deleted], updatedAt: "2020-01-01T00:00:00.000Z" });
  await openApp(page, "#/settings");
  await signIn(page);
  await card(page).getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(card(page).locator("[data-cloud-status]")).toHaveText("Synced just now");
  const before = mock.remote().updatedAt;
  await page.evaluate(() => { location.hash = "#/deleted"; });
  await page.locator('[data-action="purge"]').click();
  await page.locator("#confirm-dialog").getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect.poll(async () => (await savedNotebook(page)).recentlyDeleted.length).toBe(0);
  await page.evaluate(() => { location.hash = "#/settings"; });
  await card(page).getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(card(page).locator("[data-cloud-status]")).toHaveText("Synced just now");
  expect(mock.remote().recentlyDeleted).toEqual([]);
  expect(Date.parse(mock.remote().updatedAt)).toBeGreaterThan(Date.parse(before));
});

test("offline sync preserves the notebook and never claims success", async ({ page }) => {
  await mockSupabase(page, { offline: true });
  await seedNotebook(page);
  await openApp(page, "#/settings");
  await signIn(page);
  const original = await savedNotebook(page);
  await card(page).getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(card(page).locator("[data-cloud-status]")).toHaveText("Offline");
  await expect(card(page).getByRole("alert")).toBeVisible();
  expect(await savedNotebook(page)).toEqual(original);
});

test("a local edit during a pending cloud read survives the sync", async ({ page }) => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let began;
  const reading = new Promise(resolve => { began = resolve; });
  const remote = { nextId: 1, applications: [], recentlyDeleted: [], updatedAt: "2099-01-01T00:00:00.000Z" };
  await mockSupabase(page, { remote, beforePull: async () => { began(); await pending; } });
  await seedNotebook(page);
  await openApp(page, "#/settings");
  await signIn(page);
  await card(page).getByRole("button", { name: "Sync now", exact: true }).click();
  await reading;
  await expect(card(page).locator("[data-cloud-status]")).toHaveText("Syncing…");
  await page.evaluate(async () => {
    const { browserApi } = await import("/js/api.js");
    await browserApi.update(1, { notes: "Saved while cloud read was pending." });
  });
  release();
  await expect(card(page).locator("[data-cloud-status]")).not.toHaveText("Syncing…");
  expect((await savedNotebook(page)).applications.find(entry => entry.id === 1).notes).toBe("Saved while cloud read was pending.");
});
