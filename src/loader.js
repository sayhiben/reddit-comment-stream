import { pause, stopped } from './post.js';

export class NativeLoader {
  constructor(adapter, { signal, onProgress = () => {}, expand = () => {}, delayMs = 1000, timeoutMs = 12000 } = {}) {
    Object.assign(this, { adapter, signal, onProgress, expand, delayMs, timeoutMs });
    this.attempted = new Set();
    this.warnings = new Set();
    this.requests = 0;
    this.lastRequest = 0;
  }

  async pace() {
    if (this.signal?.aborted) throw stopped();
    await pause(Math.max(0, this.lastRequest + this.delayMs - Date.now()), this.signal);
    this.lastRequest = Date.now();
    this.requests++;
  }

  async fetchPage(url) {
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.pace();
      const controller = new AbortController();
      const abort = () => controller.abort();
      this.signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, 30000);
      try {
        const response = await fetch(url.href, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal, headers: { Accept: 'text/html' } });
        if ((response.status === 429 || response.status >= 500) && attempt < 2) {
          const value = response.headers.get('Retry-After');
          const seconds = Number(value);
          const wait = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
          await pause(Math.max(wait || 0, 2000 * 2 ** attempt), this.signal);
          continue;
        }
        if (!response.ok) throw new Error(`Reddit returned HTTP ${response.status} while loading a thread.`);
        return await response.text();
      } catch (error) {
        if (this.signal?.aborted) throw stopped();
        if (error.name === 'AbortError') throw new Error('Reddit timed out while loading a thread.');
        throw error;
      } finally {
        clearTimeout(timer);
        this.signal?.removeEventListener('abort', abort);
      }
    }
  }

  async click(item) {
    await this.pace();
    const before = this.adapter.comments().length;
    if (item.button?.disabled) throw new Error('A native reply loader is still busy.');
    // Scrolling activates Reddit's intersection-based loaders, including the
    // top-level lazy partial that has no button. It also hydrates nearby UI.
    item.node.scrollIntoView({ block: 'center' });
    await pause(200, this.signal);
    if (item.node.isConnected) item.button?.click();
    const started = Date.now();
    while (Date.now() - started < this.timeoutMs) {
      await pause(200, this.signal);
      if (!item.node.isConnected || this.adapter.comments().length !== before) {
        await pause(350, this.signal);
        return;
      }
    }
    throw new Error('A native reply loader did not reveal more comments.');
  }

  async load({ refresh = false } = {}) {
    let wasStopped = false;
    let quiet = false;
    try {
      if (refresh) {
        const url = new URL(this.adapter.post.path, location.origin);
        url.searchParams.set('sort', 'new');
        url.searchParams.set('limit', '500');
        try { this.adapter.importPage(await this.fetchPage(url), { sourceURL: url.href }); }
        catch (error) { if (error.name === 'AbortError') throw error; this.warnings.add(error.message); }
      }
      for (;;) {
        if (this.signal?.aborted) throw stopped();
        this.expand();
        const remaining = this.adapter.expanders();
        this.onProgress({ count: this.adapter.comments().length, pending: remaining.length, requests: this.requests });
        const item = remaining.find(item => !this.attempted.has(item.key));
        if (!item) {
          // Reddit hydrates further loaders asynchronously after inserting
          // comments. Give that work a quiet interval before ending traversal.
          if (quiet) break;
          quiet = true;
          await pause(1200, this.signal);
          continue;
        }
        quiet = false;
        this.attempted.add(item.key);
        try {
          if (item.type === 'native') await this.click(item);
          else {
            const result = this.adapter.importPage(await this.fetchPage(item.url), { sourceURL: item.url.href, marker: item.node });
            if (!result.progressed) this.warnings.add('A continuation page did not expose additional native comments.');
          }
        } catch (error) {
          if (error.name === 'AbortError') throw error;
          this.warnings.add(error.message || 'A reply branch could not be loaded.');
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') wasStopped = true;
      else this.warnings.add(error.message);
    }
    const count = this.adapter.comments().length;
    const pending = this.adapter.expanders().length;
    if (pending) this.warnings.add(`${pending} reply loader(s) remain unexpanded.`);
    const total = this.adapter.total();
    if (total !== null && total > count) this.warnings.add(`Reddit reports ${total} comments; not all were available when loading finished. Some may be removed or inaccessible.`);
    return { count, pending, requests: this.requests, stopped: wasStopped, warnings: [...this.warnings], complete: !wasStopped && !this.warnings.size };
  }
}
