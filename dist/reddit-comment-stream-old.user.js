// ==UserScript==
// @name         Reddit Comment Stream — Old Reddit
// @namespace    https://github.com/sayhiben/reddit-comment-stream
// @version      1.2.0
// @description  Read all available Reddit comments newest first in a lightweight reader with threaded context.
// @author       sayhiben
// @license      MIT
// @homepageURL  https://github.com/sayhiben/reddit-comment-stream
// @supportURL   https://github.com/sayhiben/reddit-comment-stream/issues
// @updateURL    https://raw.githubusercontent.com/sayhiben/reddit-comment-stream/main/dist/reddit-comment-stream-old.meta.js
// @downloadURL  https://raw.githubusercontent.com/sayhiben/reddit-comment-stream/main/dist/reddit-comment-stream-old.user.js
// @match        https://old.reddit.com/*
// @match        https://np.reddit.com/*
// @grant        none
// @inject-into  content
// @run-at       document-end
// @noframes
// ==/UserScript==

(() => {
  // src/collector.js
  var ID = /^[a-z0-9]+$/i;
  var COMMENT = /^t1_([a-z0-9]+)$/i;
  function parsePostURL(input) {
    let url;
    try {
      url = new URL(input);
    } catch {
      return null;
    }
    if (!/^https?:$/.test(url.protocol) || !/(^|\.)reddit\.com$/i.test(url.hostname)) return null;
    if (/\.(?:json|rss)\/?$/i.test(url.pathname)) return null;
    const match = url.pathname.match(/^(\/(?:r\/[^/]+\/|user\/[^/]+\/)?comments\/([a-z0-9]+))(?:\/([^/]+))?(?:\/.*)?$/i);
    if (!match || /\.(?:json|rss)$/i.test(match[3] || "")) return null;
    return { id: match[2].toLowerCase(), path: `${match[1]}${match[3] ? `/${match[3]}` : ""}/` };
  }
  function abortError() {
    const error = new Error("Loading stopped.");
    error.name = "AbortError";
    return error;
  }
  function sleep(ms, signal) {
    if (signal?.aborted) return Promise.reject(abortError());
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const stop = () => {
        clearTimeout(timer);
        reject(abortError());
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", stop);
        resolve();
      }, ms);
      signal?.addEventListener("abort", stop, { once: true });
    });
  }
  function retryDelay(value) {
    if (!value) return 0;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1e3);
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
  }
  var RequestError = class extends Error {
    constructor(message, status = 0) {
      super(message);
      this.status = status;
    }
  };
  var CommentCollector = class {
    constructor({ origin, post, fetchImpl = globalThis.fetch.bind(globalThis), signal, onProgress = () => {
    }, delayMs = 6500, timeoutMs = 3e4 }) {
      const parsedOrigin = new URL(origin);
      if (!/^https?:$/.test(parsedOrigin.protocol) || !/(^|\.)reddit\.com$/i.test(parsedOrigin.hostname)) {
        throw new Error("A Reddit origin is required.");
      }
      if (!post || typeof post.id !== "string" || !ID.test(post.id)) throw new Error("A valid Reddit post ID is required.");
      this.origin = parsedOrigin.origin;
      this.post = { ...post, id: post.id.toLowerCase() };
      this.fetchImpl = fetchImpl;
      this.signal = signal;
      this.onProgress = onProgress;
      this.delayMs = Math.max(0, delayMs);
      this.timeoutMs = timeoutMs;
      this.comments = /* @__PURE__ */ new Map();
      this.sortedComments = null;
      this.postData = null;
      this.requests = 0;
      this.phase = "ready";
      this.stopped = false;
      this.finished = false;
      this.started = false;
      this.initialLoaded = false;
      this.lastRequest = 0;
      this.notBefore = 0;
      this.warningSet = /* @__PURE__ */ new Set();
      this.knownIds = /* @__PURE__ */ new Set();
      this.pendingIds = /* @__PURE__ */ new Set();
      this.attemptedIds = /* @__PURE__ */ new Set();
      this.continuations = /* @__PURE__ */ new Map();
      this.pages = /* @__PURE__ */ new Map();
      this.unresolvedMarkers = /* @__PURE__ */ new Set();
      this.activeTask = null;
    }
    snapshot() {
      if (!this.sortedComments) this.sortedComments = [...this.comments.values()].sort((a, b) => b.created_utc - a.created_utc || b.id.localeCompare(a.id));
      const comments = this.sortedComments.slice();
      const missingIds = [...this.knownIds].filter((id) => !this.comments.has(`t1_${id}`)).length;
      const unfinishedBranches = [...this.continuations.values()].filter((task) => task.state !== "done").length;
      const unfinishedPages = [...this.pages.values()].filter((task) => task.state !== "done").length;
      const unresolved = missingIds + unfinishedBranches + unfinishedPages + this.unresolvedMarkers.size;
      const pending = this.pendingIds.size + [...this.continuations.values(), ...this.pages.values()].filter((task) => task.state === "pending").length;
      const advertised = Number(this.postData?.num_comments);
      const countMismatch = Number.isFinite(advertised) && advertised > comments.length ? advertised - comments.length : 0;
      const warnings = [...this.warningSet];
      if (this.finished && unresolved) warnings.push(`${unresolved} known comment IDs or branches could not be fully retrieved.`);
      if (this.finished && countMismatch) warnings.push(`Reddit reports ${advertised} comments; ${comments.length} were returned. Removed, inaccessible, or newly arriving comments may account for the difference.`);
      return {
        comments,
        postData: this.postData,
        requests: this.requests,
        unresolved,
        pending,
        loaded: comments.length,
        phase: this.phase,
        warnings,
        countMismatch,
        complete: this.finished && this.initialLoaded && !this.stopped && !unresolved && !warnings.length,
        stopped: this.stopped
      };
    }
    progress(phase) {
      this.phase = phase;
      let pending = this.pendingIds.size;
      for (const tasks of [this.continuations, this.pages]) {
        for (const task of tasks.values()) if (task.state === "pending") pending++;
      }
      this.onProgress({ loaded: this.comments.size, pending, requests: this.requests, phase });
    }
    url(extra = {}) {
      const url = new URL(`/comments/${this.post.id}.json`, this.origin);
      const parameters = { sort: "new", limit: "500", raw_json: "1", ...extra };
      for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value));
      return url;
    }
    async request(url) {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (this.signal?.aborted) throw abortError();
        const pause = Math.max(this.notBefore, this.lastRequest ? this.lastRequest + this.delayMs : 0) - Date.now();
        if (pause > 0) {
          this.progress(`Waiting ${Math.ceil(pause / 1e3)}s before the next Reddit request`);
          await sleep(pause, this.signal);
        }
        const controller = new AbortController();
        const stop = () => controller.abort();
        this.signal?.addEventListener("abort", stop, { once: true });
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, this.timeoutMs);
        this.lastRequest = Date.now();
        this.requests++;
        this.progress("Fetching comments");
        try {
          const response = await this.fetchImpl(url.href, {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
            redirect: "error",
            headers: { Accept: "application/json" },
            signal: controller.signal
          });
          if (response.status === 429 || response.status >= 500) {
            this.notBefore = Date.now() + Math.max(retryDelay(response.headers?.get("Retry-After")), this.delayMs, 1e3 * 2 ** attempt);
            if (attempt < 2) continue;
          }
          if (!response.ok) {
            const advice = response.status === 403 || response.status === 401 ? " Check that you are signed into Reddit and can access this post." : response.status === 429 ? " Reddit is rate limiting requests; try again later." : "";
            throw new RequestError(`Reddit returned HTTP ${response.status}.${advice}`, response.status);
          }
          let json;
          try {
            json = await response.json();
          } catch (error) {
            if (this.signal?.aborted || timedOut) throw error;
            throw new RequestError("Reddit returned a non-JSON page. It may require sign-in or be blocking this request.");
          }
          const errors = json?.json?.errors;
          if (Array.isArray(errors) && errors.length) {
            throw new RequestError(`Reddit API error: ${errors.map((e) => Array.isArray(e) ? e.slice(0, 2).join(": ") : String(e)).join("; ")}`);
          }
          return json;
        } catch (error) {
          if (this.signal?.aborted) throw abortError();
          if (error instanceof RequestError) throw error;
          if (attempt < 2) {
            this.notBefore = Date.now() + Math.max(this.delayMs, 1e3 * 2 ** attempt);
            continue;
          }
          throw new RequestError(timedOut ? "Reddit took too long to respond after three attempts." : "Could not reach Reddit after three attempts. Check your connection and retry.");
        } finally {
          clearTimeout(timer);
          this.signal?.removeEventListener("abort", stop);
        }
      }
      throw new RequestError("Reddit did not return comment data.");
    }
    queueContinuation(parent) {
      const match = typeof parent === "string" && parent.match(COMMENT);
      if (!match) {
        this.unresolvedMarkers.add(`continuation:${parent || "unknown"}`);
        return;
      }
      const id = match[1].toLowerCase();
      const existing = this.continuations.get(id);
      if (!existing) this.continuations.set(id, { id, state: "pending", repeated: false });
      else if (this.activeTask === existing) existing.repeated = true;
      else if (this.activeTask && existing.state === "done") existing.state = "failed";
    }
    queuePage(after, comment = "") {
      if (!after) return;
      if (typeof after !== "string" || !/^t[13]_[a-z0-9]+$/i.test(after)) {
        this.unresolvedMarkers.add(`page:${String(after)}`);
        return;
      }
      const key = `${comment}:${after}`;
      const existing = this.pages.get(key);
      if (!existing) this.pages.set(key, { after, comment, state: "pending", repeated: false });
      else if (this.activeTask === existing) existing.repeated = true;
      else if (this.activeTask && existing.state === "done") existing.state = "failed";
    }
    ingest(things) {
      const stack = [...things];
      const returned = /* @__PURE__ */ new Set();
      const expandableParents = /* @__PURE__ */ new Set();
      while (stack.length) {
        const thing = stack.pop();
        const data = thing?.data;
        if (!data || typeof data !== "object") {
          this.warningSet.add("Reddit returned an unrecognized comment entry.");
          continue;
        }
        if (thing.kind === "t1") {
          const id = String(data.id || data.name?.replace(/^t1_/, "") || "").toLowerCase();
          if (!ID.test(id) || data.link_id && data.link_id !== `t3_${this.post.id}`) {
            this.warningSet.add("Reddit returned an invalid comment or a comment for a different post.");
            continue;
          }
          const created = Number(data.created_utc);
          if (!Number.isFinite(created)) this.warningSet.add("Some comments have no valid timestamp and appear at the end.");
          this.comments.set(`t1_${id}`, {
            id,
            name: `t1_${id}`,
            parent_id: typeof data.parent_id === "string" ? data.parent_id : "",
            created_utc: Number.isFinite(created) ? created : 0,
            author: typeof data.author === "string" ? data.author : "[deleted]",
            body: typeof data.body === "string" ? data.body : "",
            body_html: typeof data.body_html === "string" ? data.body_html : "",
            distinguished: typeof data.distinguished === "string" ? data.distinguished : "",
            is_submitter: !!data.is_submitter,
            edited: !!data.edited,
            removed: !!(data.removed || data.banned_by || data.removal_reason || data.body === "[removed]"),
            approved_by: !!data.approved_by,
            locked: !!data.locked,
            replies: ""
          });
          this.sortedComments = null;
          returned.add(`t1_${id}`);
          this.pendingIds.delete(id);
          const parent = typeof data.parent_id === "string" && data.parent_id.match(COMMENT);
          if (parent) {
            const parentId = parent[1].toLowerCase();
            this.knownIds.add(parentId);
            if (!this.comments.has(`t1_${parentId}`) && !this.attemptedIds.has(parentId)) this.pendingIds.add(parentId);
          }
          if (data.replies && data.replies.data) {
            if (Array.isArray(data.replies.data.children)) {
              for (const child of data.replies.data.children) stack.push(child);
            } else this.warningSet.add("Reddit returned an unrecognized replies listing.");
            this.queuePage(data.replies.data.after, id);
          } else if (data.replies && data.replies !== "") this.warningSet.add("Reddit returned an unrecognized replies listing.");
        } else if (thing.kind === "more") {
          const ids = Array.isArray(data.children) ? data.children.filter((id) => typeof id === "string" && ID.test(id)).map((id) => id.toLowerCase()) : [];
          if (Array.isArray(data.children) && data.children.some((id) => typeof id !== "string" || !ID.test(id) && id !== "_")) {
            this.warningSet.add("Reddit returned an invalid ID in a hidden-replies placeholder.");
          }
          for (const id of ids) {
            this.knownIds.add(id);
            if (!this.comments.has(`t1_${id}`) && !this.attemptedIds.has(id)) this.pendingIds.add(id);
          }
          if (ids.length && Number(data.count) > 0 && typeof data.parent_id === "string" && COMMENT.test(data.parent_id)) {
            expandableParents.add(data.parent_id.toLowerCase());
          }
          if (!ids.length || data.count === 0) this.queueContinuation(data.parent_id);
        } else {
          this.warningSet.add("Reddit returned an unsupported item in the comment listing.");
        }
      }
      return { names: returned, expandableParents };
    }
    ingestTree(json, comment = "") {
      if (!Array.isArray(json) || !json[0]?.data || !Array.isArray(json[1]?.data?.children)) {
        throw new RequestError("Reddit returned an unexpected comment tree. The thread is incomplete.");
      }
      const post = json[0].data.children?.find((thing) => thing.kind === "t3")?.data;
      if (!post || String(post.id || post.name?.replace(/^t3_/, "") || "").toLowerCase() !== this.post.id) {
        throw new RequestError("Reddit returned a different or missing post.");
      }
      this.postData = { id: this.post.id, title: typeof post.title === "string" ? post.title : "", num_comments: post.num_comments };
      const returned = this.ingest(json[1].data.children);
      this.queuePage(json[1].data.after, comment);
      return returned;
    }
    async load() {
      if (this.started) throw new Error("Create a new collector to refresh the thread.");
      this.started = true;
      try {
        this.ingestTree(await this.request(this.url()));
        this.initialLoaded = true;
        this.progress("Finding hidden replies");
        for (; ; ) {
          if (this.signal?.aborted) throw abortError();
          const batch = [];
          for (const id of this.pendingIds) {
            if (this.comments.has(`t1_${id}`)) {
              this.pendingIds.delete(id);
              continue;
            }
            batch.push(id);
            if (batch.length === 100) break;
          }
          if (batch.length) {
            for (const id of batch) {
              this.pendingIds.delete(id);
              this.attemptedIds.add(id);
            }
            const url = new URL("/api/morechildren.json", this.origin);
            for (const [key, value] of Object.entries({ api_type: "json", link_id: `t3_${this.post.id}`, children: batch.join(","), sort: "new", raw_json: "1", limit_children: "false" })) url.searchParams.set(key, value);
            try {
              const json = await this.request(url);
              const things = json?.json?.data?.things;
              if (!Array.isArray(things)) throw new RequestError("Reddit returned an unexpected hidden-replies response.");
              this.ingest(things);
            } catch (error) {
              if (error.name === "AbortError" || [401, 403, 429].includes(error.status)) throw error;
              this.warningSet.add(error.message);
            }
            this.progress("Finding hidden replies");
            continue;
          }
          const continuation = [...this.continuations.values()].find((task2) => task2.state === "pending");
          const page = [...this.pages.values()].find((task2) => task2.state === "pending");
          const task = continuation || page;
          if (!task) break;
          task.state = "loading";
          this.activeTask = task;
          const comment = continuation ? task.id : task.comment;
          const params = { ...comment ? { comment, context: "0" } : {}, ...page && !continuation ? { after: task.after } : {} };
          try {
            const json = await this.request(this.url(params));
            const returned = this.ingestTree(json, comment);
            const parentName = `t1_${task.id}`;
            const revealedBranch = !continuation || returned.names.has(parentName) && (returned.expandableParents.has(parentName) || [...returned.names].some((name) => this.comments.get(name)?.parent_id === parentName));
            task.state = task.repeated || !revealedBranch ? "failed" : "done";
          } catch (error) {
            task.state = "failed";
            if (error.name === "AbortError" || [401, 403, 429].includes(error.status)) throw error;
            this.warningSet.add(error.message);
          } finally {
            this.activeTask = null;
          }
          this.progress("Finding hidden replies");
        }
      } catch (error) {
        if (error.name === "AbortError") this.stopped = true;
        else this.warningSet.add(error.message || "Loading failed.");
      }
      this.finished = true;
      this.progress(this.stopped ? "Stopped" : "Finished");
      return this.snapshot();
    }
  };

  // src/render.js
  var ALLOWED = new Set("p br strong b em i blockquote pre code a ul ol li del s hr table thead tbody tr th td sup sub span div h1 h2 h3 h4 h5 h6".split(" "));
  var DROP = new Set("script style iframe object embed svg math form input button textarea select link meta base template".split(" "));
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== void 0) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function safeURL(value, base = location.origin) {
    try {
      const url = new URL(value, base);
      return ["https:", "http:"].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }
  function link(text, href) {
    const node = element("a", text);
    const url = safeURL(href);
    if (url) node.href = url;
    node.target = "_blank";
    node.rel = "noopener noreferrer";
    return node;
  }
  function renderBody(comment) {
    const container = element("div", void 0, "body");
    if (!comment.body_html) {
      container.textContent = comment.body || "[No comment text available]";
      container.classList.add("plain");
      return container;
    }
    let source;
    try {
      let html = String(comment.body_html);
      if (/^\s*&lt;/.test(html)) {
        const decoder = document.createElement("template");
        decoder.innerHTML = html;
        html = decoder.content.textContent;
      }
      const template = document.createElement("template");
      template.innerHTML = html;
      source = template.content;
    } catch {
      container.textContent = comment.body || "[No comment text available]";
      container.classList.add("plain");
      return container;
    }
    function copy(node, parent) {
      if (node.nodeType === 3) {
        parent.append(document.createTextNode(node.textContent));
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.localName;
      if (DROP.has(tag)) return;
      if (tag === "img") {
        const url = safeURL(node.getAttribute("src"));
        if (url) parent.append(link(`[Image${node.getAttribute("alt") ? `: ${node.getAttribute("alt")}` : ""}]`, url));
        return;
      }
      let target = parent;
      if (ALLOWED.has(tag)) {
        target = tag === "a" ? link("", node.getAttribute("href") || "") : element(tag);
        if (tag === "a" && !safeURL(node.getAttribute("href") || "")) target.removeAttribute("href");
        parent.append(target);
      }
      for (const child of node.childNodes) copy(child, target);
    }
    for (const node of source.childNodes) copy(node, container);
    if (!container.textContent.trim()) container.textContent = comment.body || "[No comment text available]";
    return container;
  }
  function contextChain(comment, comments) {
    const chain = [comment];
    const seen = /* @__PURE__ */ new Set([comment.name]);
    let parent = comment.parent_id;
    while (parent?.startsWith("t1_") && !seen.has(parent)) {
      const ancestor = comments.get(parent);
      if (!ancestor) return { chain: chain.reverse(), missing: parent };
      chain.push(ancestor);
      seen.add(parent);
      parent = ancestor.parent_id;
    }
    return { chain: chain.reverse(), missing: parent?.startsWith("t1_") ? parent : null };
  }

  // src/styles.css
  var styles_default = ':host { all: initial; display: block; margin: 10px 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 15px; color: #18212a; color-scheme: light dark; }\n* { box-sizing: border-box; }\n[hidden] { display: none !important; }\nbutton, input, summary { font: inherit; }\nbutton, summary, a { -webkit-tap-highlight-color: transparent; }\nbutton, summary { cursor: pointer; }\nbutton { min-height: 42px; border: 1px solid #b7c1ca; border-radius: 8px; background: #fff; color: #18212a; padding: 8px 14px; }\nbutton:hover, summary:hover { background: #eaf3f6; }\nbutton:disabled { cursor: wait; opacity: .6; }\na { color: #086475; text-underline-offset: 3px; }\n:focus-visible { outline: 3px solid #087f9b; outline-offset: 3px; }\n.launcher { color: #fff; background: #075d6c; border: 0; font-weight: 650; padding: 12px 18px; }\n.launcher:hover { background: #084955; }\ndialog { color: #18212a; background: #f2f5f7; border: 1px solid #b7c1ca; border-radius: 14px; padding: 0; box-shadow: 0 12px 60px #0004; }\ndialog::backdrop { background: #101b27a8; }\n.main { position: fixed; inset: 0; margin: auto; width: min(1060px, calc(100% - 32px)); height: calc(100% - 40px); max-width: none; max-height: none; overflow: hidden; }\n.shell { height: 100%; display: flex; flex-direction: column; }\nheader { flex: 0 0 auto; padding: 18px 24px 14px; border-bottom: 1px solid #d5dde2; background: #fff; }\n.heading { display: flex; gap: 12px; justify-content: space-between; align-items: flex-start; }\nh1 { font-size: 20px; margin: 0 0 5px; letter-spacing: -.4px; }\nh2 { font-size: 18px; margin: 0; }\n.subtitle { color: #536471; margin: 0; line-height: 1.4; font-size: 13px; }\n.title { font-weight: 600; margin: 12px 0 0; overflow-wrap: anywhere; }\n.toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 14px; }\n.primary { color: #fff; background: #075d6c; border-color: #075d6c; }\n.primary:hover { background: #084955; }\n.search { min-width: 140px; flex: 1 1 200px; color: inherit; background: #f7f9fa; border: 1px solid #b7c1ca; border-radius: 8px; min-height: 42px; padding: 9px 12px; }\n.status { margin: 12px 0 0; color: #465764; line-height: 1.5; font-size: 13px; }\n.scroll { overflow-y: auto; overscroll-behavior: contain; flex: 1 1 auto; padding: 18px 24px 40px; -webkit-overflow-scrolling: touch; }\n.notice { padding: 12px 14px; border: 1px solid #c6d8df; border-radius: 8px; background: #eaf3f6; color: #314d5b; margin-bottom: 16px; line-height: 1.5; font-size: 13px; }\n.warning { background: #fff4dd; color: #694b14; border-color: #ddc992; }\n.notice ul { margin: 6px 0; padding-left: 20px; }\n.empty { padding: 30px 10px; text-align: center; color: #536471; line-height: 1.7; }\n.comment { position: relative; border: 1px solid #d3dce2; border-radius: 10px; background: #fff; margin-bottom: 12px; padding: 16px 18px; overflow-wrap: anywhere; }\n.meta { display: flex; align-items: center; gap: 7px 10px; flex-wrap: wrap; color: #536471; font-size: 12px; line-height: 1.5; padding-right: 38px; }\n.author { font-weight: 700; font-size: 14px; }\n.badge { color: #075d6c; background: #def1ee; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; }\n.mod { color: #694b14; background: #fff4dd; }\n.body { font-size: 15px; line-height: 1.65; margin-top: 10px; }\n.body > :first-child, .body > div > :first-child { margin-top: 0; }\n.body > :last-child, .body > div > :last-child { margin-bottom: 0; }\n.body.plain { white-space: pre-wrap; }\n.body pre { overflow-x: auto; padding: 10px; background: #edf1f4; border-radius: 5px; white-space: pre-wrap; }\n.body code { font-size: .9em; }\n.body blockquote { margin-left: 0; padding-left: 14px; border-left: 3px solid #b5c6cf; color: #536471; }\n.body table { display: block; overflow-x: auto; border-collapse: collapse; }\n.body th, .body td { border: 1px solid #b7c1ca; padding: 5px; }\n.actions { position: absolute; right: 10px; top: 8px; }\n.actions summary { list-style: none; border-radius: 6px; min-width: 40px; min-height: 36px; padding: 0 8px; text-align: center; font-weight: 700; font-size: 22px; }\n.actions summary::-webkit-details-marker { display: none; }\n.menu { position: absolute; right: 0; top: 40px; width: 190px; background: #fff; border: 1px solid #b7c1ca; border-radius: 8px; padding: 5px; box-shadow: 0 4px 16px #0002; z-index: 5; }\n.menu button, .menu a { display: block; width: 100%; text-align: left; padding: 10px; border: 0; font-size: 14px; border-radius: 4px; }\n.parent-label { color: #536471; margin-top: 10px; font-size: 12px; }\n.pagination { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: center; margin: 20px 0 0; }\n.context { width: min(900px, calc(100% - 48px)); max-height: calc(100% - 64px); overflow-y: auto; }\n.context header { position: sticky; top: 0; z-index: 10; }\n.context-body { padding: 18px 20px; }\n.context .comment { margin-left: min(calc(var(--depth, 0) * 14px), 70px); border-left: 3px solid #bed2dc; }\n.context .selected { border: 2px solid #087f9b; background: #eff9fa; }\n.context .relation { color: #075d6c; font-size: 12px; font-weight: 650; margin-bottom: 8px; }\n@media (max-width: 600px) {\n  .main { width: 100%; height: 100%; height: 100dvh; border-radius: 0; border: 0; }\n  header { padding: max(14px, env(safe-area-inset-top)) 14px 12px; }\n  .scroll { padding: 14px 10px max(30px, env(safe-area-inset-bottom)); }\n  h1 { font-size: 18px; }\n  .comment { padding: 14px; }\n  .context { width: 100%; max-height: 100%; height: 100%; height: 100dvh; border: 0; border-radius: 0; }\n  .context-body { padding: 14px 8px; }\n  .context .comment { margin-left: min(calc(var(--depth, 0) * 9px), 36px); }\n}\n@media (prefers-color-scheme: dark) {\n  :host, dialog { color: #e6edf1; }\n  dialog { background: #151c22; border-color: #45535d; }\n  header, .comment, .menu, button { color: #e6edf1; background: #202a32; border-color: #45535d; }\n  .search, .body pre { color: #e6edf1; background: #151c22; border-color: #45535d; }\n  .subtitle, .status, .meta, .parent-label, .empty, .body blockquote { color: #abbcc7; }\n  a { color: #77cedd; }\n  button:hover, summary:hover { background: #31434e; }\n  .primary, .launcher { background: #086a7b; color: #fff; }\n  .notice { background: #243c48; color: #d4e5ed; border-color: #455f6c; }\n  .warning, .mod { background: #463c24; color: #edd697; border-color: #80704a; }\n  .badge { background: #224f50; color: #aaece5; }\n  .context .selected { background: #193c44; }\n  .context .relation { color: #8fdce4; }\n}\n';

  // src/app.js
  (() => {
    const PAGE_SIZE = 50;
    const HOST_ID = "reddit-comment-stream-host";
    if (window.top !== window.self || document.getElementById(HOST_ID)) return;
    const host = element("div");
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: "open" });
    const style = element("style", styles_default);
    shadow.append(style);
    const button = (text, action, className) => {
      const node = element("button", text, className);
      node.type = "button";
      node.addEventListener("click", action);
      return node;
    };
    const launcher = button("Comment stream", open, "launcher");
    launcher.hidden = true;
    shadow.append(launcher);
    let post = null;
    let session = null;
    function mountLauncher() {
      if (!post) {
        host.remove();
        return;
      }
      const chrome = document.querySelector(".commentarea .menuarea, .commentarea .panestack-title") || document.querySelector("shreddit-comments-sort-dropdown") || document.querySelector(`shreddit-post#t3_${post.id}, shreddit-post[post-id="t3_${post.id}"], .thing.link[data-fullname="t3_${post.id}"]`);
      if (chrome) {
        if (chrome.nextElementSibling !== host) chrome.after(host);
      } else {
        const parent = document.querySelector("main") || document.body || document.documentElement;
        if (host.parentNode !== parent) parent.prepend(host);
      }
    }
    function checkRoute() {
      if (!document.documentElement) return;
      const next = parsePostURL(location.href);
      if (session && next?.id !== post?.id) {
        session.dispose();
        session = null;
      }
      post = next;
      launcher.hidden = !post;
      mountLauncher();
    }
    function open() {
      checkRoute();
      if (!post) return;
      if (!session) session = createSession({ ...post });
      session.open();
    }
    function createSession(currentPost) {
      const readerHost = element("div");
      readerHost.id = "reddit-comment-stream-reader";
      readerHost.style.margin = "0";
      const readerShadow = readerHost.attachShadow({ mode: "open" });
      readerShadow.append(element("style", styles_default));
      document.documentElement.append(readerHost);
      const dialog = element("dialog", void 0, "main");
      dialog.setAttribute("aria-label", "Reddit comment stream");
      const shell = element("div", void 0, "shell");
      const header = element("header");
      const heading = element("div", void 0, "heading");
      const headingText = element("div");
      headingText.append(element("h1", "Reddit comment stream"), element("p", "Every level · Newest first", "subtitle"));
      heading.append(headingText, button("Close", close));
      const title = element("p", void 0, "title");
      const toolbar = element("div", void 0, "toolbar");
      const refresh = button("Refresh", () => load(), "primary");
      const stop = button("Stop loading", () => controller?.abort());
      const search = element("input", void 0, "search");
      search.type = "search";
      search.placeholder = "Filter by comment or author";
      search.setAttribute("aria-label", "Filter comments");
      search.addEventListener("input", () => {
        clearTimeout(filterTimer);
        filterTimer = setTimeout(() => {
          offset = 0;
          renderList();
        }, 120);
      });
      toolbar.append(refresh, stop, search);
      const status = element("p", "Preparing to load available comments…", "status");
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      header.append(heading, title, toolbar, status);
      const scroll = element("div", void 0, "scroll");
      const notices = element("div");
      const list = element("section");
      list.setAttribute("aria-label", "Comments newest first");
      const pagination = element("nav", void 0, "pagination");
      pagination.setAttribute("aria-label", "Comment pages");
      const previous = button("Previous comments", () => {
        offset = Math.max(0, offset - PAGE_SIZE);
        renderList();
        scroll.scrollTop = 0;
      });
      const next = button("Next comments", () => {
        offset += PAGE_SIZE;
        renderList();
        scroll.scrollTop = 0;
      });
      const range = element("span", void 0, "subtitle");
      pagination.append(previous, range, next);
      pagination.hidden = true;
      scroll.append(notices, list, pagination);
      shell.append(header, scroll);
      dialog.append(shell);
      const context = element("dialog", void 0, "context");
      context.setAttribute("aria-label", "Comment context");
      readerShadow.append(dialog, context);
      let controller = null;
      let collector = null;
      let snapshot = null;
      let busy = false;
      let disposed = false;
      let generation = 0;
      let offset = 0;
      let filterTimer = null;
      let comments = /* @__PURE__ */ new Map();
      let priorIDs = null;
      let newIDs = /* @__PURE__ */ new Set();
      let restoreViewport = null;
      function prepareViewport() {
        const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1 && window.innerWidth > screen.width * 1.4;
        const existing = document.querySelector('meta[name="viewport" i]');
        if (!mobile || /width\s*=\s*device-width/i.test(existing?.content || "") || restoreViewport) return;
        const meta = existing || document.createElement("meta");
        const original = meta.getAttribute("content");
        const scrollPosition = [window.scrollX, window.scrollY];
        meta.name = "viewport";
        meta.content = "width=device-width, initial-scale=1";
        if (!existing) document.head.append(meta);
        restoreViewport = () => {
          if (!existing) meta.remove();
          else if (original === null) meta.removeAttribute("content");
          else meta.setAttribute("content", original);
          window.requestAnimationFrame(() => window.scrollTo(...scrollPosition));
          restoreViewport = null;
        };
      }
      function close() {
        session?.dispose();
        session = null;
        launcher.focus();
      }
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        close();
      });
      dialog.addEventListener("close", () => {
        if (!disposed && !dialog.open) close();
      });
      context.addEventListener("close", () => context.replaceChildren());
      function redditURL(comment) {
        return `${location.origin}/comments/${currentPost.id}/_/${comment.id}/?context=8&sort=old`;
      }
      function card(comment, { inContext = false, relation = "", depth = 0, selected = false } = {}) {
        const article = element("article", void 0, `comment${selected ? " selected" : ""}`);
        article.dataset.commentId = comment.name;
        article.style.setProperty("--depth", String(depth));
        if (relation) article.append(element("div", relation, "relation"));
        const meta = element("div", void 0, "meta");
        const author = String(comment.author || "[deleted]");
        const authorNode = author === "[deleted]" ? element("span", author) : link(`u/${author}`, `${location.origin}/user/${encodeURIComponent(author)}/`);
        authorNode.className = "author";
        meta.append(authorNode);
        const date = new Date(comment.created_utc * 1e3);
        const time = element("time", Number.isFinite(date.getTime()) ? date.toLocaleString() : "Unknown time");
        if (Number.isFinite(date.getTime())) {
          time.dateTime = date.toISOString();
          time.title = date.toISOString();
        }
        meta.append(time);
        if (comment.is_submitter) meta.append(element("span", "OP", "badge"));
        if (comment.distinguished) meta.append(element("span", comment.distinguished, "badge"));
        if (newIDs.has(comment.name)) meta.append(element("span", "NEW", "badge"));
        if (comment.edited) meta.append(element("span", "edited"));
        if (comment.removed || comment.banned_by || comment.removal_reason || comment.body === "[removed]") meta.append(element("span", "Removed", "badge mod"));
        if (comment.approved_by) meta.append(element("span", "Approved", "badge"));
        if (comment.locked) meta.append(element("span", "Locked", "badge mod"));
        article.append(meta, renderBody(comment));
        if (!inContext) {
          const parent = comments.get(comment.parent_id);
          const parentText = comment.parent_id?.startsWith("t1_") ? `Reply to ${parent ? `u/${parent.author || "[deleted]"}` : "another comment"}` : "Top-level comment";
          article.append(element("div", parentText, "parent-label"));
          const actions = element("details", void 0, "actions");
          const summary = element("summary", "…");
          summary.setAttribute("aria-label", `More actions for comment ${comment.name}`);
          const menu = element("div", void 0, "menu");
          menu.append(button("View context", () => {
            actions.open = false;
            showContext(comment);
          }), link("Open on Reddit", redditURL(comment)));
          actions.append(summary, menu);
          article.append(actions);
        }
        return article;
      }
      function showContext(comment) {
        context.replaceChildren();
        const contextHeader = element("header");
        const row = element("div", void 0, "heading");
        row.append(element("h2", "Comment context"), button("Back to stream", () => context.close()));
        const explanation = element("p", "Ancestor chain and direct replies. The selected comment is outlined. Long branches use pages of 50.", "subtitle");
        contextHeader.append(row, explanation, link("Open on Reddit", redditURL(comment)));
        const body = element("div", void 0, "context-body");
        const { chain, missing } = contextChain(comment, comments);
        if (missing) body.append(element("p", "An ancestor was not returned by Reddit. Open on Reddit to check the original branch.", "notice warning"));
        const replies = snapshot.comments.filter((item) => item.parent_id === comment.name).sort((a, b) => a.created_utc - b.created_utc || a.id.localeCompare(b.id));
        const rows = [...chain, ...replies];
        let start = Math.max(0, Math.min(chain.length - 25, rows.length - PAGE_SIZE));
        const cards = element("section");
        const pages = element("nav", void 0, "pagination");
        pages.setAttribute("aria-label", "Context pages");
        const before = button("Previous context page", () => {
          start = Math.max(0, start - PAGE_SIZE);
          draw();
        });
        const after = button("Next context page", () => {
          start = Math.min(Math.max(0, rows.length - PAGE_SIZE), start + PAGE_SIZE);
          draw();
        });
        const position = element("span", void 0, "subtitle");
        pages.append(before, position, after);
        body.append(cards, pages);
        function draw() {
          cards.replaceChildren();
          for (let index = start; index < Math.min(rows.length, start + PAGE_SIZE); index++) {
            const item = rows[index];
            cards.append(card(item, {
              inContext: true,
              selected: item.name === comment.name,
              depth: Math.min(index, chain.length),
              relation: index >= chain.length ? "Direct reply" : item.name === comment.name ? "Selected comment" : index === chain.length - 2 ? "Parent comment" : "Ancestor"
            }));
          }
          before.disabled = start === 0;
          after.disabled = start + PAGE_SIZE >= rows.length;
          position.textContent = `${start + 1}–${Math.min(rows.length, start + PAGE_SIZE)} of ${rows.length}`;
          pages.hidden = rows.length <= PAGE_SIZE;
          context.scrollTop = 0;
        }
        draw();
        if (!replies.length) body.append(element("p", "No direct replies in the loaded snapshot.", "subtitle"));
        context.append(contextHeader, body);
        context.showModal();
        context.scrollTop = 0;
      }
      function renderList() {
        if (busy || !snapshot) return;
        const query = search.value.trim().toLowerCase();
        const filtered = query ? snapshot.comments.filter((item) => `${item.author}
${item.body}`.toLowerCase().includes(query)) : snapshot.comments;
        offset = Math.min(offset, Math.max(0, Math.floor((filtered.length - 1) / PAGE_SIZE) * PAGE_SIZE));
        list.replaceChildren();
        const fragment = document.createDocumentFragment();
        for (const comment of filtered.slice(offset, offset + PAGE_SIZE)) fragment.append(card(comment));
        list.append(fragment);
        pagination.hidden = filtered.length <= PAGE_SIZE;
        previous.disabled = offset === 0;
        next.disabled = offset + PAGE_SIZE >= filtered.length;
        range.textContent = `${offset + 1}–${Math.min(filtered.length, offset + PAGE_SIZE)} of ${filtered.length.toLocaleString()}`;
        if (!filtered.length) list.append(element("p", query ? "No comments match this filter." : "No comments were returned. If this is unexpected, check your Reddit login and try Refresh.", "empty"));
        list.setAttribute("aria-label", `Comments newest first, ${filtered.length} matching`);
      }
      async function load() {
        if (busy || disposed) return;
        const thisGeneration = ++generation;
        clearTimeout(filterTimer);
        if (context.open) context.close();
        context.replaceChildren();
        snapshot = null;
        comments.clear();
        newIDs.clear();
        controller = new AbortController();
        busy = true;
        refresh.disabled = true;
        stop.hidden = false;
        search.disabled = true;
        offset = 0;
        pagination.hidden = true;
        list.replaceChildren();
        notices.replaceChildren(element("p", "Loading the full available thread before sorting. Large threads can take several minutes. Stop loading to review a partial snapshot.", "notice"));
        status.textContent = "Loading available comments…";
        const currentCollector = new CommentCollector({
          origin: location.origin,
          post: currentPost,
          signal: controller.signal,
          onProgress(progress) {
            if (disposed || thisGeneration !== generation) return;
            const count = progress.loaded ?? progress.comments?.length ?? 0;
            status.textContent = `Loading · ${count.toLocaleString()} comments · ${progress.requests || 0} requests${progress.pending ? ` · ${progress.pending} queued` : ""}${progress.phase ? ` · ${progress.phase}` : ""}`;
          }
        });
        collector = currentCollector;
        let result;
        try {
          result = await currentCollector.load();
        } catch (error) {
          result = { ...currentCollector.snapshot(), complete: false };
          result.warnings = [...result.warnings || [], String(error.message || error)];
        } finally {
          if (collector === currentCollector) collector = null;
        }
        if (disposed || thisGeneration !== generation) return;
        snapshot = result;
        comments = new Map(snapshot.comments.map((comment) => [comment.name, comment]));
        newIDs = new Set(priorIDs ? [...comments.keys()].filter((id) => !priorIDs.has(id)) : []);
        priorIDs = /* @__PURE__ */ new Set([...priorIDs || [], ...comments.keys()]);
        busy = false;
        refresh.disabled = false;
        stop.hidden = true;
        search.disabled = false;
        title.textContent = snapshot.postData?.title || "";
        status.textContent = `${snapshot.complete ? "Available thread loaded" : snapshot.stopped ? "Stopped — partial snapshot" : "Partial snapshot"} · ${snapshot.comments.length.toLocaleString()} comments · Newest first${newIDs.size ? ` · ${newIDs.size} new` : ""}`;
        notices.replaceChildren();
        if (!snapshot.complete || snapshot.warnings?.length) {
          const warning = element("div", void 0, "notice warning");
          warning.append(element("strong", "This snapshot may be incomplete."));
          const items = element("ul");
          for (const message of snapshot.warnings || []) items.append(element("li", message));
          warning.append(items, element("span", "Refresh retries the full thread. Reddit may omit deleted, removed, restricted, or newly arriving comments."));
          notices.append(warning);
        } else {
          notices.append(element("p", `All discovered reply placeholders were processed. This is a snapshot; refresh for new activity. Loaded at ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}.`, "notice"));
        }
        renderList();
      }
      return {
        open() {
          if (!dialog.open) {
            prepareViewport();
            dialog.showModal();
          }
          if (!snapshot && !busy) load();
        },
        dispose() {
          disposed = true;
          generation++;
          clearTimeout(filterTimer);
          controller?.abort();
          if (context.open) context.close();
          if (dialog.open) dialog.close();
          restoreViewport?.();
          context.replaceChildren();
          list.replaceChildren();
          snapshot = null;
          comments.clear();
          priorIDs = null;
          newIDs.clear();
          collector = null;
          readerHost.remove();
        }
      };
    }
    checkRoute();
    window.addEventListener("popstate", checkRoute);
    window.addEventListener("pageshow", checkRoute);
    document.addEventListener("DOMContentLoaded", checkRoute, { once: true });
    window.setInterval(checkRoute, 800);
  })();
})();
