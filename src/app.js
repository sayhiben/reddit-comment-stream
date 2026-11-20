import { parsePostURL } from './post.js';
import { findAdapter, NativeOrder, idOf, COMMENT } from './native.js';
import { NativeLoader } from './loader.js';
import styles from './styles.css';

(() => {
  if (window.top !== window.self) return;
  const HOST = 'reddit-comment-stream-host';
  if (document.getElementById(HOST)) return;
  let session = null;
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (text, action) => {
    const node = el('button', text);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  };

  function createSession(adapter) {
    const host = el('div');
    host.id = HOST;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.append(el('style', `
      :host{display:block;margin:10px 0;font:13px/1.5 system-ui,-apple-system,sans-serif;color:var(--color-neutral-content,#263640)}
      *{box-sizing:border-box}[hidden]{display:none!important}
      .toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
      button{font:600 13px system-ui,-apple-system,sans-serif;cursor:pointer;border:1px solid #6c8b93;border-radius:6px;padding:9px 13px;min-height:40px;background:var(--color-neutral-background,#fff);color:var(--color-neutral-content,#184854)}
      button:hover{filter:brightness(.92)}button:disabled{opacity:.6;cursor:wait}button:focus-visible{outline:3px solid #087f9b;outline-offset:2px}
      .primary{background:#075d6c;color:#fff;border-color:#075d6c}
      .status{margin:6px 0;overflow-wrap:anywhere}
      .warnings{margin:6px 0;padding-left:20px;color:var(--color-neutral-content,#6f4910)}
      .return{position:fixed;z-index:2147483646;right:max(14px,env(safe-area-inset-right));bottom:max(18px,env(safe-area-inset-bottom));box-shadow:0 2px 12px #0004;background:#075d6c;color:#fff}
      @media(prefers-color-scheme:dark){:host{color:var(--color-neutral-content,#dde9ed)}button{background:var(--color-neutral-background,#202a32);color:var(--color-neutral-content,#d7eaef)}.primary,.return{background:#075d6c;color:#fff}.warnings{color:var(--color-neutral-content,#edd697)}}
    `));
    const toolbar = el('div', '', 'toolbar');
    toolbar.setAttribute('role', 'group');
    toolbar.setAttribute('aria-label', 'Comment stream controls');
    const activate = button('Comment stream', () => start({ refresh: state === 'flat' }));
    activate.className = 'primary';
    const stop = button('Stop loading', () => controller?.abort());
    const normal = button('Normal view', () => restore());
    const floatingReturn = button('Return to normal view', () => restore());
    floatingReturn.className = 'return';
    const status = el('p', '', 'status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const warnings = el('ul', '', 'warnings');
    toolbar.append(activate, stop, normal);
    shadow.append(toolbar, status, warnings, floatingReturn);
    let state = 'normal';
    let disposed = false;
    let controller = null;
    let generation = 0;
    let lastResult = null;
    let contextNote = null;
    let selected = null;
    const order = new NativeOrder(adapter, showContext, ({ count, unknown }) => {
      if (state !== 'flat') return;
      const partial = lastResult && !lastResult.complete;
      status.textContent = `${partial ? 'Partial load · ' : ''}${count.toLocaleString()} native comments · Newest first${unknown ? ` · ${unknown} without timestamps are last` : ''}`;
    });

    function controls() {
      const loading = state === 'loading';
      activate.disabled = loading;
      activate.textContent = loading ? 'Loading comments…' : state === 'flat' ? 'Load new comments' : 'Comment stream';
      activate.setAttribute('aria-pressed', String(state === 'flat'));
      stop.hidden = !loading;
      normal.hidden = state === 'normal';
      floatingReturn.hidden = state !== 'flat';
      warnings.hidden = !warnings.childElementCount;
    }

    function clearContext() {
      contextNote?.remove();
      selected?.removeAttribute('data-rcs-context');
      selected = null;
    }

    function restore() {
      generation++;
      controller?.abort();
      clearContext();
      const visible = adapter.comments().find(node => { const r = node.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; });
      order.restore();
      state = 'normal';
      status.textContent = 'Normal thread order restored.';
      warnings.replaceChildren();
      controls();
      if (visible?.isConnected) visible.scrollIntoView({ block: 'nearest' });
    }

    function showContext(id) {
      restore();
      const node = adapter.comments().find(node => idOf(node) === id);
      if (!node) return;
      selected = node;
      node.setAttribute('data-rcs-context', '');
      for (let ancestor = node; ancestor; ancestor = ancestor.parentElement?.closest(COMMENT)) {
        const details = [...ancestor.querySelectorAll('details[role="article"]')].find(child => child.closest(COMMENT) === ancestor);
        if (details) details.open = true;
        ancestor.removeAttribute('collapsed');
        if (ancestor.classList.contains('collapsed')) ancestor.querySelector('a.expand')?.click();
      }
      contextNote = el('div', '', 'rcs-context-note');
      contextNote.append(el('span', 'Selected comment · '), button('Back to comment stream', () => start({ load: false })));
      adapter.actionContainer(node).after(contextNote);
      state = 'context';
      status.textContent = 'Showing the selected comment in Reddit’s original hierarchy.';
      controls();
      node.scrollIntoView({ block: 'center' });
      contextNote.querySelector('button').focus({ preventScroll: true });
    }

    async function start({ load = true, refresh = false } = {}) {
      if (disposed || state === 'loading') return;
      const run = ++generation;
      clearContext();
      order.restore();
      warnings.replaceChildren();
      if (load) {
        state = 'loading';
        controller = new AbortController();
        status.textContent = 'Revealing native replies before sorting…';
        controls();
        const loader = new NativeLoader(adapter, {
          signal: controller.signal,
          expand: () => order.expand(),
          onProgress: ({ count, pending, active = 0 }) => {
            if (!disposed && run === generation) status.textContent = `Loading · ${count.toLocaleString()} native comments · ${pending} branches left · ${active} loading`;
          },
        });
        lastResult = await loader.load({ refresh });
        if (disposed || run !== generation) return;
      }
      state = 'flat';
      for (const message of lastResult?.warnings || []) warnings.append(el('li', message));
      if (lastResult?.stopped) warnings.prepend(el('li', 'Loading stopped. Comments revealed so far are sorted; an in-flight native request may still finish.'));
      order.flatten();
      controls();
      if (load) adapter.root.scrollIntoView({ block: 'start' });
    }

    controls();
    adapter.mount(host);
    return {
      adapter, host,
      dispose() { disposed = true; generation++; controller?.abort(); order.restore(); clearContext(); host.remove(); },
    };
  }

  function checkRoute() {
    if (!document.documentElement) return;
    const post = parsePostURL(location.href);
    const adapter = post && findAdapter(post);
    if (session && (!adapter || session.adapter.post.id !== post.id || session.adapter.root !== adapter.root)) {
      session.dispose();
      session = null;
    }
    if (!adapter) return;
    if (!document.getElementById('reddit-comment-stream-styles')) {
      const style = el('style', styles);
      style.id = 'reddit-comment-stream-styles';
      (document.head || document.documentElement).append(style);
    }
    if (!session) session = createSession(adapter);
    else if (!session.host.isConnected) adapter.mount(session.host);
  }
  checkRoute();
  window.addEventListener('popstate', checkRoute);
  window.addEventListener('pageshow', checkRoute);
  document.addEventListener('DOMContentLoaded', checkRoute, { once: true });
  window.setInterval(checkRoute, 800);
})();
