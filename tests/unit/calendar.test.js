import test from "node:test";
import assert from "node:assert/strict";
import { entryCalendar } from "../../src/main/resources/public/js/calendar.js";

test("calendar export creates safe all-day events", () => {
  const calendar = entryCalendar({ id: 7, company: "A, Inc.", role: "Intern", deadline: "2026-10-31", nextStep: "Interview", nextStepDate: "2026-11-02", link: "https://example.com/job", notes: "Line 1\nLine 2" });
  assert.match(calendar, /DTSTART;VALUE=DATE:20261031/);
  assert.match(calendar, /DTEND;VALUE=DATE:20261101/);
  assert.match(calendar, /SUMMARY:Application deadline: A\\, Inc\./);
  assert.match(calendar, /DESCRIPTION:Line 1\\nLine 2/);
  assert.equal((calendar.match(/BEGIN:VEVENT/g) || []).length, 2);
});

test("calendar export is empty without a date", () => {
  assert.equal(entryCalendar({ deadline: "", nextStepDate: "" }), "");
});
