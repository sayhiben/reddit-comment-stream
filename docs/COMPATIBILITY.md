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

See the [installation instructions](../README.md#install) for downloads and official manager documentation. After copying or replacing a script, open the Userscripts popup to rescan its directory, then reload Reddit; see its [directory notes](https://github.com/quoid/userscripts#scripts-directory).

The script retains content-context injection at DOM readiness and remounts its in-post button if Reddit replaces the controls. Its separate reader stays outside Reddit's post components. It runs on Reddit web pages, not in the Reddit app.

## Version 1.2.0 — JSON reader restored

The native expansion approach in versions 1.1.0–1.1.1 was reported to load slowly and crash a phone under memory pressure. Version 1.2.0 restores the JSON collection and separate reader from 1.0.1, keeps the in-post button and Safari startup fixes, and reduces retained data and rendered cards. The obsolete native loader and its synthetic speed benchmark have been removed. Earlier versions remain available in Git history.

The verification suite contains **26 Node tests and 80 browser cases** across Chromium, Firefox, WebKit, mobile Chromium emulation, and mobile WebKit emulation. Each browser project covers both Reddit layouts.

- Collection checks cover nested replies, batches of at most 100 hidden IDs, sequential requests, focused deep continuations, missing ancestors, pagination, deduplication, repeated cursors, count mismatches, cancellation, retry pacing, and denied requests.
- Compact-record checks ensure nested replies and unused Reddit media, awards, and flair data are not retained. Progress reporting does not construct sorted snapshots during collection.
- A 2,505-comment fixture verifies global sort and filter behavior while paging replaces the current 50 cards. A 320-comment branch fixture checks a maximum of 50 context cards and access to both the earliest ancestor and last reply. Closing context removes its cards; closing the reader removes its host and reopening starts a fresh collection.
- Browser checks ensure native comment nodes, markup, and collapse states stay unchanged, with no native loader clicks. They also cover in-post button placement, late hydration, navigation, closing during an active request, refresh, HTML sanitization, and blocked media requests.
- Startup tests cover DOM readiness, document replacement, and a page rejecting inline scripts. Legacy Reddit's temporary mobile viewport adjustment is restored when the reader closes.

Tests inject the built script through browser automation; they do not install Tampermonkey or Userscripts. Emulation does not certify a physical iPhone or Android device. The tests verify bounded card counts and compact data retention, not physical-device peak memory or a universal absence of crashes. Authenticated moderation actions are not tested; the reader is read-only and links to native Reddit for those actions.

Live logged-out checks of the reported [Seattle post](https://www.reddit.com/r/Seattle/comments/1y0m3pi/i_love_these_mushrooms/) on 2026-11-20 verified button placement in desktop Chromium and mobile WebKit emulation. Reddit returned HTTP 403 for the JSON listing in both, so live collection could not be verified. Both readers reported partial coverage, preserved the existing native comment count and parents, and removed the reader on close. No page JavaScript errors were observed. Mobile reader and context screenshots using controlled responses were also inspected.

## Manual release checklist

Run these checks on both Reddit layouts in each browser/manager combination you use:

- Confirm the manager lists version 1.2.0 or later, grants Reddit access, and injects after reloading.
- Check that **Comment stream** appears in the post's controls or below the post. It should not float in normal view.
- Activate the reader with some native branches still collapsed. They should stay collapsed and in place after closing it.
- Load a thread with hidden replies and a deep continuation. Confirm a recent deep reply sorts above older top-level comments. Unavailable content must produce a partial result.
- Page forward and backward, and search for an older comment. Search must include comments outside the visible page.
- Choose **… → View context** beside a deep reply. Check its ancestors, parent, selected highlight, and direct replies. Page through a long branch, then return with **Back to stream**.
- Open the comment on Reddit for native actions, checking that the intended comment and parent context appear.
- Stop loading and review the partial snapshot. Refresh to retrieve new comments. Close during loading and check that late responses do not reopen the reader.
- Reopen after closing to collect fresh data. Navigate between posts without reloading and verify that no old reader remains.
- Repeat on a narrow mobile screen, a large active post, and after backgrounding briefly. Mobile operating systems may suspend background work.

Do not include private subreddit content, moderator-only material, session cookies, or account tokens in public bug reports. Fabricated fixtures are preferred.

## Known limits

- Reddit may deny JSON requests even when its normal HTML page is visible. The reader reports failure or a partial snapshot; it does not fall back to native expansion.
- Requests are serial and paced. Deep branches and large discussions can still take minutes. Rate limits and retries can lengthen this further.
- The full compact snapshot remains in memory while open, so its size still grows with the number and length of comments. Rendering is limited to 50 stream cards plus up to 50 context cards; there is no promise that arbitrarily large posts fit every phone.
- Reddit's underlying page remains loaded and uses its own memory. The script neither expands that tree nor stops Reddit's own background activity.
- The reader does not preserve native media or interactive controls in its cards. Formatting is sanitized, media is not loaded automatically, and native actions are reached through **Open on Reddit**.
- Deleted, removed, restricted, or newly arriving comments may not be returned. Completed discovery is a snapshot, not a guarantee that Reddit exposed every comment.
- Closing releases the reader's data, so reopening fetches again. Refresh replaces the snapshot and preserves only seen IDs for **NEW** labels during that open session.
