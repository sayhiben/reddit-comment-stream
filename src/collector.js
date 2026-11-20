const ID = /^[a-z0-9]+$/i;
const COMMENT = /^t1_([a-z0-9]+)$/i;

/** Recognize a post even when the URL points to one comment or has context filters. */
export function parsePostURL(input) {
  let url;
  try { url = new URL(input); } catch { return null; }
  if (!/^https?:$/.test(url.protocol) || !/(^|\.)reddit\.com$/i.test(url.hostname)) return null;
  if (/\.(?:json|rss)\/?$/i.test(url.pathname)) return null;
  const match = url.pathname.match(/^(\/(?:r\/[^/]+\/|user\/[^/]+\/)?comments\/([a-z0-9]+))(?:\/([^/]+))?(?:\/.*)?$/i);
  if (!match || /\.(?:json|rss)$/i.test(match[3] || '')) return null;
  return { id: match[2].toLowerCase(), path: `${match[1]}${match[3] ? `/${match[3]}` : ''}/` };
}

function abortError() {
  const error = new Error('Loading stopped.');
  error.name = 'AbortError';
  return error;
}

function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const stop = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop);
      resolve();
    }, ms);
    signal?.addEventListener('abort', stop, { once: true });
  });
}

function retryDelay(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

class RequestError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

/**
 * Reads Reddit's JSON tree, then exhausts the "more" and continuation work queues.
 * All requests remain on the current Reddit origin and use the existing session.
 * No IDs are guessed and no arbitrary comment/request cap is imposed.
 */
export class CommentCollector {
  constructor({ origin, post, fetchImpl = globalThis.fetch.bind(globalThis), signal, onProgress = () => {}, delayMs = 6500, timeoutMs = 30000 }) {
    const parsedOrigin = new URL(origin);
    if (!/^https?:$/.test(parsedOrigin.protocol) || !/(^|\.)reddit\.com$/i.test(parsedOrigin.hostname)) {
      throw new Error('A Reddit origin is required.');
    }
    if (!post || typeof post.id !== 'string' || !ID.test(post.id)) throw new Error('A valid Reddit post ID is required.');
    this.origin = parsedOrigin.origin;
    this.post = { ...post, id: post.id.toLowerCase() };
    this.fetchImpl = fetchImpl;
    this.signal = signal;
    this.onProgress = onProgress;
    this.delayMs = Math.max(0, delayMs);
    this.timeoutMs = timeoutMs;
    this.comments = new Map();
    this.sortedComments = null;
    this.postData = null;
    this.requests = 0;
    this.phase = 'ready';
    this.stopped = false;
    this.finished = false;
    this.started = false;
    this.initialLoaded = false;
    this.lastRequest = 0;
    this.notBefore = 0;
    this.warningSet = new Set();
    this.knownIds = new Set();
    this.pendingIds = new Set();
    this.attemptedIds = new Set();
    this.continuations = new Map();
    this.pages = new Map();
    this.unresolvedMarkers = new Set();
    this.activeTask = null;
  }

  snapshot() {
    if (!this.sortedComments) this.sortedComments = [...this.comments.values()].sort((a, b) =>
      b.created_utc - a.created_utc || b.id.localeCompare(a.id));
    const comments = this.sortedComments.slice();
    const missingIds = [...this.knownIds].filter(id => !this.comments.has(`t1_${id}`)).length;
    const unfinishedBranches = [...this.continuations.values()].filter(task => task.state !== 'done').length;
    const unfinishedPages = [...this.pages.values()].filter(task => task.state !== 'done').length;
    const unresolved = missingIds + unfinishedBranches + unfinishedPages + this.unresolvedMarkers.size;
    const pending = this.pendingIds.size + [...this.continuations.values(), ...this.pages.values()].filter(task => task.state === 'pending').length;
    const advertised = Number(this.postData?.num_comments);
    const countMismatch = Number.isFinite(advertised) && advertised > comments.length ? advertised - comments.length : 0;
    const warnings = [...this.warningSet];
    if (this.finished && unresolved) warnings.push(`${unresolved} known comment IDs or branches could not be fully retrieved.`);
    if (this.finished && countMismatch) warnings.push(`Reddit reports ${advertised} comments; ${comments.length} were returned. Removed, inaccessible, or newly arriving comments may account for the difference.`);
    return {
      comments, postData: this.postData, requests: this.requests, unresolved, pending,
      loaded: comments.length, phase: this.phase, warnings, countMismatch,
      complete: this.finished && this.initialLoaded && !this.stopped && !unresolved && !warnings.length,
      stopped: this.stopped,
    };
  }

  progress(phase) {
    this.phase = phase;
    this.onProgress(this.snapshot());
  }

  url(extra = {}) {
    const url = new URL(`/comments/${this.post.id}.json`, this.origin);
    const parameters = { sort: 'new', limit: '500', raw_json: '1', ...extra };
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value));
    return url;
  }

  async request(url) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.signal?.aborted) throw abortError();
      const pause = Math.max(this.notBefore, this.lastRequest ? this.lastRequest + this.delayMs : 0) - Date.now();
      if (pause > 0) {
        this.progress(`Waiting ${Math.ceil(pause / 1000)}s before the next Reddit request`);
        await sleep(pause, this.signal);
      }
      const controller = new AbortController();
      const stop = () => controller.abort();
      this.signal?.addEventListener('abort', stop, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
      this.lastRequest = Date.now();
      this.requests++;
      this.progress('Fetching comments');
      try {
        const response = await this.fetchImpl(url.href, {
          method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
          headers: { Accept: 'application/json' }, signal: controller.signal,
        });
        if (response.status === 429 || response.status >= 500) {
          // Honor Retry-After even across tasks, including when the final retry fails.
          this.notBefore = Date.now() + Math.max(retryDelay(response.headers?.get('Retry-After')), this.delayMs, 1000 * 2 ** attempt);
          if (attempt < 2) continue;
        }
        if (!response.ok) {
          const advice = response.status === 403 || response.status === 401
            ? ' Check that you are signed into Reddit and can access this post.'
            : response.status === 429 ? ' Reddit is rate limiting requests; try again later.' : '';
          throw new RequestError(`Reddit returned HTTP ${response.status}.${advice}`, response.status);
        }
        let json;
        try { json = await response.json(); }
        catch (error) {
          if (this.signal?.aborted || timedOut) throw error;
          throw new RequestError('Reddit returned a non-JSON page. It may require sign-in or be blocking this request.');
        }
        const errors = json?.json?.errors;
        if (Array.isArray(errors) && errors.length) {
          throw new RequestError(`Reddit API error: ${errors.map(e => Array.isArray(e) ? e.slice(0, 2).join(': ') : String(e)).join('; ')}`);
        }
        return json;
      } catch (error) {
        if (this.signal?.aborted) throw abortError();
        if (error instanceof RequestError) throw error;
        if (attempt < 2) {
          this.notBefore = Date.now() + Math.max(this.delayMs, 1000 * 2 ** attempt);
          continue;
        }
        throw new RequestError(timedOut
          ? 'Reddit took too long to respond after three attempts.'
          : 'Could not reach Reddit after three attempts. Check your connection and retry.');
      } finally {
        clearTimeout(timer);
        this.signal?.removeEventListener('abort', stop);
      }
    }
    throw new RequestError('Reddit did not return comment data.');
  }

  queueContinuation(parent) {
    const match = typeof parent === 'string' && parent.match(COMMENT);
    if (!match) {
      this.unresolvedMarkers.add(`continuation:${parent || 'unknown'}`);
      return;
    }
    const id = match[1].toLowerCase();
    const existing = this.continuations.get(id);
    if (!existing) this.continuations.set(id, { id, state: 'pending', repeated: false });
    // The focused response must remove the exact marker it was asked to expand.
    else if (this.activeTask === existing) existing.repeated = true;
    else if (this.activeTask && existing.state === 'done') existing.state = 'failed';
  }

  queuePage(after, comment = '') {
    if (!after) return;
    if (typeof after !== 'string' || !/^t[13]_[a-z0-9]+$/i.test(after)) {
      this.unresolvedMarkers.add(`page:${String(after)}`);
      return;
    }
    const key = `${comment}:${after}`;
    const existing = this.pages.get(key);
    if (!existing) this.pages.set(key, { after, comment, state: 'pending', repeated: false });
    else if (this.activeTask === existing) existing.repeated = true;
    else if (this.activeTask && existing.state === 'done') existing.state = 'failed';
  }

  ingest(things) {
    const stack = [...things];
    const returned = new Set();
    const expandableParents = new Set();
    while (stack.length) {
      const thing = stack.pop();
      const data = thing?.data;
      if (!data || typeof data !== 'object') {
        this.warningSet.add('Reddit returned an unrecognized comment entry.');
        continue;
      }
      if (thing.kind === 't1') {
        const id = String(data.id || data.name?.replace(/^t1_/, '') || '').toLowerCase();
        if (!ID.test(id) || (data.link_id && data.link_id !== `t3_${this.post.id}`)) {
          this.warningSet.add('Reddit returned an invalid comment or a comment for a different post.');
          continue;
        }
        const created = Number(data.created_utc);
        if (!Number.isFinite(created)) this.warningSet.add('Some comments have no valid timestamp and appear at the end.');
        this.comments.set(`t1_${id}`, { ...data, id, name: `t1_${id}`, created_utc: Number.isFinite(created) ? created : 0, replies: '' });
        this.sortedComments = null;
        returned.add(`t1_${id}`);
        this.pendingIds.delete(id);
        const parent = typeof data.parent_id === 'string' && data.parent_id.match(COMMENT);
        if (parent) {
          const parentId = parent[1].toLowerCase();
          this.knownIds.add(parentId);
          if (!this.comments.has(`t1_${parentId}`) && !this.attemptedIds.has(parentId)) this.pendingIds.add(parentId);
        }
        if (data.replies && data.replies.data) {
          if (Array.isArray(data.replies.data.children)) {
            for (const child of data.replies.data.children) stack.push(child);
          }
          else this.warningSet.add('Reddit returned an unrecognized replies listing.');
          this.queuePage(data.replies.data.after, id);
        } else if (data.replies && data.replies !== '') this.warningSet.add('Reddit returned an unrecognized replies listing.');
      } else if (thing.kind === 'more') {
        const ids = Array.isArray(data.children) ? data.children.filter(id => typeof id === 'string' && ID.test(id)).map(id => id.toLowerCase()) : [];
        if (Array.isArray(data.children) && data.children.some(id => typeof id !== 'string' || (!ID.test(id) && id !== '_'))) {
          this.warningSet.add('Reddit returned an invalid ID in a hidden-replies placeholder.');
        }
        for (const id of ids) {
          this.knownIds.add(id);
          if (!this.comments.has(`t1_${id}`) && !this.attemptedIds.has(id)) this.pendingIds.add(id);
        }
        if (ids.length && Number(data.count) > 0 && typeof data.parent_id === 'string' && COMMENT.test(data.parent_id)) {
          expandableParents.add(data.parent_id.toLowerCase());
        }
        if (!ids.length || data.count === 0) this.queueContinuation(data.parent_id);
      } else {
        this.warningSet.add('Reddit returned an unsupported item in the comment listing.');
      }
    }
    return { names: returned, expandableParents };
  }

  ingestTree(json, comment = '') {
    if (!Array.isArray(json) || !json[0]?.data || !Array.isArray(json[1]?.data?.children)) {
      throw new RequestError('Reddit returned an unexpected comment tree. The thread is incomplete.');
    }
    const post = json[0].data.children?.find(thing => thing.kind === 't3')?.data;
    if (!post || String(post.id || post.name?.replace(/^t3_/, '') || '').toLowerCase() !== this.post.id) {
      throw new RequestError('Reddit returned a different or missing post.');
    }
    this.postData = { ...post };
    const returned = this.ingest(json[1].data.children);
    this.queuePage(json[1].data.after, comment);
    return returned;
  }

  async load() {
    if (this.started) throw new Error('Create a new collector to refresh the thread.');
    this.started = true;
    try {
      this.ingestTree(await this.request(this.url()));
      this.initialLoaded = true;
      this.progress('Finding hidden replies');
      for (;;) {
        if (this.signal?.aborted) throw abortError();
        // Exhaust explicit IDs before focused deep-thread or pagination requests.
        const batch = [...this.pendingIds].filter(id => !this.comments.has(`t1_${id}`)).slice(0, 100);
        if (batch.length) {
          for (const id of batch) { this.pendingIds.delete(id); this.attemptedIds.add(id); }
          const url = new URL('/api/morechildren.json', this.origin);
          for (const [key, value] of Object.entries({ api_type: 'json', link_id: `t3_${this.post.id}`, children: batch.join(','), sort: 'new', raw_json: '1', limit_children: 'false' })) url.searchParams.set(key, value);
          try {
            const json = await this.request(url);
            const things = json?.json?.data?.things;
            if (!Array.isArray(things)) throw new RequestError('Reddit returned an unexpected hidden-replies response.');
            this.ingest(things);
          } catch (error) {
            if (error.name === 'AbortError' || [401, 403, 429].includes(error.status)) throw error;
            this.warningSet.add(error.message);
          }
          this.progress('Finding hidden replies');
          continue;
        }
        const continuation = [...this.continuations.values()].find(task => task.state === 'pending');
        const page = [...this.pages.values()].find(task => task.state === 'pending');
        const task = continuation || page;
        if (!task) break;
        task.state = 'loading';
        this.activeTask = task;
        const comment = continuation ? task.id : task.comment;
        const params = { ...(comment ? { comment, context: '0' } : {}), ...(page && !continuation ? { after: task.after } : {}) };
        try {
          const json = await this.request(this.url(params));
          const returned = this.ingestTree(json, comment);
          // A continuation that returns only its parent has not revealed a branch.
          // A normal "more" placeholder also reveals the branch: its queued IDs
          // must subsequently resolve before snapshot() can report complete.
          const parentName = `t1_${task.id}`;
          const revealedBranch = !continuation || (returned.names.has(parentName)
            && (returned.expandableParents.has(parentName)
              || [...returned.names].some(name => this.comments.get(name)?.parent_id === parentName)));
          task.state = task.repeated || !revealedBranch ? 'failed' : 'done';
        } catch (error) {
          task.state = 'failed';
          if (error.name === 'AbortError' || [401, 403, 429].includes(error.status)) throw error;
          this.warningSet.add(error.message);
        } finally {
          this.activeTask = null;
        }
        this.progress('Finding hidden replies');
      }
    } catch (error) {
      if (error.name === 'AbortError') this.stopped = true;
      else this.warningSet.add(error.message || 'Loading failed.');
    }
    this.finished = true;
    this.progress(this.stopped ? 'Stopped' : 'Finished');
    return this.snapshot();
  }

}
