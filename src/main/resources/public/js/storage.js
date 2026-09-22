/*
 * Browser storage keys and a small wrapper around localStorage that never throws
 * (private windows and blocked storage make localStorage calls fail).
 */
export const KEYS = {
  data: "my-internship-notebook-browser-data-v1",
  goal: "my-internship-notebook-weekly-goal",
  legacyGoal: "coop-compass-weekly-goal",
  theme: "my-internship-notebook-theme",
  prefs: "my-internship-notebook-prefs-v1"
};

export const storage = {
  get(key) { try { return globalThis.localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { globalThis.localStorage.setItem(key, value); return true; } catch { return false; } }
};
