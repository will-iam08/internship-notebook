// Sessions live only in this client; the caller owns notebook persistence.
export function createCloudClient({ url = "", anonKey = "", fetch: fetcher } = {}) {
  const baseUrl = typeof url === "string" ? url.trim().replace(/\/+$/, "") : "";
  const key = typeof anonKey === "string" ? anonKey.trim() : "";
  const enabled = Boolean(baseUrl && key);
  let currentSession = null;

  function session() {
    return currentSession ? structuredClone(currentSession) : null;
  }

  function requireSession() {
    if (!currentSession) throw new Error("Sign in to sync your notebook.");
    return currentSession;
  }

  function timestamp(notebook) {
    if (!notebook || typeof notebook !== "object" || Array.isArray(notebook)
        || typeof notebook.updatedAt !== "string" || !Number.isFinite(Date.parse(notebook.updatedAt))) {
      throw new Error("The notebook has no valid edit time.");
    }
    return Date.parse(notebook.updatedAt);
  }

  async function request(path, options = {}, token = currentSession?.access_token || key) {
    let response;
    try {
      response = await fetcher(`${baseUrl}${path}`, {
        ...options,
        headers: {
          apikey: key,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...options.headers
        }
      });
    } catch {
      throw new Error("Cloud sync is offline.");
    }
    if (!response.ok) {
      if (response.status === 401 && currentSession?.access_token === token) currentSession = null;
      const message = response.status === 400 && path.startsWith("/auth/v1/token")
        ? "That email or password was not accepted."
        : response.status === 401 ? "Sign in again to sync."
          : response.status === 403 ? "Cloud access was denied."
            : `Cloud request failed (${response.status}).`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    if (response.status === 204 || options.headers?.Prefer?.includes("return=minimal")) return null;
    try { return await response.json(); }
    catch { throw new Error("Invalid cloud response."); }
  }

  async function signIn(email, password) {
    if (!enabled) return null;
    if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
      throw new Error("Enter an email and password.");
    }
    const result = await request("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({ email: email.trim(), password })
    }, key);
    if (typeof result?.access_token !== "string" || !result.access_token
        || typeof result.user?.id !== "string" || !result.user.id) {
      throw new Error("Invalid sign-in response.");
    }
    currentSession = result;
    return session();
  }

  async function signOut() {
    if (!enabled || !currentSession) return;
    const token = currentSession.access_token;
    currentSession = null;
    await request("/auth/v1/logout", { method: "POST" }, token);
  }

  async function push(notebook) {
    if (!enabled) return null;
    const { user } = requireSession();
    timestamp(notebook);
    await request("/rest/v1/notebooks?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ user_id: user.id, data: notebook })
    });
    return notebook;
  }

  async function pull() {
    if (!enabled) return null;
    const { user } = requireSession();
    const rows = await request(`/rest/v1/notebooks?user_id=eq.${encodeURIComponent(user.id)}&select=data&limit=1`);
    if (!Array.isArray(rows)) throw new Error("Invalid cloud response.");
    if (!rows.length) return null;
    timestamp(rows[0]?.data);
    return rows[0].data;
  }

  async function sync(notebook) {
    if (!enabled) return { action: "noop", notebook };
    const localTime = timestamp(notebook);
    const remote = await pull();
    if (remote && timestamp(remote) > localTime) return { action: "pulled", notebook: remote };
    if (remote && timestamp(remote) === localTime) return { action: "noop", notebook };
    try {
      await push(notebook);
      const persisted = await pull();
      return persisted && timestamp(persisted) > localTime
        ? { action: "pulled", notebook: persisted }
        : { action: "pushed", notebook };
    } catch (error) {
      if (error.status !== 409) throw error;
      // A concurrent insert can win between the read and write; keep local edits for a later retry.
      const latest = await pull();
      return latest && timestamp(latest) > localTime
        ? { action: "pulled", notebook: latest }
        : { action: "noop", notebook };
    }
  }

  return { enabled, signIn, signOut, session, push, pull, sync };
}
