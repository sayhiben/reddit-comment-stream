import { branchURL, timestamp, newestFirst } from './post.js';

export const COMMENT = 'shreddit-comment[thingid], .thing.comment[data-fullname]';
const validID = /^t1_[a-z0-9]+$/i;
export const idOf = node => node?.getAttribute('thingid') || node?.getAttribute('data-fullname');
const owner = node => node?.closest(COMMENT);

function own(node, selector) {
  return [...node.querySelectorAll(selector)].find(child => owner(child) === node);
}

export function findAdapter(post, scope = document) {
  const tree = [...scope.querySelectorAll('shreddit-comment-tree')].find(node => !node.getAttribute('post-id') || node.getAttribute('post-id') === `t3_${post.id}`);
  if (tree) return new NativeAdapter(post, tree, tree.querySelector('[data-comment-section-anchor], section[aria-label="Comments"]') || tree, 'new');
  const area = scope.querySelector('.commentarea');
  const postNode = scope.querySelector('.thing.link[data-fullname]');
  if (area && (!postNode || postNode.getAttribute('data-fullname') === `t3_${post.id}`)) {
    const root = area.querySelector(':scope > .sitetable') || area.querySelector('.sitetable');
    if (root) return new NativeAdapter(post, area, root, 'old');
  }
  return null;
}

export class NativeAdapter {
  constructor(post, tree, root, kind) { Object.assign(this, { post, tree, root, kind }); }

  comments() {
    return [...this.root.querySelectorAll(COMMENT)].filter(node => validID.test(idOf(node))
      && (!node.getAttribute('postid') || node.getAttribute('postid') === `t3_${this.post.id}`));
  }

  mount(host) {
    const chrome = this.kind === 'old'
      ? this.tree.querySelector('.menuarea, .panestack-title')
      : this.tree.closest('main')?.querySelector('shreddit-comments-sort-dropdown') || document.querySelector(`shreddit-post#t3_${this.post.id}, shreddit-post[post-id="t3_${this.post.id}"]`);
    if (chrome) chrome.after(host);
    else this.root.before(host);
  }

  date(node) {
    return timestamp(node.getAttribute('created'))
      || timestamp(own(node, 'time[datetime]')?.getAttribute('datetime'))
      || timestamp(own(node, 'faceplate-timeago[ts]')?.getAttribute('ts'))
      || timestamp(node.getAttribute('data-timestamp'));
  }

  total() {
    const value = this.tree.getAttribute('total-comments');
    if (value !== null && /^\d+$/.test(value)) return Number(value);
    return null;
  }

  expand(records) {
    for (const node of this.comments()) {
      const id = idOf(node);
      if (!records.has(id)) records.set(id, { node, details: own(node, 'details[role="article"]'), open: own(node, 'details[role="article"]')?.open, collapsed: node.classList.contains('collapsed'), collapsedAttribute: node.getAttribute('collapsed') });
      const details = own(node, 'details[role="article"]');
      if (details && !details.open) details.open = true;
      node.removeAttribute('collapsed');
      if (this.kind === 'old' && node.classList.contains('collapsed')) {
        const expand = own(node, 'a.expand');
        if (expand) expand.click();
      }
    }
  }

  childContainer(parent) {
    if (!parent) return this.root;
    if (this.kind === 'new') return own(parent, '#comment-children') || parent;
    let child = [...parent.children].find(node => node.classList.contains('child'));
    if (!child) { child = document.createElement('div'); child.className = 'child'; parent.append(child); }
    let list = child.querySelector(':scope > .sitetable');
    if (!list) { list = document.createElement('div'); list.className = 'sitetable'; child.append(list); }
    return list;
  }

  actionContainer(node) {
    return own(node, '.flat-list.buttons, [slot="actionRow"], shreddit-comment-action-row') || own(node, '[slot="comment"], .entry') || node;
  }

  expanders({ detached = false, baseURL = location.href } = {}) {
    const result = [];
    for (const node of this.root.querySelectorAll('faceplate-partial[src]')) {
      const src = node.getAttribute('src');
      if (!/\/more-comments\//.test(src)) continue;
      const button = [...node.querySelectorAll('button')].find(b => !b.hasAttribute('aria-hidden') && !b.closest('[slot="loading"]'));
      if (!button && node.getAttribute('loading') !== 'lazy') continue;
      const cursor = [...node.querySelectorAll('input[type="hidden"]')].map(input => `${input.name}=${input.value}`).join('&');
      result.push({ type: 'native', node, button, owner: idOf(owner(node)), key: `partial:${src}:${cursor}` });
    }
    // Mobile Reddit can initially render a plain tree-level reveal button,
    // before its cursor-based loaders and the rest of the tree exist.
    for (const button of this.root.querySelectorAll('button')) {
      if (owner(button) || button.closest('faceplate-partial') || !/^(view|show|load) more comments$/i.test(button.textContent.trim())) continue;
      result.unshift({ type: 'native', node: button, button, key: `reveal:${button.id || button.textContent.trim()}` });
    }
    for (const node of this.root.querySelectorAll('.morecomments, .deepthread, a.more-comments-link')) {
      if (node.parentElement?.closest('.morecomments, .deepthread, a.more-comments-link')) continue;
      const control = node.matches('a') ? node : node.querySelector('a, button');
      if (!control) continue;
      const branch = branchURL(control.getAttribute('href') || '', baseURL);
      if (branch) {
        // Modern Reddit provides a hidden fallback link beside its live loader.
        if (!detached && node.matches('.more-comments-link') && !node.getClientRects().length) continue;
        const parent = owner(node);
        if (!node.hasAttribute('top-level') && result.some(item => item.owner === idOf(parent))) continue;
        result.push({ type: 'branch', node, owner: idOf(parent), ...branch, key: `branch:${branch.comment}` });
      } else if (this.kind === 'old') {
        result.push({ type: 'native', node, button: control, owner: idOf(owner(node)), key: `old:${node.id}:${control.getAttribute('onclick') || control.id || node.textContent.trim()}` });
      }
    }
    return result;
  }

  importPage(html, { sourceURL, marker } = {}) {
    // Parse into an inert template. Only comments and expansion controls from
    // the matching Reddit post are adopted; full-page scripts never run here.
    const template = document.createElement('template');
    template.innerHTML = html;
    const source = findAdapter(this.post, template.content);
    if (!source || source.kind !== this.kind) throw new Error('Reddit did not return a matching native comment tree.');
    const fetched = source.comments();
    const items = fetched.map(node => ({ node, id: idOf(node), parent: idOf(owner(node.parentElement)) }));
    const more = source.expanders({ detached: true, baseURL: sourceURL || location.href });
    const existing = new Map(this.comments().map(node => [idOf(node), node]));
    const keys = new Set(this.expanders({ detached: true }).map(item => item.key));
    for (const { node } of items) node.remove();
    let added = 0;
    let addedLoaders = 0;
    const clean = node => {
      node.querySelectorAll('script, iframe, object, embed, base, link, meta').forEach(child => child.remove());
      // Reddit's own inline control handlers are retained on old Reddit. User
      // comment bodies never need event-handler attributes or javascript links.
      for (const body of node.querySelectorAll('.md, [slot="comment"]')) {
        for (const child of [body, ...body.querySelectorAll('*')]) {
          for (const attr of [...child.attributes]) if (/^on/i.test(attr.name)) child.removeAttribute(attr.name);
          for (const attr of ['href', 'src', 'xlink:href']) if (/^\s*(javascript|vbscript|data):/i.test(child.getAttribute(attr) || '')) child.removeAttribute(attr);
        }
      }
      return document.adoptNode(node);
    };
    for (const item of items) {
      if (existing.has(item.id)) continue;
      const node = clean(item.node);
      const parent = existing.get(item.parent);
      const target = this.childContainer(parent);
      if (this.kind === 'new') {
        if (target === parent) node.setAttribute('slot', 'children');
        else node.removeAttribute('slot');
      }
      target.append(node);
      existing.set(item.id, node);
      added++;
    }
    for (const item of more) {
      if (item.node.isConnected || keys.has(item.key)) continue;
      this.childContainer(existing.get(item.owner)).append(clean(item.node));
      keys.add(item.key);
      addedLoaders++;
    }
    if (!fetched.length && /(?:login|blocked|challenge)/i.test(template.content.textContent || '')) throw new Error('Reddit returned a sign-in or access page.');
    const progressed = added > 0 || addedLoaders > 0;
    if (marker && progressed) marker.remove();
    return { added, progressed, sourceURL };
  }
}

/** Moves the actual nodes, with comment markers recording their original slots. */
export class NativeOrder {
  constructor(adapter, onContext, onChange) {
    Object.assign(this, { adapter, onContext, onChange });
    this.records = new Map();
    this.latestByID = new Map();
    this.expanded = new Map();
    this.active = false;
    this.observer = new MutationObserver(() => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { if (this.active) this.flatten(); }, 200);
    });
  }

  expand() { this.adapter.expand(this.expanded); }

  flatten() {
    this.observer.disconnect();
    clearTimeout(this.timer);
    this.expand();
    for (const node of this.adapter.comments()) {
      const id = idOf(node);
      let record = this.records.get(node);
      if (record?.node === node && record.button?.isConnected) continue;
      if (!record) {
        // A framework may replace a comment while preserving its ID. Reuse
        // its original slot only after the previous node has left the page.
        const previous = this.latestByID.get(id);
        if (previous && !previous.node.isConnected && previous.marker.isConnected) record = previous;
        if (record) this.records.delete(record.node);
      }
      if (!record || !record.marker.isConnected) {
        const marker = document.createComment(`comment-stream:${id}`);
        node.before(marker);
        record = { id, marker, depth: node.getAttribute('depth'), slot: node.getAttribute('slot'), index: this.records.size };
      }
      record.node = node;
      record.created = this.adapter.date(node);
      record.button?.remove();
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'rcs-context-button';
      button.textContent = 'View context';
      button.setAttribute('aria-label', `View context for ${id}`);
      button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); this.onContext(id); });
      const actions = this.adapter.actionContainer(node);
      if (actions.matches('ul, ol')) { const li = document.createElement('li'); li.className = 'rcs-context-action'; li.append(button); actions.append(li); record.button = li; }
      else { actions.append(button); record.button = button; }
      this.records.set(node, record);
      this.latestByID.set(id, record);
    }
    if (!this.end?.isConnected) {
      this.end = document.createComment('comment-stream:end');
      // Keep the stream at the start of the existing comment area. Appending
      // it would put every interspersed ad and bottom loader above the stream.
      let first = this.adapter.comments()[0];
      while (first && first.parentNode !== this.adapter.root) first = first.parentElement;
      this.adapter.root.insertBefore(this.end, first || null);
    }
    const records = [...this.records.values()].filter(record => this.adapter.root.contains(record.node)).sort(newestFirst);
    let next = this.end;
    for (const record of [...records].reverse()) {
      const node = record.node;
      node.setAttribute('data-rcs-flat-comment', '');
      if (this.adapter.kind === 'new') { if (node.getAttribute('depth') !== '0') node.setAttribute('depth', '0'); node.removeAttribute('slot'); }
      if (node.parentNode !== this.adapter.root || node.nextSibling !== next) this.adapter.root.insertBefore(node, next);
      next = node;
    }
    this.active = true;
    this.adapter.root.setAttribute('data-rcs-flat', '');
    this.observer.observe(this.adapter.root, { childList: true, subtree: true });
    this.onChange?.({ count: records.length, unknown: records.filter(record => !record.created).length });
  }

  restore() {
    this.active = false;
    clearTimeout(this.timer);
    this.observer.disconnect();
    for (const record of this.records.values()) {
      const { node, marker } = record;
      record.button?.remove();
      if (node.isConnected && marker.isConnected) marker.before(node);
      node.removeAttribute('data-rcs-flat-comment');
      for (const attr of ['depth', 'slot']) {
        if (record[attr] === null) node.removeAttribute(attr);
        else node.setAttribute(attr, record[attr]);
      }
      marker.remove();
    }
    for (const record of this.expanded.values()) {
      if (record.details?.isConnected) record.details.open = record.open;
      if (record.collapsedAttribute !== null && record.node.isConnected) record.node.setAttribute('collapsed', record.collapsedAttribute);
      if (record.collapsed && record.node.isConnected && !record.node.classList.contains('collapsed')) own(record.node, 'a.expand')?.click();
    }
    this.records.clear();
    this.latestByID.clear();
    this.expanded.clear();
    this.end?.remove();
    this.adapter.root.removeAttribute('data-rcs-flat');
  }
}
