import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePostURL, branchURL, timestamp, newestFirst, pause } from '../src/post.js';

test('recognizes post and focused-comment URLs on both layouts', () => {
  for (const url of ['https://www.reddit.com/r/Seattle/comments/1y0m3pi/i_love_these_mushrooms/', 'https://old.reddit.com/r/test/comments/1y0m3pi/title/abc/?context=3', 'https://www.reddit.com/comments/1y0m3pi/comment/abc/']) assert.equal(parsePostURL(url).id, '1y0m3pi');
  for (const url of ['https://example.com/comments/abc/', 'https://reddit.com/r/test/', 'https://reddit.com/comments/abc.json', 'https://reddit.com/comments/abc/title/x.rss', 'javascript:alert(1)']) assert.equal(parsePostURL(url), null);
});
test('continuations must target a comment in this post and this origin', () => {
  const base = 'https://www.reddit.com/r/test/comments/abc/title/';
  const branch = branchURL('/r/test/comments/abc/comment/def/?context=8', base);
  assert.equal(branch.comment, 'def');
  assert.equal(branch.url.searchParams.get('context'), '0');
  assert.equal(branch.url.searchParams.get('sort'), 'new');
  for (const href of ['/r/test/comments/xyz/comment/def/', '/api/comment', '/r/test/comments/abc/title/', 'https://old.reddit.com/comments/abc/title/def/', 'javascript:alert(1)', 'https://example.com/comments/abc/title/def/']) assert.equal(branchURL(href, base), null);
});
test('normalizes native Reddit ISO dates and numeric timestamps', () => {
  assert.equal(timestamp('2026-11-20T15:49:44.067000+0000'), timestamp('2026-11-20T15:49:44.067Z'));
  assert.equal(timestamp(1700000000), timestamp(1700000000000));
  assert.equal(timestamp('not a date'), 0);
  assert.equal(timestamp(null), 0);
});
test('newest-first ordering is stable and unknown dates follow known dates', () => {
  assert.deepEqual([{ created: 0, index: 0 }, { created: 100, index: 1 }, { created: 300, index: 2 }, { created: 100, index: 3 }].sort(newestFirst).map(x => x.index), [2, 1, 3, 0]);
});
test('request pacing stops immediately when canceled', async () => {
  const controller = new AbortController();
  const pending = pause(30000, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(pause(1, controller.signal), { name: 'AbortError' });
});
