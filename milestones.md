# Job Log — Milestones

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

## M1 — Capture plumbing (de-risk)
**Slice:** Right-click a job page → "Add job to Job Log" → the side panel opens with the URL and page title prefilled → Save.

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

## M2 — Complete application record
**Slice:** Add, view, edit and delete an application with every v1 field, and get warned about duplicates.

- All `Application` fields except the resume (§5): title, location, work mode, salary, source with suggestions, and notes.
- Detail/edit view. Soft delete with an Undo toast.
- `lib/normalizeUrl.ts` and the duplicate check on save, with "View existing" / "Save anyway" (§4.5). Add the `urlNormalized` and `[company+title]` indexes in a Dexie v2 migration.
- **Tests:** a `normalizeUrl` table test (tracking params stripped, job-ID params kept), duplicate detection, and that soft-deleted rows stay out of every query.

## M3 — Status pipeline
**Slice:** Tap a row's status chip → pick "Interviewing" → the list updates, the timeline records the date, and Undo reverts it.

- Fixed 9-value `Status` union, `statusHistory` (append-only), and the auto-set `appliedAt` rule (§5).
- `StatusChip` + picker (keyboard and ARIA), with an Undo toast.
- A timeline in the detail view whose dates can be edited.
- List filters (All / Active / Closed / any single status), search, and sort (§4.4).
- **Tests:** status transitions and history, undo, and filter/search logic.

## M4 — Resume library
**Slice:** Upload "Backend v3.pdf" → pick it on an application → open it later from that application.

- Add `unlimitedStorage`. Add a `resumes` table storing the file Blob (Dexie migration).
- A Resumes tab with upload (type and 10 MB limits, display name, note), list, rename, and archive-or-delete rules (§4.6).
- A resume dropdown and "Upload new…" in the application form, plus `resumeNameSnapshot`.
- `entrypoints/resume-viewer/`: PDFs open via a blob URL, and other formats download.
- **Tests:** archive-instead-of-delete when a resume is referenced, the snapshot showing when the file is missing, and an e2e test that uploads a resume, links it, and opens it.

## M5 — Stats
**Slice:** Open the Stats tab → see this week's Applied / Interviews / Offers / response rate → switch the range to This month.

- `lib/stats.ts` as pure functions (§4.7): counts based on the first time an application entered each status, response and interview rates, the outcomes breakdown (rejections labeled neutrally), and per-day or per-week activity buckets.
- A range picker including Custom, headline cards, the outcomes bar, and the activity chart. Decide between Recharts and custom SVG by bundle size, and close that open question in spec §12.
- **Tests:** range boundaries, week start, the "first entered" rule, and an empty dataset.

## M6 — Settings & weekly goal
**Slice:** Set a weekly goal of 10 → the Stats tab shows the goal progress ring at 3/10. Switch to dark mode.

- A Settings tab using `chrome.storage.local`: weekly goal, first day of the week (feeds into `stats.ts`), and theme (System / Light / Dark).
- "Delete all data" with typed confirmation.
- A placeholder link to the privacy policy.
- **Tests:** settings persist, and the goal and week start feed into the stats.

## M7 — Export & import
**Slice:** Export a JSON backup → "Delete all data" → import with Replace → everything is back, including resume files that open.

- JSON backup with resumes base64-encoded, CSV export, and a downloadable CSV template (§6).
- JSON import with Merge (newest `updatedAt` wins) or Replace. CSV import with validation and a preview.
- A "Last backup: N days ago" line in Settings.
- **Tests:** a full round-trip test (spec §10 acceptance), merge conflict resolution, and handling of malformed CSV rows.

## M8 — Real page extraction
**Slice:** Right-click a Greenhouse, Lever, Workday or Ashby posting, or any page with JSON-LD → title, company, location, work mode and salary arrive prefilled.

- Replace the M1 stub with the full self-contained `lib/extract.ts`, which tries sources in this order: JSON-LD → microdata → OG/meta → heuristics and ATS hostname patterns → selected text (§7). It also handles canonical URLs.
- **Tests:** saved HTML fixtures for each source plus junk pages, checking that the extractor never throws, and one e2e test against a fixture page.

## M9 — Store readiness
**Slice:** Upload the zip to the Chrome Web Store and pass review.

- Meet the performance target (side panel open in under 300 ms with 1,000 seeded applications) and virtualize the list past about 200 rows.
- Accessibility pass: WCAG AA contrast in both themes and focus management (§10).
- Empty states and onboarding tip ("right-click any job posting…").
- Final name, icon set, privacy policy page, permission justifications, single-purpose statement, screenshots and promo tile (§8).
- Close the remaining open questions in spec §12.

---

**Ordering notes**
- **M1 before M2:** M1 tests the Chrome API assumptions everything else relies on. M2–M7 can be reordered if priorities shift.
- **M8 last among features:** M8 only improves prefill quality. Any time after M1, the app is already usable with URL and page title prefill.
- **Possible early beta:** cutting a release after M4 gives a useful tracker (capture, statuses, resumes) to test with real users before stats.
