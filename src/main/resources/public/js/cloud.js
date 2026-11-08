import { browserApi, setBrowserWriteListener } from "./api.js";
import { sanitizeImportedEntry } from "./domain.js";
import { decideSync, notebookHash } from "./sync.js";
import { readDrafts, storage } from "./storage.js";

const SDK = "https://www.gstatic.com/firebasejs/12.19.0";
const MAX_CLOUD_BYTES = 900_000;
const firebaseConfig = {
  apiKey: "AIzaSyBKmoYm5o24RTHJUYD-fOoW49QrHOJeEk0",
  authDomain: "my-internship-notebook.firebaseapp.com",
  projectId: "my-internship-notebook",
  storageBucket: "my-internship-notebook.firebasestorage.app",
  messagingSenderId: "512258683637",
  appId: "1:512258683637:web:930ffa8fd6042b55578bbc"
};

let authSdk;
let storeSdk;
let auth;
let db;
let currentUser = null;
let notify = () => {};
let uploadTimer = null;
let pendingRecord = null;
let uploadChain = Promise.resolve();
let uploadCount = 0;
let uploadGeneration = 0;
let deletingAccount = false;
let enabledUid = "";
let status = "local";
let error = "";
const ENABLED_KEY = "my-internship-notebook-cloud-enabled-v1";
const baseKey = uid => `my-internship-notebook-cloud-base-v1:${uid}`;
const syncedAtKey = uid => `my-internship-notebook-cloud-synced-at-v1:${uid}`;

export function cloudSnapshot() {
  return {
    ready: Boolean(auth && db),
    user: currentUser ? {
      uid: currentUser.uid,
      email: currentUser.email || "",
      verified: currentUser.emailVerified,
      providers: currentUser.providerData.map(provider => provider.providerId)
    } : null,
    enabled: Boolean(currentUser?.emailVerified && enabledUid === currentUser.uid),
    lastSyncedAt: currentUser ? storage.get(syncedAtKey(currentUser.uid)) || "" : "",
    status,
    error
  };
}

function update(patch = {}) {
  if ("status" in patch) status = patch.status;
  if ("error" in patch) error = patch.error;
  notify(cloudSnapshot());
}

function friendly(errorValue) {
  const code = errorValue?.code || "";
  if (code.includes("invalid-credential")) return "That email or password was not accepted.";
  if (code.includes("email-already-in-use")) return "An account already uses that email. Try signing in instead.";
  if (code.includes("weak-password")) return "Use a stronger password with at least 6 characters.";
  if (code.includes("popup-closed")) return "Google sign-in was closed before it finished.";
  if (code.includes("network-request-failed")) return "Cloud sign-in could not reach Firebase. Check your connection.";
  if (code.includes("too-many-requests")) return "Too many attempts. Please wait a little and try again.";
  if (code.includes("requires-recent-login")) return "For security, sign out, sign back in, and try deleting the account again.";
  return errorValue?.message || "Cloud sync could not complete.";
}

function cloudRef() {
  if (!currentUser) throw new Error("Sign in before using cloud sync.");
  return storeSdk.doc(db, "notebooks", currentUser.uid);
}

function cloudPayload(record) {
  const payload = {
    schemaVersion: 1,
    nextId: record.nextId,
    applications: record.applications,
    recentlyDeleted: record.recentlyDeleted
  };
  if (new Blob([JSON.stringify(payload)]).size > MAX_CLOUD_BYTES) {
    throw new Error("This notebook is too large for safe cloud sync. Download a backup and remove old pages first.");
  }
  return payload;
}

function cancelUploads() {
  clearTimeout(uploadTimer);
  uploadTimer = null;
  pendingRecord = null;
  uploadGeneration++;
}

function recordSync(uid, contentHash) {
  localStorage.setItem(baseKey(uid), contentHash);
  storage.set(syncedAtKey(uid), new Date().toISOString());
}

function upload(record) {
  const uid = currentUser?.uid;
  const generation = uploadGeneration;
  const active = () => cloudSnapshot().enabled && currentUser.uid === uid && generation === uploadGeneration;
  uploadCount++;
  const result = uploadChain.then(async () => {
    try {
      if (!active()) throw new Error("Cloud sync was paused before this notebook could upload.");
      update({ status: "syncing", error: "" });
      const payload = cloudPayload(record);
      const contentHash = await notebookHash(payload);
      if (!active()) throw new Error("Cloud sync was paused before this notebook could upload.");
      await storeSdk.setDoc(storeSdk.doc(db, "notebooks", uid), { ...payload, contentHash, updatedAt: storeSdk.serverTimestamp() });
      if (active()) {
        recordSync(uid, contentHash);
        update({ status: pendingRecord ? "waiting" : uploadCount > 1 ? "syncing" : "synced", error: "" });
      }
    } catch (uploadError) {
      if (active()) update({ status: "error", error: friendly(uploadError) });
      throw new Error(friendly(uploadError));
    } finally {
      uploadCount--;
    }
  });
  // Keep later writes and account deletion waiting even when an earlier write failed.
  uploadChain = result.catch(() => {});
  return result;
}

function scheduleUpload(record) {
  if (!cloudSnapshot().enabled) return;
  pendingRecord = record;
  clearTimeout(uploadTimer);
  uploadTimer = setTimeout(() => {
    const next = pendingRecord;
    pendingRecord = null;
    upload(next).catch(() => {}); // Scheduled failures are shown in the cloud status; explicit uploads reject.
  }, 700);
  update({ status: "waiting", error: "" });
}

export async function initializeCloud(onChange) {
  notify = onChange || (() => {});
  update({ status: "loading", error: "" });
  try {
    const [appSdk, loadedAuth, loadedStore] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-firestore.js`)
    ]);
    authSdk = loadedAuth;
    storeSdk = loadedStore;
    const app = appSdk.initializeApp(firebaseConfig);
    auth = authSdk.getAuth(app);
    db = storeSdk.getFirestore(app);
    await authSdk.setPersistence(auth, authSdk.browserLocalPersistence);
    setBrowserWriteListener(scheduleUpload);
    authSdk.onAuthStateChanged(auth, user => {
      if (currentUser?.uid !== user?.uid) { enabledUid = ""; cancelUploads(); }
      currentUser = user;
      const enabled = cloudSnapshot().enabled;
      update({ status: user ? (enabled ? status : "paused") : "local", error: enabled ? error : "" });
    });
  } catch (loadError) {
    update({ status: "unavailable", error: friendly(loadError) });
  }
}

export async function signInGoogle() {
  try {
    await authSdk.signInWithPopup(auth, new authSdk.GoogleAuthProvider());
  } catch (signInError) {
    update({ status: "error", error: friendly(signInError) });
    throw new Error(friendly(signInError));
  }
}

export async function signInEmail(email, password) {
  try {
    await authSdk.signInWithEmailAndPassword(auth, email, password);
  } catch (signInError) {
    throw new Error(friendly(signInError));
  }
}

export async function createEmailAccount(email, password) {
  try {
    const credential = await authSdk.createUserWithEmailAndPassword(auth, email, password);
    await authSdk.sendEmailVerification(credential.user);
  } catch (createError) {
    throw new Error(friendly(createError));
  }
}

export async function sendPasswordReset(email) {
  try {
    await authSdk.sendPasswordResetEmail(auth, email);
  } catch (resetError) {
    // Keep account existence private while still surfacing connectivity and rate-limit failures.
    if (!["auth/user-not-found", "auth/invalid-email"].includes(resetError?.code)) throw new Error(friendly(resetError));
  }
}

export async function resendVerification() {
  if (!currentUser) throw new Error("Sign in first.");
  await authSdk.sendEmailVerification(currentUser);
}

export async function refreshAccount() {
  if (!currentUser) return;
  await authSdk.reload(currentUser);
  currentUser = auth.currentUser;
  const enabled = cloudSnapshot().enabled;
  update({ status: enabled ? status : "paused", error: enabled ? error : "" });
}

export async function signOutCloud() {
  disableCloud();
  await authSdk.signOut(auth);
}

export async function deleteCloudAccount(password = "") {
  if (!currentUser) throw new Error("Sign in before deleting your account.");
  if (deletingAccount) throw new Error("Account deletion is already in progress.");
  const user = currentUser;
  const uid = user.uid;
  const providers = user.providerData.map(provider => provider.providerId);
  deletingAccount = true;
  try {
    disableCloud();
    if (providers.includes("password")) {
      if (!password) throw new Error("Enter your current password to delete this account.");
      const credential = authSdk.EmailAuthProvider.credential(user.email, password);
      await authSdk.reauthenticateWithCredential(user, credential);
    } else if (providers.includes("google.com")) {
      await authSdk.reauthenticateWithPopup(user, new authSdk.GoogleAuthProvider());
    }
    await uploadChain;
    if (currentUser?.uid !== uid) throw new Error("The signed-in account changed. Try deleting it again.");
    // Unverified email accounts never gain Firestore access or create a cloud notebook, but they
    // still need to be able to delete the Authentication account they just created.
    if (user.emailVerified) await storeSdk.deleteDoc(storeSdk.doc(db, "notebooks", uid));
    await authSdk.deleteUser(user);
    localStorage.removeItem(ENABLED_KEY);
    localStorage.removeItem(baseKey(uid));
    storage.remove(syncedAtKey(uid));
    enabledUid = "";
  } catch (deleteError) {
    throw new Error(friendly(deleteError));
  } finally {
    deletingAccount = false;
  }
}

/**
 * Anything read back from Firestore is treated exactly like an imported backup file, not as
 * already-trusted data - it went through this same app's own writes originally, but it can also
 * be edited directly via the Firestore console or REST API, by a future client version, or by a
 * bug, and the security rules only check document-level shape (is applications a list?), not
 * per-field safety (is this link actually http(s)?). Re-running it through sanitizeImportedEntry
 * - the same function backup import uses - is what stops an unsafe link scheme from surviving a
 * round trip through the cloud and landing on "Open job posting" on some other signed-in device.
 * A malformed entry (no company/role) is dropped rather than crashing the app or storing garbage.
 */
function sanitizeCloudList(list) {
  return (Array.isArray(list) ? list : [])
    .map(sanitizeImportedEntry)
    .map(result => result.entry)
    .filter(Boolean);
}

export async function fetchCloudNotebook() {
  const snapshot = await storeSdk.getDocFromServer(cloudRef());
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  return {
    nextId: data.nextId,
    applications: sanitizeCloudList(data.applications),
    recentlyDeleted: sanitizeCloudList(data.recentlyDeleted)
  };
}

export async function enableCloudWithLocal() {
  if (!currentUser?.emailVerified) throw new Error("Verify your email before turning on cloud sync.");
  if (deletingAccount) throw new Error("Wait for account deletion to finish.");
  cancelUploads();
  enabledUid = currentUser.uid;
  localStorage.setItem(ENABLED_KEY, currentUser.uid);
  await upload(browserApi.read());
}

export async function enableCloudWithRemote(record) {
  if (!currentUser?.emailVerified) throw new Error("Verify your email before turning on cloud sync.");
  if (deletingAccount) throw new Error("Wait for account deletion to finish.");
  if (Object.keys(readDrafts()).length) throw new Error("Finish saving your pending edits before replacing this notebook.");
  const uid = currentUser.uid;
  const original = JSON.stringify(browserApi.read());
  const payload = cloudPayload(record);
  disableCloud();
  const generation = uploadGeneration;
  const contentHash = await notebookHash(payload);
  await uploadChain;
  if (currentUser?.uid !== uid || deletingAccount || generation !== uploadGeneration) throw new Error("Cloud sync changed. Choose your notebook again.");
  if (JSON.stringify(browserApi.read()) !== original || Object.keys(readDrafts()).length) {
    throw new Error("Your local notebook changed. Finish saving your edits and choose a notebook again.");
  }
  setBrowserWriteListener(null);
  try { browserApi.write(payload); } finally { setBrowserWriteListener(scheduleUpload); }
  enabledUid = uid;
  localStorage.setItem(ENABLED_KEY, uid);
  recordSync(uid, contentHash);
  update({ status: "synced", error: "" });
}

export function disableCloud() {
  localStorage.removeItem(ENABLED_KEY);
  enabledUid = "";
  cancelUploads();
  update({ status: currentUser ? "paused" : "local", error: "" });
}

export async function resumeCloud(record) {
  if (!currentUser?.emailVerified || localStorage.getItem(ENABLED_KEY) !== currentUser.uid) return { action: "paused" };
  const uid = currentUser.uid;
  const generation = uploadGeneration;
  const remote = await fetchCloudNotebook();
  record = browserApi.read();
  const original = JSON.stringify(record);
  const [localHash, remoteHash] = await Promise.all([notebookHash(record), remote ? notebookHash(remote) : ""]);
  if (currentUser?.uid !== uid || deletingAccount || generation !== uploadGeneration
      || localStorage.getItem(ENABLED_KEY) !== uid) return { action: "paused" };
  const decision = JSON.stringify(browserApi.read()) !== original || Object.keys(readDrafts()).length
    ? "conflict" : decideSync(localHash, remoteHash, localStorage.getItem(baseKey(uid)) || "");
  if (decision === "use-remote") await enableCloudWithRemote(remote);
  else if (decision === "upload-local") await enableCloudWithLocal();
  else if (decision === "synced") {
    enabledUid = uid;
    recordSync(uid, localHash);
    update({ status: "synced", error: "" });
  } else {
    disableCloud();
    update({ status: "paused", error: "Both the device and cloud notebooks changed. Choose which copy to keep in Settings." });
  }
  return { action: decision, remote };
}
