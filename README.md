# Reddit Comment Stream

Review a Reddit post as a flat stream of comments, newest first, with each comment's reply context one tap away. The userscripts work with both old Reddit and the current Reddit web interface.

**[Install through your userscript extension](https://raw.githubusercontent.com/sayhiben/reddit-comment-stream/main/dist/reddit-comment-stream.user.js)** · **[Download ZIP for iOS / Files](https://github.com/sayhiben/reddit-comment-stream/releases/latest/download/reddit-comment-stream-ios.zip)**

The install link displays JavaScript source until your userscript extension handles it. For a file you can save on iPhone or iPad, use the ZIP download.

The script rearranges **Reddit's existing comment elements in place**. Comment bodies, media, votes, reply forms, menus, and moderation controls stay attached to their original comments. Draft text and event handlers survive the move. The **Comment stream** button sits beside the post's comment sorting controls, or directly below the post on layouts without those controls.

## Install

Choose **one** setup:

| Script / extension install | Download file | Where it runs |
| --- | --- | --- |
| [Universal — recommended](https://raw.githubusercontent.com/sayhiben/reddit-comment-stream/main/dist/reddit-comment-stream.user.js) | [`.user.js`](https://github.com/sayhiben/reddit-comment-stream/releases/latest/download/reddit-comment-stream.user.js) · [iOS ZIP](https://github.com/sayhiben/reddit-comment-stream/releases/latest/download/reddit-comment-stream-ios.zip) | Both old and new Reddit |
| [Old Reddit only](https://raw.githubusercontent.com/sayhiben/reddit-comment-stream/main/dist/reddit-comment-stream-old.user.js) | [`.user.js`](https://github.com/sayhiben/reddit-comment-stream/releases/latest/download/reddit-comment-stream-old.user.js) | `old.reddit.com`, `np.reddit.com` |
| [New Reddit only](https://raw.githubusercontent.com/sayhiben/reddit-comment-stream/main/dist/reddit-comment-stream-new.user.js) | [`.user.js`](https://github.com/sayhiben/reddit-comment-stream/releases/latest/download/reddit-comment-stream-new.user.js) | Current Reddit hosts |

Install the universal script, or install the old/new pair if you prefer managing them separately. They contain the same implementation; you do not need all three.

### Desktop Chrome and Firefox

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Open the universal install link above and accept Tampermonkey's installation prompt.
3. Allow the extension to run on Reddit, then reload an open Reddit post. If Chrome blocks execution, follow Tampermonkey's [userscript permission instructions](https://www.tampermonkey.net/faq.php#Q209).

### iPhone and iPad Safari

Targets iOS / iPadOS Safari 15.4 or newer.

1. Install [Userscripts](https://github.com/quoid/userscripts#installation), open the app, and note or choose its **Userscripts Directory**.
2. Open **[Download ZIP for iOS](https://github.com/sayhiben/reddit-comment-stream/releases/latest/download/reddit-comment-stream-ios.zip)** in **Safari** and confirm **Download** if prompted. If you are viewing this inside another app, open the link in Safari first.
3. Open **Files → Browse → Downloads** and tap `reddit-comment-stream-ios.zip` to extract it. Open the extracted folder, touch and hold `reddit-comment-stream.user.js`, choose **Move**, and put it directly in the directory selected in Userscripts. Keep the `.user.js` filename. The ZIP contains only the universal script, which covers both Reddit layouts.
4. Enable the **Userscripts** Safari extension and allow it on Reddit. On the Reddit page, open **Safari → Extensions → Userscripts** and let the popup finish loading. **This step is required after copying or replacing a file:** it makes Userscripts rescan its folder. Confirm **Reddit Comment Stream** is listed and enabled, then close the popup and reload the Reddit page.
5. Look for **Comment stream** beside the post's comment sorting controls, or directly below the post on mobile layouts without a sort control. Use Safari itself, not the Reddit app or another app's embedded browser.

Apple documents [finding Safari downloads](https://support.apple.com/102440), [extracting ZIP files](https://support.apple.com/102532), and [moving files](https://support.apple.com/guide/iphone/files-basics-iphe9d46e90f/ios).

**Alternative without using Files:** open the [raw `.user.js` install link](https://raw.githubusercontent.com/sayhiben/reddit-comment-stream/main/dist/reddit-comment-stream.user.js) in Safari. Seeing script source is normal. While that page is open, open Safari's **Extensions** menu, choose **Userscripts**, and use its installation prompt; allow access to that page if requested. This flow and the directory-based method are documented by [Userscripts](https://github.com/quoid/userscripts#usage).

**Installed but no button?** Open the Userscripts popup on the Reddit page first, confirm the script and global injection switch are enabled, grant website access if prompted, then reload. If the script is absent from the popup's all-scripts folder view, check that the `.user.js` file is directly inside the chosen directory and is downloaded locally. Userscripts documents the required popup rescan in its [Scripts Directory notes](https://github.com/quoid/userscripts#scripts-directory). Version 1.0.1 also explicitly uses content-context injection and starts at DOM readiness to avoid waiting for every resource on the page to finish loading.

To update a manually installed copy, download the latest ZIP, replace the existing `reddit-comment-stream.user.js` in the same folder (avoid keeping a numbered duplicate), open the Userscripts popup once, and reload Reddit.

### Android

**Stock Chrome for Android cannot install the userscript manager needed to run this.** Google's phone installation flow adds extensions to a desktop Chrome installation, not the phone. See [Chrome's extension instructions](https://support.google.com/chrome_webstore/answer/2664769?hl=en).

Use **Firefox for Android + Tampermonkey** instead: [Tampermonkey's Mozilla listing](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/) explicitly supports Firefox for Android. Install it using [Mozilla's extension instructions](https://support.mozilla.org/en-US/kb/find-and-install-add-ons-firefox-android), then open the universal install link in Firefox. Other browsers with a compatible userscript manager may work, but are not separately verified.

## Use

1. Open a Reddit post and activate **Comment stream** in the post's controls.
2. Let loading finish. The script opens collapsed comments, activates native reply loaders and lazy comment pages, and attempts deep continuation pages before sorting the comments already on the page.
3. Read and use the native comments in newest-first order, including their existing reply, menu, vote, and moderation controls.
4. Choose **View context** alongside a comment's actions to restore the actual Reddit hierarchy and highlight that comment. **Back to comment stream** returns to the sorted order without another fetch.
5. Use **Load new comments** to fetch the post again and merge newly available native comments. Existing comments and drafts are retained. Use **Stop loading** to sort the comments revealed so far; the result is marked partial.
6. **Normal view**, or the floating **Return to normal view** button, restores each comment's original position and collapse state. The floating return button appears only while comments are flattened.

Ordering uses comment creation time, so a new reply deep inside an old branch appears near the top. Editing a comment does not change its position. Comments without usable timestamps appear last. All loaded native comments remain in the document; there is no separate reader, filter, or pagination layer.

New comments that Reddit inserts while the stream is active are also sorted. The script does not poll the server continuously; use **Load new comments** when checking for new activity. Returning to normal while loading cancels sorting; a native request already in flight may still finish adding replies in their normal positions.

## How collection works

The loader uses the page's existing session and Reddit's own “more replies,” “View more comments,” and lazy-loading controls. Some of these use Reddit's native POST requests to read more comments. To activate lazy pages, loading may scroll the comment area.

On current Reddit, up to **three independent branches** can load together. Controls in the same branch or an ancestor/descendant branch wait their turn, and mobile controls that replace the whole tree run alone. Loading actions start at least 350 ms apart; the loader watches each branch's actual DOM changes instead of adding a fixed pause after every reply load. It only scrolls when needed, and retains a settling interval at the end to catch delayed loaders before sorting.

Old Reddit's native reply loads remain sequential because its [`morechildren` endpoint permits one request at a time](https://www.reddit.com/dev/api/#GET_api_morechildren). It benefits from the shorter waits too. Explicit continuation fetches that receive a rate limit or server error pause queued starts, increase spacing, and reduce subsequent concurrency. Cancellation stops queued actions immediately; already-started native requests may still finish.

For deep “continue this thread” links, it fetches the same-origin continuation page in the background and imports additional **native Reddit comment markup**, preserving its parent relationships. It skips comments already present, retains native controls, and discards fetched page scripts. It then attempts loaders inside those newly added branches. Your browser's location does not change.

The loader attempts the branches Reddit supplies without a fixed comment-count limit. Repeated cursors and nonprogressing loaders are not retried endlessly. Explicit page requests have timeouts, pacing, and retries for rate limits and server errors. Large discussions can take several minutes. Keep the tab in the foreground on mobile.

**A completed traversal does not guarantee every comment was exposed.** Inaccessible or removed comments, moderator visibility, access challenges, rate limits, and comments arriving during loading can leave gaps. Unexpanded branches, denied pages, and mismatches with Reddit's reported count are shown as partial coverage. Some Reddit page variants do not return usable native comment markup when fetched; those branches remain available through their original links.

## Privacy and permissions

- Requests initiated by the script go to the Reddit origin you are visiting, using its normal session cookies. Reddit's own components and media continue their usual requests.
- The script does not send comments or account data to an external service.
- Automatic actions only expand and load comments. The script does not automatically approve, remove, report, vote, or post. **The preserved native controls still perform their normal actions when you use them.**
- Each install file is self-contained, with `@grant none` and no remote runtime dependencies. Your userscript manager may check GitHub for script updates.
- Existing comments retain their native formatting and media. Imported continuation markup has scripts and embedded executable documents removed; event attributes and unsafe links are stripped from comment bodies. Old Reddit's own control handlers are retained.
- Refresh merges newly discovered comments; it does not replace existing comments with a fetched snapshot. Reddit remains responsible for updating vote and moderation state through its controls.

## Development and verification

Use a current Node.js LTS release.

```sh
npm ci
npm run build
npm test
npx playwright install
npm run test:browser
```

`src/` contains the source; `dist/` contains installable bundles and update metadata. Rebuild the bundles after source changes. Automated tests use controlled Reddit-shaped responses so hidden replies, deep continuations, failure handling, and navigation can be exercised repeatably.

See [compatibility and manual verification](docs/COMPATIBILITY.md) for the distinction between browser-engine testing and testing an installed userscript on a real device.

To compare native loading performance with v1.1.0, run `git fetch --tags` and `npm run benchmark` after building. The benchmark uses identical native controls, comments, and simulated response delays for both versions, and verifies that the original nodes restore. The [recorded comparison](docs/COMPATIBILITY.md#controlled-performance-comparison) took 63% less loading time on current Reddit and 36% less on old Reddit; real Reddit timings vary.

To prepare release downloads after building, run `python scripts/package-release.py` (Python 3, standard library only). It puts the three standalone scripts, the universal-only iOS ZIP, and SHA-256 checksums in `release/`. Upload those files as GitHub Release assets so the download links above serve attachments; keep raw install and metadata URLs available for extension installation and updates.

## License

[MIT](LICENSE).
