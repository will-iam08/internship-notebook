// Interview prep: the question card on an application page and "Practice next" on Today.
import { readFile } from "node:fs/promises";
import { expect, routeSite, test } from "./fixtures.js";
import { DATA_KEY, PREFS_KEY, openApp, sampleApplications, savedNotebook, seedNotebook, seedStarted } from "./helpers.js";

const JOINS = "What's the difference between an inner join and a left join?";
const MESSY = "How do you handle missing or messy data?";

/** Seeds preferences once per test (alongside seedNotebook's data). */
async function seedPrefs(page, prefs) {
  await page.addInitScript(([key, value]) => {
    if (!sessionStorage.getItem("seeded-prefs")) { localStorage.setItem(key, value); sessionStorage.setItem("seeded-prefs", "1"); }
  }, [PREFS_KEY, JSON.stringify({ started: true, ...prefs })]);
}

/** The Practiced or Stuck button for one question, found by the question's text. */
const mark = (scope, question, label) => scope.locator(".prep-q").filter({ hasText: question }).getByRole("button", { name: label });
const savedInterview = async (page, id) => (await savedNotebook(page)).applications.find(entry => entry.id === id).interview;

let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", error => errors.push(error.message));
});
test.afterEach(() => { expect(errors).toEqual([]); });

test("an interview-stage page shows prep that matches the role, and marking it persists after reload", async ({ page }) => {
  await seedNotebook(page);
  await openApp(page, "#/entry/3"); // Harbour Health, Data Analyst Co-op, Interview stage
  const prep = page.locator("#prep");
  await expect(prep.getByText("Interview prep", { exact: true })).toBeVisible();
  // Technical leads before an interview, with data questions for a data role.
  await expect(prep.locator(".prep-group").first()).toHaveAttribute("data-group", "behavioral");
  await expect(prep.locator('.prep-group[data-group="technical"]')).toHaveAttribute("open", "");
  await expect(prep.locator('.prep-group[data-group="behavioral"]')).not.toHaveAttribute("open", "");
  await expect(prep.getByText(JOINS, { exact: true })).toBeVisible();
  await expect(prep.getByText("When would you use a hash map instead of a list?")).toHaveCount(0);

  const summary = prep.locator(".prep-summary");
  const before = await summary.textContent();
  expect(before).toMatch(/^0 of \d+ practiced$/);
  // From the keyboard, focus stays on the button through the in-place redraw.
  await mark(prep, JOINS, "Practiced").focus();
  await page.keyboard.press("Enter");
  await expect(mark(prep, JOINS, "Practiced")).toHaveAttribute("aria-pressed", "true");
  await expect(mark(prep, JOINS, "Practiced")).toBeFocused();
  await expect(summary).toHaveText(/^1 of \d+ practiced$/);
  await expect(prep.locator('[role="progressbar"]')).toHaveAttribute("aria-valuenow", "1");
  await expect(page.locator("#save-state")).toHaveClass(/synced/, { timeout: 6000 });
  expect(await savedInterview(page, 3)).toEqual({ "t-data-joins": { status: "practiced" } });

  await page.reload();
  await page.locator("#prep").waitFor();
  await expect(mark(page.locator("#prep"), JOINS, "Practiced")).toHaveAttribute("aria-pressed", "true");
  // Pressing it again clears it.
  await mark(page.locator("#prep"), JOINS, "Practiced").click();
  await expect(page.locator("#prep .prep-summary")).toHaveText(/^0 of \d+ practiced$/);
  await expect(page.locator("#save-state")).toHaveClass(/synced/, { timeout: 6000 });
  expect(await savedInterview(page, 3)).toBeUndefined();
});

test("a stuck question takes a note that is saved, and the filter shows only what's left", async ({ page }) => {
  await seedNotebook(page);
  await openApp(page, "#/entry/3");
  const prep = page.locator("#prep");
  await mark(prep, MESSY, "Stuck").click();
  const row = prep.locator(".prep-q").filter({ hasText: MESSY });
  await row.getByRole("button", { name: "Add note" }).click();
  const note = row.getByRole("textbox");
  await expect(note).toBeFocused();
  await note.fill("Use the survey-cleaning project");
  await expect(page.locator("#save-state")).toHaveClass(/synced/, { timeout: 6000 });
  expect(await savedInterview(page, 3)).toEqual({ "t-data-messy": { status: "stuck", note: "Use the survey-cleaning project" } });

  await mark(prep, JOINS, "Practiced").click();
  await prep.getByLabel("Only to practice").check();
  await expect(prep.getByText(JOINS, { exact: true })).toHaveCount(0);
  await expect(prep.getByText(MESSY, { exact: true })).toBeVisible(); // stuck still needs practice
  await prep.getByLabel("Only to practice").uncheck();
  await expect(prep.getByText(JOINS, { exact: true })).toBeVisible();

  await page.reload();
  const reloaded = page.locator("#prep .prep-q").filter({ hasText: MESSY });
  await expect(reloaded.getByRole("textbox")).toHaveValue("Use the survey-cleaning project");
  await expect(reloaded.getByRole("button", { name: "Stuck" })).toHaveAttribute("aria-pressed", "true");
});

test("Today shows Practice next for the interview-stage page and marks from there", async ({ page }) => {
  await seedNotebook(page);
  await openApp(page, "#/today");
  const card = page.locator(".practice-card");
  await expect(card).toContainText("For Harbour Health");
  await expect(card.locator(".prep-q")).toHaveCount(3);
  const first = (await card.locator(".prep-text").first().textContent()).trim();
  await card.locator(".prep-q").first().getByRole("button", { name: "Practiced" }).click();
  await expect(card.getByText(first, { exact: true })).toHaveCount(0); // replaced by the next question
  await expect(card.locator(".prep-q")).toHaveCount(3);
  await expect(card).toContainText("1 of ");
  expect(Object.values(await savedInterview(page, 3))).toEqual([{ status: "practiced" }]);
  await card.getByRole("button", { name: "All questions" }).click();
  await expect(page).toHaveURL(/#\/entry\/3$/);
  await expect(page.locator("#prep-title")).toBeFocused();
});

test("the interviews focus area puts Practice next near the top, even before any interview", async ({ page }) => {
  const noInterviews = sampleApplications().filter(entry => entry.status !== "INTERVIEW");
  await seedNotebook(page, noInterviews);
  await seedPrefs(page, { focusAreas: ["interviews"] });
  await openApp(page, "#/today");
  const cards = page.locator(".today-grid > .card");
  await expect(cards.nth(0)).toHaveClass(/interviews-card/);
  await expect(cards.nth(1)).toHaveClass(/practice-card/);
  await expect(page.locator(".practice-card")).toContainText("For Blue Fjord Energy"); // the most recently edited open page
});

test("without the focus area or an interview, Today has no Practice next card", async ({ page }) => {
  await seedNotebook(page, sampleApplications().filter(entry => entry.status !== "INTERVIEW"));
  await openApp(page, "#/today");
  await expect(page.locator(".strip")).toBeVisible();
  await expect(page.locator(".practice-card")).toHaveCount(0);
});

test("prep progress survives a backup export and import into a fresh notebook, and shows in Markdown", async ({ page, browser, baseURL }) => {
  await seedNotebook(page);
  await openApp(page, "#/entry/3");
  await mark(page.locator("#prep"), JOINS, "Practiced").click();
  await mark(page.locator("#prep"), MESSY, "Stuck").click();
  await expect(page.locator("#save-state")).toHaveClass(/synced/, { timeout: 6000 });
  await openApp(page, "#/export");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download backup" }).click()]);
  const backup = await readFile(await download.path(), "utf8");
  expect(JSON.parse(backup).applications.find(entry => entry.id === 3).interview).toEqual({ "t-data-joins": { status: "practiced" }, "t-data-messy": { status: "stuck" } });
  const [md] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download Markdown" }).click()]);
  expect(await readFile(await md.path(), "utf8")).toContain("- **Interview prep:** 1 practiced, 1 stuck");

  // A different browser profile with an empty, started notebook imports the file.
  const context = await browser.newContext({ baseURL });
  await routeSite(context, baseURL); // a new context is not covered by the fixture's file routing
  const fresh = await context.newPage();
  await seedStarted(fresh);
  await openApp(fresh, "#/settings");
  await fresh.locator("#import-file").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(backup) });
  await fresh.getByRole("button", { name: "Import", exact: true }).click();
  await expect.poll(async () => (await fresh.evaluate(key => JSON.parse(localStorage.getItem(key)).applications.length, DATA_KEY))).toBe(6);
  const harbour = await fresh.evaluate(key => JSON.parse(localStorage.getItem(key)).applications.find(entry => entry.company === "Harbour Health"), DATA_KEY);
  await openApp(fresh, `#/entry/${harbour.id}`);
  await expect(mark(fresh.locator("#prep"), JOINS, "Practiced")).toHaveAttribute("aria-pressed", "true");
  await expect(mark(fresh.locator("#prep"), MESSY, "Stuck")).toHaveAttribute("aria-pressed", "true");
  await context.close();
});

test("390px wide: the prep card fits with 44px targets", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedNotebook(page);
  await openApp(page, "#/entry/3");
  await page.locator("#prep").scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const small = await page.locator("#prep button:visible, #prep summary:visible, #prep .prep-filter:visible")
    .evaluateAll(elements => elements.filter(element => Math.round(element.getBoundingClientRect().height) < 44).map(element => element.textContent.trim()));
  expect(small).toEqual([]);
});
