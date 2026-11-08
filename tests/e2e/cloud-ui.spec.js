import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures.js";
import { DATA_KEY, openApp, sampleApplications, savedNotebook, seedNotebook } from "./helpers.js";

test.use({ serviceWorkers: "block" });

async function mockFirebase(page, { remote = null, rejectUpload = false } = {}) {
  const blockedProductionRequests = [];
  await page.route(/https:\/\/(?:identitytoolkit|firestore|securetoken)\.googleapis\.com\//, route => {
    blockedProductionRequests.push(route.request().url());
    return route.abort();
  });
  await page.route("https://www.gstatic.com/firebasejs/**", async route => {
    const file = new URL(route.request().url()).pathname.split("/").at(-1);
    const modules = {
      "firebase-app.js": `export function initializeApp() { return {}; }`,
      "firebase-auth.js": `
        const auth = { currentUser: null };
        let observer;
        export function getAuth() { return auth; }
        export const browserLocalPersistence = {};
        export async function setPersistence() {}
        export function onAuthStateChanged(_auth, callback) { observer = callback; callback(null); }
        export class GoogleAuthProvider {}
        export async function signInWithPopup() {
          auth.currentUser = { uid: "synthetic-ui-user", email: "synthetic@example.test", emailVerified: true, providerData: [{ providerId: "google.com" }] };
          observer(auth.currentUser);
          return { user: auth.currentUser };
        }`,
      "firebase-firestore.js": `
        const remote = ${JSON.stringify(remote)};
        export function getFirestore() { return {}; }
        export function doc(_db, collection, uid) { return { collection, uid }; }
        export async function getDocFromServer() { return { exists: () => remote !== null, data: () => remote }; }
        export function serverTimestamp() { return "synthetic-server-time"; }
        export async function setDoc(_ref, value) {
          globalThis.__cloudWriteAttempts = (globalThis.__cloudWriteAttempts || 0) + 1;
          globalThis.__cloudLastUpload = value;
          if (${rejectUpload}) throw new Error("Synthetic cloud upload denied");
        }`
    };
    if (!modules[file]) throw new Error(`Unexpected Firebase module: ${file}`);
    await route.fulfill({ contentType: "text/javascript", body: modules[file] });
  });
  return blockedProductionRequests;
}

function deviceNotebook() {
  const entries = sampleApplications();
  return {
    active: { ...entries[0], company: "Device original", notes: "Keep this original local text." },
    deleted: { ...entries[1], company: "Device deleted", deletedAt: new Date(Date.now() - 86400000).toISOString() }
  };
}

test("choosing the cloud copy downloads both original local lists before replacing them", async ({ page }) => {
  const local = deviceNotebook();
  const cloudEntries = sampleApplications().slice(0, 2).map((entry, index) => ({ ...entry, id: 41 + index, company: `Cloud only ${index + 1}` }));
  const blocked = await mockFirebase(page, { remote: { nextId: 43, applications: cloudEntries, recentlyDeleted: [] } });
  await seedNotebook(page, [local.active], { recentlyDeleted: [local.deleted] });
  await openApp(page, "#/settings");
  await page.getByRole("button", { name: "Sign in with Google", exact: true }).click();
  const dialog = page.locator("#confirm-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("This device: 1 active, 1 deleted pages");
  await expect(dialog).toContainText("Cloud: 2 active, 0 deleted pages");
  expect((await savedNotebook(page)).applications[0].company).toBe(local.active.company);
  await page.evaluate(key => {
    window.__cloudUiEvents = [];
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) window.__cloudUiEvents.push("backup");
      return click.call(this);
    };
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (storageKey, value) {
      if (storageKey === key) window.__cloudUiEvents.push("replace");
      return setItem.call(this, storageKey, value);
    };
  }, DATA_KEY);
  const downloaded = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Use cloud notebook", exact: true }).click();
  const download = await downloaded;
  const backup = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(backup.format).toBe("my-internship-notebook-backup");
  expect(backup.applications).toEqual([local.active]);
  expect(backup.recentlyDeleted).toEqual([local.deleted]);
  await expect.poll(async () => (await savedNotebook(page)).applications.map(entry => entry.company)).toEqual(["Cloud only 1", "Cloud only 2"]);
  const stored = await savedNotebook(page);
  expect(stored.applications).toEqual(cloudEntries);
  expect(stored.recentlyDeleted).toEqual([]);
  expect(await page.evaluate(() => window.__cloudUiEvents)).toEqual(["backup", "replace"]);
  expect(await page.evaluate(() => window.__cloudWriteAttempts || 0)).toBe(0);
  expect(blocked).toEqual([]);
  await expect(page.locator("#toasts")).toContainText("Cloud notebook restored.");
});

test("an explicit first upload failure shows the error and never reports success", async ({ page }) => {
  const local = deviceNotebook();
  const blocked = await mockFirebase(page, { rejectUpload: true });
  await seedNotebook(page, [local.active], { recentlyDeleted: [local.deleted] });
  await openApp(page, "#/settings");
  const original = await savedNotebook(page);
  await page.getByRole("button", { name: "Sign in with Google", exact: true }).click();
  const dialog = page.locator("#confirm-dialog");
  await expect(dialog).toContainText("This device: 1 active, 1 deleted pages");
  await dialog.getByRole("button", { name: "Upload & sync", exact: true }).click();
  await expect(page.locator("#toasts .toast.error")).toContainText("Synthetic cloud upload denied");
  await expect(page.getByRole("button", { name: "Retry sync", exact: true })).toBeVisible();
  await expect(page.locator("#toasts .toast:not(.error)")).toHaveCount(0);
  await expect(page.getByText("Last confirmed cloud save:", { exact: false })).toHaveCount(0);
  expect(await page.evaluate(() => window.__cloudWriteAttempts)).toBe(1);
  expect(await savedNotebook(page)).toEqual(original);
  expect(blocked).toEqual([]);
});
