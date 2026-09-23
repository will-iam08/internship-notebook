// Covers: autosave failure and retry, drafts surviving a refresh, corrupted-storage recovery,
// and backup import (validation, unsafe-link stripping, duplicates, undo).
import { expect, test } from "./fixtures.js";
import { DATA_KEY, openApp, savedNotebook, seedNotebook } from "./helpers.js";

const DRAFTS_KEY = "my-internship-notebook-drafts-v1";

test.describe("autosave", () => {
  test("a failed save keeps the edit queued and retries once storage works again", async ({ page }) => {
    await seedNotebook(page);
    await openApp(page, "#/entry/1");

    // Make the primary data key's write throw once, simulating a full/blocked localStorage.
    await page.evaluate(() => {
      const real = Storage.prototype.setItem;
      window.__armed = true;
      Storage.prototype.setItem = function (key, value) {
        if (key === "my-internship-notebook-browser-data-v1" && window.__armed) {
          throw new DOMException("QuotaExceededError simulated", "QuotaExceededError");
        }
        return real.call(this, key, value);
      };
    });

    const notes = page.locator("#entry-notes");
    await notes.fill("Called the recruiter, waiting on a reply.");

    await expect(page.locator("#save-state")).toHaveClass(/error/, { timeout: 3000 });
    await expect(page.locator("#save-state")).toContainText("Couldn't save");

    // The draft must already be on disk even though the save failed.
    const draftDuringFailure = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || "{}"), DRAFTS_KEY);
    expect(draftDuringFailure["1"]?.changes?.notes).toBe("Called the recruiter, waiting on a reply.");

    // Disarm the failure and let the automatic retry (or the Retry button) succeed.
    await page.evaluate(() => { window.__armed = false; });
    await page.locator('[data-action="retry-save"]').click();

    await expect(page.locator("#save-state")).toHaveClass(/synced/, { timeout: 6000 });
    const data = await savedNotebook(page);
    expect(data.applications.find(entry => entry.id === 1).notes).toBe("Called the recruiter, waiting on a reply.");
    const draftAfterSuccess = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || "{}"), DRAFTS_KEY);
    expect(draftAfterSuccess["1"]).toBeUndefined();
  });

  test("regression: an edit made while a save is still in flight is never cleared", async ({ page }) => {
    // flushEntrySave() snapshots the draft before its async api.update() call. The bug: if the
    // person edits a *different* field while that call is pending, writeDraft() merges it into
    // the on-disk draft, but the save that resolves afterwards used to call a plain clearDraft()
    // and delete the *entire* draft - snapshot and the newer, never-sent edit alike. Reproduced
    // here by dispatching both field changes synchronously in one page.evaluate(), so the second
    // one lands before any microtask (including the first save's own continuation) can run -
    // there is no reliable way to hit this race through real typing timing, since the local
    // storage write path resolves within a couple of microtask ticks.
    await seedNotebook(page);
    await openApp(page, "#/entry/1");

    await page.evaluate(() => {
      const company = document.getElementById("entry-company");
      const notes = document.getElementById("entry-notes");
      company.value = "Race Test Co (edited)";
      company.dispatchEvent(new Event("change", { bubbles: true })); // company saves immediately
      notes.value = "typed during the in-flight save"; // dispatched before any microtask runs
      notes.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // The notes edit goes through the normal 650ms debounce; give both saves (the immediate
    // company save, then the debounced, previously-at-risk notes save) time to complete.
    await page.waitForTimeout(1500);
    await expect(page.locator("#save-state")).toHaveClass(/synced/);

    const data = await savedNotebook(page);
    const entry = data.applications.find(item => item.id === 1);
    expect(entry.company).toBe("Race Test Co (edited)");
    expect(entry.notes, "the edit made during the in-flight save must not be lost").toBe("typed during the in-flight save");
    const draft = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || "{}"), DRAFTS_KEY);
    expect(draft["1"]).toBeUndefined();
  });

  test("regression: a failed draft write is reported honestly, not shown as 'Saved locally'", async ({ page }) => {
    await seedNotebook(page);
    await openApp(page, "#/entry/1");

    // Block every write to localStorage, simulating storage that is genuinely full or blocked -
    // even the safety-net draft itself cannot be captured, which is a stronger failure than "not
    // yet confirmed" and must not be reported as "Saved locally".
    await page.evaluate(() => {
      Storage.prototype.setItem = () => { throw new DOMException("QuotaExceededError simulated", "QuotaExceededError"); };
    });

    await page.evaluate(() => {
      const notes = document.getElementById("entry-notes");
      notes.value = "nothing can be written anywhere right now";
      notes.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await expect(page.locator("#save-state")).toHaveClass(/error/);
    await expect(page.locator("#save-state")).not.toContainText("Saved locally");
    await expect(page.locator("#toasts")).toContainText("couldn't save your change locally");
  });

  test("a draft left over from a previous visit shows up and syncs when the page reopens", async ({ page }) => {
    await seedNotebook(page);
    await page.addInitScript(([key, id, changes]) => {
      const drafts = { [id]: { changes, updatedAt: new Date().toISOString() } };
      localStorage.setItem(key, JSON.stringify(drafts));
    }, [DRAFTS_KEY, "2", { notes: "Draft written before the app closed last time." }]);

    await openApp(page, "#/entry/2");
    // The unsaved draft's value shows immediately, not the last confirmed value.
    await expect(page.locator("#entry-notes")).toHaveValue("Draft written before the app closed last time.");
    await expect(page.locator("#save-state")).toHaveClass(/synced/, { timeout: 6000 });
    const data = await savedNotebook(page);
    expect(data.applications.find(entry => entry.id === 2).notes).toBe("Draft written before the app closed last time.");
  });
});

test.describe("corrupted storage recovery", () => {
  test("garbled data never gets silently replaced with an empty notebook", async ({ page }) => {
    await page.addInitScript(key => localStorage.setItem(key, "{ this is not valid json at all"), DATA_KEY);
    await page.goto("/");
    await expect(page.getByText("could not be read")).toBeVisible();

    // The raw bytes must be preserved untouched at a separate key.
    const preserved = await page.evaluate(key => {
      const rawKey = Object.keys(localStorage).find(k => k.startsWith(`${key}-recovery-`));
      return rawKey ? localStorage.getItem(rawKey) : null;
    }, DATA_KEY);
    expect(preserved).toBe("{ this is not valid json at all");
    // And the original (still-corrupted) key must be untouched too - not overwritten.
    const original = await page.evaluate(key => localStorage.getItem(key), DATA_KEY);
    expect(original).toBe("{ this is not valid json at all");

    await page.getByRole("button", { name: "Start a new notebook" }).click();
    await page.getByRole("button", { name: "Start new" }).click();
    await expect(page.getByText("Every internship application, one tidy notebook.")).toBeVisible();
  });
});

test.describe("backup import", () => {
  function backupFile(applications) {
    return {
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ format: "my-internship-notebook-backup", version: 2, applications }))
    };
  }

  test("validates every field, strips an unsafe link, skips invalid entries, and can be undone", async ({ page }) => {
    await openApp(page);
    const applications = [
      { company: "Acme Aerospace", role: "Flight Software Intern", status: "SAVED", link: "https://acme.example/jobs/1" },
      { company: "Shady Co", role: "Intern", status: "SAVED", link: "javascript:alert(document.cookie)" },
      { company: "", role: "No Company Intern", status: "SAVED" } // unusable, no company
    ];
    await page.setInputFiles("#import-file", backupFile(applications));

    const dialog = page.locator("#confirm-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Add 2 pages");
    await expect(dialog).toContainText("1 link could not be verified as safe");
    await expect(dialog).toContainText("1 entry without a company and role will be skipped");
    await dialog.getByRole("button", { name: "Import" }).click();

    await expect(page.locator("#toasts")).toContainText("Imported 2 pages");
    const data = await savedNotebook(page);
    const shady = data.applications.find(entry => entry.company === "Shady Co");
    expect(shady.link).toBe(""); // the unsafe link must never be saved
    expect(data.applications.some(entry => entry.company === "Acme Aerospace")).toBe(true);
    expect(data.applications.some(entry => entry.company === "No Company Intern")).toBe(false);

    // Undo removes exactly the imported pages (soft-deleted, recoverable like any other delete).
    await page.locator("#toasts .toast").getByRole("button", { name: "Undo" }).click();
    const afterUndo = await savedNotebook(page);
    expect(afterUndo.applications.some(entry => entry.company === "Acme Aerospace")).toBe(false);
    expect(afterUndo.recentlyDeleted.some(entry => entry.company === "Acme Aerospace")).toBe(true);
  });

  test("rejects a file that isn't a backup", async ({ page }) => {
    await openApp(page);
    await page.setInputFiles("#import-file", { name: "notes.json", mimeType: "application/json", buffer: Buffer.from("not json") });
    await expect(page.locator("#toasts")).toContainText("couldn't be read as a backup");
  });
});
