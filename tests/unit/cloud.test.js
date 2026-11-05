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
  "firebase-auth.js": ["getAuth", "setPersistence", "onAuthStateChanged", "signOut", "deleteUser"],
  "firebase-firestore.js": ["getFirestore", "doc", "getDoc", "setDoc", "deleteDoc", "serverTimestamp"]
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
  const updates = [];
  let remote = null;
  globalThis.__cloudTestSdk = {
    initializeApp: () => ({}), getAuth: () => ({ currentUser: user }), setPersistence: async () => {},
    onAuthStateChanged: (_auth, callback) => callback(user), signOut: async () => {}, deleteUser: async () => {},
    getFirestore: () => ({}), doc: (_db, _collection, uid) => uid, serverTimestamp: () => "server-time",
    getDoc: async () => ({ exists: () => remote !== null, data: () => remote }),
    setDoc: async (_ref, value) => { remote = value; }, deleteDoc: async () => { remote = null; },
    ...sdkOverrides
  };
  const cloud = await import(`../../src/main/resources/public/js/cloud.js?test=${++fixtureId}`);
  await cloud.initializeCloud(snapshot => updates.push(snapshot));
  assert.equal(cloud.cloudSnapshot().ready, true);
  t.after(() => cloud.disableCloud());
  return { cloud, updates, remote: () => remote };
}

test("startup sync preserves edits saved while its cloud read is pending", async t => {
  const fetching = deferred();
  const { cloud } = await fixture(t, { getDoc: () => fetching.promise });
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
});

test("startup sync pauses for unsaved drafts instead of replacing them", async t => {
  const { cloud } = await fixture(t, { getDoc: async () => ({ exists: () => true, data: () => notebook("remote") }) });
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
  assert.equal(localStorage.getItem("my-internship-notebook-cloud-enabled-v1"), null);
});

test("account deletion drains an upload already sent before deleting its document", async t => {
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
  const lastWritten = deferred();
  const written = [];
  const { cloud } = await fixture(t, { setDoc: async (_ref, value) => {
    const notes = value.applications[0].notes;
    if (notes === "first edit") { firstStarted.resolve(); await firstWrite.promise; }
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
  await new Promise(setImmediate);
  assert.deepEqual(written, ["original"]);
  firstWrite.resolve();
  await lastWritten.promise;
  assert.deepEqual(written, ["original", "first edit", "latest edit"]);
});

test("explicit upload failures reject, while scheduled failures update status without escaping", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let fail = true;
  let scheduled = false;
  const failedScheduled = deferred();
  const { cloud, updates } = await fixture(t, { setDoc: async () => {
    if (fail) { if (scheduled) failedScheduled.resolve(); throw new Error("permission denied"); }
  } });
  browserApi.write(notebook("original"));
  await assert.rejects(cloud.enableCloudWithLocal(), /permission denied/);
  assert.equal(cloud.cloudSnapshot().status, "error");
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
