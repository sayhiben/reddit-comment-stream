# Compatibility and verification

## Installation targets

| Environment | Userscript manager | Status |
| --- | --- | --- |
| Desktop Chrome | Tampermonkey | Intended installation target |
| Desktop Firefox | Tampermonkey | Intended installation target |
| iOS / iPadOS Safari 15.4+ | Userscripts | Intended installation target; requires enabling the Safari extension |
| Stock Chrome for Android | None supported by Chrome | Not an installable target |
| Firefox for Android | Tampermonkey | Supported installation route for Android; real-device check still required |
| Other browsers / managers | Must support ordinary JavaScript userscripts | Not separately verified |

Tampermonkey lists [Chrome and Firefox](https://www.tampermonkey.net/) as supported browsers. Its [Mozilla listing](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/) also identifies Firefox for Android. [Userscripts](https://github.com/quoid/userscripts) provides the Safari installation route. Google's [Chrome extension documentation](https://support.google.com/chrome_webstore/answer/2664769?hl=en) describes phone installation as adding an extension to desktop Chrome.

Both old Reddit and current Reddit are handled by the same collector and reading view. The loader uses Reddit's JSON endpoints rather than relying on the nesting or CSS classes of a particular Reddit layout. The script runs on web pages only, not inside the native Reddit app.

## What automated tests establish

The repository includes Node tests for collection behavior and Playwright tests for the browser interface. Browser tests use local fixtures and intercepted responses; they can check layout, ordering, context, cancellation, and navigation without depending on a particular public thread staying unchanged.

Chromium, Firefox, and WebKit engine tests are useful compatibility evidence. They do **not** establish that every userscript manager injects the script correctly, that a physical iPhone behaves identically to desktop WebKit, or that Reddit will accept the same requests for every account. Treat an engine test as an engine test, not as real-device certification.

Before reporting a release as verified on a real device, record the browser, operating system, userscript-manager versions, Reddit host, date, and checks completed. Authenticated live Reddit behavior and physical iOS/Android devices have not been certified by this repository's automated tests.

### Version 1.0.0 verification record — 2026-11-20

- **24 Node tests passed** for collection, rate limits, retries, cancellation, malformed responses, ancestor lookup, and safe links.
- **50 Playwright tests passed** across Chromium, Firefox, WebKit, mobile Chromium emulation, and mobile WebKit emulation. Each project exercises both Reddit layouts, recursive hidden replies, deep continuations, context, stopping, refresh, access errors, HTML safety, navigation, filtering, and incomplete counts.
- Desktop and mobile screenshots were visually checked for clipping, readable content, and context indentation. Old Reddit's missing mobile viewport is temporarily corrected while the stream is open and restored on close.
- Tests ran on Windows with the pinned Playwright dependency. They inject the built userscript into fabricated Reddit pages; they do not install Tampermonkey or Userscripts.
- An unauthenticated request to live Reddit's JSON endpoint returned HTTP 403 from the development environment. Authenticated live collection, userscript-manager injection, and physical iOS/Android installation remain unverified.

## Manual release checklist

Run these checks on old Reddit and current Reddit in each intended browser/manager combination:

- Install from the raw `.user.js` link and verify that the manager recognizes the name and version.
- Grant Reddit access, reload a post, and verify that the Comment stream control appears.
- Navigate from a listing into a post without a full page reload and check that the control still appears; navigate away and check it disappears.
- Load a thread with multiple levels of replies. Verify that a recent deep reply sorts above older top-level comments.
- Load a thread containing both “more comments” and deep continuation branches. Verify the loader finishes or explicitly reports partial coverage.
- Open the **…** menu and **View context** for a deep reply. Check the parent chain and use the native link to compare with Reddit.
- Stop a load and verify that the available comments are shown as a partial result; refresh and verify that a new collection begins.
- Try a long thread and a narrow mobile viewport. Check scrolling, pagination, menu use, and returning to Reddit's native view.
- Repeat with a slow connection or a denied request. Confirm a useful error or partial-result message, rather than an empty “complete” result.
- Leave the tab in the background briefly on mobile, return, and check progress. The operating system may suspend work while backgrounded.

Do not post private subreddit content, moderator-only material, session cookies, or account tokens in public bug reports. A minimal fabricated JSON fixture is usually sufficient to reproduce a collector issue.

## Known limits

- A thread changes while requests run. The stream is a collected snapshot, not a transactionally consistent or continuously live feed.
- Reddit can return fewer comments than the post's displayed count. Exhausting available placeholders does not prove that inaccessible comments were retrieved.
- API access and page policies can change. A userscript cannot make an endpoint available if Reddit denies it.
- The reading view does not reproduce Reddit's moderation controls. Its native links lead back to Reddit for those actions.
- Large threads use memory proportional to the collected comments. The initial view renders 100 comments; **Show more** appends batches, so the visible document grows as you expand it. There is no promise of unlimited device capacity.
- Request pacing is deliberate. Deep threads with many continuation branches can take a long time.
- Mobile background suspension can pause collection. Keep the browser in the foreground for the most reliable load.
