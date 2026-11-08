import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { browserApi } from "../../src/main/resources/public/js/api.js";
import { normalize } from "../../src/main/resources/public/js/domain.js";
import { notebookHash } from "../../src/main/resources/public/js/sync.js";
import { readDrafts, writeDraft } from "../../src/main/resources/public/js/storage.js";

const SDK = "https://www.gstatic.com/firebasejs/12.19.0/";
const exportsByModule = {
  "firebase-app.js": ["initializeApp"],
  "firebase-auth.js": ["getAuth", "setPersistence", "onAuthStateChanged", "reload", "signOut", "deleteUser"],
  "firebase-firestore.js": ["getFirestore", "doc", "getDoc", "getDocFromServer", "setDoc", "deleteDoc", "serverTimestamp"]
};
// Substitute only external SDK modules. The real cloud, storage, and validation code runs unchanged.
registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier.startsWith(SDK) ? { url: specifier, shortCircuit: true } : nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.startsWith(SDK)) return nextLoad(url, context);
    const names = exportsByModule[url.slice(SDK.length)];
    return { format: "module", shortCircuit: true, source: names.map(name =>
      `export const ${name} = (...args) => globalThis.__cloudTestSdk.${name}(...args);`).join("\n") };
  }
});

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const notebook = notes => ({ nextId: 2, applications: [normalize({
  id: 1, company: "Acme", role: "Intern", notes, createdAt: "2026-11-01T12:00:00Z"
})], recentlyDeleted: [] });
let fixtureId = 0;

async function fixture(t, sdkOverrides = {}) {
  const values = new Map();
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
  const user = { uid: "owner", emailVerified: true, providerData: [] };
  const auth = { currentUser: user };
  let authChanged;
  const updates = [];
  let remote = null;
  globalThis.__cloudTestSdk = {
    initializeApp: () => ({}), getAuth: () => auth, setPersistence: async () => {}, reload: async () => {},
    onAuthStateChanged: (_auth, callback) => { authChanged = callback; callback(user); },
    signOut: async () => {}, deleteUser: async () => {},
    getFirestore: () => ({}), doc: (_db, _collection, uid) => uid, serverTimestamp: () => "server-time",
    getDoc: async () => ({ exists: () => remote !== null, data: () => remote }),
    getDocFromServer: async () => ({ exists: () => remote !== null, data: () => remote }),
    setDoc: async (_ref, value) => { remote = value; }, deleteDoc: async () => { remote = null; },
    ...sdkOverrides
  };
  const cloud = await import(`../../src/main/resources/public/js/cloud.js?test=${++fixtureId}`);
  await cloud.initializeCloud(snapshot => updates.push(snapshot));
  assert.equal(cloud.cloudSnapshot().ready, true);
  t.after(() => cloud.disableCloud());
  return { cloud, updates, remote: () => remote, emitUser: nextUser => { auth.currentUser = nextUser; authChanged(nextUser); } };
}

test("startup sync preserves edits saved while its cloud read is pending", async t => {
  const fetching = deferred();
  const { cloud } = await fixture(t, { getDocFromServer: () => fetching.promise });
  const original = notebook("base");
  browserApi.write(original);
  localStorage.setItem("my-internship-notebook-cloud-enabled-v1", "owner");
  localStorage.setItem("my-internship-notebook-cloud-base-v1:owner", await notebookHash(original));
  const resuming = cloud.resumeCloud(browserApi.read());
  await browserApi.update(1, { notes: "new local work" });
  fetching.resolve({ exists: () => true, data: () => notebook("remote work") });
  assert.equal((await resuming).action, "conflict");
  assert.equal(browserApi.read().applications[0].notes, "new local work");
  assert.equal(cloud.cloudSnapshot().enabled, false);
  assert.equal(cloud.cloudSnapshot().lastSyncedAt, "");
});

test("startup sync pauses for unsaved drafts instead of replacing them", async t => {
  const { cloud } = await fixture(t, { getDocFromServer: async () => ({ exists: () => true, data: () => notebook("remote") }) });
  const original = notebook("base");
  browserApi.write(original);
  writeDraft(1, { notes: "unsaved local work" });
  localStorage.setItem("my-internship-notebook-cloud-enabled-v1", "owner");
  localStorage.setItem("my-internship-notebook-cloud-base-v1:owner", await notebookHash(original));
  assert.equal((await cloud.resumeCloud(original)).action, "conflict");
  assert.equal(readDrafts()[1].changes.notes, "unsaved local work");
  assert.equal(browserApi.read().applications[0].notes, "base");
});

test("confirmed cloud replacement rejects old drafts and keeps the original notebook", async t => {
  const { cloud } = await fixture(t);
  browserApi.write(notebook("original"));
  writeDraft(1, { notes: "private original draft" });
  await assert.rejects(cloud.enableCloudWithRemote(notebook("different cloud entry")), /pending edits/);
  assert.equal(readDrafts()[1].changes.notes, "private original draft");
  assert.equal(browserApi.read().applications[0].notes, "original");
});

test("cloud replacement rechecks local saves before writing and succeeds once settled", async t => {
  const { cloud } = await fixture(t);
  browserApi.write(notebook("original"));
  const replacing = cloud.enableCloudWithRemote(notebook("remote"));
  await browserApi.update(1, { notes: "saved while replacement waited" });
  await assert.rejects(replacing, /local notebook changed/);
  assert.equal(browserApi.read().applications[0].notes, "saved while replacement waited");
  await cloud.enableCloudWithRemote(notebook("remote"));
  assert.equal(browserApi.read().applications[0].notes, "remote");
  assert.equal(cloud.cloudSnapshot().status, "synced");
  assert.ok(Number.isFinite(Date.parse(cloud.cloudSnapshot().lastSyncedAt)));
});

test("account deletion cancels a pending upload before removing the cloud notebook", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const deleting = deferred();
  let writes = 0;
  let deletes = 0;
  const { cloud } = await fixture(t, {
    setDoc: async () => { writes++; }, deleteDoc: async () => { deletes++; }, deleteUser: () => deleting.promise
  });
  browserApi.write(notebook("original"));
  await cloud.enableCloudWithLocal();
  assert.ok(cloud.cloudSnapshot().lastSyncedAt);
  await browserApi.update(1, { notes: "pending upload" });
  const removal = cloud.deleteCloudAccount();
  await new Promise(setImmediate);
  assert.equal(deletes, 1);
  t.mock.timers.tick(1000);
  await new Promise(setImmediate);
  assert.equal(writes, 1, "the scheduled second upload must never run");
  await assert.rejects(cloud.enableCloudWithLocal(), /deletion/);
  deleting.resolve();
  await removal;
  assert.equal(cloud.cloudSnapshot().enabled, false);
  assert.equal(cloud.cloudSnapshot().lastSyncedAt, "");
  assert.equal(localStorage.getItem("my-internship-notebook-cloud-enabled-v1"), null);
});

test("account deletion drains an upload already sent before deleting its document", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const writing = deferred();
  const started = deferred();
  const order = [];
  const { cloud } = await fixture(t, {
    setDoc: async () => { started.resolve(); await writing.promise; order.push("write"); },
    deleteDoc: async () => { order.push("delete document"); },
    deleteUser: async () => { order.push("delete account"); }
  });
  browserApi.write(notebook("original"));
  const uploading = cloud.enableCloudWithLocal();
  await started.promise;
  await browserApi.update(1, { notes: "queued upload that deletion must cancel" });
  t.mock.timers.tick(700);
  const removing = cloud.deleteCloudAccount();
  await new Promise(setImmediate);
  assert.deepEqual(order, []);
  writing.resolve();
  await Promise.all([uploading, removing]);
  assert.deepEqual(order, ["write", "delete document", "delete account"]);
});

test("a later scheduled upload waits for the earlier write and keeps the newest content", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const firstWrite = deferred();
  const firstStarted = deferred();
  const lastWrite = deferred();
  const lastStarted = deferred();
  const lastWritten = deferred();
  const written = [];
  const { cloud, updates } = await fixture(t, { setDoc: async (_ref, value) => {
    const notes = value.applications[0].notes;
    if (notes === "first edit") { firstStarted.resolve(); await firstWrite.promise; }
    if (notes === "latest edit") { lastStarted.resolve(); await lastWrite.promise; }
    written.push(notes);
    if (notes === "latest edit") lastWritten.resolve();
  } });
  browserApi.write(notebook("original"));
  await cloud.enableCloudWithLocal();
  await browserApi.update(1, { notes: "first edit" });
  t.mock.timers.tick(700);
  await firstStarted.promise;
  await browserApi.update(1, { notes: "latest edit" });
  t.mock.timers.tick(700);
  const unconfirmedStart = updates.length;
  await new Promise(setImmediate);
  assert.deepEqual(written, ["original"]);
  firstWrite.resolve();
  await lastStarted.promise;
  assert.equal(cloud.cloudSnapshot().status, "syncing");
  assert.equal(updates.slice(unconfirmedStart).some(snapshot => snapshot.status === "synced"), false,
    "an earlier confirmation must not report synced while a later upload is queued");
  lastWrite.resolve();
  await lastWritten.promise;
  await new Promise(setImmediate);
  assert.deepEqual(written, ["original", "first edit", "latest edit"]);
  assert.equal(cloud.cloudSnapshot().status, "synced");
});

test("explicit upload failures reject, while scheduled failures update status without escaping", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let fail = true;
  let scheduled = false;
  const failedScheduled = deferred();
  const { cloud, updates, emitUser } = await fixture(t, { setDoc: async () => {
    if (fail) { if (scheduled) failedScheduled.resolve(); throw new Error("permission denied"); }
  } });
  browserApi.write(notebook("original"));
  await assert.rejects(cloud.enableCloudWithLocal(), /permission denied/);
  assert.equal(cloud.cloudSnapshot().status, "error");
  assert.equal(cloud.cloudSnapshot().lastSyncedAt, "");
  await cloud.refreshAccount();
  emitUser({ uid: "owner", emailVerified: true, providerData: [] });
  assert.equal(cloud.cloudSnapshot().status, "error");
  assert.match(cloud.cloudSnapshot().error, /permission denied/);
  fail = false;
  await cloud.enableCloudWithLocal();
  fail = true;
  scheduled = true;
  await browserApi.update(1, { notes: "scheduled" });
  t.mock.timers.tick(700);
  await failedScheduled.promise;
  await new Promise(setImmediate);
  assert.equal(cloud.cloudSnapshot().status, "error");
  assert.match(updates.at(-1).error, /permission denied/);
});

test("last sync time is recorded after remote acknowledgement and isolated by account", async t => {
  const writing = deferred();
  const started = deferred();
  const { cloud, emitUser } = await fixture(t, { setDoc: async () => { started.resolve(); await writing.promise; } });
  browserApi.write(notebook("original"));
  const uploading = cloud.enableCloudWithLocal();
  await started.promise;
  assert.equal(cloud.cloudSnapshot().lastSyncedAt, "");
  writing.resolve();
  await uploading;
  const timestamp = cloud.cloudSnapshot().lastSyncedAt;
  assert.ok(Number.isFinite(Date.parse(timestamp)));
  cloud.disableCloud();
  assert.equal(cloud.cloudSnapshot().lastSyncedAt, timestamp);
  emitUser({ uid: "another-account", emailVerified: true, providerData: [] });
  assert.equal(cloud.cloudSnapshot().lastSyncedAt, "");
  emitUser({ uid: "owner", emailVerified: true, providerData: [] });
  assert.equal(cloud.cloudSnapshot().lastSyncedAt, timestamp);
  const getItem = localStorage.getItem;
  try {
    localStorage.getItem = () => { throw new Error("storage blocked"); };
    assert.equal(cloud.cloudSnapshot().lastSyncedAt, "");
  } finally { localStorage.getItem = getItem; }
});

test("pending changes show waiting immediately and auth refresh preserves waiting and syncing", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const writing = deferred();
  const started = deferred();
  let holdWrite = false;
  const { cloud, emitUser } = await fixture(t, { setDoc: async () => {
    if (holdWrite) { started.resolve(); await writing.promise; }
  } });
  browserApi.write(notebook("original"));
  await cloud.enableCloudWithLocal();
  const timestamp = cloud.cloudSnapshot().lastSyncedAt;
  holdWrite = true;
  await browserApi.update(1, { notes: "pending" });
  assert.equal(cloud.cloudSnapshot().status, "waiting");
  assert.equal(cloud.cloudSnapshot().lastSyncedAt, timestamp);
  emitUser({ uid: "owner", emailVerified: true, providerData: [] });
  await cloud.refreshAccount();
  assert.equal(cloud.cloudSnapshot().status, "waiting");
  t.mock.timers.tick(700);
  await started.promise;
  await cloud.refreshAccount();
  assert.equal(cloud.cloudSnapshot().status, "syncing");
  await browserApi.update(1, { notes: "another pending edit" });
  writing.resolve();
  await new Promise(setImmediate);
  assert.equal(cloud.cloudSnapshot().status, "waiting", "an older confirmation must not hide a pending edit");
});

test("confirmed server equality records a last sync time", async t => {
  const original = notebook("same");
  const { cloud } = await fixture(t, { getDocFromServer: async () => ({ exists: () => true, data: () => original }) });
  browserApi.write(original);
  localStorage.setItem("my-internship-notebook-cloud-enabled-v1", "owner");
  assert.equal((await cloud.resumeCloud(original)).action, "synced");
  assert.ok(Number.isFinite(Date.parse(cloud.cloudSnapshot().lastSyncedAt)));
});

test("an offline server read rejects instead of restoring a stale cached notebook", async t => {
  let cachedReads = 0;
  const { cloud } = await fixture(t, {
    getDoc: async () => { cachedReads++; return { exists: () => true, data: () => notebook("stale cache") }; },
    getDocFromServer: async () => { throw new Error("client is offline"); }
  });
  const original = notebook("local work");
  browserApi.write(original);
  localStorage.setItem("my-internship-notebook-cloud-enabled-v1", "owner");
  const timestamp = "2026-11-01T12:00:00.000Z";
  localStorage.setItem("my-internship-notebook-cloud-synced-at-v1:owner", timestamp);
  await assert.rejects(cloud.resumeCloud(original), /offline/);
  assert.equal(cachedReads, 0);
  assert.equal(browserApi.read().applications[0].notes, "local work");
  assert.equal(cloud.cloudSnapshot().lastSyncedAt, timestamp);
});
