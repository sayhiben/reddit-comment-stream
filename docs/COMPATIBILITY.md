# Compatibility and verification

## Installation targets

| Environment | Userscript manager | Status |
| --- | --- | --- |
| Desktop Chrome | Tampermonkey | Intended installation target |
| Desktop Firefox | Tampermonkey | Intended installation target |
| iOS / iPadOS Safari 15.4+ | Userscripts | Intended installation target |
| Stock Chrome for Android | None supported by Chrome | Not an installable target |
| Firefox for Android | Tampermonkey | Android installation route; real-device check still required |
| Other browsers / managers | Must support ordinary JavaScript userscripts | Not separately verified |

See the [installation instructions](../README.md#install) for downloads and official manager documentation. Userscripts requires opening its popup after copying or replacing a script to rescan its directory, then reloading Reddit; see its [directory notes](https://github.com/quoid/userscripts#scripts-directory).

The script uses content-context injection at DOM readiness, waits for a native comment tree, and remounts its toolbar if Reddit replaces the page. It runs on Reddit web pages, not in the native Reddit app. Both old Reddit and the current `shreddit-comment` layout have native DOM adapters.

## Version 1.1.0 verification — 2026-11-20

This release replaces the separate reader from versions 1.0.x with in-place native comment sorting.

- **5 Node tests** cover post and continuation URLs, origin restrictions, Reddit timestamp formats, stable ordering, and cancellable pacing.
- **110 Playwright cases** exercise Chromium, Firefox, WebKit, mobile Chromium emulation, and mobile WebKit emulation. Each project tests both Reddit layouts.
- Fixture checks verify that the original DOM nodes, direct and delegated event handlers, reply drafts, menus, and simulated moderation controls survive sorting. They verify exact parent restoration, collapse state, native comment replacements, duplicate native nodes, context navigation, refresh, and cancellation.
- Loader checks cover recursive native expansion, imported continuation HTML, scripts stripped from fetched content, mobile reveal buttons, delayed hydration, intersection-based lazy pages, access errors, unknown timestamps, repeated cursors, and replies arriving after cancellation.
- A logged-out live check of the reported [Seattle post](https://www.reddit.com/r/Seattle/comments/1y0m3pi/i_love_these_mushrooms/) in desktop Chromium revealed **126 native comments**, and mobile WebKit emulation revealed **123**. Both checks confirmed newest-first order, unchanged original comment/body/action nodes, restored original parents, and removal of all flattening markers when returning to normal. No page JavaScript errors were observed in these runs.
- The live post reported 142 comments. Some continuation fetches returned access pages or no usable comment tree, and the script correctly reported partial coverage. Counts are observations from these runs, not a promise of full collection for other accounts or future versions of Reddit.
- Live desktop and mobile screenshots were checked for comment layout, toolbar placement, and the floating return control. Live old Reddit access was blocked in this environment, so old Reddit behavior was checked with fixtures.

Tests inject the built script through browser automation; they do not install Tampermonkey or Userscripts. Browser emulation does not certify a physical iPhone or Android device. Authenticated Reddit moderation controls have **not** been tested live; tests use fabricated controls and the live check preserves the actual logged-out controls without voting, posting, or moderating.

## Manual release checklist

Run these checks on both Reddit layouts in each browser/manager combination you use:

- Confirm the manager lists the expected version, grants Reddit access, and injects after reloading.
- Check that **Comment stream** appears with the post's comment controls, or below the post on mobile. It should not float in normal view.
- Open a draft reply, enter text, and activate the stream. Confirm the draft, native menus, and account-appropriate moderation controls remain available.
- Load several reply levels, a lazy comment page, and a deep continuation. Confirm a recent deep reply sorts above older top-level comments. Any blocked branch must produce a partial result.
- Choose **View context** beside a deep reply's actions. Confirm the actual ancestor hierarchy is restored and the selected comment is highlighted. Return using **Back to comment stream**.
- Use **Normal view** and check the original hierarchy and collapse states. Confirm the floating return button disappears.
- Stop loading, then load new comments. Also return to normal during loading and check that late requests do not reactivate sorting.
- Navigate between posts without a full reload. Check that Reddit replacing a tree does not leave an old toolbar or resurrect removed comments.
- Repeat on a narrow mobile screen and after backgrounding briefly. The operating system may suspend background work.

Do not include private subreddit content, moderator-only material, session cookies, or account tokens in public bug reports. Fabricated HTML fixtures are preferred for reproducible adapter issues.

## Known limits

- Reddit controls the native elements and their hydration. Changes to its DOM, lazy-loading logic, custom elements, or event delegation may require adapter updates. Imported continuation markup depends on the native components already available on that page.
- A denied continuation fetch, missing native markup, repeated loader, or mismatch with Reddit's reported count produces partial coverage. The script cannot retrieve content Reddit withholds.
- Existing comment nodes are retained on refresh to preserve their state and drafts. Refresh discovers additional comments; it does not overwrite existing bodies or moderation state with fetched HTML.
- Reddit may add new comments while loading. Comments inserted into the native tree are sorted while the stream is active, but the script does not continuously poll the server.
- Every loaded native comment remains in the document. Very large threads can consume substantial memory and render slowly, especially on phones.
- Loading may scroll to activate lazy native pages. Native requests already in flight may finish after cancellation. The script stops its own fetches and prevents canceled work from reactivating sorting.
- Old Reddit retains its desktop layout on mobile; the script does not replace the site's styling or viewport.
