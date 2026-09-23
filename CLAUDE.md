# CLAUDE.md

Handoff notes for Claude Code. This file carries over the context from the web design work on My Internship Notebook so a new session can pick up without re-explaining.

## What this project is

My Internship Notebook is a notebook-style app for tracking internship applications, interviews, deadlines, notes, and offers. The repo is still named `coop-compass` and the Java package is `com.coopcompass`; the user-facing name is **My Internship Notebook**.

- GitHub: `will-iam08/coop-compass`, branch `main` (a `notebook-app-redesign` branch also exists and currently points at the same commit)
- Live site: will-internship-notebook.onrender.com (browser-only edition, auto-deploys from `main`)
- A GitHub Pages workflow (`.github/workflows/deploy-pages.yml`) also builds the browser-only edition on every push to `main`

## Product decisions already made

Keep these unless the owner says otherwise.

- **Name:** "My Internship Notebook", not "Coop Compass". Many people don't know what "co-op" means, and the owner prefers familiar, broadly understandable names over institution-specific jargon.
- **Audience:** anyone managing internships and interviews, not just the owner's own Winter 2027 search. Avoid copy that makes it look like a personal tool.
- **Privacy by design:** the public website stores entries only in the visitor's own browser. Do not add anything that uploads application records to a shared public server.
- **No demo data in the public version:** the 91 test entries and the "Load demo data" control were removed. A separate testing version with demo data is kept apart from the public site; `src/main/resources/public/testing.html` is gitignored for that purpose (it is not currently in this folder).
- **Look and feel:** a "paper notebook app" style. The owner likes polished interfaces with some animation and several useful features, not bare prototypes.
- **Redesign requirements (Sep 2026):** sidebar with separate pages, entries that open and can be edited, installable as an app, dark mode, works on phones and on laptops/desktops as a public website.

## Current state

Commit `e41ee5b` "Update README for the module split, testing, and deploy setup; add the sync proposal" (2026-09-22) is the tip of a data-safety/mobile/accessibility/testing improvement pass, all **local commits not yet pushed** (this session could not authenticate to GitHub - the owner needs to `git push`). Eight commits on top of the `e6fec6f` redesign, each independently reviewable:

1. `820f892` CI now runs Java + frontend checks before every Pages deploy; documents the one-time repo setting (Settings -> Pages -> Build and deployment -> Source -> GitHub Actions) that was blocking every deploy.
2. `84decf7` Split `app.js` into `js/domain.js` (rules/validation/numbers), `js/storage.js`, `js/api.js`, `js/ui/icons.js`, `js/app.js` (state/views/routing). Added `tests/unit/` (`node --test`).
3. `76ba891` Data safety: a disk-backed drafts store makes autosave retryable (failed saves stay queued, auto-retry + a Retry button, never dropped); four honest save states (Saving/Saved locally/Synced/Couldn't save - the website edition never claims "Synced"); corrupted `localStorage` is quarantined and shown a recovery screen instead of silently becoming an empty notebook; backup import validates every field the same way a typed one is (unsafe links stripped, not just trusted) and previews counts before importing.
4. `407f639` Mobile: entry details are one column below 560px (`.wide`'s unscoped `span 2` was defeating this via `grid-auto-flow: dense` - watch for that pattern again); Board becomes stage tabs + one column below 760px; touch pointers get an explicit "Move to..." button; quick-add hides everything but Company/Role/Stage behind a `<details>`; 44px touch targets.
5. `3a46de0` Accessibility: skip link no longer uses `#view` as a hash (collided with the router); stage picker is a real radiogroup (roving tabindex, arrow/Home/End); menu roles fixed (`menuitemradio` for stage choices, not bare `menuitem` + `aria-checked`); dialogs restore focus explicitly (native restore breaks when a rerender destroys the opener before the dialog closes - the "add application" flow does exactly that); WCAG AA contrast pass added `--accent-ink` and retuned `--muted`/`--faint`.
6. `ac8b0de` Playwright E2E suite (`tests/e2e/`) covering the above. **Not executed in this session** - the sandboxed shell can't launch Chromium/WebKit (`bootstrap_check_in ... Permission denied`, a macOS Seatbelt restriction on the Bash tool, unrelated to the app). Written from and cross-checked against manual browser-pane verification of every scenario; will run for real in CI once pushed.
7. `e41ee5b` README + `docs/cross-device-sync-proposal.md` (accounts/sync design; explicitly do not expose the existing Java server publicly as-is - no auth, no per-user isolation).

Known contrast gaps that couldn't be closed without touching the CVD-validated stage palette: light-theme Rejected-stage step text (4.20:1) and Applied-stage step text (4.42:1) are close to but just under 4.5:1 - see the `3a46de0` commit message for the full reasoning.

A visual reference for the original redesign is saved outside the repo at `~/projects/Claude outputs/notebook-redesign-preview.png`.

## Run and test

```bash
# full-stack version at http://localhost:8080 (data goes to data/applications.tsv, gitignored)
javac --add-modules jdk.httpserver -d out $(find src/main/java -name '*.java')
java --add-modules jdk.httpserver -cp out com.coopcompass.ApplicationServer

# Java tests
javac --add-modules jdk.httpserver -d out $(find src/main/java src/test/java -name '*.java')
java --add-modules jdk.httpserver -ea -cp out com.coopcompass.ApplicationRepositoryTest

# frontend (see package.json): npm install, then
npm run check       # syntax
npm run test:unit    # node --test
npx playwright install && npm run test:e2e
npm run build && npm run serve   # website edition at http://127.0.0.1:4173
```

A `Dockerfile` (Temurin 24 JDK) builds and runs the same server.

## Code map

- `src/main/java/com/coopcompass/`
  - `ApplicationServer.java`: HTTP routing and request/response handling only
  - `ApplicationRepository.java`: validation, IDs, TSV persistence, status history, analytics
  - `Application.java`: the record; `Json.java`: dependency-free JSON helpers
- `src/test/java/com/coopcompass/ApplicationRepositoryTest.java`: plain-Java tests run with `-ea`
- `src/main/resources/public/`: the frontend, plain HTML/CSS/JS
  - `index.html`: shell, dialogs, toasts, menu, selection bar
  - `styles.css`: design tokens in `:root`, dark theme in `:root[data-theme="dark"]`, reduced-motion rules at the end
  - `js/domain.js`: stages, `LIMITS`, validation (`cleanChanges`, `cleanLink`, ...), import sanitization (`sanitizeImportedEntry`, `previewImport`), and the numbers worked out from entries (`metrics`, `agendaItems`, ...) - pure, unit-tested
  - `js/storage.js`: localStorage wrapper, corrupted-record detection (`readJsonRecord`, `StorageCorruptedError`, `quarantine`), the drafts store (`readDrafts`/`writeDraft`/`clearDraft`)
  - `js/api.js`: `browserApi`/`serverApi` (same interface, picked by `BROWSER_MODE`)
  - `js/ui/icons.js`: inline SVG icons + the notebook logo
  - `js/app.js`: state and prefs, theme, view functions (`viewToday`, `viewBoard`, `viewNotebook`, `viewInsights`, `viewDeleted`, `viewSettings`, `viewEntry`, `viewRecovery`), hash router, autosave/retry (section 17), toasts, dialogs, menus, actions
  - `site-mode.js`: `"server"` locally; `scripts/build-site.mjs` overwrites it with `"browser"` for the website edition
  - `sw.js`: cache name `internship-notebook-v7` - bump this on every shell (`index.html`/`styles.css`/any `js/*`/icon) change
- `scripts/`: `build-site.mjs` (writes `_site/`), `serve.mjs` (static server for local preview and E2E tests), `check-syntax.mjs`
- `tests/unit/`: `node --test`, pure logic (`domain.test.js`, `storage.test.js`, `import.test.js`)
- `tests/e2e/`: Playwright against the built `_site/`; `fixtures.js` has a `PW_ROUTE_FILES=1` fallback for a shell that can't open a local port
- `docs/cross-device-sync-proposal.md`: not implemented, a design doc only

## Conventions

- **Zero third-party runtime dependencies.** Dev-only tooling (`@playwright/test`, `node --test`) is fine and lives in `package.json`; it never ships to the browser. Don't add runtime npm packages, frameworks, CDNs, or web fonts without asking. Fonts are system stacks (`--serif`, `--sans`, `--hand`, `--mono`).
- Use the CSS variables for colour, radius, and shadow instead of hard-coded values, and check every UI change in both light and dark themes and at phone width (320/375/390/430 all matter, not just one).
- The stage colours (`--st-*`) were checked as a set for colour-vision deficiency; don't change one without rechecking the others. Text *on* a stage colour is a separate concern from the colour itself - see `.step.current` in styles.css for the per-stage-per-theme ink/white choice already worked out.
- Any change to the storage layer must work in both `browserApi` and `serverApi`. Any change to what gets saved should go through `domain.js`'s validation (`cleanChanges`/`cleanLink`/etc.), including imports - see `sanitizeImportedEntry`.
- Keep TSV loading backward compatible and add a test when the format changes.
- When shell files change (`index.html`, `styles.css`, any `js/*.js`, icons), bump the `CACHE` name in `sw.js` so installed copies update.
- Keep accessibility intact: labelled inputs, focus handling in dialogs (explicit `dialogOpener` capture/restore now, not just native `<dialog>` behavior - see why in the `3a46de0` commit message), keyboard shortcuts, live status messages, `prefers-reduced-motion`, real ARIA roles (a set of mutually-exclusive choices in a menu is `menuitemradio`, not `menuitem` + `aria-checked`).
- The repo is public. Never commit real application data, `data/*.tsv`, or `testing.html`.
- This `CLAUDE.md` itself is intentionally left out of git (it was untracked before this pass and stays that way) - it's a local handoff aid, not part of the product.

## Open threads

- **Storage refactor patch (not applied):** `~/projects/Claude outputs/0001-Extract-ApplicationStore-interface-from-ApplicationR.patch` (2026-09-20) moves TSV persistence behind an `ApplicationStore` interface with a `TsvStore` implementation. Written before the redesign and **still doesn't apply cleanly** to the current `ApplicationRepository.java`.
- **Owner still needs to, in order:** (1) `git push` this branch, (2) turn on Settings -> Pages -> Build and deployment -> Source -> GitHub Actions (a repo owner has to do this; Actions can't), (3) confirm the workflow run passes and `https://will-iam08.github.io/coop-compass/` loads, (4) run `npx playwright install && npm test` at least once somewhere the E2E suite can actually execute, since this session couldn't.
- **Planned upgrades:** PostgreSQL with Flyway migrations in place of TSV; Spring Boot API with validation annotations and JUnit; React/TypeScript UI; accounts and cross-device sync (see `docs/cross-device-sync-proposal.md` - proposal only, not started); deploy the full API plus database; record a product demo.

## Working with the owner

- He is a first-year computer engineering student. Explain code changes step by step so he understands the reasoning, pitched at his level rather than jumping to advanced material.
- Change only what is asked; leave everything else as it is.
- Be direct and candid, including when an idea or claim would overstate what the project does.
- Don't use em dashes in any writing for him (README, UI copy, commit messages, explanations).
