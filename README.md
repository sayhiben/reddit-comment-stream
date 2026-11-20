# Reddit Comment Stream

Review a Reddit post as a flat stream of comments, newest first, with each comment's reply context one tap away. The userscripts work with both old Reddit and the current Reddit web interface.

**[Install through your userscript extension](https://raw.githubusercontent.com/sayhiben/reddit-comment-stream/main/dist/reddit-comment-stream.user.js)** · **[Download ZIP for iOS / Files](https://github.com/sayhiben/reddit-comment-stream/releases/latest/download/reddit-comment-stream-ios.zip)**

The install link displays JavaScript source until your userscript extension handles it. For a file you can save on iPhone or iPad, use the ZIP download.

This is a read-only moderation companion. It opens its own reading view and leaves Reddit's native comment tree available for replying, voting, and moderation actions.

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

Requires iOS / iPadOS 15.4 or newer for the reading view's modal dialogs.

1. Install [Userscripts](https://github.com/quoid/userscripts#installation), open the app, and note or choose its **Userscripts Directory**.
2. Open **[Download ZIP for iOS](https://github.com/sayhiben/reddit-comment-stream/releases/latest/download/reddit-comment-stream-ios.zip)** in **Safari** and confirm **Download** if prompted. If you are viewing this inside another app, open the link in Safari first.
3. Open **Files → Browse → Downloads** and tap `reddit-comment-stream-ios.zip` to extract it. Open the extracted folder, touch and hold `reddit-comment-stream.user.js`, choose **Move**, and put it directly in the directory selected in Userscripts. Keep the `.user.js` filename. The ZIP contains only the universal script, which covers both Reddit layouts.
4. Enable the **Userscripts** Safari extension and allow it on Reddit. On the Reddit page, open **Safari → Extensions → Userscripts** and let the popup finish loading. **This step is required after copying or replacing a file:** it makes Userscripts rescan its folder. Confirm **Reddit Comment Stream** is listed and enabled, then close the popup and reload the Reddit page.
5. Look for the teal **Comment stream** button at the bottom-right of the page. Use Safari itself, not the Reddit app or another app's embedded browser.

Apple documents [finding Safari downloads](https://support.apple.com/102440), [extracting ZIP files](https://support.apple.com/102532), and [moving files](https://support.apple.com/guide/iphone/files-basics-iphe9d46e90f/ios).

**Alternative without using Files:** open the [raw `.user.js` install link](https://raw.githubusercontent.com/sayhiben/reddit-comment-stream/main/dist/reddit-comment-stream.user.js) in Safari. Seeing script source is normal. While that page is open, open Safari's **Extensions** menu, choose **Userscripts**, and use its installation prompt; allow access to that page if requested. This flow and the directory-based method are documented by [Userscripts](https://github.com/quoid/userscripts#usage).

**Installed but no button?** Open the Userscripts popup on the Reddit page first, confirm the script and global injection switch are enabled, grant website access if prompted, then reload. If the script is absent from the popup's all-scripts folder view, check that the `.user.js` file is directly inside the chosen directory and is downloaded locally. Userscripts documents the required popup rescan in its [Scripts Directory notes](https://github.com/quoid/userscripts#scripts-directory). Version 1.0.1 also explicitly uses content-context injection and starts at DOM readiness to avoid waiting for every resource on the page to finish loading.

To update a manually installed copy, download the latest ZIP, replace the existing `reddit-comment-stream.user.js` in the same folder (avoid keeping a numbered duplicate), open the Userscripts popup once, and reload Reddit.

### Android

**Stock Chrome for Android cannot install the userscript manager needed to run this.** Google's phone installation flow adds extensions to a desktop Chrome installation, not the phone. See [Chrome's extension instructions](https://support.google.com/chrome_webstore/answer/2664769?hl=en).

Use **Firefox for Android + Tampermonkey** instead: [Tampermonkey's Mozilla listing](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/) explicitly supports Firefox for Android. Install it using [Mozilla's extension instructions](https://support.mozilla.org/en-US/kb/find-and-install-add-ons-firefox-android), then open the universal install link in Firefox. Other browsers with a compatible userscript manager may work, but are not separately verified.

## Use

1. Open a Reddit post and activate **Comment stream**.
2. Let the loader finish. It gathers the post's comments and expands available hidden branches before showing the sorted stream.
3. Open a comment's **…** menu and choose **View context** to see its place in the reply hierarchy. Use the native Reddit link when you want Reddit's own controls.
4. Use **Refresh** to collect a fresh snapshot of the thread. Use **Stop loading** if you need to review the comments already collected; that result is marked partial.

The order is based on comment creation time, so a new reply deep inside an old branch appears near the top. Editing a comment does not move it to the top. Long results are initially displayed 100 at a time after collection to keep the interface responsive on phones. **Show more** appends the next 100; it does not limit collection.

**View context** shows the ancestor chain, selected comment, and direct replies, with a link to the native branch. Filter by author or comment text to narrow a large stream. **NEW** badges identify comments first seen on a refresh during the current reading session.

## How collection works

The script reads Reddit's comment JSON using your existing browser session. It follows `more` placeholders through `/api/morechildren` and fetches focused comment listings for deep “continue this thread” branches without navigating the browser away. Requests run sequentially with pacing and retry handling. Reddit documents the comment listing and expansion endpoints in its [API reference](https://www.reddit.com/dev/api/).

The loader deduplicates comments and keeps parent IDs for context. It attempts to exhaust the branches Reddit supplies; it does not deliberately stop at a fixed comment count. Large discussions can take several minutes. Keep the tab open while loading; mobile browsers can suspend background tabs.

**A completed traversal is not a guarantee that Reddit exposed every comment.** Deleted or inaccessible comments, moderator visibility, blocked accounts, API errors, rate limits, and comments arriving during collection can produce gaps. Partial results and unresolved branches are reported instead of being silently treated as complete. Refresh after loading a very active post to take a newer snapshot.

If Reddit denies a JSON request, confirm that you can open the post in the same browser and account, then try again later. The script does not bypass access restrictions or recover content that Reddit has withheld.

## Privacy and permissions

- All runtime requests go to the Reddit origin you are visiting, using that origin's normal session cookies.
- The scripts do not send comments or account data to an external service.
- They perform read requests only; they do not approve, remove, report, vote, or post.
- Each install file is self-contained, with `@grant none` and no remote runtime dependencies. Your userscript manager may check GitHub for script updates.
- Comment formatting passes through an allowlist. Embedded images become links, avoiding automatic media requests; plain text is used if the page blocks HTML parsing.
- The reading view is a snapshot. Use Reddit's native page to verify current moderation state before acting.

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

To prepare release downloads after building, run `python scripts/package-release.py` (Python 3, standard library only). It puts the three standalone scripts, the universal-only iOS ZIP, and SHA-256 checksums in `release/`. Upload those files as GitHub Release assets so the download links above serve attachments; keep raw install and metadata URLs available for extension installation and updates.

## License

[MIT](LICENSE).
