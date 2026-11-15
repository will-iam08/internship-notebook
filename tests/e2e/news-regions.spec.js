import { expect, test } from "./fixtures.js";
import { openApp, savedPrefs, seedStarted } from "./helpers.js";
test.use({ serviceWorkers: "block" });
const listing = (company, location, extra = {}) => ({
  company, role: `${company} Software Intern`, location, url: `https://example.com/${company.toLowerCase().replace(/\W+/g, "-")}`,
  terms: ["Summer 2027"], experienceLevel: "Junior", isCoop: false, workMode: "In-person", postedAt: "2026-11-01T12:00:00Z", ...extra
});
// Tagged rows as the fetch script writes them, plus untagged rows like an older feed file, which
// the page classifies from the location text.
const listings = [
  listing("Maple Data", "Toronto, ON", { source: "canadian-tech-internships", region: "Canada", experienceLevel: "", isCoop: true, role: "Data Co-op (Winter 2027)" }),
  listing("Harbour Labs", "Vancouver, BC, Canada", { source: "simplify", region: "Canada" }),
  listing("Prairie AI", "Remote in Canada"),
  listing("Hawkeye Tools", "Waterloo, IA"),
  listing("Lone Star", "Austin, TX", { source: "simplify", region: "United States" }),
  listing("Anywhere Co", "Remote", { workMode: "Remote" }),
  listing("Thames Systems", "London, UK")
];
const sources = [
  { id: "simplify", name: "Pitt CSC & Simplify", url: "https://github.com/SimplifyJobs/Summer2027-Internships" },
  { id: "canadian-tech-internships", name: "Canadian Tech Internships", url: "https://github.com/negarprh/Canadian-Tech-Internships-2027" }
];
test.beforeEach(async ({ page }) => {
  await page.route("**/internships.json", route => route.fulfill({
    json: { listings, sources, source: sources[0].url, generatedAt: "2026-11-01T12:00:00Z" }
  }));
});
const chip = (page, name) => page.locator(`[data-action="news-region"][data-region="${name}"]`);
async function expectCounts(page, counts) {
  for (const [region, count] of Object.entries(counts)) await expect(chip(page, region).locator("b")).toHaveText(String(count));
}
test("the region filter counts openings, shows Canada in one click, and persists", async ({ page }) => {
  await seedStarted(page);
  await openApp(page);
  const items = page.locator(".news-item");
  await expect(items).toHaveCount(7);
  await expect(page.getByRole("group", { name: "Filter openings by region" }).getByRole("button")).toHaveText([
    /^All/, /^Canada/, /^United States/, /^Remote/, /^International/
  ]);
  await expectCounts(page, { ALL: 7, Canada: 3, "United States": 2, Remote: 1, International: 1 });
  await expect(chip(page, "ALL")).toHaveAttribute("aria-pressed", "true");
  await chip(page, "Canada").click();
  await expect(chip(page, "Canada")).toHaveAttribute("aria-pressed", "true");
  await expect(chip(page, "ALL")).toHaveAttribute("aria-pressed", "false");
  await expect(items).toHaveCount(3);
  await expect(items).toContainText(["Maple Data", "Harbour Labs", "Prairie AI"]);
  await expect(page.locator(".news-card .card-note").first()).toContainText("3 roles shown, in Canada");
  expect((await savedPrefs(page)).newsFilter.region).toBe("Canada");
  await page.reload();
  await expect(chip(page, "Canada")).toHaveAttribute("aria-pressed", "true");
  await expect(items).toHaveCount(3);
  await chip(page, "United States").click();
  await expect(items).toHaveCount(2);
  await expect(items).toContainText(["Hawkeye Tools", "Lone Star"]);
  await page.locator('[data-action="news-clear"]').click();
  await expect(chip(page, "ALL")).toHaveAttribute("aria-pressed", "true");
  await expect(items).toHaveCount(7);
});
test("region counts follow the other filters, and a listing with no degree data counts as unspecified", async ({ page }) => {
  await seedStarted(page);
  await openApp(page);
  await page.locator('[data-input="news-coop"]').check();
  await expectCounts(page, { ALL: 1, Canada: 1, "United States": 0, Remote: 0, International: 0 });
  await page.locator('[data-action="news-clear"]').click();
  await page.locator('[data-action="news-degree-menu"]').click();
  await page.getByRole("menuitemradio", { name: "Undergraduate or unspecified", exact: true }).click();
  await expectCounts(page, { ALL: 7, Canada: 3 });
  await page.locator("#news-keywords").fill("Harbour");
  await expectCounts(page, { ALL: 1, Canada: 1, "United States": 0 });
});
test("region chips work from the keyboard and keep focus", async ({ page }) => {
  await seedStarted(page);
  await openApp(page);
  await chip(page, "Canada").focus();
  await page.keyboard.press("Enter");
  await expect(chip(page, "Canada")).toHaveAttribute("aria-pressed", "true");
  await expect(chip(page, "Canada")).toBeFocused();
  await expect(page.locator(".news-item")).toHaveCount(3);
  // Safari does not Tab to buttons unless the visitor turns that on, so focus the next chip directly.
  await chip(page, "United States").focus();
  await page.keyboard.press("Space");
  await expect(chip(page, "United States")).toHaveAttribute("aria-pressed", "true");
  await expect(chip(page, "United States")).toBeFocused();
  await expect(page.locator(".news-item")).toHaveCount(2);
});
test("both sources are credited and a Canadian listing is saved with its own source", async ({ page }) => {
  await seedStarted(page);
  await openApp(page);
  const credit = page.locator(".news-card").getByText(/^Sources:/);
  await expect(credit.getByRole("link", { name: "Pitt CSC & Simplify" })).toHaveAttribute("href", sources[0].url);
  await expect(credit.getByRole("link", { name: "Canadian Tech Internships" })).toHaveAttribute("href", sources[1].url);
  await page.locator(".news-item").filter({ hasText: "Maple Data" }).locator('[data-action="news-save"]').click();
  await expect(page.locator('#new-form [name="source"]')).toHaveValue("Canadian Tech Internships");
});
test("the region filter fits a 390px phone and Canada is one tap away", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedStarted(page);
  await openApp(page);
  await expect(page.locator(".news-item")).toHaveCount(7, { timeout: 15000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "390px should not scroll sideways").toBeLessThanOrEqual(1);
  const fits = await page.locator(".news-regions").evaluate(group => {
    const card = group.closest(".news-card").getBoundingClientRect();
    return [...group.querySelectorAll(".filter-chip")].every(button => {
      const rect = button.getBoundingClientRect();
      return rect.left >= card.left && rect.right <= card.right && rect.height >= 44;
    });
  });
  expect(fits, "every region chip is inside the card and at least 44px tall").toBe(true);
  await expect(chip(page, "Canada")).toBeVisible();
  await chip(page, "Canada").click();
  await expect(page.locator(".news-item")).toHaveCount(3);
});
