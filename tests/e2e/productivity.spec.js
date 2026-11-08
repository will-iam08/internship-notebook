import { expect, test } from "./fixtures.js";
import { openApp, sampleApplications, savedNotebook, seedNotebook } from "./helpers.js";

test.use({ serviceWorkers: "block" });

const listings = [
  { company: "Aurora Robotics", role: "Firmware Engineer Intern", location: "Toronto, Canada", url: "https://example.com/aurora-firmware", terms: ["Summer 2027"], experienceLevel: "Junior", isCoop: true, workMode: "Hybrid", postedAt: "2026-11-01T12:00:00Z" },
  { company: "Harbour Labs", role: "Software Intern", location: "Vancouver, Canada", url: "https://example.com/harbour-software", terms: ["Winter 2027"], experienceLevel: "Senior", isCoop: false, workMode: "In-person", postedAt: "2026-11-01T12:00:00Z" }
];

test.beforeEach(async ({ page }) => {
  await page.route("**/internships.json", route => route.fulfill({
    json: { listings, generatedAt: "2026-11-01T12:00:00Z", source: "https://github.com/SimplifyJobs/Summer2027-Internships" }
  }));
});

test("a feed listing becomes a reviewed notebook page and cannot be saved twice", async ({ page }) => {
  await openApp(page);
  const listing = page.locator(".news-item").filter({ hasText: "Aurora Robotics" });
  await listing.locator('[data-action="news-save"]').click();
  const form = page.locator("#new-form");
  await expect(page.locator("#new-dialog")).toBeVisible();
  for (const [field, value] of Object.entries({
    company: listings[0].company, role: listings[0].role, location: listings[0].location,
    link: listings[0].url, source: "Pitt CSC / Simplify"
  })) await expect(form.locator(`[name="${field}"]`)).toHaveValue(value);
  await form.getByRole("button", { name: "Add to notebook" }).click();
  await expect(listing.getByRole("button", { name: "Open notebook page" })).toBeVisible();
  await page.reload();
  await listing.getByRole("button", { name: "Open notebook page" }).click();
  await expect(page.locator("#entry-company")).toHaveValue(listings[0].company);
  expect((await savedNotebook(page)).applications).toHaveLength(1);
});

test("feed filters persist after reload and clear together", async ({ page }) => {
  await openApp(page);
  await expect(page.locator(".news-item")).toHaveCount(2);
  await page.locator("#news-keywords").fill("Robotics");
  await page.locator("#news-location").fill("Toronto");
  await page.locator('[data-action="news-term-menu"]').click();
  await page.getByRole("menuitemradio", { name: "Summer 2027", exact: true }).click();
  await page.locator('[data-action="news-degree-menu"]').click();
  await page.getByRole("menuitemradio", { name: "Undergraduate or unspecified", exact: true }).click();
  await page.locator('[data-input="news-coop"]').check();
  await expect(page.locator(".news-item")).toHaveCount(1);
  await page.reload();
  await expect(page.locator("#news-keywords")).toHaveValue("Robotics");
  await expect(page.locator("#news-location")).toHaveValue("Toronto");
  await expect(page.locator('[data-action="news-term-menu"]')).toHaveText("Summer 2027");
  await expect(page.locator('[data-action="news-degree-menu"]')).toHaveText("Undergraduate or unspecified");
  await expect(page.locator('[data-input="news-coop"]')).toBeChecked();
  await expect(page.locator(".news-item")).toHaveCount(1);
  await page.locator('[data-action="news-clear"]').click();
  await expect(page.locator(".news-item")).toHaveCount(2);
  await page.locator("#news-keywords").fill("Firmware");
  await expect(page.locator(".news-item")).toHaveCount(1);
  await expect(page.locator(".news-item")).toContainText("Aurora Robotics");
  await page.locator('[data-action="news-clear"]').click();
  await page.reload();
  await expect(page.locator("#news-keywords")).toHaveValue("");
  await expect(page.locator("#news-location")).toHaveValue("");
  await expect(page.locator('[data-action="news-term-menu"]')).toHaveText("All terms");
  await expect(page.locator('[data-action="news-degree-menu"]')).toHaveText("Any degree eligibility");
  await expect(page.locator('[data-input="news-coop"]')).not.toBeChecked();
  await expect(page.locator(".news-item")).toHaveCount(2);
});

test("feed actions fit phone widths in both themes", async ({ page }) => {
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 860 });
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme });
      await openApp(page);
      await expect(page.locator(".news-item")).toHaveCount(2);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${width}px ${colorScheme} should not scroll sideways`).toBeLessThanOrEqual(1);
      for (const row of await page.locator(".news-item").all()) {
        await expect(row.locator('[data-action="news-save"]')).toBeVisible();
        await expect(row.getByRole("link", { name: /Apply to/ })).toBeVisible();
        const actionsFit = await row.evaluate(element => {
          const bounds = element.getBoundingClientRect();
          return [...element.querySelectorAll(".news-actions a, .news-actions button")].every(action => {
            const rect = action.getBoundingClientRect();
            return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
          });
        });
        expect(actionsFit, `${width}px ${colorScheme} actions should fit inside their listing`).toBe(true);
      }
    }
  }
});

function nextStepApplication() {
  return { ...sampleApplications()[2], nextStep: "Send thank-you email", notes: "Keep the interview notes." };
}

for (const route of ["#/today", "#/board", "#/entry/3"]) {
  test(`completing the next step from ${route} keeps dated history after reload`, async ({ page }) => {
    const entry = nextStepApplication();
    await seedNotebook(page, [entry]);
    await openApp(page, route);
    await page.locator('[data-action="complete-next"][data-id="3"]').first().click();
    await expect.poll(async () => (await savedNotebook(page)).applications[0].nextStep).toBe("");
    const done = (await savedNotebook(page)).applications[0];
    expect(done.nextStepDate).toBe("");
    expect(done.notes).toContain(entry.notes);
    expect(done.notes).toContain("Completed next step: Send thank-you email");
    expect(done.notes).toMatch(/\d{4}-\d{2}-\d{2}|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}/);
    await page.reload();
    await expect(page.locator("#view .view-head, #view .entry").first()).toBeVisible();
    expect((await savedNotebook(page)).applications[0]).toMatchObject({ nextStep: "", nextStepDate: "", notes: done.notes });
    await expect(page.locator('[data-action="complete-next"][data-id="3"]')).toHaveCount(0);
  });
}

test("undoing next-step completion restores its text, date, and original notes", async ({ page }) => {
  const entry = nextStepApplication();
  await seedNotebook(page, [entry]);
  await openApp(page, "#/entry/3");
  const editedNotes = `${entry.notes}\nPrepared a question before completing.`;
  await page.locator("#entry-notes").fill(editedNotes);
  await page.locator('[data-action="complete-next"][data-id="3"]').click();
  await expect.poll(async () => (await savedNotebook(page)).applications[0].nextStep).toBe("");
  expect((await savedNotebook(page)).applications[0].notes).toContain(editedNotes);
  await page.locator("#toasts .toast").getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await savedNotebook(page)).applications[0].nextStep).toBe(entry.nextStep);
  expect((await savedNotebook(page)).applications[0]).toMatchObject({ nextStep: entry.nextStep, nextStepDate: entry.nextStepDate, notes: editedNotes });
  await page.reload();
  await expect(page.locator('[data-field="nextStep"]')).toHaveValue(entry.nextStep);
  await expect(page.locator('[data-field="nextStepDate"]')).toHaveValue(entry.nextStepDate);
  await expect(page.locator("#entry-notes")).toHaveValue(editedNotes);
});

test("reschedule opens the active date editor and persists the new date", async ({ page }) => {
  const entry = nextStepApplication();
  await seedNotebook(page, [entry]);
  await openApp(page, "#/today");
  await page.locator('[data-action="reschedule-next"][data-id="3"]').first().click();
  const date = page.locator('[data-field="nextStepDate"]');
  await expect(date).toBeFocused();
  await date.fill("2026-12-15");
  await date.press("Tab");
  await expect.poll(async () => (await savedNotebook(page)).applications[0].nextStepDate).toBe("2026-12-15");
  await page.reload();
  await expect(date).toHaveValue("2026-12-15");
  await expect(page.locator('[data-field="nextStep"]')).toHaveValue(entry.nextStep);
  await expect(page.locator("#entry-notes")).toHaveValue(entry.notes);
});

function backupFile(applications, recentlyDeleted) {
  return { name: "notebook-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({
    format: "my-internship-notebook-backup", version: 2, applications, recentlyDeleted
  })) };
}

for (const includeActive of [false, true]) {
  test(`backup import previews and preserves ${includeActive ? "active and deleted" : "only deleted"} pages`, async ({ page }) => {
    const active = { ...sampleApplications()[0], company: "Backup Active" };
    const deleted = { ...sampleApplications()[1], company: "Backup Deleted", deletedAt: new Date(Date.now() - 86400000).toISOString() };
    const backup = backupFile(includeActive ? [active] : [], [deleted]);
    await openApp(page);
    await page.setInputFiles("#import-file", backup);
    const dialog = page.locator("#confirm-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(new RegExp(`${includeActive ? 1 : 0} active`, "i"));
    await expect(dialog).toContainText(/1 (recently )?deleted/i);
    await dialog.getByRole("button", { name: "Import", exact: true }).click();
    await expect.poll(async () => (await savedNotebook(page)).recentlyDeleted.length).toBe(1);
    const data = await savedNotebook(page);
    expect(data.applications).toHaveLength(includeActive ? 1 : 0);
    expect(data.recentlyDeleted[0]).toMatchObject({ company: deleted.company, createdAt: deleted.createdAt, updatedAt: deleted.updatedAt, deletedAt: deleted.deletedAt, history: deleted.history });
    if (includeActive) expect(data.applications[0]).toMatchObject({ company: active.company, createdAt: active.createdAt, updatedAt: active.updatedAt, history: active.history });
    await page.reload();
    expect((await savedNotebook(page)).recentlyDeleted[0].deletedAt).toBe(deleted.deletedAt);
    await page.setInputFiles("#import-file", backup);
    await dialog.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.locator("#toasts")).toContainText("already in your notebook");
    const repeated = await savedNotebook(page);
    expect(repeated.applications).toHaveLength(includeActive ? 1 : 0);
    expect(repeated.recentlyDeleted).toHaveLength(1);
  });
}
