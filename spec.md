# Job Log — Product Spec (v1)

A Chrome extension that helps job seekers log every application they send, remember which resume they used, move each application through a clear status pipeline, and see how their search is going.

---

## 1. Users & positioning

- **Audience:** Public product for individual job seekers, published on the Chrome Web Store.
- **Primary user:** Someone applying to many jobs across many sites (LinkedIn, Indeed, company career pages, ATS portals, referrals, email). They lose track of where they applied, when, and with which resume.
- **Positioning:** Private and local-first. No account, no server, and nothing leaves the browser. The extension reads a page only when the user explicitly asks it to.
- **Business model:** Free in v1. The architecture stays open to a later paid tier, most likely cloud sync (see §11).



## 2. Goals & non-goals

**v1 goals**

1. Log an application in under 15 seconds, with or without page prefill.
2. Always know which resume was sent for which job, and be able to open that exact file later.
3. Change an application's status in one tap, with an automatic date history.
4. Show encouraging but honest stats over a chosen time range, plus an optional weekly goal.
5. Pass Chrome Web Store review with minimal permissions and no broad host access.

**Non-goals (v1)**

- Follow-up reminders of any kind: no notifications and no "needs follow-up" badge.
- Automatically detecting submitted applications.
- Site-specific scrapers (LinkedIn, Indeed, and so on). Only generic extraction is in scope.
- Accounts, cloud sync, multi-device support, or a backend.
- Custom statuses.
- A Kanban board.
- Emailing or calendar integration.



## 3. Surfaces


| Surface                     | Purpose                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| **Side panel** (primary UI) | All app screens: Applications list, Add/Edit form, Stats, Resumes, Settings. Bottom or top tab bar. |
| **Context menu**            | "Add job to Job Log" on any page (reads the page), and "Add linked job to Job Log" on links (captures only the link URL). |
| **Keyboard shortcut**       | `Alt+Shift+J` (user-configurable) works the same as the page context-menu item.                     |
| **Toolbar icon**            | Opens the side panel (`openPanelOnActionClick`).                                                    |


The side panel is roughly 320–400 px wide, so every screen is designed mobile-first for that width.

## 4. Core flows



### 4.1 Add application: prefilled from a page (user-initiated)

1. On a job posting, the user right-clicks and chooses **"Add job to Job Log"**, or presses the shortcut.
2. That gesture grants `activeTab`. The background service worker first calls `chrome.sidePanel.open` for the tab's window, synchronously inside the gesture handler (before any `await`), then runs a one-off extractor in the tab with `chrome.scripting.executeScript`.
3. The extraction result is saved as a draft in `chrome.storage.session` under a per-window key (`captureDraft:<windowId>`), because each window has its own side panel. The panel may open before the draft is written, so it reads its window's draft on load and also listens for changes. It consumes (deletes) the draft, and ignores drafts older than 5 minutes so a capture whose panel never opened can't prefill a later session. If the page can't be read (restricted page, tab gone), the draft holds only the tab URL when it is `http(s)`, and the form otherwise opens blank. A new capture replaces whatever is in the form.
4. The side panel shows the Add form prefilled with the draft. Prefilled fields get a subtle "auto-filled, please check" hint.
5. The user reviews the fields, picks a resume, and saves. If a duplicate is detected, a warning appears (§4.5).

**From a link:** right-clicking a job link (for example in a search results list) and choosing "Add linked job to Job Log" captures only `linkUrl`, with no page read. The form opens with the link filled in and the other fields blank.

### 4.2 Add application: manual

1. In the side panel, the user taps **"+ Add application"**.
2. The form opens blank, with **Date applied** defaulting to today and **Status** defaulting to Applied.
3. The user fills in the fields and saves.



### 4.3 Update status

- Every row in the Applications list shows a **status chip**. Tapping it opens a compact picker with all statuses. One tap changes the status, appends a history entry with the timestamp, and shows an **Undo** toast for about 5 seconds.
- The detail/edit view shows the full status timeline, and each entry's date can be edited (for example, to backfill an interview date).



### 4.4 Browse & find

- The list is sorted by last activity, newest first, and can also be sorted by date applied or company.
- **Status filter:** All / Active (Saved, Applied, Screening, Interviewing, Offer) / Closed (Accepted, Rejected, Withdrawn, Ghosted) / any single status.
- **Search:** matches company, title, location, and notes.
- **Row content:** company, title, status chip, date applied, resume name, and a link icon that opens the posting.



### 4.5 Duplicate warning

On save, the extension checks for an existing application with the same **normalized URL**, or the same **company + title** (case-, whitespace- and Unicode-form-insensitive). The company + title check runs only when a title is present; matching on company alone would flag every second role at the same employer. Soft-deleted applications and the record being edited never count. If one exists, a non-blocking warning offers "View existing" or "Save anyway".

URL normalization lowercases the host, strips `utm_*`, `ref`, `refId`, `trk`, `trackingId`, `gh_src` (matched case-insensitively), fragments, and trailing slashes, and keeps the query parameters that identify the job (for example `currentJobId`, `jk`, `gh_jid`). It also treats `http` and `https` as the same (unless the URL has an explicit port, which makes them different addresses), drops default ports, and sorts the remaining parameters so their order doesn't matter. A fragment used for routing (`#/jobs/123`, `#!/job/5`) is kept, because hash-routed careers sites put the job there; other fragments are dropped. Unknown parameters are kept, since they may identify the job. Known limitation: a LinkedIn search URL keeps its `keywords`, so the same `currentJobId` reached from two searches doesn't match by URL; it can still match by company + title.

### 4.6 Resume library

- The **Resumes** tab lets the user upload a resume (PDF, DOCX, DOC, TXT, or RTF, up to 10 MB), give it a display name such as "Backend v3", and add an optional note.
- The file is stored as a Blob in IndexedDB.
- Each application references a resume by ID through a dropdown. The form also includes "Upload new…" so a resume can be added mid-flow.
- **View:** PDFs open in a new extension tab via a blob URL. Other formats download.
- **Delete:** if any applications use the resume, it is **archived** instead: hidden from the dropdown, but still viewable from those applications. Hard delete is allowed only when nothing references it.
- Each application also stores a snapshot of the resume's display name, so the name still shows even if the file is gone, for example after a partial import.



### 4.7 Stats

This is a side-panel tab.

- **Range picker:** This week (default), Last 7 days, This month, Last 30 days, This year, All time, Custom.
- **Headline cards:**
  - **Applied:** applications whose `appliedAt` falls in the range.
  - **Interviews:** applications that first entered Interviewing during the range.
  - **Offers:** applications that first entered Offer during the range.
  - **Response rate:** of the applications applied in the range, the percentage that moved past Applied to Screening, Interviewing, Offer, Accepted, or Rejected.
  - **Interview rate:** of the applications applied in the range, the percentage that reached Interviewing.
- **Outcomes breakdown:** a stacked bar of how applications in the range currently stand, with Rejected as one segment. It is labeled neutrally ("Closed – not selected") and never shown as a headline number.
- **Activity chart:** applications per day (week or month range) or per week (year or all-time range).
- **Weekly goal (optional):** the user sets N per week in Settings. A progress ring shows this week's count against N. Weeks start on the locale's first day of the week, which can be overridden in Settings.
- **Tone:** copy stays factual and encouraging. Rejections are never highlighted in red.



### 4.8 Settings

- Weekly goal (off, or a number).
- First day of the week.
- Theme: System (default), Light, or Dark.
- Export / Import (§6).
- "Delete all data", with typed confirmation.
- A link to the privacy policy.



## 5. Data model

All records use UUIDv4 IDs and `createdAt` / `updatedAt` timestamps (ISO 8601 UTC), and deletes are soft (`deletedAt`). This keeps the data ready for sync later. Deleting an application takes effect immediately and shows an Undo toast for about 5 seconds; Undo clears `deletedAt` and moves `updatedAt` forward, so with last-write-wins sync the restore is the newest change.

```ts
type Status =
  | 'saved' | 'applied' | 'screening' | 'interviewing'
  | 'offer' | 'accepted' | 'rejected' | 'withdrawn' | 'ghosted';

interface Application {
  id: string;
  url: string;                 // required
  urlNormalized: string;       // for duplicate detection (indexed)
  companyTitleKey?: string;    // normalized company + title (indexed); absent without a title
  company: string;             // required
  title?: string;              // optional
  resumeId?: string;           // FK → Resume
  resumeNameSnapshot?: string; // display name at time of linking
  status: Status;              // current status
  statusHistory: { status: Status; at: string }[]; // append-only; editable dates
  appliedAt?: string;          // date (YYYY-MM-DD); defaults to today when status ≥ applied
  location?: string;
  workMode?: 'remote' | 'hybrid' | 'onsite';
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;     // ISO 4217, default from locale
  salaryPeriod?: 'year' | 'month' | 'hour';
  source?: string;             // free text with suggestions: LinkedIn, Indeed, Company site, Referral, Recruiter, Other
  notes?: string;              // plain text, shown with line breaks
  createdAt: string; updatedAt: string; deletedAt?: string;
}

interface Resume {
  id: string;
  name: string;                // display name
  fileName: string;            // original file name
  mimeType: string;
  size: number;
  blob: Blob;                  // stored in IndexedDB
  note?: string;
  archived: boolean;
  createdAt: string; updatedAt: string; deletedAt?: string;
}

interface Settings {
  weeklyGoal?: number;
  weekStartsOn: 0 | 1 | 6;     // default from locale
  theme: 'system' | 'light' | 'dark';
  schemaVersion: number;
}
```

**Other field rules:** Date applied is the user's local calendar date, required while the status is Applied or later, and can't be in the future. Salary min and max are optional numbers typed in the user's locale (`85,000` in en-US, `85.000` in de-DE, `85 000` in fr-FR, `8,50,000` in en-IN), with up to 2 decimals. A separator followed by exactly 3 digits always means thousands, so ambiguous input such as `85.000` in en-US is rejected rather than stored as 85. Either may be given alone, and min can't exceed max. The currency defaults from the locale's region (for example GBP for `en-GB`, EUR for `de-DE`, USD when unknown) and is stored only when a salary is entered, as is the period (default per year). Location is capped at 200 characters, source at 100, and notes at 10,000 (counted as characters, so an emoji counts as one). Notes are shown as plain text with line breaks; markdown isn't rendered in v1.

**Required fields:** `url` and `company`, both trimmed, and whitespace-only counts as empty. `url` must be `http:` or `https:`, and a URL typed without a scheme gets `https://`. `appliedAt` is the user's local calendar date, not the UTC date. A `resumeId` is strongly encouraged: the form shows a gentle prompt when it is empty, but it does not block saving.

**Status rules:** any status can move to any other status (users make mistakes and processes vary). Choosing Applied when `appliedAt` is empty sets it to today.

## 6. Storage, export & import

- **IndexedDB via Dexie** holds Applications and Resumes. Indexes cover `urlNormalized`, `status`, `appliedAt`, `updatedAt`, and `companyTitleKey`. `companyTitleKey` is a derived field (normalized company and title) rather than a `[company+title]` compound index, because a compound index can't match case- and whitespace-insensitively, and Dexie leaves rows without a title out of it.
- `chrome.storage.local` holds Settings, and `chrome.storage.session` holds the transient capture draft.
- The `unlimitedStorage` permission is requested because resume files add up.
- **Migrations:** versioned Dexie schema (`schemaVersion`).

**Export**

- **JSON (full backup):** all applications, resumes (files base64-encoded), and settings. The file is named `job-log-backup-YYYY-MM-DD.json`.
- **CSV (applications only):** one row per application, with the resume name rather than the file, for use in spreadsheets.

**Import**

- **JSON:** the user chooses **Merge** (match by `id`, newest `updatedAt` wins) or **Replace all** (with confirmation).
- **CSV:** the expected headers match the CSV export format, and a downloadable template is provided. Rows are validated, and the user sees a preview before committing. Unknown statuses map to Applied, with a warning.

Since the data is local only, the UI should nudge users to export a backup now and then. A subtle "Last backup: N days ago" line in Settings is enough; this is not a reminder system.

## 7. Page extraction (generic)

The extractor runs only on user gesture, via `activeTab` and `scripting`. It is one self-contained function injected into the page that returns `{ url, title?, company?, location?, workMode?, salary? }`. It tries sources in priority order:

1. **JSON-LD** `JobPosting`**:** `title`, `hiringOrganization.name`, `jobLocation` / `jobLocationType` (`TELECOMMUTE` means remote), and `baseSalary`.
2. **Microdata** `itemtype=…/JobPosting`**.**
3. **Open Graph / meta:** `og:title`, `og:site_name`.
4. **Heuristics:** the first `<h1>` for the title. The company comes from patterns in `document.title` ("Title at Company", "Title - Company | Site"), or else from the hostname for ATS subdomains such as `boards.greenhouse.io/{company}`, `jobs.lever.co/{company}`, `{company}.myworkdayjobs.com`, and `jobs.ashbyhq.com/{company}`. This handles common URL shapes generically, not with per-site scrapers.
5. **Selection:** if the user has text selected, it is offered as a suggested title.

`url` is always the tab URL, or the canonical `<link rel=canonical>` when it exists on the same site. Extraction must never throw. Missing fields just stay blank, and the user always reviews the form before saving.

## 8. Permissions & Chrome Web Store


| Permission         | Why (store justification)                                                                |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `sidePanel`        | The extension's entire UI lives in the side panel next to the job posting.               |
| `storage`          | Saves settings and the in-progress form draft locally.                                   |
| `unlimitedStorage` | Stores the user's uploaded resume files locally in IndexedDB.                            |
| `contextMenus`     | Provides the "Add job to Job Log" right-click action.                                    |
| `activeTab`        | Reads the current job page **only when the user clicks "Add job"**, to prefill the form. |
| `scripting`        | Runs the one-off extractor in the active tab after that user gesture.                    |


- **No host permissions, no** `tabs` **permission, no remote code, no network requests.**
- **Minimum Chrome version: 116.** `chrome.sidePanel` arrived in 114 and `setPanelBehavior` in 116.
- **Single purpose statement:** "Track the job applications you submit."
- **Privacy policy:** required. It states that all data stays on the device, nothing is collected or transmitted, and no analytics are used.
- **Store assets:** screenshots of the list, add form, stats, and resumes, plus a 440×280 promo tile.

**Verified Chrome behavior** (M1, Chrome for Testing via Playwright with the production build; see `e2e/page-access.spec.ts`):

- Without a user gesture, `scripting.executeScript` on a normal page fails with "Cannot access contents of the page". The extension has no ambient page access.
- A click on a button inside the side panel is a user activation in the panel only. It does **not** grant `activeTab`, so the panel still can't read any tab.
- Clicking the toolbar icon while `openPanelOnActionClick` is on opens the side panel but does **not** grant `activeTab`. The toolbar icon therefore can't prefill; capture goes through the context menu or shortcut.
- Once a gesture grants `activeTab`, the serialized extractor runs in the tab and returns its URL and title.
- `chrome://` pages stay unreadable even with `activeTab`, so the form falls back to blank.
- `sidePanel.open()` works from the page and link context-menu handlers and from the `Alt+Shift+J` command handler. The panel opens with the capture prefilled, and restricted pages fall back as described in §4.1. Verified manually by the owner on the production build (M1, 2026-10-16). Chrome documents that `open()` must run while the gesture is active, so it is called before any `await`. Unit tests (`tests/background.test.ts`) enforce that order; the manual check didn't test a broken order.

**Known limitation:** a button *inside* the side panel does not grant `activeTab`, so the blank manual form cannot read the current tab. Page prefill happens only through the context menu or the shortcut, and the side panel's empty state should explain this ("Tip: right-click any job posting → Add job to Job Log").

## 9. Tech stack & project layout

- **WXT** (Manifest V3 framework): dev server with hot reload, cross-entry bundling, and `wxt zip` for store uploads.
- **React 18 + TypeScript (strict).**
- **Dexie** for IndexedDB, with `dexie-react-hooks` for live queries.
- **Tailwind CSS**, with a dark theme via the `class` strategy and support for `prefers-color-scheme`.
- **Charts:** a lightweight library such as Recharts, or hand-rolled SVG if bundle size matters.
- **Testing:** Vitest + React Testing Library for unit and component tests, `fake-indexeddb` for database tests, and Playwright with a persistent context loading the unpacked extension for end-to-end tests.
- **Lint/format:** ESLint + Prettier.

```
entrypoints/
  background.ts          # context menus, commands, extraction, open side panel
  sidepanel/             # React app (index.html, main.tsx, App.tsx)
  resume-viewer/         # extension page to view a resume blob
lib/
  db.ts                  # Dexie schema + migrations
  extract.ts             # injected page extractor (pure function)
  normalizeUrl.ts
  stats.ts               # pure stat calculations
  exportImport.ts
components/              # StatusChip, ApplicationForm, ResumePicker, StatCard, …
```



## 10. Quality bar & acceptance criteria

- **Speed:** adding a prefilled application takes 3 interactions or fewer after the right-click (review, pick resume, save).
- **Performance:** the side panel loads in under 300 ms with 1,000 applications, and the list is virtualized past about 200 rows.
- **Accessibility:** fully usable by keyboard, chips and picker have ARIA roles, contrast meets WCAG AA in both themes, and focus returns to the list after the form closes.
- **Data safety:** a status change can be undone, an application delete can be undone (soft delete), and every destructive bulk action asks for confirmation.
- **Round trip:** exporting JSON, then importing with Replace on a fresh profile, yields identical data, including resume files that open correctly.
- **Tests:** unit tests cover `extract.ts` (JSON-LD, meta, ATS URL patterns, and garbage pages), `normalizeUrl.ts`, and `stats.ts` (range boundaries, week start, "first entered" semantics).



## 11. Future (post-v1) roadmap

1. **Follow-up reminders:** a "needs follow-up" badge or filter, then opt-in Chrome notifications (`alarms` + `notifications`).
2. **Paid tier:** cloud sync and multi-device support. The UUIDs, timestamps, and soft deletes are already in place for this.
3. Site-specific extractors for the biggest boards, if generic extraction proves too weak.
4. Contacts per application (recruiter, interviewer), and interview scheduling.
5. Kanban board in a full-page dashboard tab.
6. Firefox/Edge builds (WXT supports both).



## 12. Open questions

- **Product name and icon:** "Job Log" is a working title, and store name availability needs checking.
- **Charts:** Recharts versus custom SVG, to be decided after measuring bundle size.
- **"Ghosted" status:** whether it should ever be suggested automatically, which is related to reminders and deferred.
- **Saved jobs and stats:** whether jobs saved but never applied to should appear in stats (currently excluded from "Applied").

