import test from "node:test";
import assert from "node:assert/strict";
import { createUsageTracker, usagePage } from "../../src/main/resources/public/js/usage.js";

const ID = "11111111-1111-4111-8111-111111111111";
function fixture() {
  const values = new Map();
  const calls = [];
  const listeners = {};
  const env = {
    Date: { now: () => Date.parse("2026-11-14T23:59:00Z") },
    crypto: { randomUUID: () => ID },
    location: { hostname: "internshipnotebook.app", hash: "#/entry/42?email=private@example.test" },
    navigator: {},
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    document: { visibilityState: "visible", addEventListener: (type, fn) => { listeners[type] = fn; } },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    setInterval: (fn, ms) => { listeners.interval = fn; assert.equal(ms, 60000); },
    AbortSignal,
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: true }; }
  };
  return { env, values, calls, listeners, tracker: createUsageTracker({ url: "https://test.supabase.co", anonKey: "public-key" }, env) };
}

test("usage sends only a daily browser ID, allowlisted page, and page-view flag", async () => {
  const { tracker, calls } = fixture();
  assert.equal(await tracker.track(true), true);
  const { url, options } = calls[0];
  assert.equal(url, "https://test.supabase.co/rest/v1/rpc/record_notebook_usage");
  assert.deepEqual(JSON.parse(options.body), { p_visitor: ID, p_page: "entry", p_page_view: true });
  assert.deepEqual(options.headers, { apikey: "public-key", "Content-Type": "application/json" });
  assert.equal(options.credentials, "omit");
  assert.equal(options.referrerPolicy, "no-referrer");
  assert.equal(JSON.stringify(calls).includes("private@example.test"), false);
  assert.equal(usagePage("#/private-company-name"), "today");
});

test("refreshes reuse the daily ID, while a UTC day change rotates it", async () => {
  const { tracker, env, calls } = fixture();
  await tracker.track(true);
  env.crypto.randomUUID = () => "22222222-2222-4222-8222-222222222222";
  await tracker.track(false);
  assert.equal(JSON.parse(calls[1].options.body).p_visitor, ID);
  env.Date.now = () => Date.parse("2026-11-15T00:00:01Z");
  await tracker.track(false);
  assert.notEqual(JSON.parse(calls[2].options.body).p_visitor, ID);
});

test("opt-out persists across tracker instances and stops all requests", async () => {
  const { tracker, env, values, calls } = fixture();
  await tracker.track();
  assert.equal(tracker.setOptOut(true), true);
  assert.equal(values.has("notebook-usage-visitor-v1"), false);
  const next = createUsageTracker({ url: "https://test.supabase.co", anonKey: "public-key" }, env);
  assert.equal(await next.track(true), false);
  assert.equal(calls.length, 1);
  tracker.setOptOut(false);
  assert.equal(await next.track(true), true);
});

test("privacy signals, hidden tabs, blocked storage, and nonproduction hosts send nothing", async () => {
  for (const configure of [
    env => { env.navigator.doNotTrack = "1"; },
    env => { env.navigator.globalPrivacyControl = true; },
    env => { env.doNotTrack = "1"; },
    env => { env.document.visibilityState = "hidden"; },
    env => { env.location.hostname = "localhost"; },
    env => { env.localStorage.getItem = () => { throw new Error("Blocked"); }; },
    env => { env.localStorage.setItem = () => { throw new Error("Full"); }; }
  ]) {
    const { tracker, env, calls } = fixture();
    configure(env);
    assert.equal(await tracker.track(true), false);
    assert.equal(calls.length, 0);
  }
});

test("missing or untrusted config cannot send anything", async () => {
  const { env, calls } = fixture();
  for (const config of [{}, { url: "https://untrusted.example", anonKey: "key" }, { url: "https://test.supabase.co" }]) {
    const tracker = createUsageTracker(config, env);
    tracker.start();
    assert.equal(await tracker.track(true), false);
  }
  assert.equal(calls.length, 0);
});

test("failed requests are contained and do not affect notebook operations", async () => {
  const { tracker, env } = fixture();
  env.fetch = async () => { throw new Error("Offline"); };
  assert.equal(await tracker.track(true), false);
  env.fetch = async () => ({ ok: false });
  assert.equal(await tracker.track(true), false);
});

test("starts once, records navigation, and sends heartbeats only while visible", async () => {
  const { tracker, env, listeners, calls } = fixture();
  tracker.start();
  tracker.start();
  assert.equal(calls.length, 1);
  env.location.hash = "#/board";
  listeners.hashchange();
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[1].options.body).p_page, "board");
  listeners.interval();
  assert.equal(JSON.parse(calls[2].options.body).p_page_view, false);
  env.document.visibilityState = "hidden";
  listeners.interval();
  listeners.visibilitychange();
  assert.equal(calls.length, 3);
});
