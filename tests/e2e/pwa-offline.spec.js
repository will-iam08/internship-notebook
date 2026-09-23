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

// Only meaningful against a real server (the default; see playwright.config.js). Under
// PW_ROUTE_FILES=1 (the sandboxed-shell fallback), Playwright's own request interception keeps
// answering requests regardless of context.setOffline(), so this specific test does not exercise
// the service worker's offline fallback there - everything else in this suite is unaffected.
test("the service worker registers and caches the app shell for offline use", async ({ page, context }) => {
  await seedNotebook(page);
  await openApp(page, "#/today");
  await page.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker.ready);
  await page.evaluate(() => navigator.serviceWorker.ready);

  // A page visited once while online should still open once the network is gone.
  await openApp(page, "#/board");
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Board" })).toBeVisible({ timeout: 10000 });
  await context.setOffline(false);
});
