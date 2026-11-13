import test from "node:test";
import assert from "node:assert/strict";
import { createCloudClient } from "../../src/main/resources/public/js/cloud.js";

const URL = "https://notebook.supabase.co";
const KEY = "public-anon-key";
const auth = { access_token: "private-access-token", user: { id: "owner-id", email: "owner@example.com" } };
const older = { updatedAt: "2026-11-01T12:00:00Z", applications: [{ id: 1, notes: "old" }] };
const newer = { updatedAt: "2026-11-02T12:00:00Z", applications: [{ id: 1, notes: "new" }] };
const response = (body, status = 200) => new Response(body == null ? null : JSON.stringify(body), { status });

function fixture(replies = [], config = {}) {
  const calls = [];
  const client = createCloudClient({
    url: `${URL}/`, anonKey: KEY,
    fetch: async (...args) => {
      calls.push(args);
      const next = replies.shift();
      if (next instanceof Error) throw next;
      assert.ok(next, "Unexpected fetch call");
      return next;
    },
    ...config
  });
  return { client, calls };
}

async function signedIn(replies = []) {
  const result = fixture([response(auth), ...replies]);
  await result.client.signIn("owner@example.com", "private-password");
  return result;
}

test("missing, empty, or partial config stays disabled and makes zero calls", async () => {
  assert.equal(createCloudClient().enabled, false);
  for (const config of [{ url: "" }, { anonKey: "" }, { url: " ", anonKey: " " }, { url: null }]) {
    const { client, calls } = fixture([], config);
    assert.equal(client.enabled, false);
    assert.equal(await client.signIn("owner@example.com", "password"), null);
    await client.signOut();
    assert.equal(client.session(), null);
    assert.equal(await client.push(newer), null);
    assert.equal(await client.pull(), null);
    assert.deepEqual(await client.sync(newer), { action: "noop", notebook: newer });
    assert.equal(calls.length, 0);
  }
});

test("signIn uses GoTrue password auth and keeps a private in-memory session", async () => {
  const { client, calls } = fixture([response(auth)]);
  assert.equal(client.enabled, true);
  assert.equal(client.session(), null);
  assert.deepEqual(await client.signIn(" owner@example.com ", "private-password"), auth);
  assert.deepEqual(calls, [[`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "owner@example.com", password: "private-password" })
  }]]);
  const exposed = client.session();
  exposed.access_token = "changed";
  exposed.user.id = "changed";
  assert.deepEqual(client.session(), auth);
});

test("signOut calls GoTrue with the access token and clears the session", async () => {
  const { client, calls } = await signedIn([response(null, 204)]);
  await client.signOut();
  assert.equal(client.session(), null);
  assert.equal(calls[1][0], `${URL}/auth/v1/logout`);
  assert.equal(calls[1][1].method, "POST");
  assert.equal(calls[1][1].headers.apikey, KEY);
  assert.equal(calls[1][1].headers.Authorization, `Bearer ${auth.access_token}`);
  await client.signOut();
  assert.equal(calls.length, 2);
});

test("a failed logout still discards the local session", async () => {
  const { client } = await signedIn([new Error("secret server details")]);
  await assert.rejects(client.signOut(), { message: "Cloud sync is offline." });
  assert.equal(client.session(), null);
});

test("push upserts the whole notebook for the authenticated owner", async () => {
  const { client, calls } = await signedIn([response(null, 201)]);
  assert.equal(await client.push(newer), newer);
  assert.deepEqual(calls[1], [`${URL}/rest/v1/notebooks?on_conflict=user_id`, {
    method: "POST",
    headers: {
      apikey: KEY, Authorization: `Bearer ${auth.access_token}`, "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({ user_id: auth.user.id, data: newer })
  }]);
});

test("pull filters by the owner and returns data or null", async () => {
  const { client, calls } = await signedIn([response([{ data: newer }]), response([])]);
  assert.deepEqual(await client.pull(), newer);
  assert.deepEqual(calls[1], [`${URL}/rest/v1/notebooks?user_id=eq.owner-id&select=data&limit=1`, {
    headers: { apikey: KEY, Authorization: `Bearer ${auth.access_token}`, "Content-Type": "application/json" }
  }]);
  assert.equal(await client.pull(), null);
});

test("sync pushes a newer local notebook or creates the missing cloud notebook", async () => {
  for (const rows of [[{ data: older }], []]) {
    const { client, calls } = await signedIn([response(rows), response(null, 204), response([{ data: newer }])]);
    assert.deepEqual(await client.sync(newer), { action: "pushed", notebook: newer });
    assert.equal(calls.length, 4);
    assert.equal(calls[2][1].method, "POST");
  }
});

test("sync pulls the server winner when a newer notebook arrives between read and upsert", async () => {
  const latest = { ...newer, updatedAt: "2026-11-03T12:00:00Z" };
  const { client, calls } = await signedIn([
    response([{ data: older }]), response(null, 204), response([{ data: latest }])
  ]);
  assert.deepEqual(await client.sync(newer), { action: "pulled", notebook: latest });
  assert.equal(calls.length, 4);
});

test("sync pulls the newer remote notebook without uploading", async () => {
  const { client, calls } = await signedIn([response([{ data: newer }])]);
  assert.deepEqual(await client.sync(older), { action: "pulled", notebook: newer });
  assert.equal(calls.length, 2);
});

test("sync treats equal edit times as a benign noop, including timezone equivalents", async () => {
  const equivalent = { ...newer, updatedAt: "2026-11-02T07:00:00-05:00" };
  const { client, calls } = await signedIn([response([{ data: equivalent }])]);
  assert.deepEqual(await client.sync(newer), { action: "noop", notebook: newer });
  assert.equal(calls.length, 2);
});

test("sync rereads a benign HTTP conflict and keeps the newest notebook", async () => {
  for (const latest of [newer, older, null]) {
    const { client } = await signedIn([
      response([]), response({ message: "duplicate key" }, 409), response(latest ? [{ data: latest }] : [])
    ]);
    assert.deepEqual(await client.sync(older), latest === newer
      ? { action: "pulled", notebook: newer }
      : { action: "noop", notebook: older });
  }
});

test("HTTP and network failures are short Errors without server bodies or secrets", async () => {
  const { client } = fixture([response({ message: "private-password private-access-token" }, 400)]);
  await assert.rejects(client.signIn("owner@example.com", "private-password"), {
    name: "Error", message: "That email or password was not accepted."
  });
  const forbidden = await signedIn([response({ message: "private-access-token" }, 403)]);
  await assert.rejects(forbidden.client.sync(newer), { name: "Error", message: "Cloud access was denied." });
  const failedWrite = await signedIn([response([]), response({ message: "private-access-token" }, 500)]);
  await assert.rejects(failedWrite.client.sync(newer), { message: "Cloud request failed (500)." });
  const offline = await signedIn([new Error("private-access-token")]);
  await assert.rejects(offline.client.pull(), { message: "Cloud sync is offline." });
});

test("unauthorized responses clear the expired session", async () => {
  const { client } = await signedIn([response({}, 401)]);
  await assert.rejects(client.pull(), { message: "Sign in again to sync." });
  assert.equal(client.session(), null);
});

test("invalid credentials, sessions, and notebook timestamps fail before destructive writes", async () => {
  const { client, calls } = fixture([response({ access_token: "token" })]);
  await assert.rejects(client.signIn("", "password"), { message: "Enter an email and password." });
  assert.equal(calls.length, 0);
  await assert.rejects(client.signIn("owner@example.com", "password"), { message: "Invalid sign-in response." });
  assert.equal(client.session(), null);
  await assert.rejects(client.push(newer), { message: "Sign in to sync your notebook." });
  const invalid = await signedIn([response([{ data: { updatedAt: "broken" } }])]);
  await assert.rejects(invalid.client.sync({}), { message: "The notebook has no valid edit time." });
  assert.equal(invalid.calls.length, 1);
  await assert.rejects(invalid.client.pull(), { message: "The notebook has no valid edit time." });
});

test("malformed successful responses fail rather than replacing a notebook", async () => {
  for (const reply of [response({ data: newer }), new Response("broken", { status: 200 })]) {
    const { client } = await signedIn([reply]);
    await assert.rejects(client.pull(), { message: "Invalid cloud response." });
  }
});

test("the pure client never reads or writes browser storage or the DOM", async t => {
  const descriptors = new Map(["localStorage", "sessionStorage", "window", "document"].map(key => [key,
    Object.getOwnPropertyDescriptor(globalThis, key)]));
  let touches = 0;
  for (const key of descriptors.keys()) {
    Object.defineProperty(globalThis, key, { configurable: true, get() { touches++; throw new Error(`Touched ${key}`); } });
  }
  t.after(() => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const { client } = await signedIn([
    response(null, 201), response([{ data: newer }]), response([{ data: newer }]), response(null, 204)
  ]);
  await client.push(newer);
  await client.pull();
  await client.sync(older);
  client.session();
  await client.signOut();
  assert.equal(touches, 0);
});
