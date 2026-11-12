// The notebook builder (#/build): three questions, a review, then one real notebook.
import { expect, test } from "./fixtures.js";
import { openBuilder, openWelcome, savedNotebook, savedPrefs } from "./helpers.js";

const next = page => page.getByRole("button", { name: "Next" }).click();
const create = page => page.getByRole("button", { name: "Create my notebook" }).click();
const step = (page, number) => expect(page.locator(".build-count")).toHaveText(`Step ${number} of 3`);

async function fillDetails(page, { name = "Jordan", role = "Software Engineering Intern", season = "Summer", companies } = {}) {
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Target role").fill(role);
  await page.getByLabel("Season").selectOption(season);
  if (companies !== undefined) await page.getByLabel(/Target companies/).fill(companies);
}

test.describe("building a notebook", () => {
  test("welcome CTA -> template, internship search, deadlines -> a real, started notebook on Today", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/media/demo-tour.mp4", route => route.abort());
    await openWelcome(page);
    await page.getByRole("button", { name: "Build my notebook" }).first().click();
    await expect(page).toHaveURL(/#\/build$/);
    await expect(page.locator(".demo-banner")).toHaveCount(0);

    await step(page, 1);
    await expect(page.getByRole("radio", { name: /Start from a template/ })).toBeChecked();
    await next(page);
    await step(page, 2);
    await expect(page.getByRole("checkbox", { name: /Internship search/ })).toBeChecked();
    await next(page);
    await step(page, 3);
    await expect(page.getByRole("checkbox", { name: /Never miss a deadline/ })).toBeChecked();
    await fillDetails(page, { companies: "Kitebird Systems" });

    // The review lists exactly what will be created.
    const summary = page.locator("[data-build-summary]");
    await expect(summary).toContainText("Jordan's notebook for Summer Software Engineering Intern roles.");
    await expect(summary.locator(".build-pages li")).toHaveCount(3);
    await expect(summary).toContainText("Kitebird Systems");
    await expect(summary).toContainText("Weekly goal: 6 applications.");
    // Nothing is written while the visitor is still choosing.
    expect(await savedNotebook(page)).toBeNull();

    await create(page);
    await expect(page).toHaveURL(/#\/today$/);
    await expect(page.locator("#toasts")).toContainText("Your notebook is ready.");
    await expect(page.locator(".demo-banner")).toHaveCount(0); // demo mode is off
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/, Jordan\.$/);

    const data = await savedNotebook(page);
    expect(data.applications.map(entry => entry.company)).toEqual(["Northwind Labs", "Lumen Analytics", "Kitebird Systems"]);
    expect(data.applications.every(entry => entry.id > 0)).toBe(true);
    const prefs = await savedPrefs(page);
    expect(prefs).toMatchObject({ started: true, name: "Jordan", targetRole: "Software Engineering Intern", season: "Summer", goal: 6, focusAreas: ["deadlines"], targetCompanies: ["Kitebird Systems"] });

    // The deadlines focus leads Today with "Next up"; the example's deadline is in it.
    await expect(page.locator(".today-grid > .card").first()).toHaveClass(/upcoming-card/);
    await expect(page.locator(".upcoming-card")).toContainText("Apply to Northwind Labs");
    // A reload keeps the real notebook (no demo, no welcome page).
    await page.reload();
    await page.locator("#view .view-head").waitFor();
    await expect(page).toHaveURL(/#\/today$/);
    await expect(page.locator(".demo-banner")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("Start empty creates an empty notebook that is still started", async ({ page }) => {
    await openBuilder(page);
    await page.getByRole("radio", { name: /Start empty/ }).check();
    await next(page);
    await next(page);
    await expect(page.getByLabel(/Target companies/)).toHaveCount(0); // no pages, so no companies field
    await fillDetails(page);
    await expect(page.locator("[data-build-summary]")).toContainText("starting empty");
    await create(page);
    await expect(page).toHaveURL(/#\/today$/);
    await expect(page.getByText("Every internship application, one tidy notebook.")).toBeVisible();
    expect((await savedNotebook(page)).applications).toEqual([]);
    expect((await savedPrefs(page)).started).toBe(true);
    await expect(page.locator(".demo-banner")).toHaveCount(0);
  });

  test("Import my applications creates the notebook and opens the import picker", async ({ page }) => {
    await openBuilder(page);
    await page.getByRole("radio", { name: /Import my applications/ }).check();
    await next(page);
    await next(page);
    await fillDetails(page);
    let chooser = page.waitForEvent("filechooser", { timeout: 4000 }).catch(() => null);
    await create(page);
    await expect(page).toHaveURL(/#\/today$/);
    let picker = await chooser;
    if (!picker) {
      // Some engines only open a picker during a click; the toast's button is that click.
      chooser = page.waitForEvent("filechooser");
      await page.locator("#toasts").getByRole("button", { name: "Choose file" }).click();
      picker = await chooser;
    }
    await picker.setFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ format: "my-internship-notebook-backup", version: 2, applications: [{ company: "Kitebird Systems", role: "Data Intern", status: "APPLIED" }] }))
    });
    await page.getByRole("button", { name: "Import" }).click();
    await expect.poll(async () => (await savedNotebook(page)).applications.map(entry => entry.company)).toEqual(["Kitebird Systems"]);
    expect((await savedPrefs(page)).started).toBe(true);
  });

  test("focus areas shape Today: interviews and responses lead, minimal drops the extras", async ({ page }) => {
    await openBuilder(page);
    await next(page);
    await next(page);
    await page.getByRole("checkbox", { name: /Never miss a deadline/ }).uncheck();
    for (const name of [/Track who replied/, /Prepare for interviews/, /Keep it minimal/]) await page.getByRole("checkbox", { name }).check();
    await fillDetails(page);
    await create(page);
    await expect(page).toHaveURL(/#\/today$/);
    const cards = page.locator(".today-grid > .card");
    await expect(cards.nth(0)).toHaveClass(/interviews-card/);
    await expect(cards.nth(1)).toHaveClass(/responses-card/);
    await expect(page.locator(".interviews-card")).toContainText("First-round interview"); // the Interview example
    await expect(page.locator(".responses-card")).toContainText("response rate");
    await expect(page.locator(".recent-card")).toHaveCount(0);
    await expect(page.locator(".news-card")).toHaveCount(0);
    expect((await savedPrefs(page)).goal).toBe(3);
  });
});

test.describe("the wizard", () => {
  test.beforeEach(async ({ page }) => { await openBuilder(page); });

  test("an empty target role blocks Create, is flagged on the field, and writes nothing", async ({ page }) => {
    await next(page);
    await next(page);
    await fillDetails(page, { role: "   " });
    await create(page);
    const role = page.getByLabel("Target role");
    await expect(page.locator("#error-targetRole")).toHaveText("Enter the role you're targeting.");
    await expect(role).toHaveAttribute("aria-invalid", "true");
    await expect(role).toBeFocused();
    await expect(page).toHaveURL(/#\/build$/);
    expect(await savedNotebook(page)).toBeNull();
    expect(await savedPrefs(page)).toBeNull();
    // Fixing it lets the visitor through.
    await role.fill("Data Intern");
    await create(page);
    await expect(page).toHaveURL(/#\/today$/);
  });

  test("Back and Next keep every choice and typed value", async ({ page }) => {
    await page.getByRole("radio", { name: /Start empty/ }).check();
    await next(page);
    await page.getByRole("checkbox", { name: /Internship search/ }).uncheck();
    await page.getByRole("checkbox", { name: /Co-op terms/ }).check();
    await page.getByRole("checkbox", { name: /Research positions/ }).check();
    await next(page);
    await page.getByRole("checkbox", { name: /Prepare for interviews/ }).check();
    await page.getByLabel("Your name").fill("Sam");
    await page.getByRole("button", { name: "Back" }).click();
    await step(page, 2);
    await page.getByRole("button", { name: "Back" }).click();
    await step(page, 1);
    await expect(page.getByRole("radio", { name: /Start empty/ })).toBeChecked();
    await next(page);
    await expect(page.getByRole("checkbox", { name: /Co-op terms/ })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: /Research positions/ })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: /Internship search/ })).not.toBeChecked();
    await next(page);
    await expect(page.getByRole("checkbox", { name: /Prepare for interviews/ })).toBeChecked();
    await expect(page.getByLabel("Your name")).toHaveValue("Sam");
  });

  test("use cases stop at two and say why; at least one is required", async ({ page }) => {
    await next(page);
    await page.getByRole("checkbox", { name: /New grad roles/ }).check();
    const third = page.getByRole("checkbox", { name: /Just exploring/ });
    await third.click();
    await expect(third).not.toBeChecked();
    await expect(page.locator("#build-use-limit")).toHaveText("You can pick up to 2. Unselect one to choose this.");
    await page.getByRole("checkbox", { name: /Internship search/ }).uncheck();
    await page.getByRole("checkbox", { name: /New grad roles/ }).uncheck();
    await next(page);
    await step(page, 2);
    await expect(page.locator("#error-useCases")).toHaveText("Pick at least one.");
  });

  test("progress is visible and announced, and the options work from the keyboard", async ({ page }) => {
    await expect(page.locator(".build-track [aria-current='step']")).toContainText("Start");
    // Enter on an option card moves on, like Enter in a text field.
    await page.getByRole("radio", { name: /Start from a template/ }).focus();
    await page.keyboard.press("ArrowDown"); // native radio group: arrows move and select
    await expect(page.getByRole("radio", { name: /Start empty/ })).toBeChecked();
    await page.keyboard.press("Enter");
    await step(page, 2);
    await expect(page.locator("#announcer")).toHaveText("Step 2 of 3");
    await expect(page.locator("#build-step-title")).toBeFocused();
    await expect(page.locator("#build-step-title")).toHaveText("What are you using it for?");
    await expect(page.locator(".build-track [aria-current='step']")).toContainText("Purpose");
    // Chips are checkboxes: Space toggles them.
    const coop = page.getByRole("checkbox", { name: /Co-op terms/ });
    await coop.focus();
    await page.keyboard.press("Space");
    await expect(coop).toBeChecked();
    await page.keyboard.press("Space");
    await expect(coop).not.toBeChecked();
    await page.keyboard.press("Enter");
    await step(page, 3);
    await expect(page.locator("#announcer")).toHaveText("Step 3 of 3");
  });

  test("Not now returns to the demo, which is still running", async ({ page }) => {
    await page.getByRole("link", { name: "Not now, back to the demo" }).click();
    await expect(page).toHaveURL(/#\/today$/);
    await expect(page.locator(".demo-banner")).toBeVisible();
    await expect(page.locator("#view")).toContainText("Northwind Robotics");
  });

  test("390px wide: no sideways scroll and 44px targets on every step", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const number of [1, 2, 3]) {
      await step(page, number);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `step ${number}`).toBeLessThanOrEqual(0);
      const small = await page.locator("#build-form .build-option:visible, #build-form .build-chip:visible, #build-form button:visible, #build-form a:visible, #build-form input[type=text]:visible, #build-form select:visible")
        .evaluateAll(elements => elements.filter(element => Math.round(element.getBoundingClientRect().height) < 44).map(element => element.textContent.trim() || element.name));
      expect(small, `step ${number}`).toEqual([]);
      if (number < 3) await next(page);
    }
  });
});
