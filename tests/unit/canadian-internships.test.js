import test from "node:test";
import assert from "node:assert/strict";
import {
  cellText, extractApplyUrl, normalizeCanadian, parseCanadianTable, parsePostedDate, splitRow, termsFrom
} from "../../scripts/canadian-internships.mjs";
const badge = url => `[![Apply](https://img.shields.io/badge/-Apply-blue?style=for-the-badge)](${url})`;
const README = `# 🍁 Canadian Tech Internships - 2027

> A curated list. | Not a table row |

<!-- BEGIN:INTERNSHIPS_TABLE -->

<!-- prettier-ignore -->
| Company | Role | Location | Apply | Date Posted |
|--------|------|----------|:-----:|--------------|
| exacare ai | Data and Analytics Intern (Summer 2027) | Toronto, ON | ${badge("https://ats.rippling.com/exacare-inc/jobs/e42f")} | Nov 11, 2026 |
| ↳ | Software Developer Co-op (Winter 2027) | Remote, Canada | ${badge("https://ats.rippling.com/exacare-inc/jobs/f00d")} | Nov 10, 2026 |
 | Altera | Software Engineer Intern | Toronto, ON | Closed🔒 | Oct 26, 2026 | 
| ↳ | Quartus User Interface Intern | Toronto, ON / Waterloo, ON | ${badge("https://altera.example/jobs/(R123)")} | Oct 20, 2026 |
| Intelcom \\| Dragonfly | Data Analyst Intern | Montreal, QC | ${badge("https://intelcom.example/data")} | Sep 15, 2026 |
| Bree | Software Engineer Co-op, Backend | Toronto, ON | ${badge("http://jobs.ashbyhq.com/bree/42fe")} | Sep 4, 2026 |
| Shady | Intern | Toronto, ON | ${badge("javascript:alert(1)")} | Sep 4, 2026 |
| Too | Many | Cells | Here | ${badge("https://example.com/x")} | Sep 4, 2026 |
| Undated | Developer Intern | Ottawa, ON | ${badge("https://example.com/undated")} | Soon |
|  | Nameless Intern | Ottawa, ON | ${badge("https://example.com/nameless")} | Sep 3, 2026 |
| **Shopify** | [Dev Intern](https://shopify.com/careers) | Toronto, ON, | ${badge("https://shopify.com/careers/1")} | Sept 2, 2026 |

<!-- END:INTERNSHIPS_TABLE -->

| Company | Role | Location | Apply | Date Posted |
|---|---|---|---|---|
| Later | Table Intern | Toronto, ON | ${badge("https://example.com/later")} | Sep 1, 2026 |
`;
test("parseCanadianTable reads every open row of the listings table", () => {
  const rows = parseCanadianTable(README);
  assert.deepEqual(rows.map(row => `${row.company} | ${row.role}`), [
    "exacare ai | Data and Analytics Intern (Summer 2027)",
    "exacare ai | Software Developer Co-op (Winter 2027)",
    "Altera | Quartus User Interface Intern",
    "Intelcom | Dragonfly | Data Analyst Intern",
    "Shopify | Dev Intern"
  ]);
  assert.deepEqual(rows[0], {
    company: "exacare ai", role: "Data and Analytics Intern (Summer 2027)", location: "Toronto, ON",
    url: "https://ats.rippling.com/exacare-inc/jobs/e42f", postedAt: "2026-11-11T00:00:00.000Z"
  });
});
test("a ↳ row inherits the company above it, even when that row was closed", () => {
  const rows = parseCanadianTable(README);
  assert.equal(rows[1].company, "exacare ai");
  assert.equal(rows[2].company, "Altera", "the Altera row above was closed but still names the company");
});
test("closed, http, javascript, wrong-width, undated and nameless rows are skipped", () => {
  const roles = parseCanadianTable(README).map(row => row.role);
  for (const skipped of ["Software Engineer Intern", "Software Engineer Co-op, Backend", "Intern", "Many", "Developer Intern", "Nameless Intern"]) {
    assert.ok(!roles.includes(skipped), `${skipped} should be skipped`);
  }
});
test("only the first listings table is read", () => {
  assert.ok(!parseCanadianTable(README).some(row => row.company === "Later"));
});
test("a ↳ row with nothing above it is skipped", () => {
  const rows = parseCanadianTable(`| Company | Role | Location | Apply | Date Posted |
|---|---|---|---|---|
| ↳ | Orphan Intern | Toronto, ON | ${badge("https://example.com/orphan")} | Sep 1, 2026 |
| Real | Intern | Toronto, ON | ${badge("https://example.com/real")} | Sep 1, 2026 |`);
  assert.deepEqual(rows.map(row => row.company), ["Real"]);
});
test("columns are matched by header name, not position", () => {
  const rows = parseCanadianTable(`| Date Posted | Apply | Company | Role | Location |
|---|---|---|---|---|
| Sep 1, 2026 | ${badge("https://example.com/a")} | Acme | Intern | Calgary, AB |`);
  assert.deepEqual(rows, [{ company: "Acme", role: "Intern", location: "Calgary, AB", url: "https://example.com/a", postedAt: "2026-09-01T00:00:00.000Z" }]);
});
test("parseCanadianTable returns nothing for text without the table", () => {
  assert.deepEqual(parseCanadianTable("# Nothing here\n\n| a | b |\n|---|---|\n| 1 | 2 |"), []);
  assert.deepEqual(parseCanadianTable(""), []);
  assert.deepEqual(parseCanadianTable(undefined), []);
});
test("splitRow keeps escaped pipes and drops the outer ones", () => {
  assert.deepEqual(splitRow("| A \\| B | C |"), ["A | B", "C"]);
  assert.deepEqual(splitRow("  | A | B |  "), ["A", "B"]);
  assert.equal(splitRow("not a row"), null);
});
test("cellText strips markdown and HTML down to the text", () => {
  assert.equal(cellText("**[Shopify](https://shopify.com)**"), "Shopify");
  assert.equal(cellText("Toronto, ON<br>Remote"), "Toronto, ON / Remote");
  assert.equal(cellText("R&amp;D   Intern"), "R&D Intern");
  assert.equal(cellText("Toronto, ON,"), "Toronto, ON");
});
test("extractApplyUrl reads the link around the badge image", () => {
  assert.equal(extractApplyUrl(badge("https://jobs.example.com/apply?id=1&src=gh")), "https://jobs.example.com/apply?id=1&src=gh");
  assert.equal(extractApplyUrl(badge("https://jobs.example.com/role_(Toronto)")), "https://jobs.example.com/role_(Toronto)", "balanced parentheses stay in the URL");
  assert.equal(extractApplyUrl(`${badge("https://first.example.com")} ${badge("https://second.example.com")}`), "https://first.example.com/");
  assert.equal(extractApplyUrl('<a href="https://html.example.com/apply"><img src="badge.svg"></a>'), "https://html.example.com/apply");
  assert.equal(extractApplyUrl("https://bare.example.com/apply"), "https://bare.example.com/apply");
});
test("extractApplyUrl rejects closed roles and links that are not plain https", () => {
  assert.equal(extractApplyUrl("Closed🔒"), "");
  assert.equal(extractApplyUrl(""), "");
  assert.equal(extractApplyUrl(badge("http://jobs.example.com/apply")), "");
  assert.equal(extractApplyUrl(badge("javascript:alert(1)")), "");
  assert.equal(extractApplyUrl(badge("https://user:pass@jobs.example.com/")), "");
  assert.equal(extractApplyUrl(badge("/relative/path")), "");
  assert.equal(extractApplyUrl("[![Apply](badge.svg)](https://unterminated.example.com"), "");
});
test("parsePostedDate reads the list's date formats as UTC midnight", () => {
  assert.equal(parsePostedDate("Nov 11, 2026"), "2026-11-11T00:00:00.000Z");
  assert.equal(parsePostedDate("Sep 4, 2026"), "2026-09-04T00:00:00.000Z");
  assert.equal(parsePostedDate("Sept 4, 2026"), "2026-09-04T00:00:00.000Z");
  assert.equal(parsePostedDate("November 2 2026"), "2026-11-02T00:00:00.000Z");
  assert.equal(parsePostedDate("2 Nov 2026"), "2026-11-02T00:00:00.000Z");
  assert.equal(parsePostedDate("2026-11-02"), "2026-11-02T00:00:00.000Z");
  assert.equal(parsePostedDate("**Oct 1, 2026**"), "2026-10-01T00:00:00.000Z");
});
test("parsePostedDate rejects dates that do not exist or cannot be read", () => {
  for (const value of ["Feb 30, 2026", "Nov 31, 2026", "Novel 11, 2026", "Closed🔒", "Soon", "0d", "", "2026-13-01", "Nov 0, 2026"]) {
    assert.equal(parsePostedDate(value), "", value);
  }
});
test("termsFrom finds work terms in a title, including combined seasons", () => {
  assert.deepEqual(termsFrom("Developer Intern (Summer 2027)"), ["Summer 2027"]);
  assert.deepEqual(termsFrom("Co-op (Summer/Fall 2027)"), ["Summer 2027", "Fall 2027"]);
  assert.deepEqual(termsFrom("Intern (Autumn 2027)", "Toronto, ON"), ["Fall 2027"]);
  assert.deepEqual(termsFrom("Intern - Winter 2027, Winter 2027"), ["Winter 2027"]);
  assert.deepEqual(termsFrom("Software Developer Intern"), []);
});
test("normalizeCanadian fills the listing shape and leaves unknown facts empty", () => {
  const [onsite, remote] = normalizeCanadian(parseCanadianTable(README));
  assert.deepEqual(onsite, {
    company: "exacare ai", role: "Data and Analytics Intern (Summer 2027)", location: "Toronto, ON",
    workMode: "In-person", isCoop: false, terms: ["Summer 2027"], degrees: [], experienceLevel: "",
    url: "https://ats.rippling.com/exacare-inc/jobs/e42f", postedAt: "2026-11-11T00:00:00.000Z",
    source: "canadian-tech-internships", region: "Canada"
  });
  assert.equal(remote.workMode, "Remote");
  assert.equal(remote.isCoop, true);
  assert.deepEqual(remote.terms, ["Winter 2027"]);
  assert.equal(remote.region, "Canada", "Remote, Canada is a Canadian role");
});
