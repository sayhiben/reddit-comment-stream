# Reddit Comment Stream

Review a Reddit post as a flat stream of comments, newest first, with each comment's reply context one tap away. The userscripts work with both old Reddit and the current Reddit web interface.

**[Install through your userscript extension](https://raw.githubusercontent.com/sayhiben/reddit-comment-stream/main/dist/reddit-comment-stream.user.js)** · **[Download ZIP for iOS / Files](https://github.com/sayhiben/reddit-comment-stream/releases/latest/download/reddit-comment-stream-ios.zip)**

The install link displays JavaScript source until your userscript extension handles it. For a file you can save on iPhone or iPad, use the ZIP download.

Version **1.2.0** restores the **separate JSON reader**. It collects available comments without expanding or rearranging Reddit's native comment tree, then displays 50 comments per page. The **Comment stream** button stays in the post's comment controls, or directly below the post on layouts without those controls. Use each comment's **…** menu for context or to open its native Reddit page for replies, voting, and moderation.

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
2. Let the JSON collection finish. It follows hidden replies and deep continuations before sorting. **Stop loading** lets you review a clearly marked partial snapshot.
3. Read newest first. **Next comments** and **Previous comments** replace the current page of up to 50 cards. Filtering searches all collected comments and authors, including other pages.
4. Open a comment's **… → View context** to see its ancestor chain and direct replies, with the selected comment outlined. Long branches have their own pages. **Back to stream** returns without fetching again.
5. Choose **Open on Reddit** for native reply, vote, report, or moderation controls. The reader itself is read-only.
6. **Refresh** fetches a new snapshot; comments first seen during this open session get a **NEW** badge. **Close** cancels pending work, removes the reader, and releases its snapshot. Reopening collects fresh data.

Ordering uses comment creation time, so a new reply deep inside an old branch appears near the top. Editing a comment does not change its position. Comments without usable timestamps appear last. The script does not continuously poll for new activity.

## How collection works

The collector uses same-origin JSON GET requests with the current Reddit session. It starts with `/comments/POST_ID.json?sort=new&limit=500&raw_json=1`, expands explicit hidden IDs through `/api/morechildren.json` in batches of at most 100, and follows focused comment listings for deep “continue this thread” branches. Listing cursors and missing ancestors are also attempted. This does not navigate the page or activate native comment controls.

Requests run sequentially, with starts at least 6.5 seconds apart, respecting the [`morechildren` endpoint's concurrency restriction](https://www.reddit.com/dev/api/#GET_api_morechildren). Timeouts, bounded retries, and `Retry-After` handling cover slow responses, rate limits, and server errors. Repeated or unresolved continuations are reported instead of retried endlessly. Large discussions can still take several minutes; keep the tab in the foreground on mobile.

There is no fixed collection cap. To reduce memory use, records retain only reader fields, discarding nested response trees and unused media, award, and flair metadata. Progress updates use counts without repeatedly sorting the collection. The reader renders at most 50 cards, with at most 50 additional cards while context is open. Images and embeds appear as links instead of loading media. Paging replaces cards, closing context clears its cards, and closing the reader releases the session's data. The compact snapshot still grows with the total comment count; these limits do not guarantee arbitrary thread sizes on every phone.

**A completed traversal does not guarantee every comment was exposed.** Inaccessible or removed comments, account visibility, access challenges, rate limits, and new arrivals can leave gaps. Missing IDs, unresolved branches, denied requests, and mismatches with Reddit's reported count produce a partial-snapshot notice. Reddit may deny JSON access even when the normal page opens; sign in and try Refresh if appropriate. The reader does not fall back to expanding the native tree.

## Privacy and permissions

- Requests initiated by the script go to the Reddit origin you are visiting, using its normal session cookies. The underlying Reddit page continues its own usual requests.
- The script does not send comments or account data to an external service.
- The script only reads comments. It does not approve, remove, report, vote, or post. Native actions are available through **Open on Reddit**.
- Each install file is self-contained, with `@grant none` and no remote runtime dependencies. Your userscript manager may check GitHub for script updates.
- Reader formatting uses a small HTML allowlist. Scripts, event handlers, embedded documents, and unsafe links are discarded; external media is not automatically loaded by the reader.
- Reader data stays in memory for the open session and is not persisted. Refresh replaces the snapshot; close discards it. The underlying Reddit comments and drafts are left in place.

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

The large-thread fixture verifies global sorting and filtering across 2,505 comments while keeping rendered card counts bounded. Other tests cover context paging, cancellation, released readers, late post controls, and unchanged native comment nodes. These checks do not measure physical iPhone memory or certify against every browser memory limit.

To prepare release downloads after building, run `python scripts/package-release.py` (Python 3, standard library only). It puts the three standalone scripts, the universal-only iOS ZIP, and SHA-256 checksums in `release/`. Upload those files as GitHub Release assets so the download links above serve attachments; keep raw install and metadata URLs available for extension installation and updates.

## License

[MIT](LICENSE).
