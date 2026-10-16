# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Job Log is a Manifest V3 Chrome extension for tracking job applications, built with WXT + React 18 + TypeScript (strict) + Tailwind v4. `spec.md` is the source of truth: read it before building any feature, and update it when a product decision changes. Build order is in `milestones.md` (thin end-to-end slices M0–M9); work one milestone at a time.

## Commands

- `npm run dev`: WXT dev mode. It launches Chrome (via the `web-ext` dev dependency) with the unpacked extension and hot reload. Dev builds add their own permissions; only the production manifest counts for spec §8.
- `npm run build`: production build to `.output/chrome-mv3/`.
- `npm run zip`: Chrome Web Store upload zip in `.output/`.
- `npx vitest run`: all unit and component tests (`lib/`, `components/`, `tests/`).
- `npx vitest run lib/stats.test.ts -t "week start"`: a single test file or test name.
- `npx playwright test`: end-to-end tests in `e2e/`, loading the built extension into a persistent Chromium context. Run `npm run build` first. `e2e/manifest.spec.ts` asserts the built manifest's permissions, so update it when a milestone adds one.
- `npm run lint` / `npx tsc --noEmit` / `npx prettier --check .`: ESLint, type check and formatting. ESLint bans `fetch`, `XMLHttpRequest`, `WebSocket` and `EventSource` as bare globals and on `window`/`self`/`globalThis`, plus `navigator.sendBeacon`. It's a guardrail, not a proof: the PR review still checks for network creep.

Gotchas:
- Every file in `entrypoints/` is treated as an entrypoint, so tests for entrypoints go in `tests/`, not next to the file.
- Use WXT's `browser` global (typed), not `chrome`. In Playwright `serviceWorker.evaluate` callbacks the global is `chrome`; declare it as `typeof browser`.
- Playwright can't click native context menus or the toolbar, and its key presses never reach extension shortcuts. `clickToolbarIcon` in `e2e/fixtures.ts` clicks the toolbar icon through CDP (`Extensions.triggerAction`, enabled by `--enable-unsafe-extension-debugging`). That click grants `activeTab` only when `openPanelOnActionClick` is off.
- TypeScript is pinned to `~6.0` because typescript-eslint doesn't support TS 7 yet.

## Architecture (from spec.md §3–§9)

**Local-first, no network.** All data lives in the browser. Applications and Resumes (file Blobs) are in IndexedDB via Dexie (`lib/db.ts`). Settings are in `chrome.storage.local`. Never add fetch calls, analytics, remote code, or host permissions: the Web Store privacy pitch depends on this.

**Permissions are fixed and minimal:** `sidePanel`, `storage`, `unlimitedStorage`, `contextMenus`, `activeTab`, `scripting`. Adding a permission is a product decision that needs a spec change.

**Capture flow spans three pieces:**
1. `entrypoints/background.ts` handles the context-menu click or the keyboard command. That user gesture grants `activeTab`.
2. The background script (`handleCapture`) first calls `chrome.sidePanel.open({ windowId })` synchronously inside the gesture handler, before any `await`, or Chrome rejects it. Then it runs `lib/extract.ts` in the tab via `chrome.scripting.executeScript({ func })` and writes the result through `lib/captureDraft.ts` to `chrome.storage.session` under `captureDraft:<windowId>`. On a restricted page it falls back to the tab URL only. If two captures in one window overlap, only the newest one writes its draft.
3. The side panel (`components/useCaptureDraft.ts`) reads and clears its own window's draft, both on load and on `storage.session` change (the panel can open before the draft exists), and ignores drafts older than 5 minutes. A capture switches `App` to the Add view and remounts the form keyed by capture, so each capture replaces the form's contents and shows the "Auto-filled, please check" hints. Saving or cancelling marks the capture consumed, so it never prefills a later manual Add.

Link context-menu clicks skip extraction and only pass `linkUrl`. Buttons inside the side panel do **not** grant `activeTab`, so the panel can't read the current tab itself.

**`lib/extract.ts` must be fully self-contained.** `executeScript` serializes the function, so it cannot reference imports or outer-scope variables. It must never throw, and it returns partial data (sources tried in order: JSON-LD `JobPosting` → microdata → OG/meta → heuristics, including ATS hostname patterns). Generic extraction only: no per-site scrapers in v1.

**Data invariants (spec §5):**
- UUID IDs, ISO timestamps, and soft deletes (`deletedAt`). Undoing a delete clears `deletedAt` and moves `updatedAt` forward, because future sync is last-write-wins on `updatedAt`. Functions that write inside a Dexie transaction return `undefined` for a missing row and throw `NotFoundError` outside it, since Dexie wraps errors thrown inside. Every query must filter out soft-deleted rows. Reads and writes go through `lib/applications.ts`, not straight to `db` from components, so the filter lives in one place. `deletedAt` isn't indexed (Dexie skips `undefined`), so filter it with `.filter()`. These fields exist to make future cloud sync possible, so keep them on new tables.
- `statusHistory` is append-only (dates are editable). Stats use the *first* entry into a status, so never rewrite history when the status changes.
- The status list is a fixed union of 9 values. Do not make it configurable.
- `urlNormalized` (`lib/normalizeUrl.ts`) and `companyTitleKey` (`lib/dedupe.ts`) drive duplicate detection. Both are derived fields, recomputed by Dexie `creating`/`updating` hooks in `lib/db.ts` on every write that touches `url`, `company` or `title`, so no write path can leave them stale. `findDuplicates()` lives in `lib/applications.ts` with the other reads and takes validated values, not raw input. `normalizeUrl` strips tracking params but keeps job-ID params such as `currentJobId`, `jk`, `gh_jid`. **Changing `normalizeUrl` or `companyTitleKey` rules needs a Dexie migration that recomputes stored values**, or old and new rows stop matching.
- Migrations are tested twice: `lib/db.test.ts` opens a database created with the previous schema (fake-indexeddb), and `e2e/migration.spec.ts` seeds the previous layout from the service worker in real Chrome. Dexie version N is IndexedDB version N × 10.
- A resume referenced by any application is archived, never hard-deleted. Applications also store `resumeNameSnapshot`.

**`lib/stats.ts` is pure.** It takes applications, a range and `weekStartsOn`, and returns numbers, which keeps it unit-testable. Rejections appear only inside the neutral outcomes breakdown ("Closed – not selected"), never as a headline stat or in red.

**Side-panel views:** `App` switches between views with plain component state (no router): the list (with "+ Add application"), Add, detail and Edit. Closing a view returns focus where the user came from (spec §10): the row they opened, Edit after editing, or + Add application when the row is gone. Async views move initial focus in a layout effect, so focus lands in the same commit the view appears (and tests don't race it). Edit loads its row once rather than live, so a delete in another window can't wipe what's being typed. Transient messages use the single `Toast` (`components/Toast.tsx`, 5 s, paused on hover/focus), which M3 reuses for status Undo. Field validation and normalization live in `lib/applicationInput.ts`; `lib/applications.ts` re-validates on write.

**UI constraint:** every screen lives in a ~320–400px side panel. Design for that width; changing status is a one-tap chip with Undo, not a Kanban board.

## Definition of done

A task or milestone is done only when all of these are true. Report anything not met instead of calling it done.

1. **The slice runs end to end.** The milestone's "Slice" scenario (in `milestones.md`) works in a production build (`npm run build`, loaded unpacked), not just in dev mode, and a Playwright test covers it.
2. **Checks are green:** `npm run lint`, `npx tsc --noEmit`, `npx vitest run`, and `npx playwright test`.
3. **Tests exist for new logic.** Anything new in `lib/` has unit tests, including the cases the milestone lists. Bug fixes come with a regression test.
4. **No permission or network creep.** The manifest permissions match spec §8 for this point in the build. There are no new host permissions, `fetch` calls, or remote code.
5. **Schema changes migrate.** Dexie schema changes add a new version with an upgrade path, and a test opens a database from the previous version.
6. **The UI fits the panel.** New screens work at 320px width with no horizontal scroll and are fully keyboard-operable. From M6 on, they also work in both light and dark themes.
7. **Docs match reality.** `spec.md` reflects any changed behavior, including verified or disproven Chrome API assumptions. `CLAUDE.md` commands and architecture match the code. The milestone is checked off in `milestones.md`.

## Branching & PR workflow

This is a solo repo on GitHub with trunk-based development. Claude runs the whole loop with `gh` (branch, commit, PR, self-review, merge) and hands a PR back to the owner only in the cases listed under step 6.

- **`main` is always releasable.** Never commit directly to it. A GitHub ruleset requires a PR and green CI, and allows squash merge only.
- **Branches are short-lived, one per task within a milestone:** `m<N>/<kebab-task>`, e.g. `m1/context-menu-capture` or `m2/normalize-url`. Keep each branch to roughly a day of work. A milestone usually takes several PRs.
- **Commits** are small and use conventional prefixes (`feat:`, `fix:`, `test:`, `refactor:`, `chore:`, `docs:`). The squash-merge title is the PR title in the same format, e.g. `feat(m1): open side panel from context menu`.

**Loop for each task:**
1. `git switch main && git pull`, then `git switch -c m<N>/<task>`.
2. Build it, then meet the Definition of done items that apply to the task.
3. Push, then `gh pr create`. The PR body covers what changed, which milestone it belongs to, how it was verified (commands and results), and any DoD items deferred to a later PR in the same milestone.
4. **Self-review before merging.** Run `/code-review` on the PR and fix the findings. Also check the manifest diff and any Dexie schema change.
5. Wait for CI (`gh pr checks --watch`), then `gh pr merge --squash --delete-branch`.
6. **Hand back to the owner** (leave the PR open and explain why) when any of these apply:
   - A permission, host access, or network call changes.
   - A product decision in `spec.md` changes, rather than a clarification or a verified assumption.
   - A Dexie migration could lose or reshape existing user data.
   - CI can't be made green.
   - Self-review leaves an unresolved concern.

**Milestones and releases:**
- When the last PR of a milestone merges and the full DoD holds, tag `main` as `v0.<N>.0` (e.g. `v0.1.0` after M1) with `gh release create`, and attach the `npm run zip` output.
- Store releases begin at `v1.0.0` after M9.
- Hotfixes use a `fix/<desc>` branch and bump the patch version.

## Out of scope for v1 (don't build unless spec.md changes)

Follow-up reminders or notifications, auto-detecting submitted applications, site-specific scrapers, accounts or sync, custom statuses, Kanban, and a show/hide-rejections setting.