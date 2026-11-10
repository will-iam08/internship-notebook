import { ROUTE_FILES, expect, test } from "./fixtures.js";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openApp, savedNotebook, seedStarted } from "./helpers.js";

/** Installs the same file-serving route interceptor used by the fixtures on a manually-created
 *  context. Required in PW_ROUTE_FILES=1 mode, where the base fixture only routes the page fixture's
 *  context, not independently created contexts. */
async function installRouting(context, baseURL) {
  if (!ROUTE_FILES) return;
  const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../_site");
  const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
  await context.route(`${baseURL}/**`, async route => {
    const { pathname } = new URL(route.request().url());
    const file = path.join(site, pathname.endsWith("/") ? `${pathname}index.html` : pathname);
    try {
      const body = await readFile(file);
      await route.fulfill({ status: 200, body, headers: { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" } });
    } catch {
      await route.fulfill({ status: 404, body: "Not found" });
    }
  });
}

test("separate browser profiles cannot read each other's notebook", async ({ browser, baseURL }) => {
  const firstContext = await browser.newContext({ baseURL });
  const secondContext = await browser.newContext({ baseURL });
  await installRouting(firstContext, baseURL);
  await installRouting(secondContext, baseURL);
  try {
    const first = await firstContext.newPage();
    const second = await secondContext.newPage();
    const apiRequests = [];
    first.on("request", request => {
      if (new URL(request.url()).pathname.includes("/api/")) apiRequests.push(request.url());
    });

    await seedStarted(first); // first profile is a real, started notebook (not the demo)
    await openApp(first);
    await first.locator('[data-action="new"]:visible').first().click();
    await first.locator('#new-form [name="company"]').fill("Private Profile Company");
    await first.locator("#new-form").getByLabel("Role").fill("Security Intern");
    await first.getByRole("button", { name: "Add to notebook" }).click();
    await expect(first.locator("#toasts")).toContainText("Private Profile Company added");
    expect((await savedNotebook(first)).applications).toHaveLength(1);

    await openApp(second, "#/notebook");
    await expect(second.getByText("Private Profile Company")).toHaveCount(0);
    expect(await savedNotebook(second)).toBeNull();
    expect(apiRequests).toEqual([]);
  } finally {
    await firstContext.close();
    await secondContext.close();
  }
});

test("content security policy blocks injected inline scripts", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.__injectedScriptRan = true";
    document.head.append(script);
  });
  expect(await page.evaluate(() => window.__injectedScriptRan)).toBeUndefined();
});

test("the public app hides itself when another page frames it", async ({ page, baseURL }) => {
  await page.setContent(`<iframe src="${baseURL}/"></iframe>`);
  const frame = page.frames().find(candidate => candidate !== page.mainFrame());
  await frame.waitForLoadState("domcontentloaded");
  await expect(frame.locator("html")).toHaveCSS("display", "none");
});
