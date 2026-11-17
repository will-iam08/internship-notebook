import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  buildBookmarkletHref,
  extractLocationFromText,
  extractSkillsFromText,
  humanizeSlug,
  parseJobClip,
  parseJobUrl,
  parseNewIntent
} from "../../src/main/resources/public/js/clipper.js";
import { SKILL_LIMIT } from "../../src/main/resources/public/js/domain.js";

test("humanizeSlug maps known tech brands and humanizes unknown company slugs", () => {
  assert.equal(humanizeSlug("stripe"), "Stripe");
  assert.equal(humanizeSlug("openai"), "OpenAI");
  assert.equal(humanizeSlug("scale-ai"), "Scale AI");
  assert.equal(humanizeSlug("1password"), "1Password");
  assert.equal(humanizeSlug("northwind-robotics-jobs"), "Northwind Robotics");
  assert.equal(humanizeSlug("acme-ai-inc"), "Acme AI");
});

test("parseJobUrl extracts company, role, source, and link from major ATS and job board URLs", () => {
  const gh = parseJobUrl("https://boards.greenhouse.io/stripe/jobs/5123456");
  assert.equal(gh.company, "Stripe");
  assert.equal(gh.source, "Company website");
  assert.equal(gh.link, "https://boards.greenhouse.io/stripe/jobs/5123456");

  const ghBoard = parseJobUrl("https://job-boards.greenhouse.io/figma/jobs/4998877");
  assert.equal(ghBoard.company, "Figma");
  assert.equal(ghBoard.source, "Company website");

  const lever = parseJobUrl("https://jobs.lever.co/palantir/8a7b6c5d-1234-5678-9abc-def012345678");
  assert.equal(lever.company, "Palantir");
  assert.equal(lever.source, "Company website");

  const ashby = parseJobUrl("https://jobs.ashbyhq.com/linear/2f3e4d5c-9876-5432-10fe-dcba98765432");
  assert.equal(ashby.company, "Linear");
  assert.equal(ashby.source, "Company website");

  const workday = parseJobUrl("https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/Santa-Clara/Software-Engineer-Intern_JR1987654");
  assert.equal(workday.company, "NVIDIA");
  assert.equal(workday.role, "Software Engineer Intern");
  assert.equal(workday.source, "Company website");

  const smartRecruiters = parseJobUrl("https://jobs.smartrecruiters.com/Visa/743999123456-software-engineer-intern");
  assert.equal(smartRecruiters.company, "Visa");
  assert.equal(smartRecruiters.role, "Software Engineer Intern");
  assert.equal(smartRecruiters.source, "Company website");

  const linkedin = parseJobUrl("https://www.linkedin.com/jobs/view/software-engineer-intern-at-datadog-3912345678");
  assert.equal(linkedin.company, "Datadog");
  assert.equal(linkedin.role, "Software Engineer Intern");
  assert.equal(linkedin.source, "LinkedIn");

  const simplify = parseJobUrl("https://simplify.jobs/p/12345678-aaaa-bbbb-cccc-1234567890ab/Backend-Engineer-Intern-at-Shopify");
  assert.equal(simplify.company, "Shopify");
  assert.equal(simplify.role, "Backend Engineer Intern");
  assert.equal(simplify.source, "Simplify");

  const handshake = parseJobUrl("https://app.joinhandshake.com/stu/jobs/9182736");
  assert.equal(handshake.source, "Handshake");

  const indeed = parseJobUrl("https://ca.indeed.com/viewjob?jk=abcdef123456");
  assert.equal(indeed.source, "Indeed");

  const waterlooWorks = parseJobUrl("https://waterlooworks.uwaterloo.ca/myAccount/co-op/full/jobs.htm");
  assert.equal(waterlooWorks.source, "WaterlooWorks");
});

test("parseJobUrl rejects unsafe schemes and malformed URLs", () => {
  assert.deepEqual(parseJobUrl("javascript:alert(1)"), { company: "", role: "", location: "", source: "", link: "" });
  assert.deepEqual(parseJobUrl("data:text/html,<script>alert(1)</script>"), { company: "", role: "", location: "", source: "", link: "" });
  assert.deepEqual(parseJobUrl("not a url"), { company: "", role: "", location: "", source: "", link: "" });
});

test("parseJobClip parses common title and header formats, locations, and skills", () => {
  const atPattern = parseJobClip("Software Engineer Intern at Stripe");
  assert.equal(atPattern.company, "Stripe");
  assert.equal(atPattern.role, "Software Engineer Intern");

  const atSymbol = parseJobClip("Machine Learning Intern @ Cohere in Toronto, ON");
  assert.equal(atSymbol.company, "Cohere");
  assert.equal(atSymbol.role, "Machine Learning Intern");
  assert.equal(atSymbol.location, "Toronto, ON");

  const dashPattern = parseJobClip("Stripe - Software Engineer Intern (Summer 2027)");
  assert.equal(dashPattern.company, "Stripe");
  assert.equal(dashPattern.role, "Software Engineer Intern (Summer 2027)");

  const roleFirstDash = parseJobClip("Frontend Developer Intern - Shopify | Simplify");
  assert.equal(roleFirstDash.company, "Shopify");
  assert.equal(roleFirstDash.role, "Frontend Developer Intern");
  assert.equal(roleFirstDash.source, "Simplify");

  const linkedinTitle = parseJobClip({
    title: "Stripe hiring Software Engineer Intern in Toronto, ON | LinkedIn",
    url: "https://www.linkedin.com/jobs/view/999888777",
    text: "Requirements: Python, TypeScript, React, SQL, and Docker."
  });
  assert.equal(linkedinTitle.company, "Stripe");
  assert.equal(linkedinTitle.role, "Software Engineer Intern");
  assert.equal(linkedinTitle.location, "Toronto, ON");
  assert.equal(linkedinTitle.source, "LinkedIn");
  assert.equal(linkedinTitle.link, "https://www.linkedin.com/jobs/view/999888777");
  assert.deepEqual(linkedinTitle.skills, ["TypeScript", "Python", "React", "SQL", "Docker"]);

  const greenhouseTitle = parseJobClip({
    title: "Job Application for Product Design Intern at Figma",
    url: "https://boards.greenhouse.io/figma/jobs/123456",
    text: "Location: San Francisco, CA\nTools: Figma, HTML, CSS, JavaScript"
  });
  assert.equal(greenhouseTitle.company, "Figma");
  assert.equal(greenhouseTitle.role, "Product Design Intern");
  assert.equal(greenhouseTitle.location, "San Francisco, CA");
  assert.equal(greenhouseTitle.source, "Company website");
  assert.deepEqual(greenhouseTitle.skills, ["JavaScript", "HTML", "CSS", "Figma"]);
});

test("extractSkillsFromText avoids Java/JavaScript false positives, handles C++ and C#, and caps at SKILL_LIMIT", () => {
  const jsOnly = extractSkillsFromText("We use JavaScript, Next.js, and Node.js.");
  assert.ok(jsOnly.includes("JavaScript"));
  assert.ok(jsOnly.includes("Next.js"));
  assert.ok(jsOnly.includes("Node.js"));
  assert.ok(!jsOnly.includes("Java"), "JavaScript must not trigger Java");

  const cppAndCsharp = extractSkillsFromText("Experience with C++, C#, Python, and Go programming.");
  assert.deepEqual(cppAndCsharp, ["Python", "C++", "C#", "Go"]);

  const manySkills = extractSkillsFromText(
    "TypeScript JavaScript Python Java C++ C# Rust React Next.js Node.js Vue Angular HTML CSS SQL PostgreSQL MySQL MongoDB Redis GraphQL AWS GCP Docker Kubernetes"
  );
  assert.equal(manySkills.length, SKILL_LIMIT);
});

test("extractLocationFromText finds labeled locations, major tech hubs, Remote, and Hybrid", () => {
  assert.equal(extractLocationFromText("Location: Waterloo, ON"), "Waterloo, ON");
  assert.equal(extractLocationFromText("Join our team in San Francisco, CA (Hybrid) this summer."), "San Francisco, CA (Hybrid)");
  assert.equal(extractLocationFromText("Work from anywhere - Remote (US & Canada)"), "Remote (US & Canada)");
});

test("parseNewIntent combines explicit query parameters with smart URL and title parsing", () => {
  const intent = parseNewIntent(new URLSearchParams({
    url: "https://boards.greenhouse.io/stripe/jobs/445566",
    title: "Job Application for Backend Engineer Intern at Stripe",
    text: "Working with Java, Go, PostgreSQL in Seattle, WA",
    stage: "APPLIED"
  }));
  assert.equal(intent.stage, "APPLIED");
  assert.equal(intent.initial.company, "Stripe");
  assert.equal(intent.initial.role, "Backend Engineer Intern");
  assert.equal(intent.initial.location, "Seattle, WA");
  assert.equal(intent.initial.source, "Company website");
  assert.equal(intent.initial.link, "https://boards.greenhouse.io/stripe/jobs/445566");
  assert.deepEqual(intent.initial.skills, ["Java", "PostgreSQL"]);
});

test("buildBookmarkletHref produces a valid javascript: bookmarklet targeting #/new?", () => {
  const href = buildBookmarkletHref("https://internshipnotebook.app/");
  assert.ok(href.startsWith("javascript:(()=>{"));
  assert.ok(href.includes("https://internshipnotebook.app/"));
  assert.ok(href.includes("#/new?"));
});

test("clipper.js is a pure module that imports only domain.js and contains no literal em dashes", () => {
  const file = path.resolve("src/main/resources/public/js/clipper.js");
  const source = fs.readFileSync(file, "utf8");
  const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map(match => match[1]);
  assert.deepEqual(imports, ["./domain.js"]);
  assert.ok(!source.includes("\u2014"), "clipper.js must not contain literal em dashes");
  assert.ok(!/\b(?:document|window\.localStorage|localStorage|fetch)\b/.test(source.replace(/buildBookmarkletHref[\s\S]*$/, "")));
});
