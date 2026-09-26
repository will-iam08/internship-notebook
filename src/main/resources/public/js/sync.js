export function decideSync(localHash, remoteHash, baseHash = "") {
  if (!remoteHash) return "upload-local";
  if (localHash === remoteHash) return "synced";
  if (!baseHash) return "conflict";
  if (localHash === baseHash) return "use-remote";
  if (remoteHash === baseHash) return "upload-local";
  return "conflict";
}

export async function notebookHash(record) {
  const text = JSON.stringify({
    schemaVersion: 1,
    nextId: record.nextId,
    applications: record.applications,
    recentlyDeleted: record.recentlyDeleted
  });
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, "0")).join("");
}
