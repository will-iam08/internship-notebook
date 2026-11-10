// Covers: the web app manifest is valid and linked, the service worker registers and caches the
// app shell, and a previously-visited page still loads while offline.
import { ROUTE_FILES, expect, test } from "./fixtures.js";
import { openApp, seedNotebook, seedStarted } from "./helpers.js";

test("the manifest is linked and declares the fields an installer needs", async ({ page, baseURL }) => {
  await seedStarted(page); // a real empty notebook, not the demo
  await openApp(page);
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  const manifest = await page.evaluate(async url => (await fetch(url)).json(), new URL(href, baseURL).toString());
  expect(manifest.name).toBe("My Internship Notebook");
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBeTruthy();
  expect(manifest.share_target?.params).toEqual({ title: "title", text: "text", url: "url" });
  expect(manifest.icons.length).toBeGreaterThan(0);
  for (const icon of manifest.icons) {
    // With PW_ROUTE_FILES=1, page.request.get() bypasses the browser-level routing interceptor
    // and hits the network directly. Use an in-page fetch() instead so the interceptor catches it.
    const ok = await page.evaluate(async url => {
      try { const r = await fetch(url); return r.ok; } catch { return false; }
    }, new URL(icon.src, baseURL).toString());
    expect(ok, `icon ${icon.src} should be reachable`).toBe(true);
  }
});

test("a shared job opens a safely prefilled new-application sheet", async ({ page }) => {
  await page.goto("/?share-target=1&title=Software%20Intern&text=Shared%20from%20a%20job%20site&url=https%3A%2F%2Fexample.com%2Fjob");
  await expect(page.getByRole("heading", { name: "Add an application" })).toBeVisible();
  await expect(page.locator("#new-form").getByLabel("Role")).toHaveValue("Software Intern");
  await expect(page.getByLabel("Job posting link")).toHaveValue("https://example.com/job");
  await expect(page.getByLabel("Notes")).toHaveValue("Shared from a job site");
});

test("privacy and account-deletion pages are public", async ({ page }) => {
  await page.goto("/privacy.html");
  await expect(page.getByRole("heading", { name: "Privacy policy" })).toBeVisible();
  await page.goto("/delete-account.html");
  await expect(page.getByRole("heading", { name: "Delete your account" })).toBeVisible();
});

test("the service worker registers and caches the app shell for offline use", async ({ page, context, browserName }) => {
  await seedNotebook(page);
  await openApp(page, "#/today");
  await page.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker.ready);
  await page.evaluate(() => navigator.serviceWorker.ready);

  // A page visited once while online should still open once the network is gone.
  await openApp(page, "#/board");
  expect(await page.evaluate(async () => Boolean(await caches.match("index.html")))).toBe(true);
  // Playwright WebKit errors on offline navigation with a service worker. Its cache is checked
  // above; Chromium also verifies that the cached page actually reloads without network access.
  if (browserName === "webkit") return;
  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Board" })).toBeVisible({ timeout: 10000 });
  } finally {
    await context.setOffline(false);
  }
});
