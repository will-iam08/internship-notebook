import assert from "node:assert/strict";
import { test } from "node:test";
import { previewImport, sanitizeImportedEntry, LIMITS } from "../../src/main/resources/public/js/domain.js";

test("sanitizeImportedEntry keeps a normal entry unchanged", () => {
  const { entry, issues } = sanitizeImportedEntry({ company: "Acme", role: "Intern", link: "https://acme.example/jobs" });
  assert.equal(entry.company, "Acme");
  assert.equal(entry.link, "https://acme.example/jobs");
  assert.deepEqual(issues, []);
});

test("sanitizeImportedEntry drops an entry with no company or role instead of guessing", () => {
  assert.equal(sanitizeImportedEntry({ company: "", role: "Intern" }).entry, null);
  assert.equal(sanitizeImportedEntry({}).entry, null);
});

test("sanitizeImportedEntry neutralizes an unsafe link but keeps the rest of the entry", () => {
  const { entry, issues } = sanitizeImportedEntry({ company: "Acme", role: "Intern", link: "javascript:alert(document.cookie)" });
  assert.ok(entry, "entry should still be imported");
  assert.equal(entry.link, "");
  assert.deepEqual(issues, ["link"]);
});

test("sanitizeImportedEntry clamps oversized text fields to the same limits a normal entry uses", () => {
  const { entry } = sanitizeImportedEntry({ company: "Acme", role: "Intern", notes: "x".repeat(20_000) });
  assert.equal(entry.notes.length, LIMITS.notes);
});

test("sanitizeImportedEntry clears an invalid calendar date instead of importing garbage", () => {
  const { entry } = sanitizeImportedEntry({ company: "Acme", role: "Intern", deadline: "2026-13-40" });
  assert.equal(entry.deadline, "");
});

test("previewImport totals what will actually happen across a mixed batch", () => {
  const { usable, skipped, linksRemoved } = previewImport([
    { company: "Acme", role: "Intern" },
    { company: "", role: "Intern" }, // unusable: no company
    { company: "Beta", role: "Intern", link: "javascript:alert(1)" }, // usable, link dropped
    { company: "Gamma", role: "Intern", link: "https://gamma.example" } // usable, link kept
  ]);
  assert.equal(usable.length, 3);
  assert.equal(skipped, 1);
  assert.equal(linksRemoved, 1);
});
