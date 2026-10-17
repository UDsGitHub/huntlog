# Design review after M6

Prepared for the owner's review before M7 (milestones.md, "After M6: owner design review"). M6 itself is done and tagged v0.6.0; the decisions go into spec.md and are applied in follow-up PRs (v0.6.x) before M7 starts.

- **Screenshots:** every screen at 320px in light and dark, below. Regenerate with `npm run build && npm run screenshots` (`review/screenshots.spec.ts`; dates are fixed to Fri Oct 16 2026).
- **Copy deck:** [copy-deck.md](copy-deck.md), every user-facing string by screen with its source line. Regenerate with `node review/copy-deck.ts`.
- **Open UI questions**, **copy suggestions** and the **name shortlist** follow.

## Screens

| Screen | Light | Dark |
| --- | --- | --- |
| Applications, empty | [light](screenshots/empty-applications-light.png) | [dark](screenshots/empty-applications-dark.png) |
| Applications list | [light](screenshots/list-light.png) | [dark](screenshots/list-dark.png) |
| Filter sheet | [light](screenshots/sheet-filters-light.png) | [dark](screenshots/sheet-filters-dark.png) |
| Status sheet | [light](screenshots/sheet-status-light.png) | [dark](screenshots/sheet-status-dark.png) |
| Add form | [light](screenshots/form-add-light.png) | [dark](screenshots/form-add-dark.png) |
| Detail | [light](screenshots/detail-light.png) | [dark](screenshots/detail-dark.png) |
| Stats, empty | [light](screenshots/empty-stats-light.png) | [dark](screenshots/empty-stats-dark.png) |
| Stats, with a goal | [light](screenshots/stats-light.png) | [dark](screenshots/stats-dark.png) |
| Custom range sheet | [light](screenshots/sheet-custom-range-light.png) | [dark](screenshots/sheet-custom-range-dark.png) |
| Resumes, empty | [light](screenshots/empty-resumes-light.png) | [dark](screenshots/empty-resumes-dark.png) |
| Resumes | [light](screenshots/resumes-light.png) | [dark](screenshots/resumes-dark.png) |
| Resume ⋯ menu | [light](screenshots/resumes-menu-light.png) | [dark](screenshots/resumes-menu-dark.png) |
| Upload sheet | [light](screenshots/sheet-upload-light.png) | [dark](screenshots/sheet-upload-dark.png) |
| Settings | [light](screenshots/settings-light.png) | [dark](screenshots/settings-dark.png) |
| Delete all data sheet | [light](screenshots/sheet-delete-all-light.png) | [dark](screenshots/sheet-delete-all-dark.png) |

## Open UI questions

1. **Where the weekly goal ring sits** (spec §12). Today it's a card at the top of Stats, above the range (A). The alternative is a large Applied number with the ring beside it (B). B saves about 90px and puts this week's goal next to the range's count, but then the ring (always this week) sits beside a number that follows the chosen range, which could read as the same thing.

   ```
   A (now)                          B
   ┌──────────────────────────┐     ┌──────────────────────────┐
   │ (◔ 4)  Weekly goal       │     │ 4            (◔)  4/10   │
   │        4 of 10 this week │     │ Applied      this week   │
   │        6 more to go      │     └──────────────────────────┘
   └──────────────────────────┘     [This week] [Last 7 days] …
   [This week] [Last 7 days] …      ┌──────┐┌──────┐
   ┌──────┐┌──────┐┌──────┐         │ 1    ││ 0    │  (Interviews,
   │ 4    ││ 1    ││ 0    │         │Interv││Offers│   Offers)
   │Applie││Interv││Offers│         └──────┘└──────┘
   ```
   *Recommendation:* keep A unless B's saving matters. A never mixes this week with another range.
2. **Resume row details wrap mid-date** ([resumes](screenshots/resumes-light.png)): "PDF · 209 bytes · Uploaded Oct / 16, 2026" breaks inside the date at 320px. Options: put "Uploaded …" on its own line, drop "Uploaded" (the date alone), or keep the date from breaking (`white-space: nowrap` on it). *Recommendation:* the date on its own line.
3. **A toast over an open sheet covers its fields.** A toast shows inside the newest sheet (so it stays clickable and announced), sitting above the footer, where it can hide a sheet's last fields (seen with Custom range's From/To while an Undo toast was up). Options: leave it (it goes in 5 s, and hovering pauses it), or have sheets reserve room for it. *Recommendation:* leave it; revisit if it bites.
4. **The chosen range chip can be scrolled out of sight.** After scrolling the chips (or closing Custom), "This week" may be off to the left; the date line under the chips still says the range. Options: scroll the chosen chip back into view when the tab is shown again, or leave it. *Recommendation:* scroll it into view on return to the tab.
5. **Header title.** "Job Log" is the panel's title above the tabs; it changes with the name (below), and could become the icon plus the name.

## Copy

The tone rule holds: rejections show only as "Closed – not selected", errors say what to do next. Suggestions (source lines are in the copy deck):

- **Settings → Your data:** "Export and import arrive in a later version." promises a feature; M7 ships it, so the line goes then. Fine until M7.
- **Stats, empty:** "Your stats show up here once you log applications. Every one you send counts." Good; keep it.
- **Resume details:** "209 bytes": sizes under 1 KB are shown in bytes, which is correct but rare for real resumes. Fine.
- **"Working…"** (the Reset settings button while it runs, with or without delete ticked) is vaguer than the other busy labels ("Deleting…", "Saving…"). Suggest "Resetting…".
- **Context menu:** "Add job to Job Log" / "Add linked job to Job Log" follow the product name; update with it.
- **Announcements:** a resume rename tells screen readers only "Saved."; suggest "Renamed to ${name}.", like "Uploaded ${name}." after an upload.

## Name shortlist

"Job Log" is a working title (spec §12). Checked against the Chrome Web Store on 2026-10-17 by web search (not a trademark search; confirm with the store's own search, `chromewebstore.google.com/search/<name>`, before choosing).

| Name | Store check | Notes |
| --- | --- | --- |
| Job Log (now) | **Crowded:** three listings named "JobLog" (an autofill tracker, a job-search notes tool, and a web app's Quick Add) | Hard to find and to tell apart |
| JobTrail | **Taken:** "JobTrail — Job Application Tracker", plus "Job Trail" (a Gmail tracker) | Drop |
| Huntlog | No listing found | Close to the well-known Huntr; "hunt" fits the search |
| Applylog | No listing found | Plain about what it does; "Apply…" prefix is common (Applytrackr, Applylane) |
| Offerpath | No listing found | Aspirational; OfferBee and Offerwatch exist |
| Next Round | No listing found | Encouraging, two common words, harder to own |
| Callback | No listing found as a name | Encouraging; a generic word, hard to search for |
| Jobfolio | No listing found | Hints at resumes too; "Superfolio" exists |
| Job Ledger | No listing found | Calm and factual; "ledger" also means crypto wallets in the store |
| Sentlog | No listing found | Says "what I sent"; "JobLogs" exists |

*Recommendation:* **Huntlog** or **Next Round**. Both are free in the store, short, and match the factual, encouraging tone. The icon follows the chosen name.
