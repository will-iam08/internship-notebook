import { expect, test } from "./fixtures.js";
import { openApp, savedNotebook, seedNotebook } from "./helpers.js";

test("loads every section without script errors", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await seedNotebook(page);
  for (const route of ["#/today", "#/board", "#/notebook", "#/insights", "#/deleted", "#/settings", "#/entry/3"]) {
    await openApp(page, route);
  }
  await expect(page.locator(".entry-role")).toHaveValue("Data Analyst Co-op");
  expect(errors).toEqual([]);
});

test("adds an application and opens its page", async ({ page }) => {
  await openApp(page);
  await page.locator('[data-action="new"]:visible').first().click();
  await page.getByLabel("Company").fill("Acme Aerospace");
  await page.getByLabel("Role").fill("Flight Software Intern");
  await page.getByRole("button", { name: "Add to notebook" }).click();
  await expect(page.locator("#toasts")).toContainText("Acme Aerospace added");
  const data = await savedNotebook(page);
  expect(data.applications.map(entry => entry.company)).toContain("Acme Aerospace");
});
