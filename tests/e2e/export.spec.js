// Reminders and exports (#/export): calendar file, Markdown, backup, print, mail digest, and the
// opt-in due-soon notification.
import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures.js";
import { PREFS_KEY, openApp, seedNotebook, seedStarted } from "./helpers.js";

/** Clicks a download button and returns { name, text } of the file it produced. */
async function downloaded(page, trigger) {
  const [file] = await Promise.all([page.waitForEvent("download"), trigger()]);
  return { name: file.suggestedFilename(), text: await readFile(await file.path(), "utf8") };
}

/** A stand-in Notification API: records what would be shown, and remembers the granted
 *  permission for the tab (sessionStorage) so a reload behaves like a real browser. */
async function fakeNotifications(page) {
  await page.addInitScript(() => {
    window.__notices = [];
    class FakeNotification {
      constructor(title, options = {}) { window.__notices.push({ title, body: options.body }); }
      close() {}
      static get permission() { return sessionStorage.getItem("fake-permission") || "default"; }
      static async requestPermission() { sessionStorage.setItem("fake-permission", "granted"); return "granted"; }
    }
    window.Notification = FakeNotification;
  });
}

let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", error => errors.push(error.message));
});
test.afterEach(() => { expect(errors).toEqual([]); });

test("the calendar file is a real VCALENDAR with reminders for upcoming dates", async ({ page }) => {
  await seedNotebook(page);
  await openApp(page, "#/export");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reminders and exports.");
  await expect(page.locator(".export-card").first()).toContainText("upcoming events");
  const { name, text } = await downloaded(page, () => page.getByRole("button", { name: "Download calendar file" }).click());
  expect(name).toMatch(/^internship-notebook-reminders-\d{4}-\d{2}-\d{2}\.ics$/);
  expect(text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
  expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
  expect(text).toContain("BEGIN:VEVENT\r\n");
  expect(text).toContain("SUMMARY:Apply to Northwind Labs (Backend Developer Intern)");
  expect(text).toContain("UID:3-interview@internshipnotebook.app");
  expect(text).toContain("TRIGGER:-P1D");
  expect(text).toContain("TRIGGER:-PT2H");
  expect(text).not.toContain("Lumen Games"); // a Rejected page has no reminders
});

test("Markdown and backup downloads contain the notebook", async ({ page }) => {
  await seedNotebook(page);
  await openApp(page, "#/export");
  const md = await downloaded(page, () => page.getByRole("button", { name: "Download Markdown" }).click());
  expect(md.name).toMatch(/\.md$/);
  expect(md.text).toMatch(/^# My internship notebook\n\nExported \d{4}-\d{2}-\d{2}\. 6 applications\./);
  expect(md.text).toContain("| Company | Role | Stage | Deadline | Next step |");
  expect(md.text).toContain("## Harbour Health: Data Analyst Co-op");
  expect(md.text).toContain("- **Next step:** Technical interview, ");
  expect(md.text).toContain("> Met the hiring manager at the career fair.");
  const backup = await downloaded(page, () => page.getByRole("button", { name: "Download backup" }).click());
  expect(JSON.parse(backup.text)).toMatchObject({ format: "my-internship-notebook-backup", applications: expect.any(Array) });
  expect(JSON.parse(backup.text).applications).toHaveLength(6);
});

test("the digest link is a prefilled, encoded mailto: and the address is remembered locally", async ({ page }) => {
  await seedNotebook(page);
  await openApp(page, "#/export");
  const link = page.getByRole("link", { name: "Open in my mail app" });
  await expect(page.locator("[data-digest-link]")).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator("[data-digest-link]")).not.toHaveAttribute("href", /.*/);
  await page.getByLabel("Your email").fill("jo.doe+jobs@example.com");
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^mailto:jo\.doe%2Bjobs@example\.com\?subject=Internship%20notebook%3A%20week%20of%20/);
  expect(href).toContain("%0D%0A"); // CRLF line breaks
  expect(href).not.toMatch(/[\s\n]/);
  const body = new URL(href).searchParams.get("body");
  expect(body).toContain("This week\r\n- ");
  expect(body).toContain("Follow up with Maple Robotics");
  expect(body).toContain("the site does not send email.");
  await expect(page.locator(".export-preview pre")).toContainText("Deadlines in the next 14 days", { useInnerText: false });
  await expect(page.getByText("This site can't send email")).toBeVisible();
  // Stored in this browser only, and back after a reload.
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).digestEmail, PREFS_KEY)).toBe("jo.doe+jobs@example.com");
  await page.reload();
  await expect(page.getByLabel("Your email")).toHaveValue("jo.doe+jobs@example.com");
  await expect(link).toHaveAttribute("href", /^mailto:/);
});

test("Print calls window.print, and print media shows the paper sheet instead of the buttons", async ({ page }) => {
  await seedNotebook(page);
  await openApp(page, "#/export");
  await page.evaluate(() => { window.__prints = 0; window.print = () => { window.__prints += 1; }; });
  await page.getByRole("button", { name: "Print" }).click();
  expect(await page.evaluate(() => window.__prints)).toBe(1);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".print-sheet")).toBeVisible();
  await expect(page.locator(".export-list")).toBeHidden();
  await expect(page.locator(".print-sheet tbody tr")).toHaveCount(6);
  await expect(page.locator(".print-sheet")).toContainText("Coming up");
  // Today and All pages print without their controls, on white paper even in dark mode.
  await page.emulateMedia({ media: "print", colorScheme: "dark" });
  await openApp(page, "#/notebook");
  await expect(page.locator(".toolbar")).toBeHidden();
  await expect(page.locator(".filters")).toBeHidden();
  await expect(page.locator(".toc-row").first()).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.querySelector(".page")).backgroundColor)).toBe("rgb(255, 255, 255)");
  await openApp(page, "#/today");
  await expect(page.locator(".strip")).toBeVisible();
  await expect(page.locator(".view-actions").first()).toBeHidden();
});

test("the due-soon notification is opt-in, shows once a day, and only for a real notebook", async ({ page }) => {
  await fakeNotifications(page);
  await seedNotebook(page);
  await openApp(page, "#/export");
  const toggle = page.getByRole("switch", { name: "Due-soon notification" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("It only works while this site is open in a tab.")).toBeVisible();
  expect(await page.evaluate(() => window.__notices)).toEqual([]); // nothing before opting in
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#due-alerts-status")).toHaveText("On. Checked once a day, when you open the notebook.");
  // Two Applied pages have been quiet for more than a week, so both need a follow-up today.
  await expect.poll(() => page.evaluate(() => window.__notices)).toEqual([
    { title: "2 things due soon", body: "Follow up with Maple Robotics (today), Follow up with Blue Fjord Energy (today)." }
  ]);
  // Opening the notebook again the same day does not repeat it.
  await page.reload();
  await page.locator("#view .view-head").waitFor();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__notices)).toEqual([]);
  // "Check now" asks again on purpose.
  await page.getByRole("button", { name: "Check now" }).click();
  await expect.poll(() => page.evaluate(() => window.__notices.length)).toBe(1);
  // Turning it off sticks.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).dueSoonAlerts, PREFS_KEY)).toBe(false);
});

test("Settings links to the page, and an empty notebook gets honest empty states", async ({ page }) => {
  await seedStarted(page);
  await openApp(page, "#/settings");
  await page.getByRole("link", { name: "Open" }).click();
  await expect(page).toHaveURL(/#\/export$/);
  await expect(page.locator('[data-nav="settings"]').first()).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Nothing dated yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download calendar file" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Download Markdown" })).toBeDisabled();
});

test("390px wide: no sideways scroll and 44px targets", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedNotebook(page);
  await openApp(page, "#/export");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const small = await page.locator(".export-page button:visible, .export-page a:visible, .export-page input:visible, .export-page summary:visible")
    .evaluateAll(elements => elements.filter(element => Math.round(element.getBoundingClientRect().height) < 44).map(element => element.textContent.trim() || element.outerHTML.slice(0, 60)));
  expect(small).toEqual([]);
});
