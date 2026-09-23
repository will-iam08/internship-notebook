// Covers: hash routing basics, the skip link, keyboard shortcuts, and the stage-picker
// radiogroup's keyboard behavior.
import { expect, test } from "./fixtures.js";
import { openApp, seedNotebook } from "./helpers.js";

test("hash routes render the right view and back/forward work", async ({ page }) => {
  await seedNotebook(page);
  await openApp(page, "#/today");
  await expect(page).toHaveTitle(/Today/);
  await page.goto("/#/board");
  await expect(page).toHaveTitle(/Board/);
  await expect(page.getByRole("heading", { name: "Board" })).toBeVisible();
  await page.goto("/#/entry/1");
  await expect(page.locator(".entry-company")).toHaveValue("Northwind Labs");
});

test("skip link moves focus into the content without resetting the route", async ({ page }) => {
  await seedNotebook(page);
  await openApp(page, "#/board");
  await page.keyboard.press("Tab"); // the skip link is the first focusable element
  await expect(page.locator(".skip-link")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#view")).toBeFocused();
  expect(page.url()).toContain("#/board");
});

test("the All pages tab stays highlighted while an application page is open", async ({ page }) => {
  await seedNotebook(page);
  await openApp(page, "#/entry/1");
  await expect(page.locator('[data-nav="notebook"]').first()).toHaveAttribute("aria-current", "page");
});

test("N opens the new-application dialog and / opens search", async ({ page }) => {
  await seedNotebook(page);
  await openApp(page, "#/today");
  await page.keyboard.press("n");
  await expect(page.locator("#new-dialog")).toBeVisible();
  await page.locator('[data-action="close-new"]').first().click();
  await expect(page.locator("#new-dialog")).toBeHidden();

  await page.keyboard.press("/");
  await expect(page.locator("#palette")).toBeVisible();
  await expect(page.locator("#palette-input")).toBeFocused();
});

test("the stage picker is a proper radiogroup: arrow keys move the selection", async ({ page }) => {
  await seedNotebook(page);
  await openApp(page, "#/today");
  await page.keyboard.press("n");
  const group = page.locator("#new-stage");
  await expect(group).toHaveAttribute("role", "radiogroup");
  await group.locator('[data-stage="SAVED"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect(group.locator('[data-stage="APPLIED"]')).toHaveAttribute("aria-checked", "true");
  await expect(group.locator('[data-stage="APPLIED"]')).toBeFocused();
  await page.keyboard.press("End");
  await expect(group.locator('[data-stage="REJECTED"]')).toHaveAttribute("aria-checked", "true");
});

test("focus returns to the view when the opening control is destroyed by a rerender", async ({ page }) => {
  await seedNotebook(page);
  await openApp(page, "#/board");
  // The "+" on a board column lives inside #view and is destroyed when the board rerenders.
  await page.locator('.column[data-stage="SAVED"] [data-action="new"]').click();
  await page.fill('#new-form [name="company"]', "Rerender Focus Co");
  await page.fill('#new-form [name="role"]', "QA Intern");
  await page.locator('#new-form [type="submit"]').click();
  await expect(page.locator("#new-dialog")).toBeHidden();
  await expect(page.locator("#view")).toBeFocused();
});
