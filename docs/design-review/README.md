# Design review after M6

**Outcome:** every decision below landed in v0.6.1 (PRs #47–#55), including the rename to Huntlog; the screenshots and copy deck show v0.6.0 as reviewed.

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


## Open UI Question Responses
1. go with option B
2. Keep the date on its own line
3. Leave as is
4. follow your recommendation
5. Lets go with Huntlog

## Extra Review Comments
- There is a wierd UI thing where opening a drawer flashes a scrollbar in the main app before the drawer finishes animating
- Lets experiment with making the tabs laid out as icon next to label in a row, then move the settings to the same how as the extension title
- For buttons like the delete all button, since we are following shadcn style, we should use the destructive button variant styles.
- The filter button in the applications tab should be shadcn ghost variant
- Lets reduce the width of the first column of the row under the title/status row so the text in there doesnt overflow to far close ot the link icon and look akward. we can also add a justify between on their wrapper and some gap as extra fallback.
- Like I mentioned before, remove the "(optional)" text in the label of the optional fields, just leave them with the label alone.
- Status in the add application form isnt using the custom or a custom select, it should.
- The plus button next to the resume field in the add application form should be ghost variant as well.
- WHy is source in the more details section of add application form set default to other, builtIn, if this has something to do with my existing setup and not the code, let me know and I will wipe my db to retest that.
- Why does it seem like the content of the accordion is wrapped by something that fades in and out when you toggle the accordion. That should not be the behavior, it should expand and collapse, growing and shrinking the height of the content and hiding excess with overflow hidden I think. you should know how to setup a good accordion.
- I dont like the "Upload and use" copy for the Resume upload field in the add application form, change the copy to "Upload", remove the cancel upload button and animate the plus icon spinning and transitioning to the minus icon
- Also change the "Backend v3" placeholder example to something more generic because that copy doesnt read as an example resume file name
- Same thing with the work mode select should be the or a custom select
- maybe change the currency select to a datalist because that list is too long to sift through
- the year, month, and hour select should be a or the custom select
- Remove the ellipses for the "Other..." option in the source field in the more details section of the add application form.
- You still have not made the change for the notes textarea input to auto grow after 3 lines or rows and remove its adjustability
- The discard changes warning being at the bottom of the drawer is not user friendly, either make it a modal or dialog or propose a better alternative
- For the resume list item in the resumes tab, change the 3 dots icon to the vertical 3 dots, transparent background and no hover styles on its the wrapper
- I want to suggest hiding the scrollbar for a scrollable areas, vertical or horizontal
- Settings page looks good, only comment is that all number inputs in this application appear to just be text fields. Thats fine if we have some parsing making sure that we only take numbers. Either we do that, we switch to number input or you propose an alternative. I know for the maximum and minimum input for the wage input in the add application form, you may have left that text to allow formatted currency input but I would prefer consistency either keep it number, leave it text field but only accept number or propose an alternative
- The sort by selected field option indicator in the application filters should be animated to slide between selections
- The filter changes should immediately be reflected until apply is clicked, so the "Done" button in the filter drawer should say "Apply"
- Use the square-pen icon for the edit in the application list item detail view title header row
- Group the toast action label and the close icon for the toasts together with a flex div and smaller spacing between them as compared to that between the wrapper and the toast message