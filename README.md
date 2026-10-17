# Student Finance Tracker

Theme: **Student Finance Tracker** (budgets, transactions, regex search). A responsive, accessible, vanilla HTML/CSS/JavaScript app for recording expenses, setting a spending cap and searching with regular expressions. It runs entirely in the browser and saves to `localStorage`.

- **Live site (GitHub Pages):** https://adukwu137.github.io/oche-student-finance-tracker/
- **Repository:** https://github.com/adukwu137/student-finance-tracker
- **Demo video (unlisted):** ADD-YOUR-LINK-HERE
- **Author:** Oche Emmanuel Mannix Adukwu, African Leadership University (o.adukwu@alustudent.com)

## Design and planning (M1: spec, wireframes, accessibility plan)

**Purpose and users.** A university student who needs to log everyday spending in Rwandan francs, see where the money goes, stay under a spending cap and quickly find old purchases. It runs offline in one browser and needs no account.

**Data model.** One record has `id`, `description`, `amount`, `currency`, `category`, `date`, `createdAt`, `updatedAt` (full example in the *Data model* section below). The whole state is `{ categories, transactions, settings }`, saved to `localStorage` after every change and exported as JSON.

**Validation plan.** Description `^\S(?:.*\S)?$` (spaces collapsed first); amount `^(0|[1-9]\d*)(\.\d{1,2})?$` and greater than 0; date typed as DD-MM-YYYY, converted to `^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$` and checked against the real calendar; category `^[A-Za-z]+(?:[ -][A-Za-z]+)*$` and must be configured; advanced rule: back-reference `\b(\w+)\s+\1\b` warns about repeated words. Search uses a safe regex compiler (try/catch, error message, case toggle, `<mark>` highlighting built from DOM nodes).

**Accessibility plan.**
- Landmarks (`header`, `nav`, `main`, `section`, `footer`), one `h1`, ordered headings, .
- Every input has a visible label; errors are text starting with "Error:", linked with `aria-describedby`, with `aria-invalid`; the first invalid field receives focus.
- Everything works with the keyboard; visible focus ring; the confirmation dialog returns focus to the button that opened it.
- Live regions: polite for normal updates and search results, a dedicated polite one for cap changes, one assertive only when the cap is exceeded.
- Text contrast 4.5:1 or better, controls 3:1; meaning is never given by colour alone (words and badges accompany colour); controls at least 44px high.
- `prefers-reduced-motion` turns animations off; mobile-first layout with breakpoints near 360px, 768px and 1024px, no horizontal scrolling down to 320px.

**Wireframes (text sketches).**

Desktop
```
+--------------------------------------------------------------+
| Student Finance Tracker      [Dashboard] Records Add/Edit ... |  black bar
+--------------------------------------------------------------+
| Dashboard                                                    |
| +-----------+ +-----------+ +-----------+ +-----------+      |
| |TRANSACT.  | |TOTAL      | |TOP CATEG. | |LAST 7 DAYS|      |
| | 14        | | RWF 201k  | | Fees      | | RWF 101k  |      |
| +-----------+ +-----------+ +-----------+ +-----------+      |
| +-------------------------+ +-----------------------------+  |
| | Spending Cap Target [!] | | Spending by Category        |  |
| | ======== bar            | | Fees  ===== RWF, %          |  |
| | Cap / Spent / Remaining | | Books ====  RWF, %          |  |
| +-------------------------+ +-----------------------------+  |
| +----------------------------------------------------------+ |
| | Spending over the last seven days (7 slim bars)          | |
| +----------------------------------------------------------+ |
| Records: [search] [Clear] [x] Ignore case  [Category][Sort]  |
| | Date | Description | Category | Amount | Edit Delete |     |
| Add/Edit form | Settings | About                             |
+--------------------------------------------------------------+
| (black footer)                                               |
+--------------------------------------------------------------+
```
Phone (about 360px)
```
+------------------------+
| Student Finance Tracker|
| Dashboard Records ...  |
+------------------------+
| Dashboard              |
| +--------------------+ |
| | TRANSACTIONS  14   | |  one stat card per row
| +--------------------+ |
| | TOTAL SPENDING ... | |
| +--------------------+ |
| | Spending Cap [!]   | |
| | Spending by Category |
| | Last 7 days (bars) | |
| Records (cards)        |
| | date, text, amount | |
| | [Edit] [Delete]    | |
| Form / Settings / About|
+------------------------+
```

 The CodeVibe report is in `codevibe-reports/`.


## Features
- **Sections:** Dashboard, Records table (cards on mobile), Add/Edit form, Settings, About, with working navigation.
- **Records:** add, edit, delete with confirmation, unique ids (`rec_0001`), `createdAt`/`updatedAt` timestamps, empty states, category management (add; removing a category moves its records to "Other").
- **Validation (live, inline):** 4 regex rules plus an advanced back-reference rule, calendar-date check, errors linked with `aria-describedby` and `aria-invalid`.
- **Search:** live regex search with a case-insensitive toggle, safe compile with an error message, `<mark>` highlighting built with DOM nodes (no HTML injection), result count, combined with the category filter and sorting.
- **Sorting:** date, description (A to Z, Z to A) and amount, both directions, numeric/date aware.
- **Dashboard:** record count, total spending, top category, last-7-days total and bar chart, category breakdown.
- **Budget cap:** editable cap, remaining/over amounts, progress bar, polite live announcements when under the cap and an assertive one when exceeded.
- **Currency:** base currency RWF plus USD, EUR, GBP; manual exchange rates (validated); every total, chart, sort and the cap use one conversion convention; stored amounts are never reinterpreted.
- **Persistence:** automatic `localStorage` save, safe handling of malformed or blocked storage, JSON export and validated import (replace after confirmation, nothing changes if validation fails).
- **Accessibility and UX:** landmarks, labelled fields, visible focus, keyboard-only operation, contrast checked, reduced-motion support, transitions, forced-colours support.

## Run it
Open `index.html` in any modern browser (double-click it), or use the VS Code **Live Server** extension (right-click `index.html`, Open with Live Server). No server, build step or internet connection is needed. The scripts are ordinary `<script>` files loaded in order and namespaced under `window.SFT`, so the app also works straight from disk. On the first visit the 14 records from `seed.json` are loaded once (an identical copy lives in `scripts/seed-data.js` so no file fetch is needed); saved data is never overwritten by sample data.

## Tests
- **Browser:** open `tests.html` (double-click works). Every assertion is listed; all should read PASS. Over `http://` it also checks that `seed.json` matches the embedded copy; opened from disk that single check reports SKIP.
- **Terminal:** `node tests/run-node.mjs` (add a word to run only matching tests, e.g. `node tests/run-node.mjs amount`). The one test that needs a real browser DOM is reported as SKIP there.
Covered: description, amount, date and category rules; the advanced regex; invalid search patterns; case modes; safe highlighting; sorting; add/edit/delete; unique ids; localStorage save/load and malformed JSON; import/export round trip and rejection of bad records; statistics; budget cap; currency conversion; empty data; `seed.json`.

## File structure
```
index.html            page structure
tests.html            browser test runner
seed.json             14 sample records (RWF) in the export format
styles/styles.css     mobile-first CSS (breakpoints 360 / 768 / 1024px)
scripts/app.js        start-up and event wiring
scripts/seed-data.js  embedded copy of seed.json (keep identical)
scripts/state.js      state and controlled updates (add, edit, delete, categories, settings)
scripts/storage.js    localStorage, export/import, seed loading
scripts/validators.js regex rules, business rules, import schema validation
scripts/search.js     safe regex compile, matching, highlighting, filter + sort
scripts/finance.js    statistics, 7-day window, cap, currency conversion
scripts/ui.js         rendering and accessible DOM updates
tests/suite.js        test suite used by tests.html and Node
assets/favicon.svg    icon
```

## Data model
```js
{ id: "rec_0001", description: "Lunch at cafeteria", amount: 2500, currency: "RWF",
  category: "Food", date: "2026-10-10",
  createdAt: "2026-10-10T12:00:00.000Z", updatedAt: "2026-10-10T12:00:00.000Z" }
```
`currency` is the currency the amount was entered in. Dates are typed as `DD-MM-YYYY` and stored/exported as `YYYY-MM-DD` calendar dates.

## Regex catalog
| Pattern | Purpose | Valid | Invalid |
|---|---|---|---|
| `^\S(?:.*\S)?$` | description with no leading/trailing space (repeated spaces are collapsed first) | `Lunch at cafe` | ` Lunch`, empty |
| `^(0\|[1-9]\d*)(\.\d{1,2})?$` | amount, at most 2 decimals, then must be greater than 0 | `2500`, `12.5` | `1.234`, `-5`, `1e3`, `007` |
| `^(0[1-9]\|[12]\d\|3[01])-(0[1-9]\|1[0-2])-\d{4}$` | the date as typed, **DD-MM-YYYY**; it is converted to the ISO form below before it is checked and stored | `08-10-2026` | `2026-10-08`, `8-10-2026`, `32-01-2026` |
| `^\d{4}-(0[1-9]\|1[0-2])-(0[1-9]\|[12]\d\|3[01])$` | date shape; a calendar check then rejects impossible dates | `2026-10-08` | `2026-13-01`, `2026-02-31` (matches the shape, fails the calendar check) |
| `^[A-Za-z]+(?:[ -][A-Za-z]+)*$` | category name; must also be a configured category | `Study abroad` | `Food2`, `a--b` |
| `\b(\w+)\s+\1\b` (flag `i`) | **advanced (back-reference)**: repeated word, shown as a warning | `Lunch lunch at cafe` | `Lunch at cafe` |
| `^\d+(\.\d{1,12})?$` | exchange rate typed in Settings (also must be greater than 0) | `0.000689655172` | `0`, `1e3`, `-1` |

## Search
Type in the **Search records** box; results update as you type and matches are highlighted. The search is powered by regular expressions, so plain words work (`coffee`) and so do patterns such as `(coffee|tea)`, `\.\d{2}\b` (a two-digit decimal ending) or `\b(\w+)\s+\1\b` (repeated words). An invalid pattern shows an error and never breaks the page. To avoid freezing the browser, patterns that can backtrack catastrophically (like `(a+)+`) are refused with a message; patterns over 200 characters are refused. "Ignore case" switches between case-insensitive and case-sensitive matching.

## Keyboard map
- `Tab` / `Shift+Tab` move through controls in page order; the first stop is the **skip link**.
- `Enter` follows links and presses buttons; `Space` presses buttons and ticks the checkbox; `Enter` in a field submits the form.
- Navigation links move focus to the section heading.
- Arrow keys change dropdown values.
- `Esc` closes the delete/replace confirmation; while it is open the page behind is inert, and focus returns to the button you used.
- After a failed submit focus goes to the first invalid field; after adding, to Description; after editing, to that row's Edit button; after deleting, to the Records heading.

## Accessibility notes
Semantic landmarks and one `h1` with ordered headings; every field has a label; errors use `aria-invalid` and `aria-describedby` and start with the word "Error:"; a polite live region for normal updates, a dedicated one for cap changes and an assertive one only when the cap is exceeded; visible focus rings; text and controls meet 4.5:1 / 3:1 contrast; controls are at least 44px tall; no horizontal scrolling down to 320px; `prefers-reduced-motion` removes animation; table semantics are preserved on mobile cards. Limitation: not yet tested with real screen readers on all platforms.

## localStorage, import and export
Everything is saved under the key `studentFinanceTracker:v1`. Unreadable stored data is copied to `studentFinanceTracker:v1:invalid-backup` and the app starts empty. **Export** downloads `student-finance-backup.json` (settings, categories, records). **Import** validates the whole file (schema, every record, duplicate ids, categories, cap, rates) and, only if valid and after you confirm, replaces your data; otherwise nothing changes.

## Currency convention
`rate[X]` is the number of units of X equal to **1 unit of the base currency (RWF)**, so USD is about `0.00069` (1 USD is about 1,450 RWF). The built-in rates are examples, so enter current ones in Settings. Changing the base currency re-expresses rates and the cap but never changes a stored amount.

## Deploy to GitHub Pages
Repository **Settings, Pages, Build and deployment, Source: Deploy from a branch, Branch `main`, folder `/ (root)`, Save.** After the "pages build and deployment" action finishes, open https://adukwu137.github.io/student-finance-tracker/ and check the app loads, there are no 404s in DevTools, and `/tests.html` passes.

## Known limitations
Data lives in one browser only; exchange rates are entered by hand; the cap applies to all records; very large patterns under the 200-character limit can still be slow.


