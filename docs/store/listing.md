# Chrome Web Store listing

Everything the developer dashboard asks for, ready to paste. Spec §8 is the source for the
permissions and the privacy promises; `tests/storeListing.test.ts` keeps this file in step with
the manifest and spec §8.

## Store listing tab

**Name** (from the manifest): Huntlog

**Summary** (the manifest's `description`, at most 132 characters):

> Track your job applications in Chrome's side panel. Right-click a posting to log it. Private: nothing leaves your device.

**Category:** Workflow & Planning

**Language:** English

**Description:**

```text
Huntlog keeps track of the jobs you apply to, right beside the posting, without an account and without sending anything anywhere.

LOG A JOB IN SECONDS
Right-click a job posting and choose "Add job to Huntlog", or press Alt+Shift+J (Option+Shift+J on a Mac). The side panel opens with the form filled in from the page: company, job title, location, work mode and salary when the posting lists them. Check it, pick the resume you sent, and save.

SEE WHERE EVERY APPLICATION STANDS
Change a status with one tap (Applied, Screening, Interviewing, Offer, Rejected and more), with Undo. Each job keeps a timeline of its stages. Search, filter by status, date or source, and sort.

KNOW WHICH RESUME YOU SENT
Upload the versions of your resume and link one to each application, so you always know what the company has.

STATS THAT KEEP YOU GOING
Applications per week, response and interview rates, and how your applications stand now. Set a weekly goal and watch it fill up.

PRIVATE BY DESIGN
• Everything stays in your browser, on your device.
• No account, no server, no analytics, no network requests at all.
• Huntlog reads a page only when you ask it to, by right-clicking or pressing the shortcut.

YOUR DATA, YOURS TO KEEP
Export a full backup (resumes included) or a spreadsheet (CSV), and import them again, or bring in applications you tracked in a spreadsheet before.

Works in light and dark themes, by keyboard, and with screen readers.
```

**Screenshots** (1280×800, `docs/store/screenshots/`, made by `npm run store-assets`), in this
order:

1. `1-list.png`: all your applications, beside the posting
2. `2-capture.png`: right-click a posting, and the form fills itself in
3. `3-detail.png`: every stage of an application on a timeline
4. `4-stats.png`: your week, your rates, your goal
5. `5-resumes.png`: know which resume you sent

**Small promo tile** (440×280): `docs/store/promo-tile.png`

**Official URL:** none. **Homepage URL:** https://github.com/UDsGitHub/job-log

**Support URL:** https://github.com/UDsGitHub/job-log/issues

## Privacy practices tab

**Single purpose:**

> Huntlog tracks the job applications you submit: you log each job (filled in from the posting when you ask), follow its status, link the resume you sent, and see your progress, all stored on your device.

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `sidePanel` | Huntlog's whole interface is in the side panel, so the user can log and review applications beside the job posting. |
| `storage` | Saves the user's settings, remembered form choices and the hand-off of a captured page to the side panel, locally in chrome.storage. Nothing is synced or sent. |
| `unlimitedStorage` | The user's uploaded resume files (PDF, DOCX and others) are stored locally in IndexedDB, and a library of several versions can exceed the default quota. |
| `contextMenus` | Adds "Add job to Huntlog" (and "Add linked job to Huntlog" on links) to the right-click menu, the main way to log a job. |
| `activeTab` | When the user chooses "Add job to Huntlog" or presses its shortcut, Huntlog reads that one tab to fill in the form. It has no other page access and no host permissions. |
| `scripting` | Runs the self-contained extractor in the active tab, once, after that user gesture, to read the posting's job details (JSON-LD, headings, title). |

**Remote code:** No, I am not using remote code. All code is in the package.

**Data usage:** none of the data types is collected. Huntlog stores what the user enters only on
their device and transmits nothing, so in the store's sense (data sent off the device) it
collects nothing. Tick all three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://udsgithub.github.io/job-log/privacy/ (GitHub Pages, from
`docs/privacy/index.html`; the same text ships in the extension as `privacy.html`).

## Account tab

**Contact email:** dingding8003@gmail.com (must be verified in the dashboard before publishing).

## Name check

Repeated on 2026-10-18 before submitting: the store's own search for "Huntlog"
(`chromewebstore.google.com/search/Huntlog`) shows no results, and a web search finds no product
by that name. The nearest are "JobLog" (a different extension) and Huntr (a job tracker with a
similar-sounding name). Not a trademark search.
