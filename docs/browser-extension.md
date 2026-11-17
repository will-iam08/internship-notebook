# Browser extension: Save Jobs

A toolbar button for Chrome, Edge, and Firefox. On a job posting, click it (or press Alt+Shift+S) and it shows the company, role, location, closing date, where the job was found, and the skills it mentions. **Save to Notebook** then opens My Internship Notebook in a new tab with that job filled in, so you can check it and add the page.

## How it works

- **Reading the page.** Most job sites (Greenhouse, Lever, Ashby, Workday, LinkedIn, SmartRecruiters, and others) put a schema.org `JobPosting` in the page for search engines. The extension reads that first, because it is the most reliable source for the company, title, location, remote work, and closing date. Whatever it leaves out comes from the notebook's own job clipper (`js/clipper.js`), which reads the page title, the address, and any text you selected.
- **Saving.** The popup opens `https://internshipnotebook.app/#/new?...` with the fields in the address. This is the same path the "Save to Notebook" bookmarklet and the share target use, and the new-application sheet opens filled in.
- **The job description.** If the posting has one, a checkbox keeps a copy in the page's notes, in case the posting comes down before your interview. The choice is remembered.
- **Another notebook.** Under **Notebook address** in the popup you can point it at a local copy (for example `localhost:4173`) instead of the live site.

## Privacy

- The extension asks for `activeTab`, `scripting`, and `storage` only. It has no access to any site until you click its button, and then only to the tab in front of you.
- It reads the page and changes nothing on it.
- It has no server and sends nothing anywhere. The job details travel after the `#` in the notebook address, which browsers never send to a server, so they go no further than your own notebook tab.
- `storage` holds two settings: the notebook address and the description checkbox.

## Files

- `extension/manifest.json`: Manifest V3, shared by Chrome, Edge, and Firefox
- `extension/popup.html`, `popup.css`, `popup.js`: the popup
- `extension/page-reader.js`: `readJobPage`, which the browser runs inside the job page. It must stay self-contained, with no imports, because the browser runs it on its own
- `extension/job-from-page.js`: the pure logic (finding the posting, location and description text, the notebook address), tested in `tests/unit/extension.test.js`
- `extension/icons/`: the app icon at 16, 32, 48, and 128 px
- `scripts/build-extension.mjs`: copies `extension/` plus the notebook's `js/clipper.js` and `js/domain.js` into `_extension/`, and packs `_extension.zip`

## Try it locally

```bash
npm run build:extension
```

- **Chrome or Edge:** open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**, choose **Load unpacked**, and pick the `_extension` folder.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and pick `_extension/manifest.json`. It stays loaded until Firefox closes.

Run `npm run build:extension` again after changing anything in `extension/`, `js/clipper.js`, or `js/domain.js`, then reload the extension.

## Publishing

Both stores take `_extension.zip`. The account steps and fees are the owner's to complete.

- **Chrome Web Store:** register at the Chrome Web Store Developer Dashboard (one-time fee), create a new item, and upload the zip. The listing needs a 128 px icon (in the zip), at least one 1280x800 screenshot, and a short description. In **Privacy**, state a single purpose ("save the job posting in the current tab to the user's notebook"), justify each permission (`activeTab` and `scripting`: read the posting when the button is clicked; `storage`: remember the notebook address), and declare that no user data is collected.
- **Firefox Add-ons (AMO):** sign in at addons.mozilla.org, choose **Submit a New Add-on**, and upload the zip. The add-on id is set in the manifest (`save-jobs@internshipnotebook.app`), and `data_collection_permissions` already declares that no data is collected.
- **Updates:** raise `version` in `extension/manifest.json`, rebuild, and upload the new zip to each store.

## Limits

- Pages that refuse extensions (browser stores, built-in PDF viewers, the browser's own pages) cannot be read. The popup says so, or falls back to what the address and tab title show.
- Someone who has not started a notebook yet sees the notebook's landing page instead of the filled-in sheet. After they start one, clicking the button again works.
- Safari needs a separate wrapper app built in Xcode, so it is not covered here.
