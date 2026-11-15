import test from "node:test";
import assert from "node:assert/strict";
import { dedupeKey, dedupeListings, mergeListings, normalizeSimplify, selectListings } from "../../scripts/fetch-internships.mjs";

const role = (overrides = {}) => ({
  active: true,
  is_visible: true,
  company_name: "Acme",
  title: "Software Engineer Intern",
  locations: ["Remote"],
  url: "https://example.com/apply",
  date_posted: 1_700_000_000,
  terms: ["Summer 2027"],
  degrees: ["Bachelor's"],
  ...overrides
});

test("selectListings keeps only active, visible roles", () => {
  const listings = selectListings([role(), role({ active: false }), role({ is_visible: false })]);
  assert.equal(listings.length, 1);
});

test("selectListings sorts newest first and respects the limit", () => {
  const listings = selectListings([
    role({ company_name: "Older", date_posted: 100 }),
    role({ company_name: "Newer", date_posted: 200 })
  ], { limit: 1 });
  assert.equal(listings.length, 1);
  assert.equal(listings[0].company, "Newer");
});

test("selectListings drops a role with no safe http(s) link", () => {
  const listings = selectListings([role({ url: "javascript:alert(1)" }), role({ url: "" })]);
  assert.equal(listings.length, 0);
});

test("selectListings drops a role missing company or title", () => {
  const listings = selectListings([role({ company_name: "" }), role({ title: "" })]);
  assert.equal(listings.length, 0);
});

test("invalid newest roles do not consume the listing limit", () => {
  const listings = selectListings([
    role({ company_name: "", date_posted: 300 }),
    role({ url: "javascript:alert(1)", date_posted: 200 }),
    role({ company_name: "Valid", date_posted: 100 })
  ], { limit: 1 });
  assert.equal(listings.length, 1);
  assert.equal(listings[0].company, "Valid");
});

test("selectListings joins multiple locations and converts the posted date to ISO", () => {
  const [listing] = selectListings([role({ locations: ["SF", "NYC"], date_posted: 1_700_000_000 })]);
  assert.equal(listing.location, "SF, NYC");
  assert.equal(listing.postedAt, new Date(1_700_000_000 * 1000).toISOString());
  const [multiple] = selectListings([role({ locations: ["Toronto, ON", "Austin, TX", "Toronto, ON"] })]);
  assert.deepEqual(multiple.countries, ["CA", "US"]);
  assert.deepEqual(multiple.regions, ["Ontario", "Texas"]);
});

test("selectListings tolerates a non-array input", () => {
  assert.deepEqual(selectListings(null), []);
  assert.deepEqual(selectListings(undefined), []);
});

test("selectListings infers work mode from the location text", () => {
  const [remote] = selectListings([role({ locations: ["Remote in USA"] })]);
  const [hybrid] = selectListings([role({ locations: ["Hybrid - Chicago, IL"] })]);
  const [onsite] = selectListings([role({ locations: ["Austin, TX"] })]);
  assert.equal(remote.workMode, "Remote");
  assert.equal(hybrid.workMode, "Hybrid");
  assert.equal(onsite.workMode, "In-person");
});

test("selectListings flags a co-op role from its title, not just internships", () => {
  const [coop] = selectListings([role({ title: "Software Developer Co-op" })]);
  const [intern] = selectListings([role({ title: "Software Engineer Intern" })]);
  assert.equal(coop.isCoop, true);
  assert.equal(intern.isCoop, false);
});

test("selectListings carries through terms and degrees for filtering", () => {
  const [listing] = selectListings([role({ terms: ["Summer 2027", "Fall 2027"], degrees: ["Master's", "PhD"] })]);
  assert.deepEqual(listing.terms, ["Summer 2027", "Fall 2027"]);
  assert.deepEqual(listing.degrees, ["Master's", "PhD"]);
});

test("selectListings defaults terms and degrees to an empty list when missing", () => {
  const [listing] = selectListings([role({ terms: undefined, degrees: undefined })]);
  assert.deepEqual(listing.terms, []);
  assert.deepEqual(listing.degrees, []);
});

test("selectListings maps degrees to a student-relevant experience tier", () => {
  const level = degrees => selectListings([role({ degrees })])[0].experienceLevel;
  assert.equal(level([]), "Junior", "unspecified defaults to the most permissive tier");
  assert.equal(level(["Bachelor's"]), "Junior");
  assert.equal(level(["Associate's"]), "Junior");
  assert.equal(level(["Certificate"]), "Junior");
  assert.equal(level(["Bootcamp"]), "Junior");
  assert.equal(level(["Bachelor's", "Master's"]), "Intermediate");
  assert.equal(level(["Master's"]), "Senior");
  assert.equal(level(["Master's", "MBA"]), "Senior");
  assert.equal(level(["PhD"]), "Advanced", "not offered as a Junior/Intermediate/Senior choice");
  assert.equal(level(["JD"]), "Advanced");
});

test("advanced degrees do not hide roles that also accept undergraduate or master's students", () => {
  const level = degrees => selectListings([role({ degrees })])[0].experienceLevel;
  assert.equal(level(["Bachelor's", "Master's", "PhD"]), "Intermediate");
  assert.equal(level(["Bachelor's", "PhD"]), "Junior");
  assert.equal(level(["Master's", "PhD"]), "Senior");
  assert.equal(level(["Associate's", "JD"]), "Junior");
});
test("Simplify listings are tagged with their source and a region read from the location", () => {
  const [toronto, austin, remote, london] = selectListings([
    role({ locations: ["Toronto, ON, Canada"], date_posted: 4 }),
    role({ locations: ["Austin, TX"], date_posted: 3 }),
    role({ locations: ["Remote"], date_posted: 2 }),
    role({ locations: ["London, UK"], date_posted: 1 })
  ]);
  assert.deepEqual([toronto, austin, remote, london].map(listing => listing.source), ["simplify", "simplify", "simplify", "simplify"]);
  assert.deepEqual([toronto, austin, remote, london].map(listing => listing.region), ["Canada", "United States", "Remote", "International"]);
  assert.deepEqual([toronto, austin, remote, london].map(listing => listing.countries), [["CA"], ["US"], ["REMOTE"], ["GB"]]);
  assert.deepEqual([toronto, austin, remote, london].map(listing => listing.regions), [["Ontario"], ["Texas"], ["Other"], ["England"]]);
});
test("normalizeSimplify keeps every valid role so the merge can choose among them", () => {
  const raw = Array.from({ length: 200 }, (_, index) => role({ company_name: `Company ${index}`, date_posted: index }));
  assert.equal(normalizeSimplify(raw).length, 200);
  assert.equal(selectListings(raw).length, 150);
});
const listing = (overrides = {}) => ({
  company: "Acme", role: "Software Intern", location: "Austin, TX", workMode: "In-person", isCoop: false,
  terms: [], degrees: [], experienceLevel: "", url: "https://example.com/apply", postedAt: "2026-11-01T00:00:00.000Z",
  source: "simplify", region: "United States", ...overrides
});
const canadian = (overrides = {}) => listing({ location: "Toronto, ON", source: "canadian-tech-internships", region: "Canada", ...overrides });
test("dedupeKey ignores case, accents, punctuation, legal suffixes and a work term in the title", () => {
  assert.equal(dedupeKey({ company: "Shopify Inc.", role: "Software Developer Co-op (Winter 2027)" }), dedupeKey({ company: "shopify", role: "Software developer co-op" }));
  assert.equal(dedupeKey({ company: "Investissement Québec", role: "AI Intern - Summer 2027" }), dedupeKey({ company: "Investissement Quebec", role: "AI Intern" }));
  assert.equal(dedupeKey({ company: "AT&T", role: "Intern" }), dedupeKey({ company: "AT and T", role: "Intern" }));
  assert.notEqual(dedupeKey({ company: "Acme", role: "Data Intern" }), dedupeKey({ company: "Acme", role: "Software Intern" }));
});
test("dedupeListings keeps the richer copy of the same role", () => {
  const rich = listing({ degrees: ["Bachelor's"], experienceLevel: "Junior", terms: ["Summer 2027"] });
  const [kept, ...rest] = dedupeListings([canadian({ role: "Software Intern (Summer 2027)", terms: ["Summer 2027"] }), rich]);
  assert.equal(rest.length, 0);
  assert.equal(kept, rich);
});
test("dedupeListings prefers the Canadian list when both copies are equally complete", () => {
  for (const order of [[listing(), canadian()], [canadian(), listing()]]) {
    const kept = dedupeListings(order);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].source, "canadian-tech-internships");
  }
});
test("dedupeListings prefers the newer copy when source and completeness tie", () => {
  const kept = dedupeListings([listing({ postedAt: "2026-10-01T00:00:00.000Z" }), listing({ postedAt: "2026-11-05T00:00:00.000Z" })]);
  assert.deepEqual(kept.map(item => item.postedAt), ["2026-11-05T00:00:00.000Z"]);
});
test("dedupeListings keeps the same title in two different work terms", () => {
  const kept = dedupeListings([
    canadian({ role: "Developer Intern (Summer 2027)", terms: ["Summer 2027"] }),
    canadian({ role: "Developer Intern (Winter 2027)", terms: ["Winter 2027"] }),
    canadian({ role: "Developer Intern", terms: [] })
  ]);
  assert.deepEqual(kept.map(item => item.terms), [["Summer 2027"], ["Winter 2027"]], "a copy with no term matches the first known one");
});
const day = index => new Date(Date.UTC(2026, 10, 1) - index * 86_400_000).toISOString();
test("mergeListings guarantees Canadian roles even when newer US roles would fill the feed", () => {
  const us = Array.from({ length: 20 }, (_, index) => listing({ company: `US ${index}`, postedAt: day(index) }));
  const ca = Array.from({ length: 10 }, (_, index) => canadian({ company: `CA ${index}`, postedAt: day(100 + index) }));
  const merged = mergeListings(us, ca, { limit: 12, canadaQuota: 5 });
  assert.equal(merged.length, 12);
  assert.equal(merged.filter(item => item.region === "Canada").length, 5);
  assert.deepEqual(merged.filter(item => item.region === "Canada").map(item => item.company), ["CA 0", "CA 1", "CA 2", "CA 3", "CA 4"], "the newest Canadian roles");
  assert.deepEqual(merged.slice(0, 7).map(item => item.company), ["US 0", "US 1", "US 2", "US 3", "US 4", "US 5", "US 6"], "then the newest Simplify roles");
  assert.deepEqual(merged.map(item => item.postedAt), [...merged.map(item => item.postedAt)].sort().reverse(), "newest first");
});
test("Canadian roles from Simplify count toward the quota, and Canadian-list rows past it do not fill", () => {
  const us = Array.from({ length: 10 }, (_, index) => listing({ company: `US ${index}`, postedAt: day(10 + index) }));
  const simplifyCanada = listing({ company: "Simplify CA", location: "Ottawa, ON, Canada", region: "Canada", postedAt: day(0) });
  const ca = Array.from({ length: 5 }, (_, index) => canadian({ company: `CA ${index}`, postedAt: day(1 + index) }));
  const merged = mergeListings([simplifyCanada, ...us], ca, { limit: 8, canadaQuota: 3 });
  assert.deepEqual(merged.filter(item => item.region === "Canada").map(item => item.company), ["Simplify CA", "CA 0", "CA 1"]);
  assert.equal(merged.filter(item => item.source === "simplify" && item.region !== "Canada").length, 5);
});
test("mergeListings uses whatever exists when there are fewer roles than the limit", () => {
  const merged = mergeListings([listing({ company: "Only US" })], [canadian({ company: "Only CA" })], { limit: 150, canadaQuota: 60 });
  assert.deepEqual(merged.map(item => item.company).sort(), ["Only CA", "Only US"]);
  assert.deepEqual(mergeListings([], []), []);
  assert.equal(mergeListings([], Array.from({ length: 5 }, (_, index) => canadian({ company: `CA ${index}` })), { limit: 3, canadaQuota: 60 }).length, 3, "the quota never exceeds the limit");
});
test("mergeListings removes a role listed by both sources before choosing", () => {
  const merged = mergeListings([listing({ company: "Ciena", role: "Layout Intern", location: "Ottawa, ON, Canada", region: "Canada" })],
    [canadian({ company: "Ciena", role: "Layout Intern (Winter 2027)", location: "Ottawa, ON", terms: ["Winter 2027"] })]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, "canadian-tech-internships", "it has the work term, so it is the richer copy");
});
