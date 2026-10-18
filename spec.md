# Huntlog — Product Spec (v1)

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
| **Side panel** (primary UI) | All app screens: Applications list, Add/Edit form, Stats, Resumes, Settings. A header (the name and a Settings gear) and a tab bar at the top. |
| **Context menu**            | "Add job to Huntlog" on any page (reads the page), and "Add linked job to Huntlog" on links (captures only the link URL). |
| **Keyboard shortcut**       | `Alt+Shift+J` (user-configurable) works the same as the page context-menu item.                     |
| **Toolbar icon**            | Opens the side panel (`openPanelOnActionClick`).                                                    |


The side panel is roughly 320–400 px wide, so every screen is designed mobile-first for that width.

**Header:** the product name on the left and a **Settings** gear button on the right. Settings opens as a near-full-height sheet over the current tab (§4.8). A capture closes it, like any sheet the capture leaves behind; a delete or reset still running then reports its outcome in a toast.

**Tab bar:** under the header, with Applications, Stats and Resumes, each an icon beside its label in one row. Switching tabs slides the next section into view like a mobile tab switcher (instant when the user prefers reduced motion). Each tab keeps its state, including its scroll position, while another is shown; a capture always switches to Applications, where its form opens. Arrow keys, Home and End move between tabs.

**Look and shared patterns** (decided in the M6 UI review):
- The look follows shadcn/ui: zinc neutrals with a near-black primary (near-white in dark), subtle borders and rounded cards. It's built by hand; no UI library is installed, to keep the panel small.
- **Sheets:** focused tasks (Add/Edit, changing a status, filters, uploads, renames and confirmations) open in a bottom sheet that slides up over the current screen. Escape or the sheet's back/close button closes it. **⌘+Enter** (Ctrl+Enter on Windows and Linux; either works everywhere) presses the sheet's main button from any control in it, including Notes and a closed select: Save, Apply, Upload or Set date. It never presses a destructive button (Delete all data, Reset settings), and a control that uses Enter itself (an open dropdown list, the inline resume upload) gets it first.
  - **Sheets without typing** (status, filters, menus) also close on a click outside them.
  - **Sheets that hold typing** (Add/Edit, upload, rename, typed confirmations) don't close on an outside click, and leaving one with unsaved changes asks before discarding them. A capture is the exception (§4.1).
- **Floating button:** the Applications and Resumes tabs have a floating action button at the bottom right (**+ Add**, **+ Upload**). Toasts sit above it.
- **Discarding changes** asks in a small dialog centered over the sheet ("Discard your changes?", with Keep editing and Discard), with focus inside it.
- **Selects** are shadcn-style: a button showing the choice that opens a list of options (keyboard: arrows, Home/End, typing a letter, Enter, Escape), not the browser's native select. Long lists (currency, resume) are searchable dropdowns.
- **Number fields** accept only what a number in the user's locale can contain: digits, plus for amounts the locale's grouping and decimal separators (other characters are dropped as typed or pasted, so a pasted "$85,000" becomes "85,000"). The salary parsing rules in §5 still apply on top (decimals, rejecting ambiguous separators). Not `type="number"`, which takes "e", changes on scroll, and can't show grouping. Amounts are shown with the locale's grouping once the field is left; small counts such as the weekly goal have − and + buttons.
- **Scrollbars** are hidden everywhere; areas still scroll by wheel, touch and keyboard (a scroll area with nothing focusable inside is itself focusable). Where hidden content would otherwise go unnoticed, such as the Stats range chips, the overflowing edge fades out to show there's more.
- **Accordions** (More details, Archived resumes) animate their height open and closed, clipping their content, with no fade, at the same speed and easing both ways. The content opens inside the same section as its row, and the row has no line of its own under it.
- **Destructive buttons** (Delete all data, Discard, Reset and delete everything) use shadcn's destructive variant: a solid red with white text (in dark mode, the red at 60% over the page).
- **Toasts** have their message on the left and their action and close button grouped tightly on the right. They slide in and out. While a sheet is open, a toast shows inside it, at its bottom above its content, so it stays visible and usable; a sheet makes the rest of the panel inert.

## 4. Core flows



### 4.1 Add application: prefilled from a page (user-initiated)

1. On a job posting, the user right-clicks and chooses **"Add job to Huntlog"**, or presses the shortcut.
2. That gesture grants `activeTab`. The background service worker first calls `chrome.sidePanel.open` for the tab's window, synchronously inside the gesture handler (before any `await`), then runs a one-off extractor in the tab with `chrome.scripting.executeScript`.
3. The extraction result is saved as a draft in `chrome.storage.session` under a per-window key (`captureDraft:<windowId>`), because each window has its own side panel. The panel may open before the draft is written, so it reads its window's draft on load and also listens for changes. It consumes (deletes) the draft, and ignores drafts older than 5 minutes so a capture whose panel never opened can't prefill a later session. If the page can't be read (restricted page, tab gone), the draft holds only the tab URL when it is `http(s)`, and the form otherwise opens blank. A new capture replaces whatever is in the Add form without asking, since the capture itself is the user's explicit request. While an existing application is being edited, the capture waits instead (a toast says so) and opens once the edit closes: saved, or left with Back or Escape (after confirming any discard). If the user cancels the discard prompt, Edit stays open and the capture keeps waiting, so unsaved edits are never discarded.
4. The side panel shows the Add form prefilled with the draft. Prefilled fields get a subtle "auto-filled, please check" hint.
   - **Source from the address:** when the job's address is on a well-known job board's own domain (any country: `linkedin.com`, `uk.indeed.com`, `indeed.co.uk`, `glassdoor.ca`), Source is set to that board: LinkedIn or Indeed (chips), or Glassdoor, ZipRecruiter, Wellfound, Dice or Monster (in Other). Company sites, ATSs and unknown sites leave it empty; a capture never uses the remembered source. It's a guess, so it carries the auto-filled hint, and More details stays shut (its row shows the source).
   - **Resume:** the form starts with the last-used resume, like a manual Add (§4.2), the one most likely sent again. The form waits briefly for the remembered defaults (at most 300 ms after the capture arrives), so a capture never hangs on them. Changes to the defaults while a form is open never touch it.
5. The user reviews the fields, changes the resume if needed, and saves. If a duplicate is detected, a warning appears (§4.5).

**From a link:** right-clicking a job link (for example in a search results list) and choosing "Add linked job to Huntlog" captures only `linkUrl`, with no page read. The form opens with the link filled in, Source told by the link's address and the last-used resume as above, and the other fields blank.

### 4.2 Add application: manual

1. In the side panel, the user taps the floating **+ Add** button (an empty list also shows a full-size "Add your first application" button).
2. The form opens blank in a sheet, with **Date applied** defaulting to today and **Status** defaulting to Applied.
3. The user fills in the fields and saves.

**Form layout** (Add and Edit), designed so the common case fits a 320px panel without scrolling. The form is a near-full-height sheet with a back button and the title in its header:

- **Top section:** Company, Job title, Job posting URL, then Status and Date applied side by side on one row (Status takes the row when Date applied is hidden for Saved), then Resume. Required fields are marked with an asterisk, explained by a "Fields marked * are required." note; Date applied's asterisk follows the status. Optional fields have just their label (no "(optional)").
- **Resume** is a searchable dropdown (a combobox: type to filter, each option shows its name, plus format and upload date where names repeat), with "No resume" first. A ghost **+** icon button beside it opens the inline upload; while it's open the icon turns (animated) into a **−** that closes it. The inline upload's button says **Upload**, and it has no separate Cancel.
- **More details**, an accordion row that is collapsed by default and animates open and closed: Location, Work mode, Salary, Source, Notes. Its row hints at what's inside ("Location, work mode, salary, source, notes"), or once anything inside is filled in, what is ("Remote · Salary"); the hint stays on the row whether it's open or closed. It opens on its own when a field inside has a validation error or was auto-filled by a capture, and in Edit when any field inside has a value.
- **Salary** shows a dash between the min and max fields, both number fields (§3). Currency is a searchable dropdown (the owner's choice over a datalist, since Chrome draws a datalist unstyled and can't put common currencies first), and Per (year, month, hour), Work mode and Status are selects (§3).
- **Source** is a row of chips: LinkedIn, Indeed, Company site, Referral, Recruiter, and **Other**, which reveals a text field for any other source.
- **Notes** starts three lines tall and grows with its text, up to about twelve lines, then scrolls. It can't be resized by hand.
- **Save** is a full-width button that stays visible at the bottom of the sheet (a sticky bar), however long the form is. It shows the ⌘+Enter shortcut (§3) on its right. Leaving is the header's back button (or Escape); with unsaved changes it first asks to discard them. Clicking outside the sheet doesn't close it.
- **Currency** lists the locale's default plus USD, EUR and GBP first, then every other code.
- **Remembered defaults:** so a run of similar applications is quick to log, a new manual Add starts with the source, work mode and resume of the last *new* application (edits don't count), stored in `chrome.storage.local`. A capture uses only the resume (its source comes from the address, §4.1). The resume is preselected only while the picker still offers it (not archived or deleted since); otherwise the field starts empty. After a manual Add they're remembered exactly, blanks included. After a capture, its resume is remembered exactly (its form showed the remembered one, so clearing it means "none"), but only a source or work mode it has replaces the old one, since its form never showed those, so their blanks don't mean "none". They never prefill Edit.



### 4.3 Update status

- Every row in the Applications list shows a **status chip**. Tapping it opens a sheet listing all statuses, with the current one checked. One tap changes the status, appends a history entry with the timestamp, and shows an **Undo** toast for about 5 seconds. Undo restores the application as it was before the tap, removing the entry it added, so a mis-tap never counts in stats; it only works if nothing has changed the application since.
- **Leaving Saved without a Date applied:** moving to Applied sets Date applied to today with no extra step. Moving to Screening, Interviewing, Offer, Accepted, Rejected or Ghosted means an application happened, so the sheet asks "When did you apply?" (default today) with **Set date** and **Skip**; Skip leaves it empty. Moving to Withdrawn doesn't ask. This is the one case where a status change takes a second interaction; it exists because Date applied drives the Applied count and the response and interview rates (§4.7).
- The detail view shows the full status timeline as a vertical stepper, and each entry's date can be edited (for example, to backfill an interview date). Stats count each stage on the day it was first reached (§4.7), so without this, a status logged late or entered when starting mid-search would land on the wrong day or week. Dates are read-only until the entry's pencil button opens a date field with explicit Save and Cancel (Enter saves); nothing is saved just by picking a date. Save (✓) and Cancel (×) are ghost icon buttons grouped together, set apart from the field.

**Detail view:** a full page that slides in from the right. Its header has a back button (Escape does the same, once any open menu or date editor has closed), the company, an Edit button (the square-pen icon), and a ⋯ menu holding Delete. The job posting opens from a full-width button that names its site (for example `boards.greenhouse.io ↗`).



### 4.4 Browse & find

- **Search** sits above the list, with a filter button beside it. It matches company, title, location, and notes, ignoring case and accents; every word typed must appear (in any of those fields). Characters such as `C++` or `.NET` match literally. The list filters once typing pauses (a quarter of a second), not on every keystroke, so it isn't re-sorted and re-frozen per character; clearing the search applies at once. The same goes for the Resumes search.
- **The filter button** opens a sheet with sort, a date range and status filters. Changes apply only when the user taps **Apply**; closing the sheet any other way discards them, and **Reset** clears the sheet's choices (still to be applied). The button is a ghost icon button. The button shows a count of active filters: one for a date range other than Any time, plus one for a status filter (whatever chips are on). Sort is never counted. Whenever search or filters hide rows, the list shows "Showing N of M" with a way to clear them.
  - **Sort:** last activity (default, newest first), date applied, or company, as a segmented choice whose selection marker slides between options.
  - **Date applied:** Any time (default), This week, This month, Last 30 days, or Custom, with the same boundaries as the Stats ranges (§4.7). A job without a Date applied is hidden while a date range is set.
  - **Status:** a wrapping list of chips, one per status, any number of which can be on. **Active** (Saved, Applied, Screening, Interviewing, Offer) and **Closed** (Accepted, Rejected, Withdrawn, Ghosted) chips turn on their whole group. With no status chip on, every status shows.
- Search, filters and sort are kept while the user opens an application and comes back. While the list is on screen, a row whose status changes keeps its place and stays visible, even if it no longer matches the status filter, so it never jumps or vanishes from under the pointer. Order and membership refresh when the search, filters or sort change or the list is shown again; new applications appear at the top, newest first.
- **Row layout:**
  - **Header line:** the company and the status chip. A long company name is cut off with an ellipsis, and hovering shows it in full.
  - **Below,** on the left: location and work mode, then the job title, then "Applied Oct 1, 2026" ("Added …", from when it was logged, for a job without a Date applied). Lines with nothing to show are left out. This column stops short of the link icon (space between them, and a gap), so long text doesn't run up against it.
  - **On the right of those lines:** a link icon that opens the posting.
  - **The whole card** opens the application, apart from the chip and the link icon, which keep their own actions.
- **Dates** are shown in the user's locale format (e.g. "Oct 1, 2026"), here and in the detail view. The resume isn't on the row; the detail view shows it.



### 4.5 Duplicate warning

On save, the extension checks for an existing application with the same **normalized URL**, or the same **company + title** (case-, whitespace- and Unicode-form-insensitive). The company + title check runs only when a title is present; matching on company alone would flag every second role at the same employer. Soft-deleted applications and the record being edited never count. If one exists, a non-blocking warning names the newest match (company, title, date applied), says why it matched ("Same job posting URL" or "Same company and title"), counts any further matches, and offers "View existing" (opens that application and discards the new entry) or "Save anyway". Changing the URL, company or title clears the warning. The same check runs when editing, ignoring the application being edited, and only if the edit changes the URL, company or title, so a job kept with "Save anyway" doesn't warn on every later edit. When editing, the button reads "Discard changes and view existing".

URL normalization lowercases the host, strips `utm_*`, `ref`, `refId`, `trk`, `trackingId`, `gh_src` (matched case-insensitively), fragments, and trailing slashes, and keeps the query parameters that identify the job (for example `currentJobId`, `jk`, `gh_jid`). It also treats `http` and `https` as the same (unless the URL has an explicit port, which makes them different addresses), drops default ports, and sorts the remaining parameters so their order doesn't matter. A fragment used for routing (`#/jobs/123`, `#!/job/5`) is kept, because hash-routed careers sites put the job there; other fragments are dropped. Unknown parameters are kept, since they may identify the job. Known limitation: a LinkedIn search URL keeps its `keywords`, so the same `currentJobId` reached from two searches doesn't match by URL; it can still match by company + title.

### 4.6 Resume library

- The **Resumes** tab lets the user upload a resume (PDF, DOCX, DOC, TXT, or RTF, up to 10 MB), give it a display name (e.g. "John_Doe_Resume"), and add an optional note. Its floating **+ Upload** button opens the upload in a sheet.
- **Uploader** (the same one in the sheet and in the application form): a dashed drop zone ("Choose a file or drag it here"), clickable as a whole, with a visible **Choose file** link button (the zone itself names the field, so there's no separate label). Its name field's placeholder is a generic file name ("e.g. John_Doe_Resume"), not a job title, since the product is for every kind of job hunter. Upload is full width. Once a file is picked, it shows the file's name, format and size, with **Change file**. Dropping more than one file is refused. A file dropped anywhere else in the panel is ignored rather than opened.
- **List:** a search box above the list matches display names and original file names (every word, ignoring case and accents), in the archived list too. Tapping a row opens or downloads the resume. Each row shows a file icon, the name, its format and size, and its upload date on its own line, and has a vertical ⋮ menu button (no background or hover fill) with Rename, Archive or Unarchive, and Delete. Rename edits the name and note in a sheet.
- The file is stored as a Blob in IndexedDB.
- Each application references a resume by ID through a searchable dropdown (§4.2). Next to it, a **+** ("Upload new resume") button opens a compact upload in the form, so a resume can be added mid-flow; it's saved and selected. (A button rather than a dropdown option, so arrowing through the options never opens an upload.)
- **View:** PDFs open in a new extension tab via a blob URL. Other formats download.
- **Accepted files:** the extension picks the format (PDF, DOCX, DOC, TXT or RTF) and the file's first bytes must match it (e.g. a PDF starts with `%PDF`). The type the browser reports is ignored, since it varies by system (a `.docx` can arrive as `application/zip`). The 10 MB limit applies to the bytes actually read.
- **Delete:** if any applications use the resume (including one deleted within the last minute, which its Undo can still bring back), it is **archived** instead: hidden from the dropdown, but still viewable from those applications. Otherwise it's deleted with an Undo toast for about 5 seconds; after that its file is removed to reclaim storage, and only a small record remains (soft delete, for future sync). If the panel closes first, a later launch removes the files of resumes deleted more than a day ago (not sooner: another window may still show that delete's Undo).
- **Archived resumes** are listed in a collapsed "Archived (N)" accordion at the bottom of the Resumes tab, with **Unarchive**.
- **Same name twice** is allowed (e.g. "Backend v3" as PDF and DOCX). Where names repeat, the dropdown also shows each one's format and upload date.
- **Rename** changes the name everywhere: applications show the resume's current name, and use `resumeNameSnapshot` only when the resume itself is gone.
- Each application also stores a snapshot of the resume's display name, so the name still shows even if the file is gone, for example after a partial import.



### 4.7 Stats

This is a side-panel tab.

- **Range picker:** a scrolling row of chips (the chosen one is scrolled back into view whenever the tab is shown again): This week (default), Last 7 days, This month, Last 30 days, This year, All time, Custom (whose From and To open in a sheet).
  - The row is one Tab stop; the arrow keys, Home and End move between chips without changing the range, and Enter, Space or a tap picks one, so the keyboard never opens the Custom sheet by passing over it.
  - The Custom sheet opens on the dates last applied (the last 30 days the first time) and changes the range only on Apply; closing it any other way keeps the range that was showing. Dates entered the wrong way round are swapped, and an empty or out-of-bounds date is flagged on Apply.
  - This week, This month and This year are whole calendar periods, so the chart shows the days still ahead. Last 7 and Last 30 days end today. All time runs from the first date logged (a Date applied or a status entry) to today. Custom is a From and To date, both included, from 1970 up to today.
  - Every count uses local calendar dates: a status entry counts on the local day of its timestamp.
- **Headline cards:**
  - **Applied:** applications whose `appliedAt` falls in the range.
  - **Interviews:** applications that first entered Interviewing during the range. A job moved straight to Offer or Accepted had interviews too, so the interview stage starts at the first of Interviewing, Offer or Accepted; this keeps Interviews and the interview rate in agreement.
  - **Offers:** applications that first entered Offer during the range, or Accepted if they skipped Offer.
  - **Response rate:** of the applications applied in the range, the percentage that moved past Applied to Screening, Interviewing, Offer, Accepted, or Rejected.
  - **Interview rate:** of the applications applied in the range, the percentage that reached Interviewing, or Offer or Accepted (which only come after interviews).
  - Both rates count a stage reached at any time, even after the range ends, so a recent range isn't stuck at 0%. Ghosted and Withdrawn aren't responses. With nothing applied in the range, a rate shows "—" rather than 0%, and each rate shows its counts ("4 of 12").
  - A job without a Date applied (the user pressed Skip) isn't counted in Applied or the rates, but its interviews and offers still count.
- **Charts** each sit in a card with a title and a one-line summary.
- **Outcomes breakdown:** a stacked bar of how applications in the range currently stand, with Rejected as one segment. It is labeled neutrally ("Closed – not selected") and never shown as a headline number.
- **Activity chart:** applications per day (week or month range) or per week (year or all-time range), by Date applied. Any range up to 31 days long is shown per day, up to 53 weeks per week (weeks start on the user's first day of the week), up to 5 years per month, and longer ones per year, so a long Custom or All time range still has bars wide enough to see.
- **Weekly goal (optional):** the user sets N per week in Settings (1 to 200). The first card under the range picker is then the **weekly application goal** card, about this calendar week whatever range is picked: the label "Weekly application goal", this week's Applied count large with "applications submitted this week" ("1 application submitted this week" for one), so it isn't read as the range's, a five-segment bar filling toward N (blue), and a bottom line with the goal and how it's going: "Goal: 5 applications · 2 more applications to reach your goal", "· Weekly goal complete" at exactly N, or "· 7 above your goal" past it. From N on, the bar is full and green (never past full), a small green check sits top right, and "You've reached your goal!" shows under the count; the count keeps going past N. The range's **Applied** count then joins Interviews and Offers as three small cards. Weeks start on the locale's first day of the week, which can be overridden in Settings. Without a goal, the first card is the range's Applied count, laid out the same way (label, the number large with "applications submitted"), with a quiet line pointing to the goal setting; Interviews and Offers follow as two cards.
- **Tone:** copy stays factual and encouraging. Rejections are never highlighted in red.



### 4.8 Settings

Opened from the gear in the header as a near-full-height sheet of grouped cards. Changes save as they're made and apply in every open window.

- **Weekly goal:** off, or a number from 1 to 200 (a number field with − and +). The switch turns the goal on (at 5) and off; − stops at 1 and + at 200 (each disabled there), so the buttons never turn it off or store an invalid value.
- **Display:**
  - **Theme:** System (default), Light, or Dark, as a three-way segmented control.
  - **First day of the week:** the locale's default (named, e.g. "Locale default (Monday)"), Sunday, Monday, or Saturday.
- **Your data:**
  - **Export backup**, **Export CSV** and **Import…** (§6), with the "Last backup" line.
  - **Delete all data** (a solid destructive button)**:** permanently deletes every application and resume (with its file), and the remembered form defaults. Settings stay. The user must type `DELETE` before the button works.
  - **Reset settings:** puts the weekly goal, first day of the week and theme back to their defaults, after a confirmation. It has an "Also delete all my data" checkbox, off by default. Ticking it adds the same typed `DELETE` confirmation and changes the button to "Reset and delete everything". Unticking clears what was typed.
- **About:** a link to the privacy policy (a page bundled with the extension), a link to the third-party notices (font and icon licenses), and the version.



## 5. Data model

All records use UUIDv4 IDs and `createdAt` / `updatedAt` timestamps (ISO 8601 UTC), and deletes are soft (`deletedAt`). This keeps the data ready for sync later. The one exception is **Delete all data** (§4.8), which permanently removes every application and resume (settings stay): it is a privacy promise, and no sync exists to need tombstones. Deleting an application takes effect immediately and shows an Undo toast for about 5 seconds; Undo clears `deletedAt` and moves `updatedAt` forward, so with last-write-wins sync the restore is the newest change.

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
  // The file's bytes live in a separate ResumeFile { id, data: ArrayBuffer } record, so listing
  // resumes never loads files; it's removed once a deleted resume's Undo window passes.
  note?: string;
  archived: boolean;
  createdAt: string; updatedAt: string; deletedAt?: string;
}

interface Settings {
  weeklyGoal?: number;         // 1–200; absent = off
  weekStartsOn?: 0 | 1 | 6;    // absent = follow the locale (so a later language change is followed)
  theme: 'system' | 'light' | 'dark';
  schemaVersion: number;
}
```

**Other field rules:** Date applied is the user's local calendar date, required unless the status is Saved or Withdrawn (a job can be withdrawn before applying), and can't be in the future. For a Saved job the form hides it and stores none. Salary min and max are optional numbers typed in the user's locale (`85,000` in en-US, `85.000` in de-DE, `85 000` in fr-FR, `8,50,000` in en-IN), with up to 2 decimals. A separator followed by exactly 3 digits always means thousands, so ambiguous input such as `85.000` in en-US is rejected rather than stored as 85. Either may be given alone, and min can't exceed max. The currency defaults from the locale's region (for example GBP for `en-GB`, EUR for `de-DE`, USD when unknown) and is stored only when a salary is entered, as is the period (default per year). Location is capped at 200 characters, source at 100, and notes at 10,000 (counted as characters, so an emoji counts as one). Notes are shown as plain text with line breaks; markdown isn't rendered in v1.

**Required fields:** `url` and `company`, both trimmed, and whitespace-only counts as empty. `url` must be `http:` or `https:`, and a URL typed without a scheme gets `https://`. `appliedAt` is the user's local calendar date, not the UTC date. A `resumeId` is strongly encouraged: the form shows a gentle prompt when it is empty, but it does not block saving.

**Status rules:** any status can move to any other status (users make mistakes and processes vary). When `appliedAt` is empty, choosing Applied sets it to today, and choosing any other status except Saved and Withdrawn asks for it (§4.3). A stored `appliedAt` is never overwritten by a status change (including switching an existing job to Saved in Edit), and undoing a status change clears an `appliedAt` that change set. A job left without a date after Skip isn't made to get one by an unrelated edit; Date applied is only required in Edit if one is stored. The same rules apply whether the status is changed with the chip or in the Edit form.

## 6. Storage, export & import

- **IndexedDB via Dexie** holds Applications and Resumes. Application indexes cover `urlNormalized`, `status`, `appliedAt`, `updatedAt`, `companyTitleKey` and `resumeId` (to tell whether a resume is used); resumes are indexed by `createdAt` and `updatedAt`. A resume's file is stored in its own table (`resumeFiles`), as raw bytes (an `ArrayBuffer`) with its type on the resume, not a `Blob`: bytes store and round-trip everywhere (the test database loses `Blob`s), and a `Blob` is built only when the file is opened. `companyTitleKey` is a derived field (normalized company and title) rather than a `[company+title]` compound index, because a compound index can't match case- and whitespace-insensitively, and Dexie leaves rows without a title out of it.
- `chrome.storage.local` holds Settings, and `chrome.storage.session` holds the transient capture draft.
- The `unlimitedStorage` permission is requested because resume files add up.
- **Migrations:** versioned Dexie schema (`schemaVersion`).

**Export** (Settings → Your data). Files download through a link from the side panel, so no `downloads` permission is needed.

- **JSON (full backup, Export backup):** every application and resume the user still has (resume files base64-encoded) and the settings. Soft-deleted rows stay out: a backup holds what the user has, not what they deleted (except a resume deleted within its Undo window that a live application still links to, so no link points at nothing). Only the settings the user has set are included. The file is recognised by its contents (`"format": "huntlog-backup"` and a version number), not its name, and is named `huntlog-backup-YYYY-MM-DD.json` (the local date).
- **CSV (applications only, Export CSV):** one row per application, with the resume's name rather than the file, for use in spreadsheets. Its columns are fixed: Company, Job title, URL, Status, Date applied, Location, Work mode, Salary min, Salary max, Currency, Per, Source, Notes, Resume, Created, Updated. Values are plain and locale-free (statuses and work modes as their labels, numbers like `85000.5`, dates as `YYYY-MM-DD`, Created and Updated as ISO timestamps). It's UTF-8 with a byte-order mark, so Excel reads accents. A cell that starts with `=`, `+`, `-` or `@` gets a leading `'`, so a spreadsheet never runs it as a formula.

**Import** (Settings → Your data → Import…): a sheet with a drop zone that takes one JSON or CSV file, told apart by its contents.

- **JSON:** the sheet shows what the backup holds (counts and its date), then the user chooses **Merge** or **Replace all**.
  - The whole file is checked before anything changes, as strictly as typed input (web addresses must be `http(s)`, statuses, currencies and other choices must be known values, text within its limits, Date applied not in the future (a day's leeway for a backup made in a time zone ahead), the minimum salary not above the maximum, each timeline ending at its status, resume files matching their format and 10 MB or less). Any invalid record refuses the whole file, saying which; nothing is half imported. A backup from a newer version of Huntlog is refused with a message.
  - **Merge** matches by `id`: the newer `updatedAt` wins, and on a tie the stored row stays. A resume and its file go together. The settings stay as they are, since they have no `updatedAt` to compare.
  - **Replace all** asks first, naming what it replaces and with what ("your 42 applications and 3 resumes, with the 40 applications and 5 resumes in this backup"), on a destructive button. It replaces every application and resume and restores the settings from the backup. The remembered form defaults are cleared, as by Delete all data.
  - An application linking a resume that's neither in the backup nor (for Merge) already stored keeps only the resume's name, as its snapshot (§4.6), not a link to nothing.
  - A file is read whole, so one over 500 MB (the most a browser can hold as text) is refused.
- **CSV:** the headers are those of the export (in any order; a column may be left out, except Company and URL). A template with the header row only downloads from a link in the Import sheet. Rows are validated like the Add form, and the user sees a preview before committing: how many rows will be imported, which have warnings, which are skipped for errors (by spreadsheet row number, the header being row 1, with the column and the reason), which are already logged, and which columns aren't Huntlog's (their values aren't imported). The button names the count ("Import 38 applications").
  - **Already logged:** a row with the same job posting URL or company + title (§4.5) as an existing application, or as an earlier row, is skipped unless the user ticks **Import them anyway**, so importing the same file twice doesn't double everything.
  - **Unknown statuses** map to Applied, with a warning on that row. Statuses and work modes match their labels or stored values, ignoring case.
  - **A file a spreadsheet saved again** still reads: a `;` or tab separator (Excel's in many European locales) is told from the header line, Date applied may be in the locale's numeric format (`3/1/2026` in en-US, `01.03.2026` in de-DE, with any time dropped), numbers may be as exported (`85000.5`) or in the locale's format, and Created and Updated may be any date and time the browser reads. Rows are numbered as the spreadsheet shows them, blank rows included.
  - **Date applied:** a row past Saved without one stays without one (like Skip), with a note that it isn't counted in Applied or the rates, rather than getting today's date.
  - **Status history:** a CSV has no timeline, so each row gets one entry for its status, dated its Date applied (or its Created date, or the import time). Stats then count an imported interview or offer on that date.
  - **Resume:** matched by name to a resume the form's picker offers (live and not archived; the newest of that name); otherwise only its name is kept, as the snapshot.
  - Every row becomes a new application with a new `id`. Created and Updated are kept when readable (a note says when one isn't), never later than the import and never Updated before Created.
  - Importing checks "already logged" and each resume link again against what's stored at that moment, since another window may have changed things since the preview.

Since the data is local only, the UI should nudge users to export a backup now and then. A subtle "Last backup: N days ago" line in Settings, under Export backup, is enough; this is not a reminder system. It shows "never", "today", "yesterday" or "N days ago" in local calendar days, counts JSON backups only (a CSV isn't a full backup), follows exports from any window, and is kept by Delete all data and Reset settings.

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
| `contextMenus`     | Provides the "Add job to Huntlog" right-click action.                                    |
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

**Known limitation:** a button *inside* the side panel does not grant `activeTab`, so the blank manual form cannot read the current tab. Page prefill happens only through the context menu or the shortcut, and the side panel's empty state should explain this ("Tip: right-click any job posting → Add job to Huntlog").

## 9. Tech stack & project layout

- **WXT** (Manifest V3 framework): dev server with hot reload, cross-entry bundling, and `wxt zip` for store uploads.
- **React 18 + TypeScript (strict).**
- **Dexie** for IndexedDB, with `dexie-react-hooks` for live queries.
- **Tailwind CSS v4**, with design tokens as CSS variables (`assets/theme.css`, shadcn's names: `--background`, `--foreground`, `--muted`, `--primary`, `--border`, `--input`, `--ring`, `--destructive`, …) mapped to Tailwind colors (`bg-background`, `text-muted-foreground`, …). Every extension page sets `data-theme` on `<html>` to the *resolved* theme, `light` or `dark` (System resolved from `prefers-color-scheme`, and followed live), and the dark set applies under `[data-theme=dark]`. `light-dark()` isn't used because it needs Chrome 123. To avoid a flash of the wrong theme, the stored theme is mirrored to `localStorage`, and each extension page applies it before its first paint from a small separate script (`theme-init.js`) in `<head>`, since MV3's CSP forbids inline scripts. Every page refreshes the mirror whenever the setting changes, including a Reset or a change from another window. A contrast test checks every token pair for WCAG AA in both themes.
- **Look:** shadcn/ui's visual style, built by hand. No shadcn, Radix, `class-variance-authority`, `tailwind-merge`, `clsx` or `lucide-react` is installed, to keep the bundle small. A widget that's hard to make accessible by hand may justify adding a single Radix primitive, not the kit.
- **Font:** Geist, one variable `woff2` (Latin subset), bundled locally. **Icons:** Lucide SVGs (ISC license) copied into one local file. Their licenses (Geist: SIL OFL 1.1; Lucide: ISC) ship in a bundled third-party notices page, linked from Settings → About.
- **Charts:** hand-written SVG and CSS, no chart library. Decided in M5 after measuring: one Recharts 3 bar chart adds about 320 KB minified (97 KB gzipped), more than the whole side panel (about 200 KB), for two simple charts.
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
  backup.ts              # JSON backup: export, checks, merge/replace
  csv.ts                 # CSV reading and writing
components/              # StatusChip, ApplicationForm, ResumePicker, StatCard, …
```



## 10. Quality bar & acceptance criteria

- **Speed:** adding a prefilled application takes 3 interactions or fewer after the right-click (review, pick resume, save). Save is reachable without scrolling at 320px.
- **Performance:** the side panel loads in under 300 ms with 1,000 applications, and the list is virtualized past about 200 rows.
- **Accessibility:** fully usable by keyboard, chips, sheets and the resume dropdown have ARIA roles, contrast meets WCAG AA in both themes, and focus returns to the list after the form closes.
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

- **Product name and icon:** decided in the post-M6 review: **Huntlog** (it replaced the working name Job Log in v0.6.1). The Chrome Web Store's own search (`chromewebstore.google.com/search/Huntlog`) returned no results on 2026-10-17 (Huntr is a near neighbour); M9 repeats the check before submitting. The icon is a white crosshair around a check on the blue chart color, so it shows on light and dark toolbars (`assets/icon.svg`; a simpler `assets/icon-16.svg` for the 16px toolbar size; the 128px store size keeps 16px of transparent padding; rendered to `public/icon/` by `scripts/render-icons.ts`).
- **"Ghosted" status:** whether it should ever be suggested automatically, which is related to reminders and deferred.
- **Saved jobs and stats:** whether jobs saved but never applied to should appear in stats (currently excluded from "Applied").

