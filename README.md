# My Internship Notebook

A notebook-style app for organizing internship applications, interviews, and offers. Each application gets its own lined page for notes, contacts, and next steps, and the board, agenda, and insights views keep the whole search in one place. It runs as a full-stack local project (Java API) or as a private website that installs like an app on a laptop or phone.

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
- **Light and dark themes** that follow the device setting or a manual choice
- **Your data, portable:** CSV export for spreadsheets, plus a JSON backup you can import on another device
- Responsive layout (sidebar on laptops, bottom tab bar on phones), keyboard-friendly controls, and motion that respects reduced-motion settings

The app has **zero third-party dependencies**: the backend is a Java HTTP API and the frontend is plain HTML, CSS, and JavaScript. The API boundary and project structure are stepping stones toward a Spring Boot + React version later.

## What it demonstrates

- RESTful Java API design with input validation, partial updates (`PATCH`), and atomic batch actions
- Persistent storage with a backward-compatible file format: rows saved by the first version still load
- A per-application status history used to derive analytics such as weekly activity and response rates
- A single-page frontend with hash routing, one storage interface with two implementations (server API or browser storage), and debounced autosave
- Progressive web app basics: manifest, icons, and a network-first service worker
- Accessible form labels, live status messages, focus handling in dialogs, and keyboard shortcuts
- Automated repository tests and Docker packaging

## Run it

From this folder, compile and start the app:

```bash
javac --add-modules jdk.httpserver -d out $(find src/main/java -name '*.java')
java --add-modules jdk.httpserver -cp out com.coopcompass.ApplicationServer
```

Then visit [http://localhost:8080](http://localhost:8080). Data is saved locally in `data/applications.tsv` (which is intentionally gitignored).

Run the tests with:

```bash
javac --add-modules jdk.httpserver -d out $(find src/main/java src/test/java -name '*.java')
java --add-modules jdk.httpserver -ea -cp out com.coopcompass.ApplicationRepositoryTest
```

## Website edition

The same interface also runs as a browser-only website. The GitHub Pages workflow (and the Render static site) copy `src/main/resources/public` and set `window.NOTEBOOK_STORAGE_MODE = "browser"` in `site-mode.js`.

In that mode each person's entries stay in their own browser's storage. Nothing is uploaded to a server, so entries are private to that browser but do not sync between devices. To move a notebook to another phone or laptop, use **Settings → Download backup**, then **Import backup** on the other device.

To install it: in Chrome or Edge use the install icon in the address bar; in Safari on a Mac choose **File → Add to Dock**; on iPhone or iPad tap **Share → Add to Home Screen**.

## Architecture

```text
Browser UI (HTML/CSS/JavaScript, service worker for offline use)
            |  fetch / JSON            (or browser storage on the website)
Java HTTP server ── ApplicationRepository ── data/applications.tsv
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
3. Rebuild the UI with React/TypeScript and add login support, so a notebook can sync between devices.
4. Deploy the API and database, then record a short product demo.
