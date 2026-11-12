import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { dayKey, normalize } from "../../src/main/resources/public/js/domain.js";
import {
  QUIET_DAYS, upcomingActions, nextActionFor, dueSoon, dueSoonMessage,
  escapeIcsText, foldIcsLine, buildIcs, mdInline, buildMarkdownNotebook,
  buildEmailDigest, digestMailto, isPlausibleEmail
} from "../../src/main/resources/public/js/reminders.js";

const NOW = new Date(2026, 10, 11, 9, 30); // Wed Nov 11 2026, 9:30 local
const day = offset => { const date = new Date(NOW); date.setDate(date.getDate() + offset); return dayKey(date); };
const iso = daysAgo => new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();
const page = (id, fields) => normalize({ id, company: "Northwind Labs", role: "Software Intern", createdAt: iso(30), ...fields });
const applied = (id, daysAgo, fields = {}) => page(id, { status: "APPLIED", history: [{ status: "SAVED", at: iso(daysAgo + 2) }, { status: "APPLIED", at: iso(daysAgo) }], ...fields });

const notebook = () => [
  page(1, { status: "SAVED", deadline: day(3), company: "Northwind Labs, Inc.", role: "Data; Analytics Intern" }),
  applied(2, 10, { company: "Lumen Analytics" }),
  page(3, { status: "INTERVIEW", company: "Harbor & Co.", nextStep: "Technical interview", nextStepDate: day(1), contact: "Sam Rivera" }),
  page(4, { status: "SAVED", deadline: day(-2), company: "Expired Co." }),
  page(5, { status: "REJECTED", deadline: day(4), nextStepDate: day(4), company: "Nope Ltd." }),
  page(6, { status: "OFFER", nextStep: "Reply to the offer", nextStepDate: day(6), company: "Atlas Freight" })
];

/* ---------- next actions ---------- */

test("each stage maps to its next action, and nothing in the past or on a Rejected page", () => {
  const [saved, quiet, interview, expired, rejected, offer] = notebook();
  assert.deepEqual(pick(nextActionFor(saved, { now: NOW })), { kind: "deadline", day: day(3), label: "Apply to Northwind Labs, Inc." });
  assert.deepEqual(pick(nextActionFor(quiet, { now: NOW })), { kind: "follow-up", day: day(0), label: "Follow up with Lumen Analytics" });
  assert.deepEqual(pick(nextActionFor(interview, { now: NOW })), { kind: "interview", day: day(1), label: "Technical interview: Harbor & Co." });
  assert.equal(nextActionFor(expired, { now: NOW }), null, "a passed deadline is not a next action");
  assert.equal(nextActionFor(rejected, { now: NOW }), null);
  assert.deepEqual(pick(nextActionFor(offer, { now: NOW })), { kind: "next-step", day: day(6), label: "Reply to the offer: Atlas Freight" });
  assert.ok(nextActionFor(saved, { now: NOW }).at instanceof Date);
});

function pick(action) { return action && { kind: action.kind, day: action.day, label: action.label }; }

test("follow-ups wait until an Applied page has been quiet for more than a week", () => {
  assert.equal(nextActionFor(applied(1, QUIET_DAYS), { now: NOW }), null, "exactly a week is not yet quiet");
  assert.equal(nextActionFor(applied(1, QUIET_DAYS + 1), { now: NOW }).kind, "follow-up");
  // A scheduled next step replaces the follow-up; an Applied deadline is still listed.
  const scheduled = applied(1, 20, { nextStep: "Coffee chat", nextStepDate: day(2), deadline: day(5) });
  assert.deepEqual(upcomingActions(scheduled, { now: NOW }).map(action => action.kind), ["next-step", "deadline"]);
  assert.equal(upcomingActions(scheduled, { now: NOW })[1].label, "Application deadline: Northwind Labs");
});

test("the soonest action wins, and an interview beats a deadline on the same day", () => {
  const both = page(1, { status: "SAVED", deadline: day(2), nextStep: "Info session", nextStepDate: day(1) });
  assert.equal(nextActionFor(both, { now: NOW }).kind, "next-step");
  const tie = page(2, { status: "INTERVIEW", nextStepDate: day(0) });
  assert.equal(nextActionFor(tie, { now: NOW }).label, "Interview: Northwind Labs");
});

test("due-soon covers today and tomorrow, and the notification text names the items", () => {
  const items = dueSoon(notebook(), { now: NOW });
  assert.deepEqual(items.map(item => item.application.id), [2, 3]);
  assert.deepEqual(dueSoonMessage(items, { now: NOW }), {
    title: "2 things due soon",
    body: "Follow up with Lumen Analytics (today), Technical interview: Harbor & Co. (tomorrow)."
  });
  assert.equal(dueSoonMessage([], { now: NOW }), null);
  assert.equal(dueSoon(notebook(), { now: NOW, withinDays: 3 }).length, 3);
});

/* ---------- calendar file ---------- */

test("the calendar file is a valid VCALENDAR with CRLF line endings and one event per action", () => {
  const ics = buildIcs(notebook(), { now: NOW });
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.doesNotMatch(ics.replaceAll("\r\n", ""), /[\r\n]/, "no bare LF or CR anywhere");
  assert.equal(count(ics, "BEGIN:VEVENT"), 4);
  assert.equal(count(ics, "END:VEVENT"), 4);
  assert.equal(count(ics, "BEGIN:VALARM"), 8);
  assert.match(ics, /PRODID:-\/\/My Internship Notebook\/\/Reminders\/\/EN/);
  assert.match(ics, /X-WR-CALNAME:My Internship Notebook/);
  assert.equal(count(ics, "DTSTAMP:20261111T"), 4);
  assert.match(ics, /DTSTAMP:\d{8}T\d{6}Z\r\n/, "DTSTAMP is UTC");
  for (const trigger of ["TRIGGER:-P1D", "TRIGGER:-PT2H"]) assert.equal(count(ics, trigger), 4);
  const first = event(ics, "1-deadline");
  assert.match(first, new RegExp(`DTSTART;VALUE=DATE:${day(3).replaceAll("-", "")}`));
  assert.match(first, new RegExp(`DTEND;VALUE=DATE:${day(4).replaceAll("-", "")}`));
  assert.match(unfold(first), /SUMMARY:Apply to Northwind Labs\\, Inc\. \(Data\\; Analytics Intern\)/);
  assert.match(unfold(first), /DESCRIPTION:Northwind Labs\\, Inc\.: Data\\; Analytics Intern\\nStage: Saved/);
  assert.match(unfold(event(ics, "3-interview")), /Contact: Sam Rivera/);
});

const count = (haystack, needle) => haystack.split(needle).length - 1;
const unfold = ics => ics.replace(/\r\n /g, "");
const event = (ics, uid) => ics.split("BEGIN:VEVENT").find(block => block.includes(`UID:${uid}@`)) || "";

test("no calendar event is in the past", () => {
  const ics = buildIcs(notebook(), { now: NOW });
  const today = dayKey(NOW).replaceAll("-", "");
  const starts = [...ics.matchAll(/DTSTART;VALUE=DATE:(\d{8})/g)].map(match => match[1]);
  assert.ok(starts.length > 0);
  for (const start of starts) assert.ok(start >= today, start);
  assert.doesNotMatch(ics, /Expired Co\.|Nope Ltd\./);
});

test("UIDs are stable across calls and depend only on the application and kind", () => {
  const uids = ics => [...ics.matchAll(/^UID:(.+)$/gm)].map(match => match[1].trim());
  const first = uids(buildIcs(notebook(), { now: NOW }));
  const later = uids(buildIcs(notebook(), { now: new Date(NOW.getTime() + 3_600_000) }));
  assert.deepEqual(first, later);
  assert.deepEqual(first, ["1-deadline@internshipnotebook.app", "2-follow-up@internshipnotebook.app", "3-interview@internshipnotebook.app", "6-next-step@internshipnotebook.app"]);
  assert.equal(new Set(first).size, first.length);
});

test("TEXT values escape backslashes, commas, semicolons, and every kind of newline", () => {
  assert.equal(escapeIcsText("a\\b, c; d\ne\r\nf\rg"), "a\\\\b\\, c\\; d\\ne\\nf\\ng");
  const ics = buildIcs([page(1, { status: "SAVED", deadline: day(2), company: "A;B,C\\D", role: "R\nS" })], { now: NOW });
  assert.match(unfold(ics), /SUMMARY:Apply to A\\;B\\,C\\\\D \(R\\nS\)/);
});

test("lines are folded at 75 octets, counting UTF-8 bytes and never splitting a character", () => {
  const long = page(1, { status: "SAVED", deadline: day(2), company: "Ünïcödé Ünïversity Research Lab, Montréal".repeat(3), role: "Développeuse — stage d’été" });
  const ics = buildIcs([long], { now: NOW });
  const encoder = new TextEncoder();
  for (const line of ics.split("\r\n")) assert.ok(encoder.encode(line).length <= 75, `${encoder.encode(line).length}: ${line}`);
  assert.ok(ics.includes("\r\n "), "a long line was folded");
  assert.ok(unfold(ics).includes("Ünïcödé Ünïversity Research Lab\\, Montréal"), "unfolding restores the text exactly");
  assert.doesNotMatch(ics, /\uFFFD/);
  assert.equal(foldIcsLine("x".repeat(75)), "x".repeat(75));
  assert.equal(foldIcsLine("x".repeat(76)), `${"x".repeat(75)}\r\n x`);
  assert.equal(foldIcsLine("é".repeat(40)).split("\r\n")[0], "é".repeat(37), "37 two-byte characters = 74 octets; a 38th would split at 76");
});

test("an empty notebook still makes a valid, empty calendar", () => {
  assert.equal(buildIcs([], { now: NOW, calendarName: "Jo, notebook" }),
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//My Internship Notebook//Reminders//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:Jo\\, notebook\r\nEND:VCALENDAR\r\n");
});

/* ---------- Markdown ---------- */

test("the Markdown copy has a title, a summary table, and one section per application", () => {
  const md = buildMarkdownNotebook(notebook(), { name: "Jordan" }, { now: NOW });
  assert.ok(md.startsWith("# Jordan's internship notebook\n\nExported 2026-11-11. 6 applications.\n\n| Company | Role | Stage | Deadline | Next step |\n| --- | --- | --- | --- | --- |\n"));
  assert.equal(count(md, "\n## "), 6);
  const harbor = md.slice(md.indexOf("## Harbor & Co."));
  assert.match(harbor, /^## Harbor & Co\.: Software Intern\n\n- \*\*Stage:\*\* Interview/);
  assert.match(harbor, new RegExp(`- \\*\\*Next step:\\*\\* Technical interview, ${day(1)}`));
  assert.match(harbor, /- \*\*Contact:\*\* Sam Rivera/);
  // Sections run in stage order, then by company.
  const order = [...md.matchAll(/^## (.+?):/gm)].map(match => match[1]);
  assert.deepEqual(order, ["Expired Co.", "Northwind Labs, Inc.", "Lumen Analytics", "Harbor & Co.", "Atlas Freight", "Nope Ltd."]);
});

test("Markdown escapes what would break the layout, keeps notes readable, and respects the limits", () => {
  const tricky = page(1, {
    status: "SAVED", company: "# Pipe | Co *bold* [x](y) <b>", role: "1. Intern_role", skills: ["C#", "Node.js"],
    link: "https://example.com/job (1)", notes: `- not a list\n\n## not a heading\n${"n".repeat(12000)}`
  });
  const md = buildMarkdownNotebook([tricky], {}, { now: NOW });
  assert.match(md, /^# My internship notebook/);
  assert.match(md, /^## \\# Pipe \\\| Co \\\*bold\\\* \\\[x\\\]\(y\) \\<b\\>: 1\\. Intern\\_role$/m);
  assert.equal(mdInline("2) second"), "2\\) second");
  assert.match(md, /^\| \\# Pipe \\\| Co/m, "the table row has exactly one cell per column");
  assert.equal(md.split("\n").find(line => line.startsWith("| \\#")).split(/(?<!\\)\|/).length, 7);
  assert.match(md, /- \*\*Skills:\*\* C#, Node\.js/);
  assert.match(md, /\[Open the posting\]\(https:\/\/example\.com\/job%20%281%29\)/);
  assert.match(md, /^> \\- not a list$/m);
  assert.match(md, /^>$/m, "blank lines in notes stay as quote lines");
  assert.match(md, /^> \\## not a heading$/m);
  const notesLength = md.split("\n").filter(line => line.startsWith("> n")).join("").length - 2;
  assert.ok(notesLength <= 10000, `notes cut to the 10000-character limit (got ${notesLength})`);
  assert.equal(mdInline("line one\nline two"), "line one line two");
  assert.equal(mdInline("+ plus"), "\\+ plus");
});

test("an empty notebook exports a short, valid Markdown page", () => {
  assert.equal(buildMarkdownNotebook([], {}, { now: NOW }), "# My internship notebook\n\nExported 2026-11-11. 0 applications.\n");
});

/* ---------- email digest ---------- */

test("the digest covers this week, deadlines, follow-ups, and interview prep", () => {
  const sent = applied(7, 1, { company: "Quarry Labs" }); // applied yesterday, so it counts this week
  const { subject, body } = buildEmailDigest([...notebook(), sent], { name: "Jordan", goal: 5 }, { now: NOW });
  assert.equal(subject, "Internship notebook: week of Nov 9");
  assert.ok(body.startsWith("Hi Jordan,\n\nThis week\n- 1 of 5 applications sent since Monday\n- 5 open applications\n"));
  assert.match(body, new RegExp(`Deadlines in the next 14 days\\n- Sat Nov 14: Apply to Northwind Labs, Inc\\. \\(Data; Analytics Intern\\)`));
  assert.match(body, /Follow-ups\n- Wed Nov 11: Follow up with Lumen Analytics/);
  assert.match(body, /Interviews\n- Thu Nov 12: Technical interview: Harbor & Co\./);
  assert.match(body, /Interview prep\n- Before Harbor & Co\.: prepare two stories/);
  assert.match(body, /the site does not send email\.$/);
});

test("an empty digest still reads well, and long sections are capped", () => {
  const { body } = buildEmailDigest([], {}, { now: NOW });
  assert.match(body, /^Hi,\n/);
  assert.match(body, /- None\. A good week to save a few new roles\./);
  assert.match(body, /- 0 of 5 applications sent/);
  const many = Array.from({ length: 9 }, (_, index) => page(index + 1, { status: "SAVED", deadline: day(index + 1), company: `Co ${index + 1}` }));
  const capped = buildEmailDigest(many, {}, { now: NOW }).body;
  assert.equal(count(capped, ": Apply to Co "), 5);
  assert.match(capped, /- and 4 more in the notebook/);
});

test("the mailto link encodes the subject and body, uses CRLF line breaks, and keeps the @", () => {
  const digest = { subject: "Week of Nov 9 & more?", body: "Line one\nLine two: 50% done, #1" };
  const href = digestMailto({ to: " jo.doe+jobs@example.com ", digest });
  assert.equal(href, "mailto:jo.doe%2Bjobs@example.com?subject=Week%20of%20Nov%209%20%26%20more%3F&body=Line%20one%0D%0ALine%20two%3A%2050%25%20done%2C%20%231");
  const url = new URL(href);
  assert.equal(url.searchParams.get("subject"), digest.subject);
  assert.equal(url.searchParams.get("body"), "Line one\r\nLine two: 50% done, #1");
  assert.equal(digestMailto({ to: "not an email", digest }), "");
  assert.equal(digestMailto({ to: "jo@example.com?cc=x@evil.example", digest }), "", "a second address is refused outright");
  assert.ok(digestMailto({ to: "jo@example.com?cc=x", digest }).startsWith("mailto:jo@example.com%3Fcc%3Dx?subject="), "a query in the address is encoded, so it cannot add recipients");
  for (const good of ["a@b.co", "first.last@uni.example.edu"]) assert.equal(isPlausibleEmail(good), true);
  for (const bad of ["", "a@b", "a b@c.d", "@b.co", null]) assert.equal(isPlausibleEmail(bad), false);
});

/* ---------- purity ---------- */

test("the module is pure: it imports only domain.js and never touches storage", async () => {
  const source = await readFile(new URL("../../src/main/resources/public/js/reminders.js", import.meta.url), "utf8");
  assert.deepEqual([...source.matchAll(/^import .* from "(.+)";$/gm)].map(match => match[1]), ["./domain.js"]);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.|window\.|fetch\(/);
  const touched = [];
  const trap = new Proxy({}, { get: (_, key) => { touched.push(String(key)); return () => null; } });
  const saved = { local: globalThis.localStorage, session: globalThis.sessionStorage };
  globalThis.localStorage = trap;
  globalThis.sessionStorage = trap;
  try {
    const pages = notebook();
    buildIcs(pages, { now: NOW });
    buildMarkdownNotebook(pages, { name: "Jo" }, { now: NOW });
    digestMailto({ to: "jo@example.com", digest: buildEmailDigest(pages, {}, { now: NOW }) });
    dueSoonMessage(dueSoon(pages, { now: NOW }), { now: NOW });
  } finally {
    globalThis.localStorage = saved.local;
    globalThis.sessionStorage = saved.session;
  }
  assert.deepEqual(touched, []);
});
