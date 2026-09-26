# My Internship Notebook

A private, installable web app for organizing internship applications, interviews, and offers. Each application gets its own lined page for notes, contacts, and next steps, while the board, agenda, and insights views keep the whole search in one place.

**Live app:** [internshipnotebook.app](https://internshipnotebook.app/) · [Privacy](https://internshipnotebook.app/privacy.html) · [Delete account or cloud data](https://internshipnotebook.app/delete-account.html)

## Features

- **Today:** a greeting, a weekly application goal with a progress ring and day-by-day dots, a "Coming up" agenda of deadlines and next steps, gentle nudges (roles closing soon, deadlines that passed, applications waiting 14+ days for a reply), and recently edited pages
- **Board:** a Kanban pipeline (Saved, Applied, Interview, Offer, Rejected) with drag and drop, a quick "Move to" menu on every card, and filtering
- **Notebook pages:** open any application to edit every field with autosave: company, role, location, source, deadline, job posting link, contact, next step and date, skill tags, and long notes on ruled paper. A timeline records each stage change
- **All pages:** a table-of-contents view with stage filters, starred pages, search across notes and skills, and sorting
- **Insights:** response rate, interview rate, a weekly rhythm chart against your goal, a pipeline funnel, which sources lead to interviews, and the most requested skills
- **Batch actions:** select several applications to move them together or send them to Recently Deleted
- **Safety net:** Recently Deleted keeps removed pages for seven days, and moves and deletes can be undone from the confirmation toast
- **Search everything:** press `⌘K` (or `Ctrl K`, or `/`) to jump to any page or action. `N` starts a new application
- **Installable and offline:** a web app manifest and service worker let it install to the Dock, desktop, or phone home screen and keep working without a connection
- **Light and dark themes** that follow the device setting or a manual choice, checked against WCAG 2.2 AA contrast
- **Your data, portable:** CSV export for spreadsheets, plus a JSON backup you can import on another device. Every imported field is validated the same way a typed one is (limits, calendar dates, and links: only `http(s)://` is ever accepted), the import is previewed before anything is written, and it can be undone as a batch
- **Optional account sync:** Google sign-in or a verified email/password account can copy the browser notebook to a private Firestore document and sync later edits. Email accounts have recovery links; phone/SMS recovery is deliberately off to avoid paid-SMS abuse
- **Account privacy controls:** a public privacy policy and deletion guide, plus in-app deletion of both the Firebase account and its cloud notebook
- **Google/Android-friendly PWA:** job links can be shared into the installed app, and application deadlines or next steps can be downloaded as standard calendar events
- **Autosave that doesn't lose work:** every edit is captured to this browser the instant it happens. If a save can't be confirmed yet (offline, storage briefly unavailable), it stays queued and retries automatically, or press Retry - it is never silently dropped. The save indicator says exactly what's true: Saving, Saved locally, Synced (server mode only), or Couldn't save
- Responsive layout (sidebar on laptops, bottom tab bar on phones, stage tabs and a "Move to..." control on the Board on a touch screen), 44px touch targets, and motion that respects reduced-motion settings
- Keyboard-friendly throughout: a real radiogroup with arrow-key support for picking a stage, a skip link, and focus that returns to where you were after a dialog closes

The local app has **zero third-party runtime dependencies**: the backend is a Java HTTP API and the frontend is plain HTML, CSS, and JavaScript, split into small modules (`js/domain.js`, `js/storage.js`, `js/api.js`, `js/cloud.js`, `js/app.js`). The optional cloud feature loads the official Firebase web modules from Google's CDN only in the website edition. Development-only tooling (`node --test`, Playwright) lives in `package.json` and never ships to the browser.

## What it demonstrates

- RESTful Java API design with input validation, partial updates (`PATCH`), and atomic batch actions
- Persistent storage with a backward-compatible file format: rows saved by the first version still load
- A per-application status history used to derive analytics such as weekly activity and response rates
- A single-page frontend with hash routing, one storage interface with two implementations (server API or browser storage), and a disk-backed autosave queue with retry
- Defensive data handling: corrupted local storage is quarantined and shown a recovery screen rather than silently replaced with an empty notebook; every imported field is re-validated, not just trusted
- Progressive web app basics: manifest, icons, and a network-first service worker
- Accessible form labels, live status messages, a real ARIA radiogroup and menu semantics, focus handling in dialogs, and keyboard shortcuts
- Automated tests: Java repository tests, frontend unit tests (`node --test`) for the validation and storage logic, and Playwright end-to-end tests, all run in CI before every deploy

## Run locally

The hosted app above is ready to use. To run the Java API edition for local development, compile and start it from this folder:

```bash
javac --add-modules jdk.httpserver -d out $(find src/main/java -name '*.java')
java --add-modules jdk.httpserver -cp out com.coopcompass.ApplicationServer
```

Then visit [http://localhost:8080](http://localhost:8080). Data is saved locally in `data/applications.tsv` (which is intentionally gitignored).

Run the Java tests with:

```bash
javac --add-modules jdk.httpserver -d out $(find src/main/java src/test/java -name '*.java')
java --add-modules jdk.httpserver -ea -cp out com.coopcompass.ApplicationRepositoryTest
java --add-modules jdk.httpserver -ea -cp out com.coopcompass.ApplicationServerSecurityTest
```

## Testing

Frontend tooling is dev-only (see `package.json`); nothing here ships to the browser.

```bash
npm install                 # once, installs @playwright/test
npm run check                # syntax-checks every frontend script
npm run test:unit            # node --test on domain.js, storage.js, and import validation
npx playwright install       # once, downloads test browsers
npm run test:e2e             # Playwright, against the built website edition
npm test                     # all three
```

`npm run build` writes the website edition to `_site/`; `npm run serve` serves it locally at `http://127.0.0.1:4173` for a quick look without the Java server.

## Website edition

The same interface also runs as a browser-only website. The GitHub Pages workflow (and the Render static site) build `src/main/resources/public` with `scripts/build-site.mjs`, which sets `window.NOTEBOOK_STORAGE_MODE = "browser"` in `site-mode.js`.

In that mode each person's entries start in their own browser profile's storage. Nothing is uploaded unless they open **Settings**, sign in, verify the email address when needed, and explicitly choose which notebook copy to use. While sync is on, Firebase Authentication controls account access and Firestore rules allow a verified user to access only `notebooks/{their uid}`. After that first choice, sync can resume on the same browser: a last-synced fingerprint selects the only changed copy, while diverged local and cloud copies pause for the user to choose. Anyone who can use the same unlocked browser profile can still see its local notebook, and local storage is not encrypted by this app, so use a separate profile on a shared device.

Firebase encrypts stored data and network traffic using its managed infrastructure, but this is recoverable account security—not user-only end-to-end encryption. An app-layer encrypted design that also survives a forgotten password would need a trusted key-wrapping backend (for example Cloud Functions plus KMS) and is intentionally not claimed here. Backup files also contain the notebook in readable form, so keep them somewhere you trust.

Browser storage is separated by origin, not URL path. The production app uses the dedicated `internshipnotebook.app` origin, so its browser-local notebook is isolated from other GitHub Pages projects. Anyone who can use the same unlocked browser profile can still see that profile's local notebook. See `docs/cross-device-sync-proposal.md` for the sync design.

The Java API is a single-user development server. It binds only to the loopback interface, rejects cross-site browser requests and non-JSON writes, caps request bodies at 64 KiB, and sends restrictive browser security headers. It still has no accounts or per-user database rows, so it must not be exposed as a public shared backend.

To install it: in Chrome or Edge use the install icon in the address bar; in Safari on a Mac choose **File → Add to Dock**; on iPhone or iPad tap **Share → Add to Home Screen**.

### Deploying (GitHub Pages)

`.github/workflows/deploy-pages.yml` runs the Java tests and the frontend syntax check on every push and pull request, and only builds and deploys to Pages after they pass and the push is to `main`. GitHub Pages itself has to be turned on once, by a repository owner, before the deploy job can succeed:

**Settings → Pages → Build and deployment → Source → GitHub Actions**

The workflow's `actions/configure-pages@v5` step cannot change this setting itself; it only reads it. Once it is set, the next push to `main` (or a manual run from the Actions tab) publishes to [https://internshipnotebook.app/](https://internshipnotebook.app/).

## Architecture

```text
Browser UI (HTML/CSS/JavaScript, service worker for offline use)
      | fetch / JSON                 | optional verified account sync
Java HTTP server                     Firebase Auth + Firestore
      |
ApplicationRepository ── data/applications.tsv
```

`ApplicationServer` owns HTTP concerns and `ApplicationRepository` owns validation, IDs, persistence, status history, and analytics. Keeping those responsibilities separate makes a later migration to Spring controllers and a database much simpler.

### API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/applications` | List active applications |
| `POST` | `/api/applications` | Create an application |
| `PATCH` | `/api/applications/{id}` | Update any subset of fields; a new `status` is added to the history |
| `DELETE` | `/api/applications/{id}` | Move to Recently Deleted |
| `POST` | `/api/applications/bulk-status` | Move several applications to one stage |
| `POST` | `/api/applications/bulk-delete` | Move several applications to Recently Deleted |
| `GET` | `/api/recently-deleted` | List Recently Deleted |
| `POST` | `/api/recently-deleted/{id}/restore` and `/bulk-restore` | Restore |
| `DELETE` | `/api/recently-deleted/{id}` and `POST /bulk-permanent-delete` | Delete permanently |
| `GET` | `/api/dashboard` | Totals by stage and response rate |

## Next upgrades

1. Replace the TSV repository with PostgreSQL and Flyway migrations.
2. Add a Spring Boot API, validation annotations, and JUnit tests.
3. Rebuild the UI with React/TypeScript.
4. Add live multi-device conflict detection while two signed-in copies are open at the same time.
5. Record a short product demo.
