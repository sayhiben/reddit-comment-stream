import test from 'node:test';
import assert from 'node:assert/strict';
import { CommentCollector, parsePostURL } from '../src/collector.js';

const listing = (children, after = null) => ({ kind: 'Listing', data: { children, after } });
const comment = (id, created = 1, parent = 't3_post', replies = [], extra = {}) => ({
  kind: 't1', data: { id, name: `t1_${id}`, link_id: 't3_post', parent_id: parent, created_utc: created, author: 'tester', body: id, replies: replies.length ? listing(replies) : '', ...extra },
});
const more = (children, parent = 't3_post', count = children.length) => ({ kind: 'more', data: { children, parent_id: parent, count } });
const tree = (children, count = 0, after = null) => [listing([{ kind: 't3', data: { id: 'post', name: 't3_post', num_comments: count } }]), listing(children, after)];
const hidden = things => ({ json: { errors: [], data: { things } } });
const response = (json, status = 200, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => json });
function collector(handler, options = {}) {
  const calls = [];
  const instance = new CommentCollector({
    origin: 'https://old.reddit.com', post: { id: 'post', path: '/r/test/comments/post/example/' }, delayMs: 0,
    fetchImpl: async (url, init) => {
      const parsed = new URL(url);
      calls.push({ url: parsed, init });
      return handler(parsed, calls.length, init);
    }, ...options,
  });
  return { instance, calls };
}

test('post URL parsing removes comment and context restrictions across Reddit layouts', () => {
  for (const origin of ['https://reddit.com', 'https://www.reddit.com', 'https://old.reddit.com', 'https://new.reddit.com', 'https://m.reddit.com']) {
    assert.deepEqual(parsePostURL(`${origin}/r/Seattle/comments/AbC/title/child/?context=3&depth=1`), { id: 'abc', path: '/r/Seattle/comments/AbC/title/' });
  }
  assert.deepEqual(parsePostURL('https://www.reddit.com/comments/abc/'), { id: 'abc', path: '/comments/abc/' });
  assert.deepEqual(parsePostURL('https://www.reddit.com/user/name/comments/abc/title/'), { id: 'abc', path: '/user/name/comments/abc/title/' });
  for (const url of ['https://reddit.com.evil.test/comments/abc/', 'https://notreddit.com/comments/abc/', 'https://www.reddit.com/r/Seattle/', 'https://www.reddit.com/comments/abc.json', 'https://www.reddit.com/comments/abc/title.json', 'https://www.reddit.com/comments/abc/title/comment.json', 'https://www.reddit.com/comments/abc/title/comment.rss/', 'javascript:alert(1)', 'bad']) assert.equal(parsePostURL(url), null);
});

test('flattens nested replies and sorts by comment time, regardless of sticky or thread placement', async () => {
  const { instance, calls } = collector(() => response(tree([
    comment('old', 5, 't3_post', [comment('new', 100, 't1_old')], { stickied: true }),
    comment('middle', 50),
  ], 3)));
  const result = await instance.load();
  assert.deepEqual(result.comments.map(c => c.id), ['new', 'middle', 'old']);
  assert.equal(result.complete, true);
  assert.equal(result.unresolved, 0);
  assert.equal(result.comments[0].parent_id, 't1_old');
  assert.equal(result.comments[1].replies, '');
  assert.equal(calls[0].url.pathname, '/comments/post.json');
  assert.equal(calls[0].url.searchParams.get('sort'), 'new');
  assert.equal(calls[0].url.searchParams.get('comment'), null);
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.redirect, 'error');
});

test('retains compact reader records, not nested trees or unused Reddit metadata', async () => {
  const payload = tree([comment('parent', 1, 't3_post', [comment('child', 2, 't1_parent')], {
    body_html: '<p>Comment</p>', media_metadata: { preview: 'x'.repeat(100_000) },
    all_awardings: [{ icon_url: 'https://example.com/award' }], author_flair_richtext: [{ t: 'flair' }],
    banned_by: 'moderator', approved_by: 'moderator', locked: true, is_submitter: true,
  })], 2);
  Object.assign(payload[0].data.children[0].data, { title: 'Post title', preview: { images: ['large unused image data'] } });
  const { instance } = collector(() => response(payload));
  const result = await instance.load();
  assert.equal(result.comments.length, 2);
  const parent = result.comments.find(item => item.id === 'parent');
  assert.equal(parent.body_html, '<p>Comment</p>');
  assert.equal(parent.replies, '');
  for (const field of ['media_metadata', 'all_awardings', 'author_flair_richtext', 'banned_by']) {
    assert.equal(Object.hasOwn(parent, field), false, field);
  }
  for (const flag of ['removed', 'approved_by', 'locked', 'is_submitter']) assert.equal(parent[flag], true);
  assert.deepEqual(result.postData, { id: 'post', title: 'Post title', num_comments: 2 });
  assert.equal(result.comments[0].parent_id, 't1_parent');
});

test('progress reports counts without constructing sorted snapshots during collection', async () => {
  const updates = [];
  const { instance } = collector((url, index) => response(index === 1
    ? tree([comment('parent'), more(['child'])], 2)
    : hidden([comment('child', 2, 't1_parent')])), { onProgress: update => updates.push(update) });
  let snapshots = 0;
  const snapshot = instance.snapshot.bind(instance);
  instance.snapshot = () => { snapshots++; return snapshot(); };
  const result = await instance.load();
  assert.equal(snapshots, 1, 'sort once at completion');
  assert.ok(updates.length > 2);
  assert.ok(updates.every(update => !('comments' in update) && Number.isInteger(update.loaded)));
  assert.equal(updates.at(-1).loaded, 2);
  assert.deepEqual(result.comments.map(item => item.id), ['child', 'parent']);
});

test('loads all explicit IDs in batches of at most 100 and recursively discovers more', async () => {
  const ids = Array.from({ length: 225 }, (_, index) => (1000 + index).toString(36));
  let active = 0;
  const { instance, calls } = collector(async (url, index) => {
    active++;
    assert.equal(active, 1, 'morechildren requests must be serial');
    try {
      if (index === 1) return response(tree([more(ids)], 226));
      assert.equal(url.pathname, '/api/morechildren.json');
      const batch = url.searchParams.get('children').split(',');
      assert.ok(batch.length <= 100);
      return response(hidden([...batch.map(id => comment(id)), ...(index === 2 ? [more(['extra'])] : [])]));
    } finally { active--; }
  });
  const result = await instance.load();
  assert.equal(result.comments.length, 226);
  assert.equal(calls.length, 4);
  assert.equal(result.complete, true);
  assert.ok(result.comments.some(c => c.id === 'extra'));
});

test('fetches continue-thread placeholders without navigation and discovers further deep trees', async () => {
  const { instance, calls } = collector((url, index) => {
    if (index === 1) return response(tree([comment('a', 1, 't3_post', [more([], 't1_a', 0)])], 3));
    if (url.searchParams.get('comment') === 'a') return response(tree([comment('a', 1, 't3_post', [comment('b', 2, 't1_a', [more(['_'], 't1_b', 0)])])], 3));
    if (url.searchParams.get('comment') === 'b') return response(tree([comment('b', 2, 't1_a', [comment('c', 3, 't1_b')])], 3));
    throw new Error('Unexpected request');
  });
  const result = await instance.load();
  assert.deepEqual(result.comments.map(c => c.id), ['c', 'b', 'a']);
  assert.equal(result.complete, true);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].url.searchParams.get('context'), '0');
});

test('repeated unexpandable continuation terminates and reports incomplete coverage', async () => {
  const { instance, calls } = collector(() => response(tree([comment('a', 1, 't3_post', [more([], 't1_a')])], 10)));
  const result = await instance.load();
  assert.equal(calls.length, 2);
  assert.equal(result.complete, false);
  assert.equal(result.unresolved, 1);
  assert.equal(result.countMismatch, 9);
  assert.match(result.warnings.join(' '), /could not be fully retrieved/);
});

test('missing IDs remain unresolved while duplicate comments and more stubs do not loop', async () => {
  const { instance, calls } = collector((url, index) => index === 1
    ? response(tree([comment('a'), more(['a', 'b', 'c'])], 3))
    : response(hidden([comment('b'), more(['b', 'c'])])));
  const result = await instance.load();
  assert.equal(calls.length, 2);
  assert.equal(result.comments.length, 2);
  assert.equal(result.unresolved, 1);
  assert.equal(result.complete, false);
});

test('fetches missing ancestors discovered in flat API replies', async () => {
  const { instance, calls } = collector((url, index) => index === 1
    ? response(tree([comment('child', 2, 't1_parent')], 2))
    : response(hidden([comment('parent', 1)])));
  const result = await instance.load();
  assert.equal(calls[1].url.searchParams.get('children'), 'parent');
  assert.equal(result.complete, true);
  assert.equal(instance.comments.get('t1_child').parent_id, 't1_parent');
});

test('attempts listing pagination and catches repeated cursors', async () => {
  const { instance, calls } = collector((url, index) => index === 1
    ? response(tree([comment('a')], 2, 't1_a'))
    : response(tree([comment('b')], 2, 't1_a')));
  const result = await instance.load();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url.searchParams.get('after'), 't1_a');
  assert.equal(result.comments.length, 2);
  assert.equal(result.unresolved, 1);
  assert.equal(result.complete, false);
});

test('follows a valid listing pagination cursor to exhaustion', async () => {
  const { instance } = collector((url, index) => response(index === 1
    ? tree([comment('a')], 2, 't1_a') : tree([comment('b')], 2)));
  const result = await instance.load();
  assert.equal(result.complete, true);
  assert.equal(result.comments.length, 2);
});

test('HTTP denial and non-JSON pages produce clear partial results', async () => {
  const denied = collector(() => response({}, 403));
  const result = await denied.instance.load();
  assert.equal(result.complete, false);
  assert.equal(result.requests, 1);
  assert.match(result.warnings.join(' '), /HTTP 403.*signed into Reddit/);
  const invalid = collector(() => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } }));
  const invalidResult = await invalid.instance.load();
  assert.equal(invalidResult.complete, false);
  assert.match(invalidResult.warnings.join(' '), /non-JSON/);
});

test('malformed data cannot masquerade as a complete empty post', async () => {
  for (const value of [{}, [], { json: { errors: [['BAD_REQUEST', 'No access']] } }, tree([]).map((entry, index) => index === 0 ? listing([]) : entry)]) {
    const { instance } = collector(() => response(value));
    const result = await instance.load();
    assert.equal(result.complete, false);
    assert.ok(result.warnings.length);
  }
});

test('cancellation retains fetched comments and aborts active fetch', async () => {
  const controller = new AbortController();
  const { instance, calls } = collector((url, index, init) => {
    if (index === 1) return response(tree([comment('a'), more(['b'])], 2));
    return new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
      controller.abort();
    });
  }, { signal: controller.signal });
  const result = await instance.load();
  assert.equal(calls.length, 2);
  assert.equal(result.stopped, true);
  assert.equal(result.complete, false);
  assert.equal(result.comments.length, 1);
  assert.equal(result.unresolved, 1);
  assert.deepEqual(instance.snapshot().comments.map(c => c.id), ['a']);
});

test('already-aborted collectors make no network requests', async () => {
  const controller = new AbortController();
  controller.abort();
  const { instance, calls } = collector(() => { throw new Error('must not fetch'); }, { signal: controller.signal });
  const result = await instance.load();
  assert.equal(calls.length, 0);
  assert.equal(result.stopped, true);
});

test('429 honors Retry-After and retries, without parallel requests', async () => {
  const { instance, calls } = collector((url, index) => index === 1
    ? response({}, 429, { 'Retry-After': '1.1' }) : response(tree([], 0)));
  const started = Date.now();
  const result = await instance.load();
  assert.equal(calls.length, 2);
  assert.ok(Date.now() - started >= 1000);
  assert.equal(result.complete, true);
});

test('request pacing can be canceled promptly before the next fetch', async () => {
  const controller = new AbortController();
  const { instance, calls } = collector(() => response(tree([more(['b'])], 1)), {
    signal: controller.signal, delayMs: 10000,
    onProgress: progress => { if (progress.phase.startsWith('Waiting')) controller.abort(); },
  });
  const result = await instance.load();
  assert.equal(calls.length, 1);
  assert.equal(result.stopped, true);
});

test('remaining comment count is reported even with no more stubs', async () => {
  const { instance } = collector(() => response(tree([comment('a')], 4)));
  const result = await instance.load();
  assert.equal(result.complete, false);
  assert.equal(result.countMismatch, 3);
  assert.match(result.warnings.join(' '), /Reddit reports 4 comments; 1 were returned/);
});

test('comments from a different post are rejected', async () => {
  const { instance } = collector(() => response(tree([comment('a', 1, 't3_other', [], { link_id: 't3_other' })], 1)));
  const result = await instance.load();
  assert.equal(result.comments.length, 0);
  assert.equal(result.complete, false);
});

test('request timeouts retry a bounded number of times and preserve partial results', async () => {
  const { instance, calls } = collector((url, index, init) => {
    if (index === 1) return response(tree([comment('a'), more(['b'])], 2));
    return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'AbortError' })), { once: true }));
  }, { timeoutMs: 5 });
  const result = await instance.load();
  assert.equal(calls.length, 4);
  assert.equal(result.comments.length, 1);
  assert.equal(result.complete, false);
  assert.equal(result.unresolved, 1);
  assert.match(result.warnings.join(' '), /too long to respond after three attempts/);
});

test('exhausted server-error retries report the HTTP status and terminate', async () => {
  const { instance, calls } = collector(() => response({}, 503));
  const result = await instance.load();
  assert.equal(calls.length, 3);
  assert.equal(result.complete, false);
  assert.match(result.warnings.join(' '), /HTTP 503/);
});

test('a continuation returning only its parent is unresolved despite previously loaded children', async () => {
  const { instance } = collector((url, index) => response(index === 1
    ? tree([comment('a', 1, 't3_post', [comment('b', 2, 't1_a'), more([], 't1_a')])], 2)
    : tree([comment('a')], 2)));
  const result = await instance.load();
  assert.equal(result.comments.length, 2);
  assert.equal(result.unresolved, 1);
  assert.equal(result.complete, false);
});

test('mixed invalid and valid placeholder IDs warn without losing valid replies', async () => {
  const { instance } = collector((url, index) => index === 1
    ? response(tree([more(['a', 'invalid!'])], 1)) : response(hidden([comment('a')])));
  const result = await instance.load();
  assert.equal(result.comments.length, 1);
  assert.equal(result.complete, false);
  assert.match(result.warnings.join(' '), /invalid ID/);
});

test('a continuation can reveal a normal more placeholder whose children then resolve', async () => {
  for (const includeChild of [true, false]) {
    const { instance, calls } = collector((url, index) => {
      if (index === 1) return response(tree([comment('a', 1, 't3_post', [more([], 't1_a')])], 2));
      if (index === 2) return response(tree([comment('a', 1, 't3_post', [more(['b'], 't1_a', 1)])], 2));
      return response(hidden(includeChild ? [comment('b', 2, 't1_a')] : []));
    });
    const result = await instance.load();
    assert.equal(calls.length, 3);
    assert.equal(calls[1].url.searchParams.get('comment'), 'a');
    assert.equal(calls[2].url.searchParams.get('children'), 'b');
    assert.equal(result.complete, includeChild);
    assert.equal(result.unresolved, includeChild ? 0 : 1);
  }
});
