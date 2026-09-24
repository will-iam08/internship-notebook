// Covers the specific mobile layout requirements: single-column entry details, Board stage tabs
// replacing the five-column scroller, the "Move to..." touch control, collapsed quick-add
// fields, and that nothing overflows horizontally at 320/375/390/430px.
import { expect, test } from "./fixtures.js";
import { openApp, seedNotebook } from "./helpers.js";

// These are mobile/touch layout tests: force a touch-capable context (pointer: coarse) regardless
// of which project runs the file, so "Move to..." and the stage tabs behave the same everywhere
// instead of only appearing under the iphone-webkit project.
test.use({ hasTouch: true });

const widths = [320, 375, 390, 430];

for (const width of widths) {
  test(`no horizontal overflow at ${width}px on Today, Board, and an entry page`, async ({ page }) => {
    await page.setViewportSize({ width, height: 860 });
    await seedNotebook(page);
    for (const route of ["#/today", "#/board", "#/entry/3"]) {
      await openApp(page, route);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${route} should not scroll sideways at ${width}px`).toBeLessThanOrEqual(1);
    }
  });
}

test("entry details are single-column below 560px and the title never breaks layout", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 860 });
  await seedNotebook(page);
  await openApp(page, "#/entry/1");
  const columns = await page.locator(".details").evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length);
  expect(columns).toBe(1);
});

test("Board shows stage tabs and one column at a time below 760px, with a Move to control", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 860 });
  await seedNotebook(page);
  await openApp(page, "#/board");
  await expect(page.locator(".board-stage-tabs")).toBeVisible();
  await expect(page.locator(".column.active-stage")).toHaveCount(1);
  await expect(page.locator(".column:not(.active-stage)").first()).toBeHidden();
  await expect(page.locator(".move-button").first()).toBeVisible();

  await page.getByRole("tab", { name: /Interview/ }).click();
  await expect(page.locator('.column[data-stage="INTERVIEW"]')).toHaveClass(/active-stage/);
});

test("quick add shows only Company, Role, and Stage until More details is opened", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 860 });
  await openApp(page);
  // Same trap as the touch-targets test above: [data-action="new"] also matches the desktop
  // sidebar's button (.cover-new, hidden below 1024px), which `.first()` picks in DOM order.
  // Clicking it at 320px waits for it to become visible and times out instead of failing fast.
  // .bottom-new is the mobile FAB this test is actually about.
  await page.locator(".bottom-new").click();
  await expect(page.locator('#new-form [name="deadline"]')).toBeHidden();
  await page.getByText("More details").click();
  await expect(page.locator('#new-form [name="deadline"]')).toBeVisible();
});

test("touch targets: icon buttons and the pipeline stepper are at least 44px tall", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 860 });
  await seedNotebook(page);
  await openApp(page, "#/entry/1");
  // There are two [data-action="palette"] buttons: the desktop sidebar's (hidden below 1024px)
  // and the mobile top bar's. `.first()` picks DOM order, which is the hidden sidebar one - its
  // boundingBox() is null (not "zero-size"), so asserting through it threw instead of failing on
  // an actual measurement. Scope to the one this test is actually about: the visible mobile bar.
  const searchBox = await page.locator('.mobile-bar [data-action="palette"]').boundingBox();
  expect(searchBox.height).toBeGreaterThanOrEqual(44);
  const step = await page.locator(".step").first().boundingBox();
  expect(step.height).toBeGreaterThanOrEqual(44);
});
