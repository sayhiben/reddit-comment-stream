import { CommentCollector, parsePostURL } from './collector.js';
import { element, link, renderBody, contextChain } from './render.js';
import styles from './styles.css';

(() => {
  const HOST_ID = 'reddit-comment-stream-host';
  if (window.top !== window.self || document.getElementById(HOST_ID)) return;
  const host = element('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  const style = element('style', styles);
  shadow.append(style);

  const button = (text, action, className) => {
    const node = element('button', text, className);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  };
  const launcher = button('Comment stream', open, 'launcher');
  launcher.hidden = true;
  shadow.append(launcher);
  let post = null;
  let session = null;
  let lastURL = '';

  function checkRoute() {
    // Safari can inject while a navigation is still replacing the document.
    // Keep initialization alive until there is a root to mount into.
    if (!document.documentElement) return;
    if (location.href === lastURL && host.isConnected) return;
    lastURL = location.href;
    const next = parsePostURL(location.href);
    if (session && next?.id !== post?.id) {
      session.dispose();
      session = null;
    }
    post = next;
    launcher.hidden = !post;
    if (!host.isConnected) document.documentElement.append(host);
  }

  function open() {
    checkRoute();
    if (!post) return;
    if (!session) session = createSession({ ...post });
    session.open();
  }

  function createSession(currentPost) {
    const dialog = element('dialog', undefined, 'main');
    dialog.setAttribute('aria-label', 'Reddit comment stream');
    const shell = element('div', undefined, 'shell');
    const header = element('header');
    const heading = element('div', undefined, 'heading');
    const headingText = element('div');
    headingText.append(element('h1', 'Reddit comment stream'), element('p', 'Every level · Newest first', 'subtitle'));
    heading.append(headingText, button('Close', close));
    const title = element('p', undefined, 'title');
    const toolbar = element('div', undefined, 'toolbar');
    const refresh = button('Refresh', () => load(), 'primary');
    const stop = button('Stop loading', () => controller?.abort());
    const search = element('input', undefined, 'search');
    search.type = 'search';
    search.placeholder = 'Filter by comment or author';
    search.setAttribute('aria-label', 'Filter comments');
    search.addEventListener('input', () => { pageSize = 100; renderList(); });
    toolbar.append(refresh, stop, search);
    const status = element('p', 'Preparing to load available comments…', 'status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    header.append(heading, title, toolbar, status);
    const scroll = element('div', undefined, 'scroll');
    const notices = element('div');
    const list = element('section');
    list.setAttribute('aria-label', 'Comments newest first');
    const more = button('Show more', () => { pageSize += 100; renderList(true); }, 'more');
    more.hidden = true;
    scroll.append(notices, list, more);
    shell.append(header, scroll);
    dialog.append(shell);

    const context = element('dialog', undefined, 'context');
    context.setAttribute('aria-label', 'Comment context');
    shadow.append(dialog, context);
    let controller = null;
    let collector = null;
    let snapshot = null;
    let busy = false;
    let disposed = false;
    let generation = 0;
    let pageSize = 100;
    let comments = new Map();
    let priorIDs = null;
    let newIDs = new Set();
    let restoreViewport = null;

    function prepareViewport() {
      // Legacy Reddit omits a mobile viewport, giving even a fixed dialog a
      // ~980px layout on a phone. Adjust only while this reading view is open.
      const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
        || (navigator.maxTouchPoints > 1 && window.innerWidth > screen.width * 1.4);
      const existing = document.querySelector('meta[name="viewport" i]');
      if (!mobile || /width\s*=\s*device-width/i.test(existing?.content || '') || restoreViewport) return;
      const meta = existing || document.createElement('meta');
      const original = meta.getAttribute('content');
      const scrollPosition = [window.scrollX, window.scrollY];
      meta.name = 'viewport';
      meta.content = 'width=device-width, initial-scale=1';
      if (!existing) document.head.append(meta);
      restoreViewport = () => {
        if (!existing) meta.remove();
        else if (original === null) meta.removeAttribute('content');
        else meta.setAttribute('content', original);
        window.requestAnimationFrame(() => window.scrollTo(...scrollPosition));
        restoreViewport = null;
      };
    }

    function close() {
      if (context.open) context.close();
      controller?.abort();
      dialog.close();
      restoreViewport?.();
      launcher.focus();
    }
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('close', () => {
      if (!dialog.open) { controller?.abort(); restoreViewport?.(); }
    });

    function redditURL(comment) {
      // Construct from validated IDs rather than trusting a returned permalink.
      return `${location.origin}/comments/${currentPost.id}/_/${comment.id}/?context=8&sort=old`;
    }

    function card(comment, { inContext = false, relation = '', depth = 0, selected = false } = {}) {
      const article = element('article', undefined, `comment${selected ? ' selected' : ''}`);
      article.dataset.commentId = comment.name;
      article.style.setProperty('--depth', String(depth));
      if (relation) article.append(element('div', relation, 'relation'));
      const meta = element('div', undefined, 'meta');
      const author = String(comment.author || '[deleted]');
      const authorNode = author === '[deleted]' ? element('span', author) : link(`u/${author}`, `${location.origin}/user/${encodeURIComponent(author)}/`);
      authorNode.className = 'author';
      meta.append(authorNode);
      const date = new Date(comment.created_utc * 1000);
      const time = element('time', Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Unknown time');
      if (Number.isFinite(date.getTime())) { time.dateTime = date.toISOString(); time.title = date.toISOString(); }
      meta.append(time);
      if (comment.is_submitter) meta.append(element('span', 'OP', 'badge'));
      if (comment.distinguished) meta.append(element('span', comment.distinguished, 'badge'));
      if (newIDs.has(comment.name)) meta.append(element('span', 'NEW', 'badge'));
      if (comment.edited) meta.append(element('span', 'edited'));
      if (comment.removed || comment.banned_by || comment.removal_reason || comment.body === '[removed]') meta.append(element('span', 'Removed', 'badge mod'));
      if (comment.approved_by) meta.append(element('span', 'Approved', 'badge'));
      if (comment.locked) meta.append(element('span', 'Locked', 'badge mod'));
      article.append(meta, renderBody(comment));
      if (!inContext) {
        const parent = comments.get(comment.parent_id);
        const parentText = comment.parent_id?.startsWith('t1_') ? `Reply to ${parent ? `u/${parent.author || '[deleted]'}` : 'another comment'}` : 'Top-level comment';
        article.append(element('div', parentText, 'parent-label'));
        const actions = element('details', undefined, 'actions');
        const summary = element('summary', '…');
        summary.setAttribute('aria-label', `More actions for comment ${comment.name}`);
        const menu = element('div', undefined, 'menu');
        menu.append(button('View context', () => { actions.open = false; showContext(comment); }), link('Open on Reddit', redditURL(comment)));
        actions.append(summary, menu);
        article.append(actions);
      }
      return article;
    }

    function showContext(comment) {
      context.replaceChildren();
      const contextHeader = element('header');
      const row = element('div', undefined, 'heading');
      row.append(element('h2', 'Comment context'), button('Back to stream', () => context.close()));
      const explanation = element('p', 'Ancestor chain and direct replies. The selected comment is outlined.', 'subtitle');
      contextHeader.append(row, explanation, link('Open on Reddit', redditURL(comment)));
      const body = element('div', undefined, 'context-body');
      const { chain, missing } = contextChain(comment, comments);
      if (missing) body.append(element('p', 'An ancestor was not returned by Reddit. Open on Reddit to check the original branch.', 'notice warning'));
      chain.forEach((item, index) => body.append(card(item, { inContext: true, selected: item.name === comment.name, depth: index, relation: item.name === comment.name ? 'Selected comment' : (index === chain.length - 2 ? 'Parent comment' : 'Ancestor') })));
      const replies = snapshot.comments.filter(item => item.parent_id === comment.name).sort((a, b) => a.created_utc - b.created_utc || a.id.localeCompare(b.id));
      let shown = 0;
      const moreReplies = button('Show more replies', appendReplies, 'more');
      function appendReplies() {
        moreReplies.remove();
        for (const item of replies.slice(shown, shown + 100)) body.append(card(item, { inContext: true, depth: chain.length, relation: 'Direct reply' }));
        shown += 100;
        if (shown < replies.length) body.append(moreReplies);
      }
      appendReplies();
      if (!replies.length) body.append(element('p', 'No direct replies in the loaded snapshot.', 'subtitle'));
      context.append(contextHeader, body);
      context.showModal();
      context.scrollTop = 0;
    }

    function renderList(append = false) {
      if (busy || !snapshot) return;
      const query = search.value.trim().toLowerCase();
      const filtered = query ? snapshot.comments.filter(item => `${item.author}\n${item.body}`.toLowerCase().includes(query)) : snapshot.comments;
      const start = append ? list.childElementCount : 0;
      if (!append) list.replaceChildren();
      const fragment = document.createDocumentFragment();
      for (const comment of filtered.slice(start, pageSize)) fragment.append(card(comment));
      list.append(fragment);
      more.hidden = filtered.length <= pageSize;
      more.textContent = `Show more (${Math.max(0, filtered.length - pageSize).toLocaleString()} remaining)`;
      if (!filtered.length) list.append(element('p', query ? 'No comments match this filter.' : 'No comments were returned. If this is unexpected, check your Reddit login and try Refresh.', 'empty'));
      list.setAttribute('aria-label', `Comments newest first, ${filtered.length} matching`);
    }

    async function load() {
      if (busy || disposed) return;
      const thisGeneration = ++generation;
      controller = new AbortController();
      busy = true;
      refresh.disabled = true;
      stop.hidden = false;
      search.disabled = true;
      pageSize = 100;
      more.hidden = true;
      list.replaceChildren();
      notices.replaceChildren(element('p', 'Loading the full available thread before sorting. Large threads can take several minutes. Stop loading to review a partial snapshot.', 'notice'));
      status.textContent = 'Loading available comments…';
      collector = new CommentCollector({
        origin: location.origin, post: currentPost, signal: controller.signal,
        onProgress(progress) {
          if (disposed || thisGeneration !== generation) return;
          const count = progress.loaded ?? progress.comments?.length ?? 0;
          status.textContent = `Loading · ${count.toLocaleString()} comments · ${progress.requests || 0} requests${progress.pending ? ` · ${progress.pending} queued` : ''}${progress.phase ? ` · ${progress.phase}` : ''}`;
        },
      });
      let result;
      try { result = await collector.load(); }
      catch (error) {
        result = { ...collector.snapshot(), complete: false };
        result.warnings = [...(result.warnings || []), String(error.message || error)];
      }
      if (disposed || thisGeneration !== generation) return;
      snapshot = result;
      comments = new Map(snapshot.comments.map(comment => [comment.name, comment]));
      newIDs = new Set(priorIDs ? [...comments.keys()].filter(id => !priorIDs.has(id)) : []);
      // Keep the union across partial refreshes so previously seen comments do not
      // become falsely NEW merely because an intervening request was blocked.
      priorIDs = new Set([...(priorIDs || []), ...comments.keys()]);
      busy = false;
      refresh.disabled = false;
      stop.hidden = true;
      search.disabled = false;
      title.textContent = snapshot.postData?.title || '';
      status.textContent = `${snapshot.complete ? 'Available thread loaded' : snapshot.stopped ? 'Stopped — partial snapshot' : 'Partial snapshot'} · ${snapshot.comments.length.toLocaleString()} comments · Newest first${newIDs.size ? ` · ${newIDs.size} new` : ''}`;
      notices.replaceChildren();
      if (!snapshot.complete || snapshot.warnings?.length) {
        const warning = element('div', undefined, 'notice warning');
        warning.append(element('strong', 'This snapshot may be incomplete.'));
        const items = element('ul');
        for (const message of snapshot.warnings || []) items.append(element('li', message));
        warning.append(items, element('span', 'Refresh retries the full thread. Reddit may omit deleted, removed, restricted, or newly arriving comments.'));
        notices.append(warning);
      } else {
        notices.append(element('p', `All discovered reply placeholders were processed. This is a snapshot; refresh for new activity. Loaded at ${new Date().toLocaleTimeString()}.`, 'notice'));
      }
      renderList();
    }

    return {
      open() { if (!dialog.open) { prepareViewport(); dialog.showModal(); } if (!snapshot && !busy) load(); },
      dispose() { disposed = true; generation++; controller?.abort(); if (context.open) context.close(); if (dialog.open) dialog.close(); restoreViewport?.(); context.remove(); dialog.remove(); },
    };
  }

  checkRoute();
  // Isolated userscript worlds cannot reliably observe Reddit's history wrapper.
  // A cheap URL check also covers pushState, back/forward, and modal post routes.
  window.addEventListener('popstate', checkRoute);
  window.addEventListener('pageshow', checkRoute);
  document.addEventListener('DOMContentLoaded', checkRoute, { once: true });
  window.setInterval(checkRoute, 800);
})();
