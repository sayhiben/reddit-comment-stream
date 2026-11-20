import test from 'node:test';
import assert from 'node:assert/strict';
import { contextChain, safeURL } from '../src/render.js';

test('context follows parents rather than chronological position, detecting missing or cyclic ancestry', () => {
  const root = { name: 't1_root', parent_id: 't3_post' };
  const parent = { name: 't1_parent', parent_id: root.name };
  const child = { name: 't1_child', parent_id: parent.name };
  const comments = new Map([child, root, parent].map(item => [item.name, item]));
  assert.deepEqual(contextChain(child, comments), { chain: [root, parent, child], missing: null });
  comments.delete(root.name);
  assert.deepEqual(contextChain(child, comments), { chain: [parent, child], missing: root.name });
  parent.parent_id = child.name;
  assert.equal(contextChain(child, comments).missing, child.name);
});

test('links permit only HTTP(S), resolving Reddit relative paths', () => {
  const base = 'https://old.reddit.com';
  assert.equal(safeURL('/r/test', base), `${base}/r/test`);
  assert.equal(safeURL('https://example.com/', base), 'https://example.com/');
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/test', 'vbscript:msgbox(1)']) assert.equal(safeURL(url, base), null);
});
