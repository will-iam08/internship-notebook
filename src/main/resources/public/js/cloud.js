import { browserApi, setBrowserWriteListener } from "./api.js";
import { sanitizeImportedEntry } from "./domain.js";

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
let enabledUid = "";
let status = "local";
let error = "";

export function cloudSnapshot() {
  return {
    ready: Boolean(auth && db),
    user: currentUser ? { uid: currentUser.uid, email: currentUser.email || "", verified: currentUser.emailVerified } : null,
    enabled: Boolean(currentUser?.emailVerified && enabledUid === currentUser.uid),
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

async function upload(record) {
  if (!cloudSnapshot().enabled) return;
  update({ status: "syncing", error: "" });
  try {
    await storeSdk.setDoc(cloudRef(), { ...cloudPayload(record), updatedAt: storeSdk.serverTimestamp() });
    update({ status: "synced", error: "" });
  } catch (uploadError) {
    update({ status: "error", error: friendly(uploadError) });
  }
}

function scheduleUpload(record) {
  if (!cloudSnapshot().enabled) return;
  pendingRecord = record;
  clearTimeout(uploadTimer);
  uploadTimer = setTimeout(() => {
    const next = pendingRecord;
    pendingRecord = null;
    upload(next);
  }, 700);
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
      currentUser = user;
      if (!user) enabledUid = "";
      update({ status: user ? (cloudSnapshot().enabled ? "synced" : "paused") : "local", error: "" });
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
  update({ status: cloudSnapshot().enabled ? "synced" : "paused", error: "" });
}

export async function signOutCloud() {
  enabledUid = "";
  await authSdk.signOut(auth);
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
  const snapshot = await storeSdk.getDoc(cloudRef());
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
  enabledUid = currentUser.uid;
  await upload(browserApi.read());
}

export function enableCloudWithRemote(record) {
  if (!currentUser?.emailVerified) throw new Error("Verify your email before turning on cloud sync.");
  setBrowserWriteListener(null);
  try { browserApi.write(cloudPayload(record)); } finally { setBrowserWriteListener(scheduleUpload); }
  enabledUid = currentUser.uid;
  update({ status: "synced", error: "" });
}

export function disableCloud() {
  enabledUid = "";
  update({ status: currentUser ? "paused" : "local", error: "" });
}
