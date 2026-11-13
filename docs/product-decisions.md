# Product decisions

Notes on how My Internship Notebook is meant to work, and the rules we keep when changing it. The README covers features, setup, and testing; this file covers the why.

## Product rules

- **Zero backend for the website edition.** The public site at internshipnotebook.app is static files and nothing else. Every page lives in the visitor's own browser storage. When configured by the owner, optional manual sync copies a signed-in visitor's notebook to their own Supabase row, protected by the ownership policies in `supabase/schema.sql`; there is no shared server that receives application records. Anything that sounds "real" (reminders, email, sync) has to work within that, and the interface says plainly when something is not possible without a server, instead of pretending.
- **What reminders really do.** The site cannot send email, push notifications, or run while it is closed. So `#/export` hands reminders to apps that can:
  - the calendar file (.ics) adds each upcoming deadline, interview, and follow-up to the visitor's own calendar, with alerts a day before and two hours before. These are the reminders that actually arrive on a phone or laptop;
  - "Email me a digest" only opens the visitor's own mail app with a prefilled, self-addressed message. They press Send. The address is stored in this browser and never leaves it except in that message;
  - the optional due-soon notification is shown only when the notebook is opened in a tab, at most once a day, only for a real notebook (never the demo), and only after the browser grants permission.
- **Interview prep data is local and exportable.** Practice status and notes are stored on each page's optional `interview` field, in the same browser storage as the rest of the page. They go through the same draft and autosave path, are included in every JSON backup, are restored on import, and appear as counts in the Markdown export. The Java server edition does not store them, so `serverApi` strips the field before sending.
- **Demo data is sample-only.** A brand-new visitor opens on the welcome page (`#/welcome`) in front of an interactive demo (`js/demo.js`). The demo is invented data held in memory. It is never written to `localStorage`, never synced, and never uploaded: the demo backend in `app.js` keeps reads and writes in memory and skips the cloud write listener. A visitor's real notebook always starts empty or from their own choices in the builder (`#/build`) or guided setup (`#/setup`). Template pages exist only because the visitor chose a template, use invented company names, and are labelled "Example page" in their notes. The old 91 test entries and the "Load demo data" control stay removed, and `src/main/resources/public/testing.html` stays out of git.

## Other decisions

- **Name.** "My Internship Notebook", not "Coop Compass". Many people don't know what "co-op" means, so we prefer familiar names over institution-specific ones. The Java package stays `com.coopcompass` for compatibility.
- **Audience.** Anyone managing internships and interviews. Copy should never read like a personal tool for one person's search.
- **Privacy by design.** Nothing uploads application records to a shared public server. A shared device should use a separate browser profile; the Settings page says so.
- **Look and feel.** A paper notebook: a cloth cover for the sidebar, dot-grid pages, index-card applications, and a ruled page for each entry. Polished, with some purposeful motion, rather than a bare prototype.
- **Layout requirements.** A sidebar with separate pages, entries that open and can be edited, installable as an app, dark mode, and it works on phones as well as laptops and desktops.

## Conventions

- **No runtime dependencies.** Dev tooling (`@playwright/test`, `node --test`) lives in `package.json` and never ships to the browser. No runtime packages, frameworks, CDNs, or web fonts. Fonts are system stacks (`--serif`, `--sans`, `--hand`, `--mono`).
- **Design tokens.** Use the CSS variables for colour, radius, and shadow, and check every UI change in light and dark themes at phone widths (320, 375, 390, and 430 px all matter).
- **Stage colours.** The `--st-*` colours were checked as a set for colour-vision deficiency. Don't change one without rechecking the others. Text on a stage colour is a separate choice; see `.step.current` in `styles.css`.
- **Interaction feedback.** Every clickable control has a hover state and a small press (1px down, 2% smaller, 150-180 ms), using the `translate` and `scale` properties so nothing moves around it. Reduced motion keeps the colour change and drops the movement. New controls should join the shared selector list at the end of `styles.css`.
- **Storage.** Any storage change must work in both `browserApi` and `serverApi`. Anything that gets saved goes through `domain.js` validation (`cleanChanges`, `cleanLink`, `cleanInterview`, and so on), including imports through `sanitizeImportedEntry`. Keep TSV loading backward compatible and add a test when the format changes.
- **Service worker.** When shell files change (`index.html`, `styles.css`, any `js/*.js`, icons, or a precached file), bump the `CACHE` name in `sw.js` so installed copies update.
- **Accessibility.** Labelled inputs, explicit focus capture and restore in dialogs, keyboard shortcuts, live status messages, `prefers-reduced-motion`, 44px touch targets, and real ARIA roles (a set of mutually exclusive menu choices is `menuitemradio`).
- **Public repository.** Never commit real application data, `data/*.tsv`, or `testing.html`.
- **Writing.** Plain, direct copy that a student understands in one read. No em dashes in docs, UI copy, or commit messages.

## Known gaps

- Two light-theme stage step labels are just under WCAG AA 4.5:1 (Rejected 4.20:1, Applied 4.42:1). Closing them means retuning the CVD-checked stage palette, so they are left as they are until that palette is revisited.
