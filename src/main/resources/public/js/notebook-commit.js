/*
 * The one place a real notebook is created from onboarding (guided setup and the notebook builder).
 *
 * The backend is passed in rather than imported, so this module never reaches storage on its own
 * and the unit tests can drive the real browserApi against an in-memory localStorage. The caller
 * owns validation, the started flag, and preferences; this only commits the pages, as one write.
 */
import { withoutExistingStarters } from "./onboarding.js";

/**
 * Adds the starter pages that are not already in the notebook, as a single importBackup batch.
 * With nothing new to add (no starters, or a re-submit), the current notebook is written back as-is
 * so the visitor still ends up with a saved notebook, without ever replacing pages that exist.
 * A read that fails (corrupted storage) or a write the browser rejects throws to the caller.
 */
export async function commitStarterNotebook(backend, starters) {
  const current = backend.read();
  const fresh = withoutExistingStarters(starters, current);
  if (fresh.length) {
    const added = await backend.importBackup(fresh, []);
    return { added: added.applications.length };
  }
  backend.write(current);
  return { added: 0 };
}
