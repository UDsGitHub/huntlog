# Huntlog — Milestones

Each milestone is a thin vertical slice: it ships something a user can do end to end in a loaded extension, with UI, storage and tests, and it leaves the app releasable. The riskiest pieces come first: Chrome APIs whose behavior we have only assumed. Section references (§) point to `spec.md`.

---

## M0 — Walking skeleton ✅ (v0.0.0)
**Slice:** Click the toolbar icon → side panel opens → type a URL and company → Save → the job appears in a list and survives a browser restart.

- Scaffold WXT + React + TS (strict) + Tailwind, plus ESLint/Prettier, Vitest and Playwright.
- `background.ts`: `sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`.
- `lib/db.ts`: Dexie v1 schema with an `applications` table holding `id`, `url`, `company`, `status='applied'`, `statusHistory` (written from M0 so M3 needs no backfill), `appliedAt`, timestamps and `deletedAt`.
- Side panel: a minimal form with the two required fields, and a plain list underneath.
- Manifest contains only `sidePanel` and `storage`.
- **Tests:** a db unit test using `fake-indexeddb`. A Playwright smoke test loads the built extension, opens the side panel page, adds a job and sees it listed.
- **Done when:** `npm run dev` / `build` / `zip` work, CI runs lint, typecheck, unit and e2e, and the commands in CLAUDE.md are updated to match reality.

## M1 — Capture plumbing (de-risk) ✅ (v0.1.0)
**Slice:** Right-click a job page → "Add job to Huntlog" → the side panel opens with the URL and page title prefilled → Save.

- Add the `contextMenus`, `activeTab` and `scripting` permissions.
- Register the page and link context-menu items and the `Alt+Shift+J` command.
- Gesture handler: call `sidePanel.open()` first, then run `executeScript` with a stub extractor that returns only the `location.href` and `document.title` values. Write the draft to `storage.session`.
- The side panel watches `storage.session`, consumes the draft and prefills the form with an "auto-filled, please check" hint.
- Link menu: send `linkUrl` only, with no page read.
- **Verify spec assumptions and record the results in spec.md §8:**
  - (a) `sidePanel.open()` works from the context-menu and command handlers.
  - (b) It must be called before any `await`.
  - (c) A button inside the side panel does *not* grant `activeTab`.
  - (d) Behavior on restricted pages such as `chrome://` and the Web Store, where the extension falls back to an empty form.
- **Tests:** an e2e test that triggers the flow on a local fixture page, or calls the background handler directly if Playwright can't click Chrome context menus.

## M2 — Complete application record ✅ (v0.2.0)
**Slice:** Add, view, edit and delete an application with every v1 field, and get warned about duplicates.

- All `Application` fields except the resume (§5): title, location, work mode, salary, source with suggestions, and notes.
- Detail/edit view. Soft delete with an Undo toast.
- `lib/normalizeUrl.ts` and the duplicate check on save, with "View existing" / "Save anyway" (§4.5). Add the `urlNormalized` and `[company+title]` indexes in a Dexie v2 migration.
- **Tests:** a `normalizeUrl` table test (tracking params stripped, job-ID params kept), duplicate detection, and that soft-deleted rows stay out of every query.

## M3 — Status pipeline ✅ (v0.3.0)
**Slice:** Tap a row's status chip → pick "Interviewing" → the list updates, the timeline records the date, and Undo reverts it.
**Also:** Open + Add application → only the top fields show, with Save visible → open More details, enter a salary → save. Move a Saved job to Interviewing → asked for the date applied.

- **Form layout first** (§4.2), so M3's Status field and M4's Resume field land in the final layout: top section, collapsed More details that opens on its own for errors, captured values and stored values, a sticky Save/Cancel bar, common currencies first, and remembered source and work mode for manual adds (`chrome.storage.local`).
- Fixed 9-value `Status` union, `statusHistory` (append-only), and the `appliedAt` rules (§4.3, §5): Applied sets today, other statuses that imply an application ask (Set date / Skip), Withdrawn doesn't, a stored date is never overwritten, and Undo clears a date the change set.
- A Status selector in the form (default Applied), so a job can be logged as Saved.
- `StatusChip` + picker (keyboard and ARIA), with an Undo toast.
- A timeline in the detail view whose dates can be edited.
- List filters (All / Active / Closed / any single status), search, and sort (§4.4).
- **Tests:** status transitions and history, the `appliedAt` prompt (Set date, Skip, Withdrawn, existing date), undo, filter/search logic, More details auto-opening, the sticky bar at 320px, currency order, and remembered defaults applying to manual adds but not to captures or Edit.

## M4 — Resume library ✅ (v0.4.0)
**Slice:** Upload "Backend v3.pdf" → pick it on an application → open it later from that application.

- Add `unlimitedStorage`. Add a `resumes` table storing the file Blob (Dexie migration).
- A Resumes tab with upload (type and 10 MB limits, display name, note), list, rename, and archive-or-delete rules (§4.6).
- A resume dropdown and "Upload new…" in the application form, plus `resumeNameSnapshot`.
- `entrypoints/resume-viewer/`: PDFs open via a blob URL, and other formats download.
- **Tests:** archive-instead-of-delete when a resume is referenced, the snapshot showing when the file is missing, and an e2e test that uploads a resume, links it, and opens it.

## M5 — Stats ✅ (v0.5.0)
**Slice:** Open the Stats tab → see this week's Applied / Interviews / Offers / response rate → switch the range to This month.

- `lib/stats.ts` as pure functions (§4.7): counts based on the first time an application entered each status, response and interview rates, the outcomes breakdown (rejections labeled neutrally), and per-day or per-week activity buckets.
- A range picker including Custom, headline cards, the outcomes bar, and the activity chart. Charts are hand-written SVG and CSS: Recharts measured about 320 KB minified for one bar chart, more than the whole panel (spec §9).
- **Tests:** range boundaries, week start, the "first entered" rule, and an empty dataset.

## M6 — Settings & weekly goal ✅ (v0.6.0)
**Slice:** Set a weekly goal of 10 → the Stats tab shows the goal progress ring at 3 of 10. Switch to dark mode.

- A Settings tab using `chrome.storage.local`: weekly goal, first day of the week (feeds into `stats.ts`), and theme (System / Light / Dark).
- **Delete all data** (applications and resumes, typed confirmation; settings stay) and **Reset settings** (with an "Also delete all my data" checkbox that brings back the typed confirmation) (§4.8).
- A placeholder link to the privacy policy (a bundled page; M9 writes the final text), and a bundled third-party notices page with the Geist (OFL) and Lucide (ISC) licenses.
- **UI redesign** (owner's screen-by-screen review, 2026-10-16; the decisions are in spec §3, §4 and §9):
  - **Foundation:** the shadcn look, hand-built with nothing installed (no shadcn, Radix or helper packages, for bundle size). Design tokens on `:root` using shadcn's names, with a zinc neutral primary, light and dark sets, Geist bundled locally, and Lucide icons copied into one file. Shared button, field, badge and chip styles replace the class strings repeated per component. Buttons get the pointer cursor back (Tailwind v4 dropped it).
  - **Shared pieces:** one bottom **Sheet** (a native `<dialog>`), animated toasts, and a floating action button. Every animation is instant under reduced motion.
  - **Tabs:** a top tab bar with icons, where panels slide horizontally.
  - **Applications:** a new row layout, search plus a filter sheet (sort, date range, several statuses at once), a **+ Add** button that floats, and status changes in a sheet.
  - **Add/Edit** in a sheet: a new field order with required markers, a resume combobox, Source chips, Notes that grow, and an animated More details.
  - **Detail** as a page that slides in, with a pencil and a ⋯ menu, the posting as a button showing its site, and a stepper timeline whose dates are edited explicitly.
  - **Resumes:** an upload button that floats and opens a sheet with a drop zone, search, a ⋯ menu per row, rename in a sheet, and Archived as an accordion.
  - **Stats:** range chips, the weekly goal ring, and charts restyled for both themes.
- **Tests:** settings persist, and the goal and week start feed into the stats. Delete and reset each leave the other's data alone. The sheet, combobox and chips work by keyboard. The uploader works by click, keyboard and drop. Every screen fits 320px in both themes. A timeline date can be saved without leaving the field (regression: it used to save only on blur).

### After M6: owner design review
Before M7 starts, the owner reviews the whole app and makes design decisions. Claude prepares:
- a short list of open UI questions, including where the weekly goal ring goes (top of Stats, or beside a large Applied number);
- screenshots of each screen at 320px in both themes;
- a **copy deck** of every user-facing string, factual and encouraging;
- a **name shortlist** of about 8 names with a Web Store availability check (the icon follows the name).

Claude then applies the decisions (in follow-up PRs, released as v0.6.x) before starting M7.

**Review outcome (2026-10-17):** the owner's answers are in `docs/design-review/README.md` and spec.md. Follow-up PRs before M7:
- **polish:** button variants, icons, toast layout, labels, list row and resume row layout, copy;
- **motion and scrolling:** accordion height animation, the scrollbar flash while a sheet opens, hidden scrollbars, Notes without a resize handle;
- **inputs:** a Select component (Status, Work mode, Per), a searchable Currency, number fields, and the inline upload's +/− toggle;
- **filters:** Apply instead of applying live, and a sliding sort marker;
- **discard:** a centered dialog;
- **header:** tabs with the icon beside the label, and Settings as a gear that opens a sheet;
- **stats:** a large Applied number with the goal ring beside it, and the chosen chip kept in view;
- **rename:** Huntlog, with an icon.

The owner also asked why Source opened on "Other" in a new form: the remembered source from an application saved before the Source chips existed (when "Other" was a typed suggestion), not a code bug; it resets the next time a new application is saved with a chip or none.

Tag v0.6.1 once the last of them (#55, the rename) merges.

**Second pass (2026-10-17, v0.6.2):** after using v0.6.1 the owner asked for: the timeline's date Save and Cancel grouped as ghost icon buttons; shadcn's destructive colors (solid red, white text); a debounced search; More details as one section with its hint kept on the row, no line under the row, and an opening as slow as its closing; the goal ring leading the Stats card (Applied centered when there's no goal); no remembered source in a new form; the uploader without its "Resume file" label, with a "Choose file" link button, a generic name placeholder and a full-width Upload; and sheets that slid in with a jump (focus scrolled the dialog, fixed with `overflow: clip`).

**Goal card (v0.6.3):** at the owner's request the ring became a weekly application goal card (this week's count large, a five-segment bar, a green check once reached, the goal and what's left or past it), with Applied moving in beside Interviews and Offers; without a goal, Applied is laid out the same way, with a pointer to the setting.

**Quick logging (v0.6.4):** the owner reversed the v0.6.2 removal of the remembered source (it's there so a run of applications is quick to log), and asked for the last-used resume to be remembered too, preselected only while it's still offered.

**Captures (v0.6.5):** a capture now sets Source from the job board in its address (LinkedIn, Indeed, Glassdoor, ZipRecruiter, Wellfound, Dice, Monster) and starts with the last-used resume. Fixed with it: a resume remembered before the panel opened was never preselected (v0.6.4), and a row's status chip drew over the toast's buttons.

**Sheet shortcut (v0.6.6):** ⌘/Ctrl+Enter presses a sheet's main button from any control in it (never a destructive one), and Escape leaves the detail view.

## M7 — Export & import ✅ (v0.7.0)
**Slice:** Export a JSON backup → "Delete all data" → import with Replace → everything is back, including resume files that open.

- JSON backup with resumes base64-encoded, CSV export, and a downloadable CSV template (§6).
- JSON import with Merge (newest `updatedAt` wins) or Replace. CSV import with validation and a preview.
- A "Last backup: N days ago" line in Settings.
- **Tests:** a full round-trip test (spec §10 acceptance), merge conflict resolution, and handling of malformed CSV rows.
- **Decisions (owner, 2026-10-18; spec §6):** CSV rows get one status entry dated their Date applied; CSV rows already logged are skipped unless "Import them anyway"; Replace all asks with a plain confirmation naming the counts; Merge keeps the current settings and Replace restores them; backups hold live rows only. The backup is named `huntlog-backup-YYYY-MM-DD.json` after the rename.

**Follow-up (v0.7.1):** at the owner's request, destructive buttons use shadcn's red tint with red text (kept although the text is under 4.5:1, so the contrast test no longer checks that pair); exports, imports and file checks show a turning loader; and Settings' Import button lost its ellipsis.

## M8 — Real page extraction ✅ (v0.8.0)
**Slice:** Right-click a Greenhouse, Lever, Workday or Ashby posting, or any page with JSON-LD → title, company, location, work mode and salary arrive prefilled.

- Replace the M1 stub with the full self-contained `lib/extract.ts`, which tries sources in this order: JSON-LD → microdata → OG/meta → heuristics and ATS hostname patterns → selected text (§7). It also handles canonical URLs.
- **Tests:** saved HTML fixtures for each source plus junk pages, checking that the extractor never throws, and one e2e test against a fixture page.
- **Plan (2026-10-18):**
  - **PR 1, structured data, end to end:** JSON-LD `JobPosting` (also inside `@graph`, arrays and `mainEntity`) and microdata, the canonical URL, and selected text. The capture draft carries company, location, work mode and salary; the form fills them with "Auto-filled, please check" hints and opens More details for the ones inside it.
  - **PR 2, fallbacks:** Open Graph and meta tags, the first `<h1>`, `document.title` patterns ("Title at Company", "Title - Company | Site", "Company hiring Title in Place"), and company names from ATS addresses (Greenhouse, Lever, Workday, Ashby).
  - **PR 3:** release v0.8.0.
  - **Salary rule:** only what the posting states. A single figure fills both Minimum and Maximum. Currency and Per are set only when the page gives them, and a weekly or daily salary is left out, since Per has no such choice.
  - **Selected text** at capture time becomes the title: selecting it is a deliberate choice.

## M9 — Store readiness
**Slice:** Upload the zip to the Chrome Web Store and pass review.

**Plan (owner, 2026-10-18):**
1. **Source filter** in the filter sheet (spec §4.4): plain chips for sources in use, Not set, any of the chosen ones. Stats by source stays out of v1.
2. **Performance:** 1,000 seeded applications, panel open to list shown in under 300 ms in the production build, with a regression test. Measure first: if `content-visibility: auto` on rows meets the target, use it instead of hand-built virtualization and change spec §10's wording; virtualize only if it doesn't. *Done: `content-visibility: auto` met it (about 100 ms, from 150 ms), so no virtualization.*
3. **Accessibility pass:** `axe-core` as a test-only dependency on every screen and sheet at 320px in both themes; focus return (spec §10); keyboard-only walk of the main flows. The destructive button's contrast stays the owner's exception (v0.7.1). *Done: axe found only Label in Name (More details, resume rows), fixed; the keyboard walk found nothing.*
4. **Empty states and onboarding:** every empty and zero-result state, including the source filter; the tip names the real shortcut (`commands.getAll`, no new permission). *Done: the tip names the shortcut or offers Chrome's shortcuts page; no-match messages say what's hiding the rows; Stats hides its range with nothing logged and says when a longer range would help; the resume tip points at + with an empty library.*
5. **Store materials:** the final privacy policy, also published on GitHub Pages from this repo (the store needs a public URL; enabling Pages is asked first); `docs/store/` with the listing text, single purpose, permission justifications, privacy-practices answers and contact (dingding8003@gmail.com); store screenshots at 1280×800 and the 440×280 promo tile, generated by a script; the name check repeated.
6. **Release v1.0.0** and a submission checklist. Submitting is the owner's (their developer account; it's public once published).

- Meet the performance target (side panel open in under 300 ms with 1,000 seeded applications); off-screen rows skip rendering (`content-visibility: auto`), as measured enough without virtualizing.
- Accessibility pass: WCAG AA contrast in both themes and focus management (§10).
- Empty states and onboarding tip ("right-click any job posting…").
- Final name, icon set, privacy policy page, permission justifications, single-purpose statement, screenshots and promo tile (§8).
- Close the remaining open questions in spec §12.

---

**Ordering notes**
- **M1 before M2:** M1 tests the Chrome API assumptions everything else relies on. M2–M7 can be reordered if priorities shift.
- **M8 last among features:** M8 only improves prefill quality. Any time after M1, the app is already usable with URL and page title prefill.
- **Possible early beta:** cutting a release after M4 gives a useful tracker (capture, statuses, resumes) to test with real users before stats.
