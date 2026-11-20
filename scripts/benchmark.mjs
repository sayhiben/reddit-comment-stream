// Deterministic browser benchmark. This measures the native-control path, with
// equal response latency and comment content for both userscript versions.
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { comment, more, pageHTML, path } from '../test/fixtures.js';

const baseline = process.argv[2] || 'v1.1.0';
const layouts = process.argv[3] ? [process.argv[3]] : ['old', 'new'];
const versions = [
  [baseline, execFileSync('git', ['show', `${baseline}:dist/reddit-comment-stream.user.js`], { encoding: 'utf8', maxBuffer: 2e6 })],
  ['working build', await readFile(new URL('../dist/reddit-comment-stream.user.js', import.meta.url), 'utf8')],
];
const browser = await chromium.launch();
const results = [];
try {
  for (const kind of layouts) {
    for (const [version, source] of versions) {
      const context = await browser.newContext();
      const page = await context.newPage();
      let active = 0;
      let peak = 0;
      let requests = 0;
      const body = Array.from({ length: 12 }, (_, i) => comment(kind, `parent${i}`, 100 + i, more(kind, `branch${i}`))).join('');
      await page.route('**/*', async route => {
        if (route.request().resourceType() === 'document') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: pageHTML(kind, body) });
        const match = new URL(route.request().url()).pathname.match(/^\/native-more\/branch(\d+)$/);
        if (!match) return route.fulfill({ body: '' });
        requests++;
        peak = Math.max(peak, ++active);
        await new Promise(resolve => setTimeout(resolve, 800));
        await route.fulfill({ contentType: 'text/html; charset=utf-8', body: comment(kind, `child${match[1]}`, 500 + Number(match[1]), '', { depth: 1 }) });
        active--;
      });
      await page.goto(`https://${kind === 'old' ? 'old' : 'www'}.reddit.com${path}`);
      await page.addScriptTag({ content: source });
      await page.evaluate(() => window.kept = [...document.querySelectorAll('shreddit-comment,.thing.comment')].map(node => ({ node, parent: node.parentNode })));
      const start = performance.now();
      await page.getByRole('button', { name: 'Comment stream', exact: true }).click();
      await page.getByRole('button', { name: 'Load new comments', exact: true }).waitFor({ timeout: 60000 });
      const elapsedMs = Math.round(performance.now() - start);
      const count = await page.locator('[data-rcs-flat-comment]').count();
      if (count !== 24 || requests !== 12) throw new Error(`Incomplete benchmark: ${count} comments / ${requests} requests`);
      await page.getByRole('button', { name: 'Normal view', exact: true }).click();
      if (!await page.evaluate(() => window.kept.every(({ node, parent }) => node.isConnected && node.parentNode === parent))) throw new Error('Original nodes did not restore');
      const result = { layout: kind, version, elapsedMs, comments: count, nativeLoads: requests, peakConcurrentLoads: peak };
      results.push(result);
      console.log(JSON.stringify(result));
      await context.close();
    }
  }
  for (const kind of layouts) {
    const [before, after] = results.filter(result => result.layout === kind);
    console.log(`${kind}: ${(before.elapsedMs / after.elapsedMs).toFixed(2)}× faster; ${Math.round((1 - after.elapsedMs / before.elapsedMs) * 100)}% less loading time`);
  }
} finally { await browser.close(); }
