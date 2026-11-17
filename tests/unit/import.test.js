import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LIMITS,
  buildCsv,
  normalizeImportStage,
  parseDelimited,
  parseFlexibleDate,
  parseSpreadsheetImport,
  previewImport,
  sanitizeImportedEntry
} from "../../src/main/resources/public/js/domain.js";

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

test("parseFlexibleDate normalizes common spreadsheet date formats and rejects invalid dates", () => {
  assert.equal(parseFlexibleDate("2026-11-15"), "2026-11-15");
  assert.equal(parseFlexibleDate("2026/11/05"), "2026-11-05");
  assert.equal(parseFlexibleDate("11/15/2026"), "2026-11-15");
  assert.equal(parseFlexibleDate("3/7/2027"), "2027-03-07");
  assert.equal(parseFlexibleDate("11-15-2026"), "2026-11-15");
  assert.equal(parseFlexibleDate("11/15/26"), "2026-11-15");
  assert.equal(parseFlexibleDate("2026-11-15T14:30:00.000Z"), "2026-11-15");
  assert.equal(parseFlexibleDate("Nov 15, 2026"), "2026-11-15");
  assert.equal(parseFlexibleDate("2026-02-30"), "");
  assert.equal(parseFlexibleDate("13/40/2026"), "");
  assert.equal(parseFlexibleDate("not a date"), "");
  assert.equal(parseFlexibleDate(""), "");
});

test("normalizeImportStage maps spreadsheet status synonyms and respects applied-date fallback", () => {
  assert.equal(normalizeImportStage("Wishlist"), "SAVED");
  assert.equal(normalizeImportStage("Bookmarked"), "SAVED");
  assert.equal(normalizeImportStage("To Apply"), "SAVED");
  assert.equal(normalizeImportStage("Submitted"), "APPLIED");
  assert.equal(normalizeImportStage("Under Review"), "APPLIED");
  assert.equal(normalizeImportStage("Pending"), "APPLIED");
  assert.equal(normalizeImportStage("Online Assessment"), "INTERVIEW");
  assert.equal(normalizeImportStage("OA"), "INTERVIEW");
  assert.equal(normalizeImportStage("HackerRank"), "INTERVIEW");
  assert.equal(normalizeImportStage("CodeSignal"), "INTERVIEW");
  assert.equal(normalizeImportStage("Phone Screen"), "INTERVIEW");
  assert.equal(normalizeImportStage("Final Round"), "INTERVIEW");
  assert.equal(normalizeImportStage("Superday"), "INTERVIEW");
  assert.equal(normalizeImportStage("Offer Received"), "OFFER");
  assert.equal(normalizeImportStage("Accepted"), "OFFER");
  assert.equal(normalizeImportStage("Ghosted"), "REJECTED");
  assert.equal(normalizeImportStage("Withdrawn"), "REJECTED");
  assert.equal(normalizeImportStage("Not Selected"), "REJECTED");
  assert.equal(normalizeImportStage(""), "SAVED");
  assert.equal(normalizeImportStage("", { hasAppliedDate: true }), "APPLIED");
  assert.equal(normalizeImportStage("Unknown Custom Stage", { hasAppliedDate: true }), "APPLIED");
});

test("parseDelimited handles UTF-8 BOM, quoted commas, escaped quotes, multiline cells, and TSV tabs", () => {
  const csv = "\uFEFFCompany,Role,Notes\r\n\"Stripe, Inc.\",\"SWE \"\"Core\"\" Intern\",\"Line 1\nLine 2, with comma\"\r\nShopify,Backend Intern,Plain note\r\n";
  const rows = parseDelimited(csv);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], ["Company", "Role", "Notes"]);
  assert.deepEqual(rows[1], ["Stripe, Inc.", "SWE \"Core\" Intern", "Line 1\nLine 2, with comma"]);
  assert.deepEqual(rows[2], ["Shopify", "Backend Intern", "Plain note"]);

  const tsv = "Company\tJob Title\tStatus\nFigma\tProduct Design Intern\tInterviewing\n";
  const tsvRows = parseDelimited(tsv);
  assert.equal(tsvRows.length, 2);
  assert.deepEqual(tsvRows[1], ["Figma", "Product Design Intern", "Interviewing"]);
});

test("parseSpreadsheetImport maps headers from Google Sheets, Notion, Simplify, Handshake, and WaterlooWorks", () => {
  const sheet = [
    "Employer,Job Title,Application Status,Close Date,City,Platform,Job URL,Recruiter,Follow Up,Follow Up Date,Tech Stack,Comments,Favorite,Date Applied",
    "Stripe,Software Engineer Intern,Online Assessment,11/30/2026,\"San Francisco, CA\",Simplify,https://boards.greenhouse.io/stripe/jobs/123,Alex Recruiter,Complete HackerRank,11/20/2026,\"Python, Go, SQL\",'=Referral from Sam,★,11/01/2026",
    "Cohere,ML Intern,,12/15/2026,Toronto,WaterlooWorks,javascript:alert(1),,,,,\"- Focus on transformers\",no,11/05/2026"
  ].join("\n");

  const { entries } = parseSpreadsheetImport(sheet);
  const { usable, skipped, linksRemoved } = previewImport(entries);
  assert.equal(skipped, 0);
  assert.equal(linksRemoved, 1);
  assert.equal(usable.length, 2);

  const stripe = usable[0];
  assert.equal(stripe.company, "Stripe");
  assert.equal(stripe.role, "Software Engineer Intern");
  assert.equal(stripe.status, "INTERVIEW");
  assert.equal(stripe.deadline, "2026-11-30");
  assert.equal(stripe.location, "San Francisco, CA");
  assert.equal(stripe.source, "Simplify");
  assert.equal(stripe.link, "https://boards.greenhouse.io/stripe/jobs/123");
  assert.equal(stripe.contact, "Alex Recruiter");
  assert.equal(stripe.nextStep, "Complete HackerRank");
  assert.equal(stripe.nextStepDate, "2026-11-20");
  assert.deepEqual(stripe.skills, ["Python", "Go", "SQL"]);
  assert.equal(stripe.notes, "=Referral from Sam");
  assert.equal(stripe.starred, true);
  assert.ok(stripe.createdAt.startsWith("2026-11-01"));

  const cohere = usable[1];
  assert.equal(cohere.company, "Cohere");
  assert.equal(cohere.status, "APPLIED", "blank status with Date Applied defaults to APPLIED");
  assert.equal(cohere.link, "", "unsafe link is stripped");
  assert.equal(cohere.notes, "- Focus on transformers", "formula-escaped leading hyphen is restored");
  assert.equal(cohere.starred, false);
});

test("buildCsv and parseSpreadsheetImport round-trip an exported notebook 100% losslessly", () => {
  const original = [
    {
      id: 1,
      company: "Figma",
      role: "Software Engineer Intern",
      status: "INTERVIEW",
      deadline: "2026-12-01",
      location: "San Francisco, CA",
      source: "Company website",
      link: "https://boards.greenhouse.io/figma/jobs/999",
      contact: "@recruiter_jane",
      nextStep: "+1-555-0199 phone screen",
      nextStepDate: "2026-11-22",
      skills: ["TypeScript", "React", "C++"],
      notes: "=Important formula note\nSecond line with \"quotes\" and, commas",
      starred: true,
      createdAt: "2026-11-01T10:00:00.000Z",
      updatedAt: "2026-11-10T15:30:00.000Z",
      history: [{ status: "SAVED", at: "2026-11-01T10:00:00.000Z" }, { status: "INTERVIEW", at: "2026-11-10T15:30:00.000Z" }]
    },
    {
      id: 2,
      company: "Shopify",
      role: "Backend Developer Intern",
      status: "SAVED",
      deadline: "",
      location: "Ottawa, ON",
      source: "LinkedIn",
      link: "https://www.shopify.com/careers",
      contact: "",
      nextStep: "- Prepare Ruby project",
      nextStepDate: "",
      skills: ["Ruby", "SQL", "Docker"],
      notes: "Plain note",
      starred: false,
      createdAt: "2026-11-02T08:00:00.000Z",
      updatedAt: "2026-11-02T08:00:00.000Z",
      history: [{ status: "SAVED", at: "2026-11-02T08:00:00.000Z" }]
    }
  ];

  const csvText = buildCsv(original);
  const { entries } = parseSpreadsheetImport(csvText);
  const { usable, skipped, linksRemoved } = previewImport(entries);

  assert.equal(skipped, 0);
  assert.equal(linksRemoved, 0);
  assert.equal(usable.length, 2);

  for (let index = 0; index < original.length; index++) {
    const exp = original[index];
    const got = usable[index];
    assert.equal(got.company, exp.company);
    assert.equal(got.role, exp.role);
    assert.equal(got.status, exp.status);
    assert.equal(got.deadline, exp.deadline);
    assert.equal(got.location, exp.location);
    assert.equal(got.source, exp.source);
    assert.equal(got.link, exp.link);
    assert.equal(got.contact, exp.contact);
    assert.equal(got.nextStep, exp.nextStep);
    assert.equal(got.nextStepDate, exp.nextStepDate);
    assert.deepEqual(got.skills, exp.skills);
    assert.equal(got.notes, exp.notes);
    assert.equal(got.starred, exp.starred);
    assert.equal(got.createdAt, exp.createdAt);
    assert.equal(got.updatedAt, exp.updatedAt);
  }
});

test("parseSpreadsheetImport rejects files without recognizable company and role headers", () => {
  assert.throws(
    () => parseSpreadsheetImport(" random text that is not a spreadsheet "),
    /couldn't be read as a backup/
  );
  assert.throws(
    () => parseSpreadsheetImport("Date,Amount,Category\n2026-11-01,12.50,Lunch\n"),
    /couldn't be read as a backup/
  );
});
