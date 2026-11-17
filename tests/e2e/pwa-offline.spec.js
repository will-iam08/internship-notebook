// Covers: the web app manifest is valid and linked, the service worker registers and caches the
// app shell, and a previously-visited page still loads while offline.
import { ROUTE_FILES, expect, test } from "./fixtures.js";
import { openApp, seedNotebook, seedSession, seedStarted } from "./helpers.js";

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
  await seedSession(page); // signed in: the job opens straight away (signed out, it waits for sign-up)
  await page.goto("/?share-target=1&title=Software%20Intern&text=Shared%20from%20a%20job%20site&url=https%3A%2F%2Fexample.com%2Fjob");
  await expect(page.getByRole("heading", { name: "Add an application" })).toBeVisible();
  await expect(page.locator("#new-form").getByLabel("Role")).toHaveValue("Software Intern");
  await expect(page.getByLabel("Job posting link")).toHaveValue("https://example.com/job");
  await expect(page.getByLabel("Notes")).toHaveValue("Shared from a job site");
});

test("deep-link #/new?... and quick-fill input bar autofill company, role, location, source, link, and skills", async ({ page }) => {
  await seedStarted(page);
  await page.goto("/#/new?url=https%3A%2F%2Fboards.greenhouse.io%2Ffigma%2Fjobs%2F12345&title=Job%20Application%20for%20Product%20Design%20Intern%20at%20Figma&text=Location%3A%20San%20Francisco%2C%20CA%20using%20Figma%20and%20React");
  await expect(page.getByRole("heading", { name: "Add an application" })).toBeVisible();
  await expect(page.locator("#new-form").getByLabel("Company")).toHaveValue("Figma");
  await expect(page.locator("#new-form").getByLabel("Role")).toHaveValue("Product Design Intern");
  await expect(page.locator("#new-form").getByLabel("Location")).toHaveValue("San Francisco, CA");
  await expect(page.locator("#new-form").getByLabel("Where you found it")).toHaveValue("Company website");
  await expect(page.locator("#new-form").getByLabel("Job posting link")).toHaveValue("https://boards.greenhouse.io/figma/jobs/12345");
  await expect(page.locator("#new-form").getByLabel("Skills")).toHaveValue("React, Figma");
  await page.locator('#new-dialog [data-action="close-new"]').first().click();

  // Open empty New dialog and use the quick-fill bar directly
  // The sidebar's New button is hidden on a phone; use whichever one this screen shows.
  await page.locator('[data-action="new"]:visible').first().click();
  await expect(page.locator("#new-dialog")).toBeVisible();
  await page.locator("#new-quickfill").fill("Software Engineer Intern at Stripe in Seattle, WA (Python, Go, SQL) https://boards.greenhouse.io/stripe/jobs/98765");
  await expect(page.locator("#new-form").getByLabel("Company")).toHaveValue("Stripe");
  await expect(page.locator("#new-form").getByLabel("Role")).toHaveValue("Software Engineer Intern");
  await expect(page.locator("#new-form").getByLabel("Location")).toHaveValue("Seattle, WA");
  await expect(page.locator("#new-form").getByLabel("Where you found it")).toHaveValue("Company website");
  await expect(page.locator("#new-form").getByLabel("Job posting link")).toHaveValue("https://boards.greenhouse.io/stripe/jobs/98765");
  await expect(page.locator("#new-form").getByLabel("Skills")).toHaveValue("Python, SQL");
  await page.locator('#new-form [type="submit"]').click();
  await expect(page.locator("#toasts")).toContainText("Stripe added to your notebook");

  // Verify the 1-click bookmarklet is rendered in Settings and safely handles in-app clicks
  await page.goto("/#/settings");
  const bookmarklet = page.locator("[data-bookmarklet]");
  await expect(bookmarklet).toBeVisible();
  const href = await bookmarklet.getAttribute("href");
  expect(href).toContain("javascript:");
  expect(href).toContain("#/new?");
  await bookmarklet.click();
  await expect(page.locator("#toasts")).toContainText("Drag Save to Notebook to your bookmarks bar");
});

test("privacy and account-deletion pages are public", async ({ page }) => {
  await page.goto("/privacy.html");
  await expect(page.getByRole("heading", { name: "Privacy policy" })).toBeVisible();
  await page.goto("/delete-account.html");
  await expect(page.getByRole("heading", { name: "Delete your account" })).toBeVisible();
});

test("the service worker registers and caches the app shell for offline use", async ({ page, context, browserName }) => {
  // Headless Chromium crashes in its native speech probe; voice paths use stubs in mock.spec.js.
  await page.addInitScript(() => { window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; });
  await seedNotebook(page);
  await openApp(page, "#/today");
  await page.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker.ready);
  await page.evaluate(() => navigator.serviceWorker.ready);

  // A page visited once while online should still open once the network is gone.
  await openApp(page, "#/board");
  expect(await page.evaluate(async () => Boolean(await caches.match("index.html")))).toBe(true);
  for (const module of ["js/mock-interview.js", "js/mock-interview-view.js"]) {
    expect(await page.evaluate(async url => Boolean(await caches.match(url)), module), `${module} is precached`).toBe(true);
  }
  // Playwright WebKit errors on offline navigation with a service worker. Its cache is checked
  // above; Chromium also verifies that the cached page actually reloads without network access.
  if (browserName === "webkit") return;
  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Board" })).toBeVisible({ timeout: 10000 });
    await page.goto("/#/mock/3", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Start practice", exact: true }).click();
    await expect(page.locator("#mock-answer-form")).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test("signed out, a shared job shows the landing page first and the address is tidied", async ({ page }) => {
  await page.goto("/?share-target=1&title=Software%20Intern&url=https%3A%2F%2Fexample.com%2Fjob");
  await expect(page.locator("#landing-shell")).toBeVisible();
  await expect(page.locator("#app")).toBeHidden();
  await expect(page).toHaveURL(/\/$/);
});
