import { pause, stopped } from './post.js';
import { COMMENT } from './native.js';

export class NativeLoader {
  constructor(adapter, { signal, onProgress = () => {}, expand = () => {}, delayMs = 350, timeoutMs = 12000, concurrency = 3, settleMs = 1200 } = {}) {
    Object.assign(this, { adapter, onProgress, expand, delayMs, timeoutMs, concurrency, settleMs });
    this.controller = new AbortController();
    this.signal = this.controller.signal;
    this.externalSignal = signal;
    this.abort = () => this.controller.abort();
    if (signal?.aborted) this.abort();
    else signal?.addEventListener('abort', this.abort, { once: true });
    this.attempted = new Set();
    this.warnings = new Set();
    this.active = new Map();
    this.waiters = new Set();
    this.requests = 0;
    this.lastRequest = 0;
    this.backoffUntil = 0;
    this.queue = Promise.resolve();
  }

  wake() { for (const wake of [...this.waiters]) wake(); }

  wait(ms) {
    if (this.signal.aborted) return Promise.reject(stopped());
    return new Promise((resolve, reject) => {
      const finish = error => {
        clearTimeout(timer);
        this.waiters.delete(wake);
        this.signal.removeEventListener('abort', abort);
        error ? reject(error) : resolve();
      };
      const wake = () => finish();
      const abort = () => finish(stopped());
      const timer = setTimeout(wake, Math.max(0, ms));
      this.waiters.add(wake);
      this.signal.addEventListener('abort', abort, { once: true });
    });
  }

  // Serialize only the start of an action, not the network/rendering wait.
  // Reserving a slot inside this queue prevents concurrent workers bursting.
  initiate(action) {
    const task = this.queue.then(async () => {
      for (;;) {
        if (this.signal.aborted) throw stopped();
        const remaining = Math.max(this.lastRequest + this.delayMs, this.backoffUntil) - Date.now();
        if (remaining <= 0) break;
        await pause(remaining, this.signal);
      }
      this.lastRequest = Date.now();
      this.requests++;
      try { return await action(); }
      finally { this.lastRequest = Date.now(); }
    });
    this.queue = task.catch(() => {});
    return task;
  }

  async fetchPage(url) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      this.signal.addEventListener('abort', abort, { once: true });
      let timer;
      try {
        let request;
        await this.initiate(() => {
          timer = setTimeout(abort, 30000);
          request = fetch(url.href, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal, headers: { Accept: 'text/html' } });
        });
        const response = await request;
        if (response.status === 429 || response.status >= 500) {
          const value = response.headers.get('Retry-After');
          const seconds = Number(value);
          const wait = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
          this.backoffUntil = Math.max(this.backoffUntil, Date.now() + Math.max(wait || 0, 2000 * 2 ** attempt));
          this.delayMs = Math.max(this.delayMs, 1000);
          this.concurrency = 1;
          if (attempt < 2) continue;
        }
        if (!response.ok) throw new Error(`Reddit returned HTTP ${response.status} while loading a thread.`);
        return await response.text();
      } catch (error) {
        if (this.signal.aborted) throw stopped();
        if (error.name === 'AbortError') throw new Error('Reddit timed out while loading a thread.');
        throw error;
      } finally {
        clearTimeout(timer);
        this.signal.removeEventListener('abort', abort);
      }
    }
  }

  scope(item) { return item.node.closest(COMMENT); }

  independent(item) {
    const scope = this.scope(item);
    for (const { item: other } of this.active.values()) {
      // Old Reddit's native morechildren endpoint permits one request at a
      // time. Retain that limit while eliminating its old fixed idle waits.
      if (this.adapter.kind === 'old' && item.type === 'native' && other.type === 'native') return false;
      // Mobile reveal buttons can replace the entire tree. Two controls in
      // one branch, including its ancestors, must not run together either.
      if (item.key.startsWith('reveal:') || other.key.startsWith('reveal:')) return false;
      const otherScope = this.scope(other);
      if ((!scope && !otherScope) || scope === otherScope
        || (scope && otherScope && (scope.contains(otherScope) || otherScope.contains(scope)))) return false;
    }
    return true;
  }

  async click(item) {
    const scope = this.scope(item);
    const comments = () => [...(scope || this.adapter.root).querySelectorAll(COMMENT)]
      .filter(node => scope || !node.parentElement?.closest(COMMENT));
    let before;
    await this.initiate(async () => {
      if (!item.node.isConnected) return;
      if (item.button?.disabled) throw new Error('A native reply loader is still busy.');
      before = new Set(comments());
      const rect = item.node.getBoundingClientRect();
      if (!item.button || rect.top < 0 || rect.bottom > innerHeight) {
        // Still use Reddit's intersection observers and native controls. Keep
        // the scroll/activation together so workers cannot steal the viewport.
        item.node.scrollIntoView({ block: 'center' });
        await pause(150, this.signal);
      }
      if (item.node.isConnected && item.button) {
        // Native old-Reddit handlers still run, but a malformed loader link
        // must never navigate this tab away while gathering comments.
        const preventNavigation = event => event.preventDefault();
        if (item.button.matches('a')) item.button.addEventListener('click', preventNavigation);
        try { item.button.click(); }
        finally { item.button.removeEventListener('click', preventNavigation); }
      }
    });
    const started = Date.now();
    while (item.node.isConnected) {
      if (this.signal.aborted) throw stopped();
      // Check only this branch. A sibling finishing must not falsely complete
      // this job and release its concurrency slot while it is still loading.
      if (before && comments().some(node => !before.has(node))) return;
      const remaining = this.timeoutMs - (Date.now() - started);
      if (remaining <= 0) throw new Error('A native reply loader did not reveal more comments.');
      await this.wait(Math.min(1000, remaining));
    }
  }

  async run(item) {
    if (item.type === 'native') return this.click(item);
    const result = this.adapter.importPage(await this.fetchPage(item.url), { sourceURL: item.url.href, marker: item.node });
    if (!result.progressed) this.warnings.add('A continuation page did not expose additional native comments.');
  }

  async load({ refresh = false } = {}) {
    let wasStopped = false;
    let quietSince = null;
    let previousCount = -1;
    let previousLoaders = '';
    const observer = new MutationObserver(() => this.wake());
    observer.observe(this.adapter.root, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'loading', 'aria-busy'] });
    try {
      if (refresh) {
        const url = new URL(this.adapter.post.path, location.origin);
        url.searchParams.set('sort', 'new');
        url.searchParams.set('limit', '500');
        try { this.adapter.importPage(await this.fetchPage(url), { sourceURL: url.href }); }
        catch (error) { if (error.name === 'AbortError') throw error; this.warnings.add(error.message); }
      }
      for (;;) {
        if (this.signal.aborted) throw stopped();
        this.expand();
        const remaining = this.adapter.expanders();
        for (const item of remaining) {
          if (this.active.size >= this.concurrency) break;
          if (this.attempted.has(item.key) || !this.independent(item)) continue;
          this.attempted.add(item.key);
          const job = { item };
          this.active.set(item.key, job);
          job.promise = this.run(item).catch(error => {
            if (error.name !== 'AbortError') this.warnings.add(error.message || 'A reply branch could not be loaded.');
          }).finally(() => { this.active.delete(item.key); this.wake(); });
        }
        const count = this.adapter.comments().length;
        const loaders = remaining.map(item => item.key).join('|');
        this.onProgress({ count, pending: remaining.length, requests: this.requests, active: this.active.size });
        if (this.active.size) quietSince = null;
        else {
          if (count !== previousCount || loaders !== previousLoaders) quietSince = null;
          quietSince ??= Date.now();
          if (Date.now() - quietSince >= this.settleMs) break;
        }
        previousCount = count;
        previousLoaders = loaders;
        // DOM changes and completed jobs wake the queue immediately. Keep one
        // settling interval at the end for loaders Reddit hydrates later.
        await this.wait(quietSince === null ? 1000 : this.settleMs - (Date.now() - quietSince));
      }
    } catch (error) {
      if (error.name === 'AbortError') wasStopped = true;
      else this.warnings.add(error.message);
    } finally {
      observer.disconnect();
      this.controller.abort();
      await Promise.allSettled([...this.active.values()].map(job => job.promise));
      this.externalSignal?.removeEventListener('abort', this.abort);
    }
    const count = this.adapter.comments().length;
    const pending = this.adapter.expanders().length;
    if (pending) this.warnings.add(`${pending} reply loader(s) remain unexpanded.`);
    const total = this.adapter.total();
    if (total !== null && total > count) this.warnings.add(`Reddit reports ${total} comments; not all were available when loading finished. Some may be removed or inaccessible.`);
    return { count, pending, requests: this.requests, stopped: wasStopped, warnings: [...this.warnings], complete: !wasStopped && !this.warnings.size };
  }
}
