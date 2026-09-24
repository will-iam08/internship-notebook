import { expect, test } from "./fixtures.js";
import { openApp, savedNotebook } from "./helpers.js";

test("separate browser profiles cannot read each other's notebook", async ({ browser, baseURL }) => {
  const firstContext = await browser.newContext({ baseURL });
  const secondContext = await browser.newContext({ baseURL });
  try {
    const first = await firstContext.newPage();
    const second = await secondContext.newPage();
    const apiRequests = [];
    first.on("request", request => {
      if (new URL(request.url()).pathname.includes("/api/")) apiRequests.push(request.url());
    });

    await openApp(first);
    await first.locator('[data-action="new"]:visible').first().click();
    await first.getByLabel("Company").fill("Private Profile Company");
    await first.getByLabel("Role").fill("Security Intern");
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
