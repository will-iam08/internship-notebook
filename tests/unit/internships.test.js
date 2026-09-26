import test from "node:test";
import assert from "node:assert/strict";
import { selectListings } from "../../scripts/fetch-internships.mjs";

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

test("selectListings joins multiple locations and converts the posted date to ISO", () => {
  const [listing] = selectListings([role({ locations: ["SF", "NYC"], date_posted: 1_700_000_000 })]);
  assert.equal(listing.location, "SF, NYC");
  assert.equal(listing.postedAt, new Date(1_700_000_000 * 1000).toISOString());
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
