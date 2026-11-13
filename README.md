# My Internship Notebook

A private, installable web app for organizing internship applications, interviews, and offers. Each application gets its own lined page for notes, contacts, and next steps, while the board, agenda, and insights views keep the whole search in one place.

**Live app:** [internshipnotebook.app](https://internshipnotebook.app/) · [Privacy](https://internshipnotebook.app/privacy.html) · [Delete account or cloud data](https://internshipnotebook.app/delete-account.html)

## Features

- **Welcome page and interactive tour:** a brand-new visitor to the website edition lands on `#/welcome`, in front of a live demo notebook. It has a short muted tour video (poster and a play button instead of autoplay under reduced motion or save-data), a tabbed tour of Today, Board, All pages, and Insights drawn in HTML/CSS from the demo data, a mini board with stage filter chips, and a Chaos/Notebook toggle that sorts scattered notes into board columns. `Explore the demo` opens the demo; `Build my notebook` opens the builder. Deep links, returning visitors, and the Server Edition skip it. The demo is sample data held in memory only: it is never written to storage or uploaded
- **Build your notebook your way:** a three-step builder at `#/build` asks how to start (from a template, empty, or by importing a backup), what the notebook is for (internship search, co-op, new grad, research, career switch, or just exploring; up to two), and what it should do (deadlines, responses, openings, interviews, or minimal), then collects your name, target role, season, and optional target companies. A review card lists the exact pages and settings before anything is saved. A template adds two to four example pages with invented company names, notes, contacts, skill tags, and dates relative to today, plus a page per target company; the focus areas rearrange Today (for example, "Never miss a deadline" puts Next up first) and set a suggested weekly goal. Progress is announced, choices survive Back and Next, and every option works from the keyboard. Guided setup at `#/setup` still works and uses the same commit path
- **Today:** a greeting, a weekly application goal with a progress ring and day-by-day dots, a compact "Next up" look at your soonest deadline or next step, and recently edited pages
- **Latest internship openings:** a worldwide feed of recently posted internship and co-op roles on the Today page. Search role/company and location, filter by term, degree eligibility, and co-op status, and keep those choices after reopening. Save a role into the notebook with its details prefilled, or open its posting to apply. Already tracked postings link back to their notebook page. Pulled from the public [Pitt CSC & Simplify internship tracker](https://github.com/SimplifyJobs/Summer2027-Internships) by a scheduled workflow, not fetched live in your browser
- **Board:** a Kanban pipeline (Saved, Applied, Interview, Offer, Rejected) with drag and drop, a quick "Move to" menu on every card, filtering, the full "Coming up" agenda of deadlines and next steps, and gentle nudges (roles closing soon, deadlines that passed, applications waiting 14+ days for a reply)
- **Notebook pages:** open any application to edit every field with autosave: company, role, location, source, deadline, job posting link, contact, next step and date, skill tags, and long notes on ruled paper. Complete or reschedule next steps from Today, Board, or the page; completion keeps a dated record in Notes and can be undone. A timeline records each stage change
- **Interview prep:** every application page has a question bank of 62 questions in four groups (behavioral, technical, internship logistics, and questions to ask them). Technical questions follow the role (software, data, design, product), and the stage decides what comes first: technical before an interview, logistics once there's an offer. Mark each question Practiced or Stuck, add a short note, filter to what's left, and watch a progress bar fill. Today shows three "Practice next" questions for the soonest interview, or for the latest open page when interviews is a focus area. Progress is stored with the page in this browser, comes along in every backup, and is listed in the Markdown export
- **All pages:** a table-of-contents view with stage filters, starred pages, search across notes and skills, and sorting
- **Insights:** response rate, interview rate, a weekly rhythm chart against your goal, a pipeline funnel, which sources lead to interviews, and the most requested skills
- **Batch actions:** select several applications to move them together or send them to Recently Deleted
- **Safety net:** Recently Deleted keeps removed pages for seven days, and moves and deletes can be undone from the confirmation toast
- **Search everything:** press `⌘K` (or `Ctrl K`, or `/`) to jump to any page or action. `N` starts a new application
- **Installable and offline:** a web app manifest and service worker let it install to the Dock, desktop, or phone home screen and keep working without a connection
- **Light and dark themes** that follow the device setting or a manual choice, checked against WCAG 2.2 AA contrast
- **Your data, portable:** CSV export for spreadsheets, plus a JSON backup you can import on another device. Every imported field is validated the same way a typed one is (limits, calendar dates, and links: only `http(s)://` is ever accepted), the import is previewed before anything is written, and it can be undone as a batch
- **Reminders and exports (`#/export`):** the website edition has no server, so it hands reminders to apps that can deliver them, and says so on the page. A calendar file (.ics) puts every upcoming deadline, interview, and follow-up into Google Calendar, Apple Calendar, or Outlook, with alerts a day and two hours before; those are real reminders on a phone or laptop. "Email me a digest" opens your own mail app with the week's deadlines, follow-ups, and interviews already written and addressed to you (the site never sends email, and the address stays in this browser). An optional notification lists anything due today or tomorrow, but only when the notebook is open in a tab. There is also a Markdown copy, a print stylesheet for Today, All pages, and a one-page summary (or Save as PDF), and the JSON backup
- **Optional cloud sync:** when the owner configures Supabase, Settings offers email/password sign-in and a manual Sync now button. The newer whole notebook wins by edit timestamp; local-only use remains the default. Sessions stay in memory and notebook storage stays in the existing browser key. See [Supabase setup](supabase/README.md)
- **Account privacy:** a public privacy policy and deletion guide explain browser storage and optional cloud data
- **Google/Android-friendly PWA:** job links can be shared into the installed app, and application deadlines or next steps can be downloaded as standard calendar events
- **Autosave that doesn't lose work:** every edit is captured to this browser the instant it happens. If a save can't be confirmed yet (offline, storage briefly unavailable), it stays queued and retries automatically, or press Retry - it is never silently dropped. The save indicator says exactly what's true: Saving, Saved locally, Synced (server mode only), or Couldn't save
- Responsive layout (sidebar on laptops, bottom tab bar on phones, stage tabs and a "Move to..." control on the Board on a touch screen), 44px touch targets, and motion that respects reduced-motion settings
- Consistent interaction feedback: every button, chip, tab, card, list row, and link reacts on hover and gives a small press (1px down, 2% smaller) in 150-180 ms. Presses use transform only, so nothing around them moves, and reduced motion keeps the colour changes but drops the movement
- Keyboard-friendly throughout: a real radiogroup with arrow-key support for picking a stage, a skip link, and focus that returns to where you were after a dialog closes

The local app has **zero third-party runtime dependencies**: the backend is a Java HTTP API and the frontend is plain HTML, CSS, and JavaScript, split into small modules (`js/domain.js`, `js/storage.js`, `js/api.js`, `js/cloud.js`, `js/app.js`). Optional Supabase sync uses plain `fetch` to Auth and PostgREST, with no SDK or third-party runtime scripts. Development-only tooling (`node --test`, Playwright) lives in `package.json` and never ships to the browser.

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

`node scripts/fetch-internships.mjs` refreshes `src/main/resources/public/internships.json`, the small file behind the Today page's internship feed. `.github/workflows/update-internships.yml` runs it daily, commits the result if it changed, and dispatches the tested Pages deployment; run it by hand when testing that feature locally.

## Website edition

The same interface also runs as a browser-only website. The GitHub Pages workflow (and the Render static site) build `src/main/resources/public` with `scripts/build-site.mjs`, which sets `window.NOTEBOOK_STORAGE_MODE = "browser"` in `site-mode.js`.

In that mode each person's entries start in their own browser profile's storage. Cloud sync is disabled unless the owner fills in `src/main/resources/public/runtime-config.js`. To enable it, create a Supabase project, run `supabase/schema.sql`, enable email sign-in, create a user, and paste the Project URL and public anon key. Follow [the full setup guide](supabase/README.md), then rebuild the site.

A visitor chooses **Settings → Cloud sync**, signs in, and presses **Sync now** to upload or download the newer whole notebook. Sign-in alone sends no notebook data; there is no background sync. Row Level Security restricts reads and writes to the signed-in owner's row. The database rejects stale concurrent writes. Timestamps depend on device clocks; keep backups when working on multiple copies. Reloading or session expiry requires signing in again. Existing Firebase accounts and cloud copies are not migrated; use a JSON backup to move a notebook.

The cloud copy is readable by the Supabase project owner; it is not end-to-end encrypted. Backup files also contain readable notebook data. Anyone using the same unlocked browser profile can see its local notebook, so use a separate profile on a shared device. Browser storage is separated by origin, not URL path; production uses the dedicated `internshipnotebook.app` origin.

The Java API is a single-user development server. It binds only to the loopback interface, rejects cross-site browser requests and non-JSON writes, caps ordinary request bodies at 64 KiB and backup imports at 5 MiB, and sends restrictive browser security headers. Backup import preserves active and recently deleted pages, original timestamps and stage history, and saves the whole batch atomically. An unreadable local storage row stops startup with the original file intact for recovery. The server still has no accounts or per-user database rows, so it must not be exposed as a public shared backend.

To install it: in Chrome or Edge use the install icon in the address bar; in Safari on a Mac choose **File → Add to Dock**; on iPhone or iPad tap **Share → Add to Home Screen**.

### Deploying (GitHub Pages)

`.github/workflows/deploy-pages.yml` runs the Java tests and the frontend syntax check on every push and pull request, and only builds and deploys to Pages after they pass and the push is to `main`. GitHub Pages itself has to be turned on once, by a repository owner, before the deploy job can succeed:

**Settings → Pages → Build and deployment → Source → GitHub Actions**

The workflow's `actions/configure-pages@v5` step cannot change this setting itself; it only reads it. Once it is set, the next push to `main` (or a manual run from the Actions tab) publishes to [https://internshipnotebook.app/](https://internshipnotebook.app/).

## Architecture

The product rules (the zero-backend rule, what reminders really do, where interview prep data lives, and the demo-data rule) and the code conventions are in [docs/product-decisions.md](docs/product-decisions.md).

```text
Browser UI (HTML/CSS/JavaScript, service worker for offline use)
      | fetch / JSON                 | optional manual account sync
Java HTTP server                     Supabase Auth + PostgREST (fetch)
      |
ApplicationRepository ── data/applications.tsv
```

`ApplicationServer` owns HTTP concerns and `ApplicationRepository` owns validation, IDs, persistence, status history, and analytics. Keeping those responsibilities separate makes a later migration to Spring controllers and a database much simpler.

### API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/applications` | List active applications |
| `POST` | `/api/applications` | Create an application |
| `POST` | `/api/applications/import` | Atomically import active and recently deleted pages with their original dates and history |
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
5. Send reminder emails and push notifications while the notebook is closed. Both need a server (a scheduler plus a mail or push service) and an account to deliver to; until then the calendar file is how reminders arrive.
6. Let people change their focus areas from Settings, not only in the builder.
7. Import applications from a CSV or spreadsheet, not just from a JSON backup.
