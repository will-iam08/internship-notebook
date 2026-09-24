// Covers: the web app manifest is valid and linked, the service worker registers and caches the
// app shell, and a previously-visited page still loads while offline.
import { expect, test } from "./fixtures.js";
import { openApp, seedNotebook } from "./helpers.js";

test("the manifest is linked and declares the fields an installer needs", async ({ page, baseURL }) => {
  await openApp(page);
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  const manifest = await page.evaluate(async url => (await fetch(url)).json(), new URL(href, baseURL).toString());
  expect(manifest.name).toBe("My Internship Notebook");
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBeTruthy();
  expect(manifest.icons.length).toBeGreaterThan(0);
  for (const icon of manifest.icons) {
    const response = await page.request.get(new URL(icon.src, baseURL).toString());
    expect(response.ok(), `icon ${icon.src} should be reachable`).toBe(true);
  }
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
