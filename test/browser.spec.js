import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { comment, more, continuation, pageHTML, path } from './fixtures.js';
const scriptPath = fileURLToPath(new URL('../dist/reddit-comment-stream.user.js', import.meta.url));
const selector = 'shreddit-comment[thingid], .thing.comment[data-fullname]';
const nodeFor = (page, id) => page.locator(`[thingid="t1_${id}"],.thing.comment[data-fullname="t1_${id}"]`);
const ids = page => page.locator('[data-rcs-flat-comment]').evaluateAll(nodes => nodes.map(node => node.getAttribute('thingid') || node.dataset.fullname));

async function install(page, kind, body, respond = () => '', options = {}) {
  const host = kind === 'old' ? 'old.reddit.com' : 'www.reddit.com';
  const requests = [];
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({ path: url.pathname, method: request.method(), type: request.resourceType() });
    if (request.resourceType() === 'document') return route.fulfill({ contentType: 'text/html', body: pageHTML(kind, body, options) });
    const response = await respond(url);
    if (typeof response === 'object') return route.fulfill({ status: response.status, body: response.body || '', headers: response.headers }).catch(() => {});
    return route.fulfill({ contentType: 'text/html', body: response }).catch(() => {});
  });
  await page.goto(`https://${host}${path}`);
  await page.addScriptTag({ path: scriptPath });
  await expect(page.getByRole('button', { name: 'Comment stream', exact: true })).toBeVisible();
  return { requests, url: `https://${host}${path}` };
}

for (const kind of ['old', 'new']) {
  if (kind === 'new') test(`${kind}: overlaps independent native branches with three slots and isolates shared parents`, async ({ page }) => {
    const gates = new Map();
    for (const key of ['a','a2','b','c','d']) {
      let release;
      const promise = new Promise(resolve => { release = resolve; });
      gates.set(key, { promise, release });
    }
    const started = [];
    let active = 0;
    let peak = 0;
    const body = comment(kind, 'pa', 100, more(kind, 'a') + more(kind, 'a2'))
      + ['b','c','d'].map(key => comment(kind, `p${key}`, 100, more(kind, key))).join('');
    await install(page, kind, body, async url => {
      const key = url.pathname.split('/').at(-1);
      started.push({ key, at: Date.now() });
      peak = Math.max(peak, ++active);
      await gates.get(key).promise;
      active--;
      return comment(kind, key, 500, '', { depth: 1 });
    });
    await page.getByRole('button', { name: 'Comment stream', exact: true }).click();
    await expect.poll(() => started.map(item => item.key)).toEqual(['a','b','c']);
    await expect(page.locator('[data-rcs-flat-comment]')).toHaveCount(0);
    gates.get('b').release();
    await expect.poll(() => started.map(item => item.key)).toEqual(['a','b','c','d']);
    // Completing b must not release a's slot or unlock a2 in the same branch.
    expect(active).toBe(3);
    gates.get('a').release();
    await expect.poll(() => started.map(item => item.key)).toEqual(['a','b','c','d','a2']);
    for (const gate of gates.values()) gate.release();
    await expect(page.locator('[data-rcs-flat-comment]')).toHaveCount(9);
    expect(peak).toBe(3);
    expect(started.slice(1).every((item, i) => item.at - started[i].at >= 300)).toBe(true);
    await page.getByRole('button', { name: 'Normal view', exact: true }).click();
    await expect(nodeFor(page, 'pa').locator('[thingid="t1_a2"],[data-fullname="t1_a2"]')).toHaveCount(1);
  });

  test(`${kind}: reorders original nodes, preserves controls and drafts, and exactly restores hierarchy`, async ({ page }, info) => {
    const body = comment(kind, 'parent', 100, comment(kind, 'child', 300, comment(kind, 'grand', 500, '', { depth: 2 }), { depth: 1 })) + comment(kind, 'sibling', 400);
    await install(page, kind, body);
    const launcher = page.getByRole('button', { name: 'Comment stream', exact: true });
    expect(await launcher.evaluate(node => getComputedStyle(node).position)).not.toBe('fixed');
    expect(await page.locator('#reddit-comment-stream-host').evaluate(node => node.previousElementSibling.matches('.menuarea,shreddit-comments-sort-dropdown'))).toBe(true);
    await expect(page.getByRole('button', { name: 'Return to normal view', exact: true })).toBeHidden();
    await nodeFor(page, 'child').getByRole('button', { name: 'Reply child', exact: true }).click();
    await page.getByLabel('Draft child', { exact: true }).fill('Unsent moderator reply');
    await page.evaluate(selector => {
      window.originals=[...document.querySelectorAll(selector)].map(node=>({node,parent:node.parentNode,slot:node.getAttribute('slot'),depth:node.getAttribute('depth'),vote:node.querySelector('.vote'),draft:node.querySelector('textarea')}));
    }, selector);
    await launcher.click();
    await expect.poll(() => ids(page)).toEqual(['t1_grand','t1_sibling','t1_child','t1_parent']);
    expect(await page.evaluate(() => window.originals.every(x=>x.node.isConnected&&x.vote===x.node.querySelector('.vote')&&x.draft===x.node.querySelector('textarea')))).toBe(true);
    await expect(page.getByLabel('Draft child', { exact: true })).toHaveValue('Unsent moderator reply');
    await nodeFor(page, 'child').getByRole('button', { name: 'Vote child', exact: true }).click();
    await nodeFor(page, 'child').getByRole('button', { name: 'More child', exact: true }).click();
    await expect(nodeFor(page, 'child').locator('.native-menu-content')).toBeVisible();
    await nodeFor(page, 'child').getByRole('button', { name: 'Remove child', exact: true }).click();
    await expect(nodeFor(page, 'child')).toHaveAttribute('data-moderated', 'removed');
    expect(await page.evaluate(() => window.nativeDirectClicks)).toBe(1);
    expect(await page.evaluate(() => window.nativeEvents)).toContain('Vote child');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.screenshot({ path: `test-results/native-${kind}-${info.project.name}.png` });
    await page.getByRole('button', { name: 'Return to normal view', exact: true }).click();
    expect(await page.evaluate(() => window.originals.every(x=>x.node.parentNode===x.parent&&x.node.getAttribute('slot')===x.slot&&x.node.getAttribute('depth')===x.depth))).toBe(true);
    await expect(page.getByLabel('Draft child', { exact: true })).toHaveValue('Unsent moderator reply');
    await expect(page.locator('[data-rcs-flat-comment]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Return to normal view', exact: true })).toBeHidden();
  });

  test(`${kind}: context restores the native hierarchy and can resume the same stream`, async ({ page }) => {
    await install(page, kind, comment(kind, 'parent', 100, comment(kind, 'child', 300, comment(kind, 'grand', 500, '', { depth: 2 }), { depth: 1 })));
    await page.getByRole('button', { name: 'Comment stream', exact: true }).click();
    await expect.poll(() => ids(page)).toEqual(['t1_grand','t1_child','t1_parent']);
    await page.getByRole('button', { name: 'View context for t1_child', exact: true }).click();
    await expect(nodeFor(page, 'parent').locator('[thingid="t1_child"], [data-fullname="t1_child"]')).toHaveCount(1);
    await expect(nodeFor(page, 'child')).toHaveAttribute('data-rcs-context', '');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Back to comment stream', exact: true }).click();
    await expect.poll(() => ids(page)).toEqual(['t1_grand','t1_child','t1_parent']);
  });

  test(`${kind}: recursively reveals native loaders before sorting and keeps new controls`, async ({ page }) => {
    const { requests } = await install(page, kind, comment(kind, 'parent', 100, more(kind, 'one')), url => url.pathname.endsWith('/one')
      ? comment(kind, 'child', 300, more(kind, 'two'), { depth: 1 })
      : comment(kind, 'grand', 500, '', { depth: 2 }));
    await page.getByRole('button', { name: 'Comment stream', exact: true }).click();
    await expect(page.locator('[data-rcs-flat-comment]')).toHaveCount(0);
    await expect.poll(() => ids(page)).toEqual(['t1_grand','t1_child','t1_parent']);
    await nodeFor(page, 'grand').getByRole('button', { name: 'Reply grand', exact: true }).click();
    await expect(page.getByLabel('Draft grand', { exact: true })).toBeVisible();
    expect(requests.filter(x => x.path.startsWith('/native-more/')).length).toBe(2);
    await page.getByRole('button', { name: 'Normal view', exact: true }).click();
    expect(await nodeFor(page, 'grand').evaluate(node => node.parentElement.closest('shreddit-comment,.thing.comment').getAttribute('thingid') || node.parentElement.closest('.thing.comment').dataset.fullname)).toBe('t1_child');
  });

  test(`${kind}: fetches continuation HTML in place without replacing originals or running scripts`, async ({ page }) => {
    const incoming = comment(kind, 'parent', 100, comment(kind, 'deep', 900, more(kind, 'last'), { depth: 1, body: '<p onclick="window.attack=true">Deep comment</p><script>window.attack=true</script>' }));
    const { url, requests } = await install(page, kind, comment(kind, 'parent', 100, continuation(kind, 'parent')), requested => requested.pathname.startsWith('/native-more/') ? comment(kind, 'last', 1000, '', { depth: 2 }) : pageHTML(kind, incoming));
    await page.evaluate(() => window.keptParent=document.querySelector('shreddit-comment,.thing.comment'));
    await page.getByRole('button', { name: 'Comment stream', exact: true }).click();
    await expect.poll(() => ids(page)).toEqual(['t1_last','t1_deep','t1_parent']);
    expect(page.url()).toBe(url);
    expect(await page.evaluate(() => window.keptParent===document.querySelector('[thingid="t1_parent"],[data-fullname="t1_parent"]'))).toBe(true);
    expect(await page.evaluate(() => window.attack)).toBeUndefined();
    await expect(nodeFor(page, 'deep').locator('script,[onclick]')).toHaveCount(0);
    await nodeFor(page, 'deep').getByRole('button', { name: 'Reply deep', exact: true }).click();
    await expect(page.getByLabel('Draft deep', { exact: true })).toBeVisible();
    expect(requests.every(x=>x.method==='GET')).toBe(true);
  });

  test(`${kind}: stop shows a partial stream and handles a late native reply`, async ({ page }) => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    let started = false;
    await install(page, kind, comment(kind, 'parent', 100, more(kind, 'slow')), async () => { started = true; await pending; return comment(kind, 'late', 900, '', { depth: 1 }); });
    await page.getByRole('button', { name: 'Comment stream', exact: true }).click();
    await expect.poll(()=>started).toBe(true);
    await page.getByRole('button', { name: 'Stop loading', exact: true }).click();
    await expect.poll(() => ids(page)).toEqual(['t1_parent']);
    await expect(page.getByRole('status')).toContainText('Partial');
    release();
    await expect.poll(() => ids(page)).toEqual(['t1_late','t1_parent']);
    await page.getByRole('button', { name: 'Normal view', exact: true }).click();
    await expect(nodeFor(page, 'parent').locator('[thingid="t1_late"],[data-fullname="t1_late"]')).toHaveCount(1);
  });

  test(`${kind}: loading a refreshed page adds new comments and preserves existing drafts`, async ({ page }) => {
    const incoming = comment(kind, 'parent', 100, comment(kind, 'recent', 999, '', { depth: 1 }));
    await install(page, kind, comment(kind, 'parent', 100), () => pageHTML(kind, incoming));
    await page.getByRole('button', { name: 'Reply parent', exact: true }).click();
    await page.getByLabel('Draft parent').fill('Keep my draft');
    await page.getByRole('button', { name: 'Comment stream', exact: true }).click();
    await expect.poll(() => ids(page)).toEqual(['t1_parent']);
    await page.getByRole('button', { name: 'Load new comments', exact: true }).click();
    await expect.poll(() => ids(page)).toEqual(['t1_recent','t1_parent']);
    await expect(page.getByLabel('Draft parent')).toHaveValue('Keep my draft');
  });

  test(`${kind}: returning to normal during loading cancels automatic sorting`, async ({ page }) => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    let started = false;
    await install(page, kind, comment(kind, 'parent', 100, more(kind, 'slow')), async () => { started = true; await pending; return comment(kind, 'late', 900, '', { depth: 1 }); });
    await page.getByRole('button', { name: 'Comment stream', exact: true }).click();
    await expect.poll(() => started).toBe(true);
    await page.getByRole('button', { name: 'Normal view', exact: true }).click();
    release();
    await expect(nodeFor(page, 'parent').locator('[thingid="t1_late"],[data-fullname="t1_late"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Comment stream', exact: true })).toBeEnabled();
    await expect(page.locator('[data-rcs-flat-comment]')).toHaveCount(0);
  });

  test(`${kind}: restores collapse state and the original slot after a native comment replacement`, async ({ page }) => {
    await install(page, kind, comment(kind, 'parent', 100, comment(kind, 'child', 300, '', { depth: 1 }), { collapsed: true }));
    await page.getByRole('button', { name: 'Comment stream', exact: true }).click();
    await expect.poll(() => ids(page)).toEqual(['t1_child', 't1_parent']);
    await nodeFor(page, 'child').evaluate(node => {
      const replacement = node.cloneNode(true);
      replacement.querySelector('.rcs-context-action, .rcs-context-button')?.remove();
      node.replaceWith(replacement);
    });
    await expect(page.getByRole('button', { name: 'View context for t1_child', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Normal view', exact: true }).click();
    await expect(nodeFor(page, 'parent').locator('[thingid="t1_child"],[data-fullname="t1_child"]')).toHaveCount(1);
    if (kind === 'old') await expect(nodeFor(page, 'parent')).toHaveClass(/collapsed/);
    else {
      expect(await nodeFor(page, 'parent').locator('details').first().evaluate(node => node.open)).toBe(false);
      await expect(nodeFor(page, 'child')).toHaveAttribute('depth', '1');
    }
    await expect(page.locator('[data-rcs-flat-comment]')).toHaveCount(0);
  });
}

test('canceling stops queued activations as well as concurrent workers', async ({ page }) => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let started = 0;
  await install(page, 'new', ['a','b','c','d'].map(id => comment('new', `p${id}`, 100, more('new', id))).join(''), async () => {
    started++;
    await pending;
    return comment('new', 'late', 900, '', { depth: 1 });
  });
  await page.getByRole('button', { name: 'Comment stream', exact: true }).click();
  await expect.poll(() => started).toBe(1);
  await page.getByRole('button', { name: 'Normal view', exact: true }).click();
  const canceledAt = started;
  release();
  await expect(nodeFor(page, 'late').first()).toBeVisible();
  await page.waitForTimeout(1100);
  expect(started).toBe(canceledAt);
  await expect(page.locator('[data-rcs-flat-comment]')).toHaveCount(0);
});

test('old Reddit serializes native morechildren loads while removing fixed per-branch waits', async ({ page }) => {
  let active = 0;
  let peak = 0;
  let completed = 0;
  const body = ['a','b','c'].map(id => comment('old', `p${id}`, 100, more('old', id)
    .replace('<button ', '<a href="/r/test/" onclick="window.inlineRuns=(window.inlineRuns||0)+1" ')
    .replace('</button>', '</a>'))).join('');
  const { url: originalURL } = await install(page, 'old', body, async url => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 600));
    active--;
    completed++;
    return comment('old', url.pathname.split('/').at(-1), 900, '', { depth: 1 });
  });
  await page.getByRole('button', { name: 'Comment stream', exact: true }).click();
  await expect(page.locator('[data-rcs-flat-comment]')).toHaveCount(6);
  expect(peak).toBe(1);
  expect(completed).toBe(3);
  expect(page.url()).toBe(originalURL);
  expect(await page.evaluate(() => window.inlineRuns)).toBe(3);
});

test('a rate limit pauses queued starts and slows subsequent continuation loads', async ({ page }) => {
  const attempts = new Map();
  const starts = [];
  const body = ['a','b','c'].map(id => comment('new', id, 100, continuation('new', id))).join('');
  await install(page, 'new', body, url => {
    const id = url.pathname.split('/').filter(Boolean).at(-1);
    const attempt = (attempts.get(id) || 0) + 1;
    attempts.set(id, attempt);
    starts.push(Date.now());
    if (id === 'a' && attempt === 1) return { status: 429, headers: { 'Retry-After': '1' } };
    return pageHTML('new', comment('new', id, 100, comment('new', `child${id}`, 900, '', { depth: 1 })));
  });
  await page.getByRole('button', { name: 'Comment stream', exact: true }).click();
  await expect(page.locator('[data-rcs-flat-comment]')).toHaveCount(6);
  expect(attempts.get('a')).toBe(2);
  expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1900);
  expect(starts.slice(2).every((time, i) => time - starts[i + 1] >= 900)).toBe(true);
  await expect(page.getByRole('status')).not.toContainText('Partial');
});

test('mobile reveal runs once and delayed lazy loaders finish before sorting', async ({ page }) => {
  const { requests } = await install(page, 'new', comment('new', 'parent', 100) + '<button id="native-reveal">View more comments</button>', () => comment('new', 'lazy', 900));
  await page.evaluate(() => {
    document.querySelector('shreddit-comments-sort-dropdown').remove();
    const post = document.querySelector('shreddit-post');
    post.id = post.getAttribute('post-id');
    post.removeAttribute('post-id');
    document.getElementById('reddit-comment-stream-host').remove();
  });
  await expect(page.getByRole('button', { name: 'Comment stream', exact: true })).toBeVisible();
  expect(await page.locator('#reddit-comment-stream-host').evaluate(node => node.previousElementSibling.localName)).toBe('shreddit-post');
  await page.evaluate(fragment => {
    window.reveals = 0;
    document.querySelector('#native-reveal').addEventListener('click', () => {
      window.reveals++;
      const root = document.querySelector('[data-comment-section-anchor]');
      root.insertAdjacentHTML('beforeend', fragment);
      setTimeout(() => {
        const lazy = document.createElement('faceplate-partial');
        lazy.setAttribute('src', '/svc/shreddit/more-comments/lazy');
        lazy.setAttribute('loading', 'lazy');
        // Initially outside the viewport, like a native lazy cursor page.
        lazy.style.cssText = 'display:block;margin-top:2000px;height:10px';
        root.append(lazy);
        const observer = new IntersectionObserver(async entries => {
          if (!entries.some(entry => entry.isIntersecting)) return;
          observer.disconnect();
          const response = await fetch('/native-more/lazy');
          const template = document.createElement('template');
          template.innerHTML = await response.text();
          lazy.replaceWith(template.content);
        });
        observer.observe(lazy);
      }, 900);
    });
  }, comment('new', 'revealed', 300));
  await page.getByRole('button', { name: 'Comment stream', exact: true }).click();
  await expect.poll(() => ids(page)).toEqual(['t1_lazy', 't1_revealed', 't1_parent']);
  expect(await page.evaluate(() => window.reveals)).toBe(1);
  expect(requests.filter(request => request.path === '/native-more/lazy')).toHaveLength(1);
  await expect(page.getByRole('status')).toContainText('Partial'); // The persistent native reveal is reported.
});

test('keeps native duplicate nodes restorable and the stream ahead of interspersed content', async ({ page }) => {
  await install(page, 'new', comment('new', 'parent', 100) + '<aside id="between">Native interspersed content</aside>' + comment('new', 'parent', 100));
  await page.evaluate(() => window.originals = [...document.querySelectorAll('shreddit-comment')].map(node => ({ node, next: node.nextSibling })));
  await page.getByRole('button', { name: 'Comment stream', exact: true }).click();
  await expect(page.locator('[data-rcs-flat-comment]')).toHaveCount(2);
  expect(await page.locator('#between').evaluate(node => [...node.parentElement.children].filter(n => n.matches('aside,shreddit-comment')).map(n => n.localName))).toEqual(['shreddit-comment','shreddit-comment','aside']);
  await page.getByRole('button', { name: 'Normal view', exact: true }).click();
  expect(await page.evaluate(() => window.originals.every(({ node, next }) => node.nextSibling === next))).toBe(true);
  await expect(page.locator('[data-rcs-flat-comment]')).toHaveCount(0);
});

test('unexpandable and blocked branches remain visibly partial without navigating', async ({ page }) => {
  await install(page, 'new', comment('new', 'parent', 100, continuation('new', 'parent')), () => ({ status: 403 }), { total: 20 });
  await page.getByRole('button', { name: 'Comment stream', exact: true }).click();
  await expect.poll(()=>ids(page)).toEqual(['t1_parent']);
  await expect(page.getByRole('status')).toContainText('Partial');
  await expect(page.locator('#reddit-comment-stream-host')).toContainText('HTTP 403');
  await expect(page.locator('#reddit-comment-stream-host')).toContainText('20 comments');
});

test('repeated loaders terminate and unknown times appear last', async ({ page }) => {
  const body = comment('new', 'parent', 100, more('new', 'loop')) + comment('new', 'unknown', 200).replace(/created="[^"]+"/, '').replace(/datetime="[^"]+"/, '');
  const {requests}=await install(page, 'new', body, ()=>more('new','loop'));
  await page.getByRole('button', {name:'Comment stream',exact:true}).click();
  await expect.poll(()=>ids(page)).toEqual(['t1_parent','t1_unknown']);
  await expect(page.getByRole('status')).toContainText('1 without timestamps');
  expect(requests.filter(x=>x.path.startsWith('/native-more/')).length).toBe(1);
});

test('a native tree rerender and SPA navigation safely discard the old stream', async ({page})=>{
  await install(page,'new',comment('new','first',100));
  await page.getByRole('button',{name:'Comment stream',exact:true}).click();
  await expect.poll(()=>ids(page)).toEqual(['t1_first']);
  await page.evaluate(html=>{
    const template=document.createElement('template');template.innerHTML=html;
    document.querySelector('shreddit-comment-tree').replaceWith(template.content.querySelector('shreddit-comment-tree'));
  },pageHTML('new',comment('new','replacement',300)));
  await expect(page.getByRole('button',{name:'Comment stream',exact:true})).toBeEnabled();
  await expect(page.locator('[data-rcs-flat-comment]')).toHaveCount(0);
  await expect(nodeFor(page,'first')).toHaveCount(0);
  await page.evaluate(()=>{history.pushState({},'','/r/test/');window.dispatchEvent(new PopStateEvent('popstate'));});
  await expect(page.locator('#reddit-comment-stream-host')).toHaveCount(0);
});

test('initialization waits for native post chrome and restores a removed toolbar', async ({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width"><main>Loading post</main>'}));
  await page.addInitScript({path:scriptPath});
  await page.goto('https://www.reddit.com/r/Seattle/comments/1y0m3pi/i_love_these_mushrooms/');
  await expect(page.locator('#reddit-comment-stream-host')).toHaveCount(0);
  await page.evaluate(html=>{const t=document.createElement('template');t.innerHTML=html;document.body.replaceChildren(t.content.querySelector('main'));},pageHTML('new',comment('new','first',100,'',{post:'1y0m3pi'}),{post:'1y0m3pi'}));
  const launcher=page.getByRole('button',{name:'Comment stream',exact:true});
  await expect(launcher).toBeVisible();
  await page.evaluate(()=>document.getElementById('reddit-comment-stream-host').remove());
  await expect(launcher).toBeVisible();
  await page.evaluate(await readFile(scriptPath,'utf8'));
  await expect(launcher).toHaveCount(1);
});
