# Chrome Web Store submission checklist

Submitting is the owner's: it uses your developer account, and the listing is public once it's
published. Everything to paste is in [`listing.md`](listing.md); the images are next to it.

## Before you start

- [ ] A Chrome Web Store developer account (one-time registration fee) at
      https://chrome.google.com/webstore/devconsole.
- [ ] In the dashboard's **Account** tab, set the contact email to dingding8003@gmail.com and
      verify it. Publishing is blocked until it's verified.
- [ ] The privacy policy is live at https://udsgithub.github.io/huntlog/privacy/ (GitHub Pages
      from `main`, `/docs`; enabled 2026-10-19).

## The package

- [ ] Download `job-log-1.0.0-chrome.zip` (later releases are `huntlog-<version>-chrome.zip`) from the
      [v1.0.0 release](https://github.com/UDsGitHub/huntlog/releases/tag/v1.0.0), or build it:
      `npm ci && npm run zip` (it lands in `.output/`).
- [ ] Optional check: unzip it and look at `manifest.json`. The version is `1.0.0` and the
      permissions are exactly `sidePanel`, `storage`, `unlimitedStorage`, `contextMenus`,
      `activeTab`, `scripting`, with no `host_permissions`.
- [ ] In the dashboard: **Add new item**, then upload the zip.

## Store listing tab

- [ ] Description, category (Workflow & Planning) and language (English) from `listing.md`.
      The name and summary come from the manifest.
- [ ] Store icon (128×128 PNG): `icon-128.png`.
- [ ] Screenshots, in order: `screenshots/1-list.png` to `screenshots/5-resumes.png`.
- [ ] Small promo tile: `promo-tile.png`.
- [ ] Homepage and support URLs from `listing.md` (both optional).

## Privacy practices tab

- [ ] Single purpose, each permission's justification, and "No" to remote code, from
      `listing.md`.
- [ ] Data usage: tick none of the data types, and tick the three certifications.
- [ ] Privacy policy URL: https://udsgithub.github.io/huntlog/privacy/

## Distribution tab

- [ ] Visibility: **Public** (or **Unlisted** to try it with a link first).
- [ ] Regions: all.

## Submit

- [ ] **Submit for review.** Reviews usually take a few days, longer for a first item. Narrow
      permissions and no host access help.
- [ ] If the review asks about a permission, the answers are in `listing.md` and spec §8.

## After it's published

- [ ] Install it from the store in a clean Chrome profile: right-click a job posting, add it,
      change its status, open Stats.
- [x] Note the store URL, then have it recorded in spec §8: https://chromewebstore.google.com/detail/huntlog/pfnkcogijmmaiajobancjgkeflokkhjc

## Later releases

Each one goes through the repo's usual loop (a branch, a PR, green CI), then:

- [ ] If what Huntlog stores, reads or asks permission for changed, update the privacy policy
      (`entrypoints/privacy/index.html`, with a new effective date), run
      `node scripts/build-privacy-page.ts`, and update `listing.md`.
- [ ] Bump the version: `npm version <x.y.z> --no-git-tag-version` (the store refuses a version
      it has seen).
- [ ] After merging, tag the release with `gh release create v<x.y.z>` and attach the zip from
      `npm run zip`.
- [ ] Upload that zip to the same item in the dashboard and submit it for review.
