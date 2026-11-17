import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import * as clipper from "../../src/main/resources/public/js/clipper.js";
import { parseNewIntent } from "../../src/main/resources/public/js/clipper.js";
import {
  DEFAULT_NOTEBOOK, cleanNotebookAddress, closingDay, descriptionText, findJobPostings, jobFromPage, notebookNewUrl, postingLocation
} from "../../extension/job-from-page.js";

const extensionFile = name => readFileSync(new URL(`../../extension/${name}`, import.meta.url), "utf8");

// Shaped like the schema.org JobPosting that Greenhouse, Lever, Ashby and Workday pages embed.
const greenhousePosting = {
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: "Software Engineer Intern (Summer 2027)",
  hiringOrganization: { "@type": "Organization", name: "Stripe", sameAs: "https://stripe.com" },
  jobLocation: [
    { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Toronto", addressRegion: "ON", addressCountry: "CA" } },
    { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Seattle", addressRegion: "WA", addressCountry: "US" } }
  ],
  validThrough: "2026-12-01T23:59:59-05:00",
  description: "&lt;p&gt;Build payments infrastructure with &lt;strong&gt;Java&lt;/strong&gt; and Go.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Experience with SQL &amp;amp; Kubernetes&lt;/li&gt;&lt;li&gt;Bonus: React&lt;/li&gt;&lt;/ul&gt;"
};

const snapshot = (extra = {}) => ({
  url: "https://job-boards.greenhouse.io/stripe/jobs/7654321",
  title: "Job Application for Software Engineer Intern (Summer 2027) at Stripe",
  heading: "Software Engineer Intern (Summer 2027)",
  ogTitle: "",
  selection: "",
  structured: [greenhousePosting],
  ...extra
});

/* ---------- findJobPostings ---------- */
test("findJobPostings finds a JobPosting on its own, in a list, inside @graph, and under a full type URL", () => {
  assert.equal(findJobPostings([greenhousePosting]).length, 1);
  assert.equal(findJobPostings(greenhousePosting).length, 1);
  assert.equal(findJobPostings([{ "@context": "https://schema.org", "@graph": [{ "@type": "WebPage" }, { "@type": ["Thing", "JobPosting"], title: "A" }] }])[0].title, "A");
  assert.equal(findJobPostings([{ "@type": "http://schema.org/JobPosting", title: "B" }])[0].title, "B");
  assert.equal(findJobPostings([{ "@type": "WebPage", mainEntity: { "@type": "JobPosting", title: "C" } }])[0].title, "C");
});

test("findJobPostings ignores everything else and survives odd or enormous data", () => {
  for (const value of [undefined, null, "", 42, [], [{ "@type": "Organization", name: "Stripe" }], [null, "text", 3]]) {
    assert.deepEqual(findJobPostings(value), [], JSON.stringify(value));
  }
  let deep = { "@type": "JobPosting", title: "too deep" };
  for (let level = 0; level < 50; level++) deep = { "@graph": [deep] };
  assert.deepEqual(findJobPostings(deep), []);
  const wide = Array.from({ length: 5000 }, () => ({ "@type": "WebPage" }));
  wide.push({ "@type": "JobPosting", title: "far away" });
  assert.deepEqual(findJobPostings(wide), [], "searching stops after a fixed amount of work");
});

/* ---------- postingLocation ---------- */
test("postingLocation writes up to two places, and handles remote postings", () => {
  assert.equal(postingLocation(greenhousePosting), "Toronto, ON; Seattle, WA");
  assert.equal(postingLocation({ jobLocation: { address: { addressLocality: "Waterloo", addressRegion: "ON" } } }), "Waterloo, ON");
  assert.equal(postingLocation({ jobLocation: { address: { addressCountry: { "@type": "Country", name: "Canada" } } } }), "Canada");
  assert.equal(postingLocation({ jobLocation: { address: "123 King St, Toronto" } }), "123 King St, Toronto");
  assert.equal(postingLocation({ jobLocationType: "TELECOMMUTE" }), "Remote");
  assert.equal(postingLocation({ jobLocationType: "TELECOMMUTE", applicantLocationRequirements: { "@type": "Country", name: "Canada" } }), "Remote (Canada)");
  assert.equal(postingLocation({ jobLocationType: ["TELECOMMUTE"], jobLocation: { address: { addressLocality: "Toronto", addressRegion: "ON" } } }), "Toronto, ON or Remote");
  assert.equal(postingLocation({ jobLocation: [{ address: { addressLocality: "A", addressRegion: "B" } }, { address: { addressLocality: "A", addressRegion: "B" } }] }), "A, B", "repeats are dropped");
  assert.equal(postingLocation(null), "");
  assert.equal(postingLocation({}), "");
  assert.ok(postingLocation({ jobLocation: [{ address: { addressLocality: "L".repeat(70), addressRegion: "XX" } }, { address: { addressLocality: "M".repeat(70) } }] }).length <= 80);
});

/* ---------- descriptionText ---------- */
test("descriptionText turns escaped HTML into readable lines", () => {
  assert.equal(descriptionText(greenhousePosting.description),
    "Build payments infrastructure with Java and Go.\n- Experience with SQL & Kubernetes\n- Bonus: React");
  assert.equal(descriptionText("<p>Line one<br>Line two</p><script>alert(1)</script><style>p{}</style>"), "Line one\nLine two");
  assert.equal(descriptionText("Pay &#36;40/h &#x2014; full time&nbsp;role"), "Pay $40/h - full time role", "entities decode and dashes become hyphens");
  assert.equal(descriptionText("Use <strong>Java</strong>, <a href=\"#\">Go</a>.<table><tr><td>A</td><td>B</td></tr></table>"), "Use Java, Go.\nA B", "inline tags leave no stray spaces; table cells stay apart");
  assert.equal(descriptionText(""), "");
  assert.equal(descriptionText(undefined), "");
  assert.equal(descriptionText("x".repeat(20_000)).length, 10_000, "held to the notebook's notes limit");
});

/* ---------- closingDay ---------- */
test("closingDay keeps the day of a real closing date and drops anything else", () => {
  assert.equal(closingDay("2026-12-01T23:59:59-05:00"), "2026-12-01");
  assert.equal(closingDay("2026-12-01"), "2026-12-01");
  for (const value of ["2026-02-30", "12/01/2026", "soon", "", null, undefined, 20261201]) assert.equal(closingDay(value), "", String(value));
});

/* ---------- jobFromPage ---------- */
test("jobFromPage takes the structured posting first and the clipper for the rest", () => {
  const job = jobFromPage(snapshot(), clipper);
  assert.deepEqual({ ...job, description: undefined }, {
    company: "Stripe",
    role: "Software Engineer Intern (Summer 2027)",
    location: "Toronto, ON; Seattle, WA",
    source: "Company website",
    link: "https://job-boards.greenhouse.io/stripe/jobs/7654321",
    deadline: "2026-12-01",
    skills: ["Java", "React", "SQL", "Kubernetes"],
    selection: "",
    description: undefined,
    fromPosting: true
  });
  assert.ok(job.description.startsWith("Build payments infrastructure"));
});

test("jobFromPage falls back to the page title, address and selection when there is no structured posting", () => {
  const job = jobFromPage(snapshot({
    url: "https://www.linkedin.com/jobs/view/data-analyst-intern-at-shopify-3812345678",
    title: "Shopify hiring Data Analyst Intern in Ottawa, ON | LinkedIn",
    heading: "",
    selection: "You will use Python and SQL every day.",
    structured: []
  }), clipper);
  assert.equal(job.fromPosting, false);
  assert.equal(job.company, "Shopify");
  assert.equal(job.role, "Data Analyst Intern");
  assert.equal(job.location, "Ottawa, ON");
  assert.equal(job.source, "LinkedIn");
  assert.equal(job.deadline, "");
  assert.equal(job.description, "");
  assert.deepEqual(job.skills, ["Python", "SQL"]);
  assert.equal(job.selection, "You will use Python and SQL every day.");
});

test("jobFromPage uses the page heading for the role only when it reads like a job title", () => {
  const base = { url: "https://careers.example.com/jobs/42", title: "Careers", structured: [] };
  assert.equal(jobFromPage({ ...base, heading: "Embedded Software Intern" }, clipper).role, "Embedded Software Intern");
  assert.equal(jobFromPage({ ...base, heading: "Join our team" }, clipper).role, "");
});

test("jobFromPage copes with an empty or broken snapshot", () => {
  for (const value of [undefined, {}, { url: "", title: "", structured: "not a list" }, { structured: [{ "@type": "JobPosting" }] }]) {
    const job = jobFromPage(value, clipper);
    assert.equal(typeof job.company, "string");
    assert.equal(typeof job.role, "string");
    assert.ok(Array.isArray(job.skills));
  }
  const unsafe = jobFromPage({ url: "javascript:alert(1)", title: "Intern at Acme", structured: [] }, clipper);
  assert.equal(unsafe.link, "", "a non-web address never becomes the posting link");
});

test("jobFromPage keeps every field inside the notebook's limits", () => {
  const job = jobFromPage(snapshot({ structured: [{ ...greenhousePosting, title: "T".repeat(300), hiringOrganization: "C".repeat(300) }] }), clipper);
  assert.equal(job.role.length, 100);
  assert.equal(job.company.length, 80);
  assert.ok(job.skills.length <= 12);
});

/* ---------- cleanNotebookAddress ---------- */
test("cleanNotebookAddress accepts the live site, a local copy, and a page address, and nothing else", () => {
  assert.equal(cleanNotebookAddress(DEFAULT_NOTEBOOK), "https://internshipnotebook.app/");
  assert.equal(cleanNotebookAddress("internshipnotebook.app"), "https://internshipnotebook.app/");
  assert.equal(cleanNotebookAddress(" https://internshipnotebook.app/#/today?x=1 "), "https://internshipnotebook.app/");
  assert.equal(cleanNotebookAddress("http://localhost:4173"), "http://localhost:4173/");
  assert.equal(cleanNotebookAddress("localhost:4173"), "http://localhost:4173/", "a local copy without a scheme uses http");
  assert.equal(cleanNotebookAddress("127.0.0.1:8080/index.html"), "http://127.0.0.1:8080/index.html");
  assert.equal(cleanNotebookAddress("http://127.0.0.1:8080/index.html"), "http://127.0.0.1:8080/index.html");
  assert.equal(cleanNotebookAddress("https://will-iam08.github.io/internship-notebook"), "https://will-iam08.github.io/internship-notebook/");
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///Users/will/notebook", "ftp://example.com", "", "   ", null, "http://"]) {
    assert.equal(cleanNotebookAddress(bad), "", String(bad));
  }
});

/* ---------- notebookNewUrl ---------- */
test("notebookNewUrl opens #/new with the job, and the notebook reads every field back", () => {
  const job = { ...jobFromPage(snapshot({ selection: "Team: Payments" }), clipper), savedOn: "Nov 17, 2026" };
  const url = notebookNewUrl("https://internshipnotebook.app/", job);
  assert.ok(url.startsWith("https://internshipnotebook.app/#/new?"), url);
  assert.equal(new URL(url).search, "", "nothing about the job is in the part of the address a server sees");
  const intent = parseNewIntent(new URLSearchParams(url.split("#/new?")[1]));
  assert.deepEqual(intent, {
    stage: "SAVED",
    initial: {
      company: "Stripe",
      role: "Software Engineer Intern (Summer 2027)",
      location: "Toronto, ON; Seattle, WA",
      source: "Company website",
      link: "https://job-boards.greenhouse.io/stripe/jobs/7654321",
      skills: ["Java", "React", "SQL", "Kubernetes"],
      notes: "Team: Payments",
      deadline: "2026-12-01"
    }
  });
});

test("notebookNewUrl adds the job description to the notes only when asked", () => {
  const job = { ...jobFromPage(snapshot(), clipper), savedOn: "Nov 17, 2026" };
  const notes = url => new URLSearchParams(url.split("#/new?")[1]).get("notes");
  assert.equal(notes(notebookNewUrl(DEFAULT_NOTEBOOK, job)), null);
  assert.equal(notes(notebookNewUrl(DEFAULT_NOTEBOOK, job, { includeDescription: true })),
    "Job description (saved Nov 17, 2026):\nBuild payments infrastructure with Java and Go.\n- Experience with SQL & Kubernetes\n- Bonus: React");
  const both = notes(notebookNewUrl(DEFAULT_NOTEBOOK, { ...job, selection: "Ask about the team" }, { includeDescription: true }));
  assert.ok(both.startsWith("Ask about the team\n\nJob description"));
  const long = notes(notebookNewUrl(DEFAULT_NOTEBOOK, { ...job, description: "d".repeat(20_000) }, { includeDescription: true }));
  assert.equal(long.length, 10_000);
});

test("notebookNewUrl leaves out empty fields, and refuses a bad notebook address", () => {
  const empty = { company: "", role: "", location: "", source: "", link: "", deadline: "", skills: [], selection: "", description: "" };
  assert.equal(notebookNewUrl(DEFAULT_NOTEBOOK, empty), "https://internshipnotebook.app/#/new");
  assert.equal(notebookNewUrl("http://localhost:4173", { ...empty, company: "Acme & Co" }), "http://localhost:4173/#/new?company=Acme+%26+Co");
  assert.equal(notebookNewUrl("javascript:alert(1)", { ...empty, company: "Acme" }), "");
});

/* ---------- The extension package ---------- */
test("the manifest asks for as little as possible", () => {
  const manifest = JSON.parse(extensionFile("manifest.json"));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions.sort(), ["activeTab", "scripting", "storage"]);
  assert.equal("host_permissions" in manifest, false, "no standing access to any website");
  assert.equal("content_scripts" in manifest, false, "nothing runs on a page until the button is clicked");
  assert.equal("background" in manifest, false);
  assert.equal(manifest.action.default_popup, "popup.html");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.name.length <= 45, "Chrome Web Store name limit");
  assert.ok(manifest.description.length <= 132, "Chrome Web Store description limit");
  assert.ok(manifest.browser_specific_settings.gecko.id, "Firefox needs an add-on id");
  for (const icon of [...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)]) {
    assert.ok(readdirSync(new URL("../../extension/icons/", import.meta.url)).includes(icon.replace("icons/", "")), icon);
  }
});

test("the popup loads only its own files, and page-reader.js stands alone", () => {
  const html = extensionFile("popup.html");
  assert.match(html, /<script type="module" src="popup.js"><\/script>/);
  assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/.test(html), false, "no inline script (extension pages forbid it)");
  assert.equal(/\bon[a-z]+=/i.test(html), false, "no inline event handlers");
  assert.equal(/https?:\/\/(?!internshipnotebook\.app)/.test(html.replace(/<p class="privacy">[\s\S]*?<\/p>/, "")), false, "no remote resources");
  const reader = extensionFile("page-reader.js");
  assert.equal(/^\s*import\s/m.test(reader), false, "the browser runs readJobPage on its own, so it cannot import anything");
  assert.equal(/fetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(reader), false, "reading a page never sends anything");
});

test("no em dashes anywhere in the extension", () => {
  for (const name of readdirSync(new URL("../../extension/", import.meta.url)).filter(file => /\.(js|html|css|json)$/.test(file))) {
    assert.equal(extensionFile(name).includes("—"), false, name);
  }
});
