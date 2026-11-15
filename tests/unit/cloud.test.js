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
    assert.equal(await client.signUp("owner@example.com", "password"), null);
    assert.equal(await client.recover("owner@example.com"), null);
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

test("signUp posts credentials and adopts an immediate session in memory", async () => {
  const { client, calls } = fixture([response(auth)]);
  assert.deepEqual(await client.signUp(" owner@example.com ", "private-password"), auth);
  assert.deepEqual(calls, [[`${URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "owner@example.com", password: "private-password" })
  }]]);
  client.session().user.id = "changed";
  assert.deepEqual(client.session(), auth);
  assert.ok(!JSON.stringify(client.session()).includes("private-password"));
});

test("signUp without a session waits for email confirmation, including an obfuscated user", async () => {
  for (const user of [{ id: "new-user", identities: [{ id: "email-identity" }] }, { id: "obfuscated-user" }]) {
    const { client } = fixture([response(user)]);
    assert.equal(await client.signUp("owner@example.com", "private-password"), null);
    assert.equal(client.session(), null);
  }
});

test("signUp reports registered addresses only when the response identifies them", async () => {
  for (const reply of [
    response({ code: "user_already_exists", msg: "secret" }, 422),
    response({ error_code: "email_exists" }, 400),
    response({ code: 422, error_code: "user_already_exists", msg: "secret" }, 422),
    response({ msg: "User already registered" }, 400),
    response({ id: "hidden-user", identities: [] })
  ]) {
    const { client } = fixture([reply]);
    await assert.rejects(client.signUp("owner@example.com", "private-password"), {
      message: "That email is already registered. Sign in or reset your password."
    });
    assert.equal(client.session(), null);
  }
});

test("signUp handles weak passwords, rate limits, offline and server failures safely", async () => {
  for (const [reply, message] of [
    [response({ code: "weak_password", msg: "private-password" }, 422), "That password is too weak. Choose a longer, more varied password."],
    [response({ code: 422, error_code: "weak_password" }, 422), "That password is too weak. Choose a longer, more varied password."],
    [response({ weak_password: { reasons: ["length"] } }, 400), "That password is too weak. Choose a longer, more varied password."],
    [response({}, 429), "Too many requests. Please wait before trying again."],
    [response({ code: "over_email_send_rate_limit" }, 422), "Too many requests. Please wait before trying again."],
    [new Error("private-password"), "Cloud sync is offline."],
    [response({ msg: "private-password" }, 500), "Cloud request failed (500)."]
  ]) {
    const { client } = fixture([reply]);
    await assert.rejects(client.signUp("owner@example.com", "private-password"), { message });
    assert.equal(client.session(), null);
  }
});

test("signUp rejects empty credentials and malformed success responses without adopting a session", async () => {
  for (const reply of [response({}), response({ id: "user", access_token: "" }), response({ access_token: "token" }), new Response("broken")]) {
    const { client, calls } = fixture([reply]);
    await assert.rejects(client.signUp(" ", "password"), /Enter an email and password/);
    await assert.rejects(client.signUp("owner@example.com", ""), /Enter an email and password/);
    assert.equal(calls.length, 0);
    await assert.rejects(client.signUp("owner@example.com", "private-password"), /Invalid .*response/);
    assert.equal(client.session(), null);
  }
});

test("recover sends only the trimmed email with the public key and never creates a session", async () => {
  const { client, calls } = fixture([response({})]);
  assert.equal(await client.recover(" owner@example.com "), null);
  assert.deepEqual(calls, [[`${URL}/auth/v1/recover`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "owner@example.com" })
  }]]);
  assert.equal(client.session(), null);
});

test("recover keeps an unknown address neutral, and reports rate limits, offline and SMTP failures", async () => {
  const unknown = fixture([response({ code: 404, error_code: "user_not_found" }, 404)]);
  assert.equal(await unknown.client.recover("unknown@example.com"), null);
  for (const [reply, message] of [
    [response({}, 429), "Too many requests. Please wait before trying again."],
    [response({ code: "over_request_rate_limit" }, 422), "Too many requests. Please wait before trying again."],
    [new Error("secret"), "Cloud sync is offline."],
    [response({ msg: "SMTP secret" }, 500), "Cloud request failed (500)."],
    [new Response("broken"), "Invalid cloud response."]
  ]) {
    const { client } = fixture([reply]);
    await assert.rejects(client.recover("owner@example.com"), { message });
    assert.equal(client.session(), null);
  }
  const { client, calls } = fixture();
  await assert.rejects(client.recover(" "), /Enter your email address/);
  assert.equal(calls.length, 0);
});

test("unconfirmed email sign-in explains the confirmation step", async () => {
  const { client } = fixture([response({ code: 400, error_code: "email_not_confirmed" }, 400)]);
  await assert.rejects(client.signIn("owner@example.com", "private-password"), {
    message: "Check your email to confirm the address, then sign in."
  });
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
    response(null, 201), response([{ data: newer }]), response([{ data: newer }]), response(null, 204),
    response({ id: "pending-user" }), response({}), response(auth)
  ]);
  await client.push(newer);
  await client.pull();
  await client.sync(older);
  client.session();
  await client.signOut();
  await client.signUp("owner@example.com", "private-password");
  await client.recover("owner@example.com");
  await client.signUp("owner@example.com", "private-password");
  assert.equal(touches, 0);
});
