import { expect, test } from "./fixtures.js";
import { openApp, seedNotebook } from "./helpers.js";

test.use({ serviceWorkers: "block" });

test("usage opt-out is labelled, persists, and keeps the local notebook usable", async ({ page }) => {
  await seedNotebook(page);
  await openApp(page, "#/settings");
  const toggle = page.getByRole("switch", { name: "Share basic usage counts" });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await openApp(page, "#/notebook");
  await expect(page.getByRole("heading", { name: "All pages", exact: true })).toBeVisible();
});

test("a browser privacy signal overrides the setting", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, "globalPrivacyControl", { value: true }); });
  await seedNotebook(page);
  await openApp(page, "#/settings");
  const toggle = page.getByRole("switch", { name: "Share basic usage counts" });
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: "Off because your browser requests no tracking." })).toBeVisible();
});
