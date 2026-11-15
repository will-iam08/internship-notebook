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
  listing("Maple Data", "Toronto, ON", { source: "canadian-tech-internships", region: "Canada", countries: ["CA"], regions: ["Ontario"], experienceLevel: "", isCoop: true, role: "Data Co-op (Winter 2027)" }),
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
const country = page => page.getByRole("combobox", { name: "Country", exact: true });
const region = page => page.getByRole("combobox", { name: "Region", exact: true });
async function expectCountries(page, labels) {
  await expect(country(page).locator("option")).toHaveText(labels);
}
test("country and region counts filter openings and both choices survive reload", async ({ page }) => {
  await seedStarted(page);
  await openApp(page);
  const items = page.locator(".news-item");
  await expect(items).toHaveCount(7);
  await expectCountries(page, ["All countries (7)", "Canada (3)", "United States (2)", "United Kingdom (1)", "Remote (1)"]);
  await expect(region(page)).toBeDisabled();
  await expect(region(page).locator("option")).toHaveText(["Choose a country first"]);
  await country(page).selectOption("CA");
  await expect(items).toHaveCount(3);
  await expect(items).toContainText(["Maple Data", "Harbour Labs", "Prairie AI"]);
  await expect(region(page)).toBeEnabled();
  await expect(region(page).locator("option")).toHaveText(["All regions (3)", "British Columbia (1)", "Ontario (1)", "Other (1)"]);
  await region(page).selectOption("Ontario");
  await expect(items).toHaveCount(1);
  await expect(items).toContainText(["Maple Data"]);
  await expect(page.locator(".news-card .card-note").first()).toContainText("1 role in Canada, Ontario");
  expect((await savedPrefs(page)).newsFilter).toMatchObject({ country: "CA", region: "Ontario" });
  await page.reload();
  await expect(country(page)).toHaveValue("CA");
  await expect(region(page)).toHaveValue("Ontario");
  await expect(items).toHaveCount(1);
  await country(page).selectOption("US");
  await expect(region(page)).toHaveValue("ALL");
  await expect(region(page).locator("option")).toHaveText(["All regions (2)", "Iowa (1)", "Texas (1)"]);
  await expect(items).toHaveCount(2);
  await country(page).selectOption("REMOTE");
  await expect(items).toHaveCount(1);
  await expect(items).toContainText(["Anywhere Co"]);
  await expect(page.locator(".news-card .card-note").first()).toContainText("1 role remote");
  await page.locator('[data-action="news-clear"]').click();
  await expect(country(page)).toHaveValue("ALL");
  await expect(region(page)).toBeDisabled();
  await expect(items).toHaveCount(7);
});
test("counts follow the other filters and a zero-match region names a way out", async ({ page }) => {
  await seedStarted(page);
  await openApp(page);
  await page.locator('[data-input="news-coop"]').check();
  await expectCountries(page, ["All countries (1)", "Canada (1)", "United States (0)", "United Kingdom (0)", "Remote (0)"]);
  await page.locator('[data-action="news-clear"]').click();
  await page.locator('[data-action="news-degree-menu"]').click();
  await page.getByRole("menuitemradio", { name: "Undergraduate or unspecified", exact: true }).click();
  await expectCountries(page, ["All countries (7)", "Canada (3)", "United States (2)", "United Kingdom (1)", "Remote (1)"]);
  await country(page).selectOption("CA");
  await region(page).selectOption("Ontario");
  await page.locator("#news-keywords").fill("Harbour");
  await expect(page.locator(".news-item")).toHaveCount(0);
  await expect(region(page)).toHaveValue("Ontario");
  await expect(region(page).locator('option[value="Ontario"]')).toHaveText("Ontario (0)");
  await expect(page.locator(".news-card .card-note").first()).toContainText("0 roles in Canada, Ontario");
  await expect(page.locator(".news-card .empty-note")).toHaveText("No openings in Ontario right now - try All regions or another country.");
  await region(page).selectOption("ALL");
  await expect(page.locator(".news-item")).toHaveCount(1);
  await expect(page.locator(".news-item")).toContainText(["Harbour Labs"]);
});
test("native selects retain focus after a change and support the keyboard", async ({ page, isMobile }) => {
  await seedStarted(page);
  await openApp(page);
  await expect(page.locator(".news-item")).toHaveCount(7);
  await country(page).focus();
  if (isMobile) await country(page).selectOption("CA");
  else {
    await page.keyboard.press("c");
    await page.keyboard.press("Enter");
  }
  await expect(country(page)).toHaveValue("CA");
  await expect(country(page)).toBeFocused();
  await region(page).focus();
  await region(page).selectOption("Ontario");
  await expect(region(page)).toBeFocused();
  await expect(page.locator(".news-item")).toHaveCount(1);
});
test("a saved coarse region migrates to a country", async ({ page }) => {
  await seedStarted(page, { newsFilter: { region: "Canada" } });
  await openApp(page);
  await expect(country(page)).toHaveValue("CA");
  await expect(region(page)).toHaveValue("ALL");
  await expect(page.locator(".news-item")).toHaveCount(3);
});
test("a saved region missing from a refreshed feed stays visible with zero openings", async ({ page }) => {
  await seedStarted(page, { newsFilter: { country: "CA", region: "Alberta" } });
  await openApp(page);
  await expect(region(page)).toHaveValue("Alberta");
  await expect(region(page).locator('option[value="Alberta"]')).toHaveText("Alberta (0)");
  await expect(page.locator(".news-card .empty-note")).toContainText("No openings in Alberta right now");
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
test("country and region selects fit 390px in light and dark mode", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedStarted(page);
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme });
    await openApp(page);
    await page.locator('[data-action="news-clear"]').click();
    await expect(page.locator(".news-item")).toHaveCount(7);
    await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
    await country(page).selectOption("CA");
    await region(page).selectOption("Ontario");
    await expect(page.locator(".news-item")).toHaveCount(1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "390px should not scroll sideways").toBeLessThanOrEqual(1);
    const fits = await page.locator(".news-places").evaluate(group => {
      const card = group.closest(".news-card").getBoundingClientRect();
      return [...group.querySelectorAll("select")].every(select => {
        const rect = select.getBoundingClientRect();
        return rect.left >= card.left && rect.right <= card.right && rect.height >= 44;
      });
    });
    expect(fits, "both selects stay inside the card and are at least 44px tall").toBe(true);
    await page.locator(".news-card").screenshot({ path: testInfo.outputPath(`news-${colorScheme}-390.png`) });
  }
});
