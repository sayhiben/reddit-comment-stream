import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const scriptPath = fileURLToPath(new URL('../dist/reddit-comment-stream.user.js', import.meta.url));
const postPath = '/r/test/comments/abc123/a_post/';
const reportedURL = 'https://www.reddit.com/r/Seattle/comments/1y0m3pi/i_love_these_mushrooms/';

function comment(id, created, body, replies = [], parent = 't3_abc123', extra = {}) {
  return {
    kind: 't1',
    data: {
      id, name: `t1_${id}`, parent_id: parent, link_id: 't3_abc123',
      author: `author_${id}`, created_utc: created, body,
      body_html: `<div class="md"><p>${body}</p></div>`, score: 1,
      permalink: `${postPath}${id}/`,
      replies: replies.length ? { kind: 'Listing', data: { children: replies, after: null } } : '',
      ...extra,
    },
  };
}

function more(children, parent = 't3_abc123', count = children.length) {
  return { kind: 'more', data: { id: children[0] || '_', children, parent_id: parent, count } };
}

function listing(children, count = null, id = 'abc123') {
  return [
    { kind: 'Listing', data: { children: [{ kind: 't3', data: {
      id, name: `t3_${id}`, title: 'A busy moderation thread', subreddit: 'test',
      num_comments: count, permalink: postPath,
    } }], after: null } },
    { kind: 'Listing', data: { children, after: null } },
  ];
}

async function install(page, { host = 'www.reddit.com', respond } = {}) {
  const requests = [];
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({ url, method: request.method(), type: request.resourceType() });
    if (url.hostname.endsWith('reddit.com') && request.resourceType() === 'document') {
      await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><title>Fixture Reddit</title>${host !== 'old.reddit.com' ? '<meta name="viewport" content="width=device-width, initial-scale=1">' : ''}</head><body>
        <header>Reddit fixture</header><main id="native"><h1>A busy moderation thread</h1>
        ${host === 'old.reddit.com' ? '<div class="commentarea"><div class="menuarea">Sort comments</div><div id="native-thread" class="sitetable nestedlisting"><div class="thing comment">Original thread</div></div></div>' : '<shreddit-post post-id="t3_abc123"></shreddit-post><shreddit-comments-sort-dropdown>Sort comments</shreddit-comments-sort-dropdown><shreddit-comment-tree id="native-thread"><shreddit-comment thingid="t1_parent">Original thread</shreddit-comment></shreddit-comment-tree>'}
        </main></body></html>` });
    } else if (url.hostname === host && (url.pathname.endsWith('.json') || url.pathname.includes('/api/morechildren'))) {
      const response = await respond(url, request);
      if (response?.status) {
        await route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body || {}), headers: response.headers });
      } else {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) }).catch(() => {});
      }
    } else {
      await route.abort();
    }
  });
  await page.goto(`https://${host}${postPath}`);
  await page.evaluate(() => {
    const tree = document.getElementById('native-thread');
    tree.insertAdjacentHTML('beforeend', '<details><summary>Collapsed reply</summary>Hidden content</details><button class="morecomments">View more comments</button>');
    window.nativeLoadClicks = 0;
    tree.querySelector('button').addEventListener('click', () => window.nativeLoadClicks++);
    window.nativeNodes = [...tree.querySelectorAll('*')];
    window.nativeHTML = tree.innerHTML;
  });
  await page.addScriptTag({ path: scriptPath });
  await page.getByRole('button', { name: 'Comment stream', exact: true }).click();
  return { requests, stream: page.getByRole('dialog', { name: 'Reddit comment stream', exact: true }) };
}

const ids = locator => locator.locator('article[data-comment-id]').evaluateAll(nodes => nodes.map(node => node.dataset.commentId));

test('starts at DOM readiness without waiting for slow page resources', async ({ page }) => {
  const code = await readFile(scriptPath, 'utf8');
  const runAt = code.match(/^\/\/ @run-at\s+(\S+)/m)?.[1];
  let release;
  const resource = new Promise(resolve => { release = resolve; });
  await page.route('**/*', async route => {
    if (route.request().resourceType() === 'document') {
      await route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width"><title>Thread</title><img src="/slow-image.png">' });
    } else {
      await resource;
      await route.abort().catch(() => {});
    }
  });
  // Model the manager's metadata-based lifecycle dispatch. This is not a test
  // of the installed iOS extension; it catches scripts waiting for window load.
  await page.addInitScript(({ code, runAt }) => {
    const event = runAt === 'document-end' ? 'DOMContentLoaded' : 'load';
    window.addEventListener(event, () => (0, eval)(code), { once: true });
  }, { code, runAt });
  try {
    await page.goto(reportedURL, { waitUntil: 'domcontentloaded' });
    expect(await page.evaluate(() => document.readyState)).toBe('interactive');
    const launcher = page.getByRole('button', { name: 'Comment stream', exact: true });
    await expect(launcher).toBeVisible();
    await launcher.click();
    await expect(page.getByRole('dialog', { name: 'Reddit comment stream', exact: true })).toBeVisible();
  } finally { release(); }
});

test('recovers when injected during document replacement and restores a removed host', async ({ page }) => {
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width"><title>Thread</title><main>Thread</main>' }));
  await page.goto(reportedURL);
  const code = await readFile(scriptPath, 'utf8');
  await page.evaluate(code => {
    const root = document.documentElement;
    root.remove();
    try { (0, eval)(code); } finally { document.append(root); }
  }, code);
  const launcher = page.getByRole('button', { name: 'Comment stream', exact: true });
  await expect(launcher).toBeVisible();
  await page.evaluate(() => document.getElementById('reddit-comment-stream-host').remove());
  await expect(launcher).toBeVisible();
  await page.evaluate(code);
  await expect(launcher).toHaveCount(1);
});

test('uses content-context startup on a page that rejects inline script tags', async ({ page }) => {
  await page.route('**/*', route => route.fulfill({
    contentType: 'text/html',
    headers: { 'Content-Security-Policy': "script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'" },
    body: '<!doctype html><meta name="viewport" content="width=device-width"><title>Thread</title><main>Thread</main>',
  }));
  await page.goto(reportedURL);
  const code = await readFile(scriptPath, 'utf8');
  const context = code.match(/^\/\/ @inject-into\s+(\S+)/m)?.[1];
  // Remote evaluation supplies the test's privileged entry point, analogous
  // to a manager's isolated content world. Physical Safari injection is separate.
  if (context === 'content') await page.evaluate(code);
  else await page.addScriptTag({ content: code }).catch(() => {});
  await expect(page.getByRole('button', { name: 'Comment stream', exact: true })).toBeVisible();
});

for (const host of ['old.reddit.com', 'www.reddit.com']) {
  test(`flattens nested comments by creation time on ${host}`, async ({ page }, testInfo) => {
    const child = comment('child', 300, 'Questionable reply', [comment('grandchild', 500, 'Latest nested reply', [], 't1_child')], 't1_parent');
    const { stream, requests } = await install(page, { host, respond: () => listing([
      comment('parent', 100, 'Original parent', [child]), comment('sibling', 400, 'Another top level comment'),
    ], 4) });
    await expect.poll(() => ids(stream)).toEqual(['t1_grandchild', 't1_sibling', 't1_child', 't1_parent']);
    await page.screenshot({ path: `test-results/preview-${testInfo.project.name}-${host}.png` });
    const box = await stream.boundingBox();
    const viewport = page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    await stream.locator('[data-comment-id="t1_child"]').getByLabel('More actions for comment t1_child').click();
    await stream.locator('[data-comment-id="t1_child"]').getByRole('button', { name: 'View context', exact: true }).click();
    const context = page.getByRole('dialog', { name: 'Comment context', exact: true });
    await expect(context).toBeVisible();
    await expect(context).toContainText('Original parent');
    await expect(context).toContainText('Questionable reply');
    await expect(context).toContainText('Latest nested reply');
    await page.screenshot({ path: `test-results/context-${testInfo.project.name}-${host}.png` });
    const link = context.getByRole('link', { name: 'Open on Reddit', exact: true }).first();
    await expect(link).toHaveAttribute('target', '_blank');
    expect(page.url()).toBe(`https://${host}${postPath}`);
    await context.getByRole('button', { name: 'Back to stream', exact: true }).click();
    await expect(context).not.toBeVisible();
    await stream.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(stream).not.toBeVisible();
    await expect(page.locator('#reddit-comment-stream-reader')).toHaveCount(0);
    await expect(page.locator('#native')).toContainText('Original thread');
    expect(await page.evaluate(() => {
      const tree = document.getElementById('native-thread');
      return tree.innerHTML === window.nativeHTML && window.nativeLoadClicks === 0
        && [...tree.querySelectorAll('*')].every((node, index) => node === window.nativeNodes[index]);
    })).toBe(true);
    const launcher = page.getByRole('button', { name: 'Comment stream', exact: true });
    await expect(launcher).toHaveCSS('position', 'static');
    expect(await page.locator('#reddit-comment-stream-host').evaluate(node => node.previousElementSibling.matches('.menuarea, shreddit-comments-sort-dropdown'))).toBe(true);
    if (host === 'old.reddit.com') {
      await expect(page.locator('meta[name="viewport"]')).toHaveCount(0);
    } else {
      await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', 'width=device-width, initial-scale=1');
    }
    expect(requests.every(request => request.method === 'GET')).toBe(true);
  });
}

test('loads morechildren and deep continuations before rendering sorted comments', async ({ page }) => {
  let sawMore = false;
  let sawDeep = false;
  const { stream } = await install(page, { respond: url => {
    if (url.pathname.includes('/api/morechildren')) {
      sawMore = true;
      expect(url.searchParams.get('children')).toBe('hidden');
      return { json: { errors: [], data: { things: [comment('hidden', 300, 'Hidden top level')] } } };
    }
    if (url.searchParams.has('comment')) {
      sawDeep = true;
      expect(url.searchParams.get('comment')).toBe('parent');
      return listing([comment('parent', 100, 'Parent', [comment('deep', 900, 'Deep newest reply', [], 't1_parent')])], 3);
    }
    return listing([comment('parent', 100, 'Parent', [more([], 't1_parent', 0)]), more(['hidden'])], 3);
  } });
  await expect(stream.getByRole('button', { name: 'Stop loading', exact: true })).toBeVisible();
  await expect(stream.locator('article[data-comment-id]')).toHaveCount(0);
  await expect.poll(() => ids(stream), { timeout: 30_000 }).toEqual(['t1_deep', 't1_hidden', 't1_parent']);
  expect(sawMore).toBe(true);
  expect(sawDeep).toBe(true);
});

test('stopping loading preserves a clearly partial readable result', async ({ page }) => {
  let moreRequested = false;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const { stream } = await install(page, { respond: async url => {
    if (url.pathname.includes('/api/morechildren')) {
      moreRequested = true;
      await pending;
      return { json: { errors: [], data: { things: [] } } };
    }
    return listing([comment('parent', 100, 'Available before stopping'), more(['hidden'])], 2);
  } });
  await expect.poll(() => moreRequested).toBe(true);
  await stream.getByRole('button', { name: 'Stop loading', exact: true }).click();
  release();
  await expect.poll(() => ids(stream)).toEqual(['t1_parent']);
  await expect(stream.getByRole('status')).toContainText(/partial|stopped|incomplete/i);
});

test('refresh includes newly posted replies', async ({ page }) => {
  let iteration = 0;
  const { stream } = await install(page, { respond: () => {
    iteration++;
    return listing(iteration === 1 ? [comment('first', 100, 'Existing comment')] : [
      comment('first', 100, 'Existing comment', [comment('second', 200, 'New reply', [], 't1_first')]),
    ], iteration === 1 ? 1 : 2);
  } });
  await expect.poll(() => ids(stream)).toEqual(['t1_first']);
  await stream.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => ids(stream)).toEqual(['t1_second', 't1_first']);
});

test('large snapshots paginate after global sorting and search all loaded comments', async ({ page }) => {
  const children = Array.from({ length: 2505 }, (_, index) => comment(`c${index}`, index + 1,
    index === 0 ? 'Review target in the oldest comment' : `Comment number ${index}`));
  let loads = 0;
  const { stream } = await install(page, { respond: () => { loads++; return listing(children, 2505); } });
  await expect(stream.locator('article[data-comment-id]')).toHaveCount(50);
  const initial = await ids(stream);
  expect(initial[0]).toBe('t1_c2504');
  expect(initial[49]).toBe('t1_c2455');
  await page.evaluate(() => { window.firstCard = document.getElementById('reddit-comment-stream-reader').shadowRoot.querySelector('article'); });
  for (let index = 1; index <= 5; index++) {
    await stream.getByRole('button', { name: 'Next comments', exact: true }).click();
    await expect(stream.locator('article[data-comment-id]')).toHaveCount(50);
    expect((await ids(stream))[0]).toBe(`t1_c${2504 - index * 50}`);
  }
  expect(await page.evaluate(() => window.firstCard.isConnected)).toBe(false);
  await stream.getByRole('button', { name: 'Previous comments', exact: true }).click();
  expect((await ids(stream))[0]).toBe('t1_c2304');
  await stream.getByRole('searchbox', { name: 'Filter comments' }).fill('Review target');
  await expect.poll(() => ids(stream)).toEqual(['t1_c0']);
  await stream.getByRole('searchbox', { name: 'Filter comments' }).fill('');
  await expect.poll(() => ids(stream)).toEqual(initial);
  await stream.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('#reddit-comment-stream-reader')).toHaveCount(0);
  await page.getByRole('button', { name: 'Comment stream', exact: true }).click();
  await expect.poll(() => loads).toBe(2);
  await expect.poll(() => ids(stream)).toEqual(initial);
});

test('long context branches page without accumulating cards and release cards on back', async ({ page }) => {
  const ancestors = Array.from({ length: 120 }, (_, index) => comment(`a${index}`, index + 1,
    index === 119 ? 'Selected test comment' : `Ancestor number ${index}`, [], index ? `t1_a${index - 1}` : 't3_abc123'));
  const replies = Array.from({ length: 200 }, (_, index) => comment(`r${index}`, 121 + index, `Reply ${index}`, [], 't1_a119'));
  const { stream } = await install(page, { respond: () => listing([...ancestors, ...replies], 320) });
  await expect(stream.locator('article')).toHaveCount(50);
  await stream.getByRole('searchbox', { name: 'Filter comments' }).fill('Selected test comment');
  await expect.poll(() => ids(stream)).toEqual(['t1_a119']);
  await stream.getByLabel('More actions for comment t1_a119').click();
  await stream.getByRole('button', { name: 'View context', exact: true }).click();
  const context = page.getByRole('dialog', { name: 'Comment context', exact: true });
  await expect(context.locator('article')).toHaveCount(50);
  await expect(context.locator('[data-comment-id="t1_a118"]')).toContainText('Parent comment');
  await expect(context.locator('[data-comment-id="t1_a119"]')).toContainText('Selected comment');
  await context.getByRole('button', { name: 'Previous context page' }).click();
  await context.getByRole('button', { name: 'Previous context page' }).click();
  expect((await ids(context))[0]).toBe('t1_a0');
  while (await context.getByRole('button', { name: 'Next context page' }).isEnabled()) {
    await context.getByRole('button', { name: 'Next context page' }).click();
    await expect(context.locator('article')).toHaveCount(50);
  }
  expect((await ids(context)).at(-1)).toBe('t1_r199');
  await context.getByRole('button', { name: 'Back to stream' }).click();
  await expect(page.locator('#reddit-comment-stream-reader').locator('dialog.context article')).toHaveCount(0);
  await expect(stream.locator('article')).toHaveCount(1);
});

test('closing during loading aborts collection and a later response cannot restore the reader', async ({ page }) => {
  let release;
  let started = false;
  let loads = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const { stream } = await install(page, { respond: async () => {
    if (++loads === 1) { started = true; await pending; }
    return listing([comment('fresh', 100, 'Fresh response')], 1);
  } });
  await expect.poll(() => started).toBe(true);
  await stream.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('#reddit-comment-stream-reader')).toHaveCount(0);
  release();
  await page.getByRole('button', { name: 'Comment stream', exact: true }).click();
  await expect.poll(() => ids(stream)).toEqual(['t1_fresh']);
  expect(loads).toBe(2);
  await expect(page.locator('#reddit-comment-stream-reader')).toHaveCount(1);
});

test('late post controls receive the launcher without replacing the active reader', async ({ page }) => {
  const { stream } = await install(page, { respond: () => listing([comment('one', 100, 'Keep this reader')], 1) });
  await expect.poll(() => ids(stream)).toEqual(['t1_one']);
  await page.evaluate(() => {
    document.querySelector('shreddit-comments-sort-dropdown').remove();
    document.getElementById('reddit-comment-stream-host').remove();
    document.querySelector('shreddit-post').insertAdjacentHTML('afterend', '<shreddit-comments-sort-dropdown id="late-sort">New controls</shreddit-comments-sort-dropdown>');
  });
  await expect(page.locator('#late-sort + #reddit-comment-stream-host')).toHaveCount(1);
  await expect(stream).toBeVisible();
  await expect.poll(() => ids(stream)).toEqual(['t1_one']);
});

test('a mismatch with Reddit\'s advertised count is visibly incomplete', async ({ page }) => {
  const { stream } = await install(page, { respond: () => listing([comment('only', 100, 'One returned comment')], 5) });
  await expect.poll(() => ids(stream)).toEqual(['t1_only']);
  await expect(stream.getByRole('status')).toContainText(/partial|incomplete/i);
  await expect(stream).toContainText('Reddit reports 5 comments');
});

test('blocked API responses remain recoverable through refresh', async ({ page }) => {
  let blocked = true;
  const { stream } = await install(page, { respond: () => blocked ? { status: 403 } : listing([comment('ok', 100, 'Recovered comment')], 1) });
  await expect(stream.getByRole('status')).toContainText(/403|failed|unable|blocked|partial|error/i);
  await expect(stream.locator('article[data-comment-id]')).toHaveCount(0);
  blocked = false;
  await stream.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => ids(stream)).toEqual(['t1_ok']);
});

test('comment HTML is sanitized and cannot execute scripts or load tracking media', async ({ page }) => {
  const { stream, requests } = await install(page, { respond: () => listing([comment('attack', 100, 'Safe fallback', [], 't3_abc123', {
    body_html: '<div class="md"><p>Readable content</p><script>window.__commentAttack = true</script><img src="https://tracker.invalid/pixel" onerror="window.__commentAttack = true"><a href="javascript:window.__commentAttack=true">unsafe link</a><a href="https://example.com/">safe link</a><svg onload="window.__commentAttack=true"></svg></div>',
  })], 1) });
  await expect.poll(() => ids(stream)).toEqual(['t1_attack']);
  expect(await page.evaluate(() => window.__commentAttack)).toBeUndefined();
  expect(await stream.locator('script,iframe,svg,[onload],[onerror],a[href^="javascript:"]').count()).toBe(0);
  expect(requests.some(request => request.url.hostname === 'tracker.invalid')).toBe(false);
});

test('new Reddit navigation discards the previous post and detects the next post', async ({ page }) => {
  const { stream } = await install(page, { respond: url => listing([
    comment(url.pathname.includes('def456') ? 'newpost' : 'firstpost', 100, 'Comment', [],
      url.pathname.includes('def456') ? 't3_def456' : 't3_abc123',
      { link_id: url.pathname.includes('def456') ? 't3_def456' : 't3_abc123' }),
  ], 1, url.pathname.includes('def456') ? 'def456' : 'abc123') });
  await expect.poll(() => ids(stream)).toEqual(['t1_firstpost']);
  await page.evaluate(() => {
    history.pushState({}, '', '/r/test/comments/def456/next_post/');
    document.querySelector('h1').textContent = 'A different post';
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(stream).not.toBeVisible();
  await page.getByRole('button', { name: 'Comment stream', exact: true }).click();
  await expect.poll(() => ids(page.getByRole('dialog', { name: 'Reddit comment stream', exact: true }))).toEqual(['t1_newpost']);
  await page.evaluate(() => {
    history.pushState({}, '', '/r/test/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('button', { name: 'Comment stream', exact: true })).not.toBeVisible();
});
