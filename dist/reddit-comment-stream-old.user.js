// ==UserScript==
// @name         Reddit Comment Stream — Old Reddit
// @namespace    https://github.com/sayhiben/reddit-comment-stream
// @version      1.1.0
// @description  Reveal and sort native Reddit comments newest first, preserving their controls and threaded context.
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
  // src/post.js
  var ID = /^[a-z0-9]+$/i;
  function parsePostURL(input) {
    let url;
    try {
      url = new URL(input);
    } catch {
      return null;
    }
    if (!/^https?:$/.test(url.protocol) || !/(^|\.)reddit\.com$/i.test(url.hostname)) return null;
    if (/\.(?:json|rss)\/?$/i.test(url.pathname)) return null;
    const match = url.pathname.match(/^(\/(?:r\/[^/]+\/|user\/[^/]+\/)?comments\/([a-z0-9]+))(?:\/.*)?$/i);
    return match ? { id: match[2].toLowerCase(), path: `${match[1]}/` } : null;
  }
  function branchURL(href, currentURL) {
    try {
      const base = new URL(currentURL);
      const url = new URL(href, base);
      const post = parsePostURL(base.href);
      if (!post || url.origin !== base.origin || parsePostURL(url.href)?.id !== post.id) return null;
      const parts = url.pathname.split("/").filter(Boolean);
      const tail = parts.slice(parts.indexOf("comments") + 2);
      const comment = url.searchParams.get("comment") || tail[1];
      if (!comment || !ID.test(comment)) return null;
      url.hash = "";
      url.searchParams.set("context", "0");
      url.searchParams.set("sort", "new");
      url.searchParams.set("limit", "500");
      return { url, comment: comment.toLowerCase() };
    } catch {
      return null;
    }
  }
  function timestamp(value) {
    if (!value) return 0;
    if (/^\d+(\.\d+)?$/.test(String(value))) {
      const n = Number(value);
      return n > 1e12 ? n : n * 1e3;
    }
    const normalized = String(value).replace(/(\.\d{3})\d+/, "$1").replace(/([+-]\d\d)(\d\d)$/, "$1:$2");
    return Date.parse(normalized) || 0;
  }
  function newestFirst(a, b) {
    return b.created - a.created || a.index - b.index;
  }
  function stopped() {
    return new DOMException("Loading stopped.", "AbortError");
  }
  function pause(ms, signal) {
    if (signal?.aborted) return Promise.reject(stopped());
    return new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(stopped());
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  // src/native.js
  var COMMENT = "shreddit-comment[thingid], .thing.comment[data-fullname]";
  var validID = /^t1_[a-z0-9]+$/i;
  var idOf = (node) => node?.getAttribute("thingid") || node?.getAttribute("data-fullname");
  var owner = (node) => node?.closest(COMMENT);
  function own(node, selector) {
    return [...node.querySelectorAll(selector)].find((child) => owner(child) === node);
  }
  function findAdapter(post, scope = document) {
    const tree = [...scope.querySelectorAll("shreddit-comment-tree")].find((node) => !node.getAttribute("post-id") || node.getAttribute("post-id") === `t3_${post.id}`);
    if (tree) return new NativeAdapter(post, tree, tree.querySelector('[data-comment-section-anchor], section[aria-label="Comments"]') || tree, "new");
    const area = scope.querySelector(".commentarea");
    const postNode = scope.querySelector(".thing.link[data-fullname]");
    if (area && (!postNode || postNode.getAttribute("data-fullname") === `t3_${post.id}`)) {
      const root = area.querySelector(":scope > .sitetable") || area.querySelector(".sitetable");
      if (root) return new NativeAdapter(post, area, root, "old");
    }
    return null;
  }
  var NativeAdapter = class {
    constructor(post, tree, root, kind) {
      Object.assign(this, { post, tree, root, kind });
    }
    comments() {
      return [...this.root.querySelectorAll(COMMENT)].filter((node) => validID.test(idOf(node)) && (!node.getAttribute("postid") || node.getAttribute("postid") === `t3_${this.post.id}`));
    }
    mount(host) {
      const chrome = this.kind === "old" ? this.tree.querySelector(".menuarea, .panestack-title") : this.tree.closest("main")?.querySelector("shreddit-comments-sort-dropdown") || document.querySelector(`shreddit-post#t3_${this.post.id}, shreddit-post[post-id="t3_${this.post.id}"]`);
      if (chrome) chrome.after(host);
      else this.root.before(host);
    }
    date(node) {
      return timestamp(node.getAttribute("created")) || timestamp(own(node, "time[datetime]")?.getAttribute("datetime")) || timestamp(own(node, "faceplate-timeago[ts]")?.getAttribute("ts")) || timestamp(node.getAttribute("data-timestamp"));
    }
    total() {
      const value = this.tree.getAttribute("total-comments");
      if (value !== null && /^\d+$/.test(value)) return Number(value);
      return null;
    }
    expand(records) {
      for (const node of this.comments()) {
        const id = idOf(node);
        if (!records.has(id)) records.set(id, { node, details: own(node, 'details[role="article"]'), open: own(node, 'details[role="article"]')?.open, collapsed: node.classList.contains("collapsed"), collapsedAttribute: node.getAttribute("collapsed") });
        const details = own(node, 'details[role="article"]');
        if (details && !details.open) details.open = true;
        node.removeAttribute("collapsed");
        if (this.kind === "old" && node.classList.contains("collapsed")) {
          const expand = own(node, "a.expand");
          if (expand) expand.click();
        }
      }
    }
    childContainer(parent) {
      if (!parent) return this.root;
      if (this.kind === "new") return own(parent, "#comment-children") || parent;
      let child = [...parent.children].find((node) => node.classList.contains("child"));
      if (!child) {
        child = document.createElement("div");
        child.className = "child";
        parent.append(child);
      }
      let list = child.querySelector(":scope > .sitetable");
      if (!list) {
        list = document.createElement("div");
        list.className = "sitetable";
        child.append(list);
      }
      return list;
    }
    actionContainer(node) {
      return own(node, '.flat-list.buttons, [slot="actionRow"], shreddit-comment-action-row') || own(node, '[slot="comment"], .entry') || node;
    }
    expanders({ detached = false, baseURL = location.href } = {}) {
      const result = [];
      for (const node of this.root.querySelectorAll("faceplate-partial[src]")) {
        const src = node.getAttribute("src");
        if (!/\/more-comments\//.test(src)) continue;
        const button = [...node.querySelectorAll("button")].find((b) => !b.hasAttribute("aria-hidden") && !b.closest('[slot="loading"]'));
        if (!button && node.getAttribute("loading") !== "lazy") continue;
        const cursor = [...node.querySelectorAll('input[type="hidden"]')].map((input) => `${input.name}=${input.value}`).join("&");
        result.push({ type: "native", node, button, owner: idOf(owner(node)), key: `partial:${src}:${cursor}` });
      }
      for (const button of this.root.querySelectorAll("button")) {
        if (owner(button) || button.closest("faceplate-partial") || !/^(view|show|load) more comments$/i.test(button.textContent.trim())) continue;
        result.unshift({ type: "native", node: button, button, key: `reveal:${button.id || button.textContent.trim()}` });
      }
      for (const node of this.root.querySelectorAll(".morecomments, .deepthread, a.more-comments-link")) {
        if (node.parentElement?.closest(".morecomments, .deepthread, a.more-comments-link")) continue;
        const control = node.matches("a") ? node : node.querySelector("a, button");
        if (!control) continue;
        const branch = branchURL(control.getAttribute("href") || "", baseURL);
        if (branch) {
          if (!detached && node.matches(".more-comments-link") && !node.getClientRects().length) continue;
          const parent = owner(node);
          if (!node.hasAttribute("top-level") && result.some((item) => item.owner === idOf(parent))) continue;
          result.push({ type: "branch", node, owner: idOf(parent), ...branch, key: `branch:${branch.comment}` });
        } else if (this.kind === "old") {
          result.push({ type: "native", node, button: control, owner: idOf(owner(node)), key: `old:${node.id}:${control.getAttribute("onclick") || control.id || node.textContent.trim()}` });
        }
      }
      return result;
    }
    importPage(html, { sourceURL, marker } = {}) {
      const template = document.createElement("template");
      template.innerHTML = html;
      const source = findAdapter(this.post, template.content);
      if (!source || source.kind !== this.kind) throw new Error("Reddit did not return a matching native comment tree.");
      const fetched = source.comments();
      const items = fetched.map((node) => ({ node, id: idOf(node), parent: idOf(owner(node.parentElement)) }));
      const more = source.expanders({ detached: true, baseURL: sourceURL || location.href });
      const existing = new Map(this.comments().map((node) => [idOf(node), node]));
      const keys = new Set(this.expanders({ detached: true }).map((item) => item.key));
      for (const { node } of items) node.remove();
      let added = 0;
      let addedLoaders = 0;
      const clean = (node) => {
        node.querySelectorAll("script, iframe, object, embed, base, link, meta").forEach((child) => child.remove());
        for (const body of node.querySelectorAll('.md, [slot="comment"]')) {
          for (const child of [body, ...body.querySelectorAll("*")]) {
            for (const attr of [...child.attributes]) if (/^on/i.test(attr.name)) child.removeAttribute(attr.name);
            for (const attr of ["href", "src", "xlink:href"]) if (/^\s*(javascript|vbscript|data):/i.test(child.getAttribute(attr) || "")) child.removeAttribute(attr);
          }
        }
        return document.adoptNode(node);
      };
      for (const item of items) {
        if (existing.has(item.id)) continue;
        const node = clean(item.node);
        const parent = existing.get(item.parent);
        const target = this.childContainer(parent);
        if (this.kind === "new") {
          if (target === parent) node.setAttribute("slot", "children");
          else node.removeAttribute("slot");
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
      if (!fetched.length && /(?:login|blocked|challenge)/i.test(template.content.textContent || "")) throw new Error("Reddit returned a sign-in or access page.");
      const progressed = added > 0 || addedLoaders > 0;
      if (marker && progressed) marker.remove();
      return { added, progressed, sourceURL };
    }
  };
  var NativeOrder = class {
    constructor(adapter, onContext, onChange) {
      Object.assign(this, { adapter, onContext, onChange });
      this.records = /* @__PURE__ */ new Map();
      this.latestByID = /* @__PURE__ */ new Map();
      this.expanded = /* @__PURE__ */ new Map();
      this.active = false;
      this.observer = new MutationObserver(() => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          if (this.active) this.flatten();
        }, 200);
      });
    }
    expand() {
      this.adapter.expand(this.expanded);
    }
    flatten() {
      this.observer.disconnect();
      clearTimeout(this.timer);
      this.expand();
      for (const node of this.adapter.comments()) {
        const id = idOf(node);
        let record = this.records.get(node);
        if (record?.node === node && record.button?.isConnected) continue;
        if (!record) {
          const previous = this.latestByID.get(id);
          if (previous && !previous.node.isConnected && previous.marker.isConnected) record = previous;
          if (record) this.records.delete(record.node);
        }
        if (!record || !record.marker.isConnected) {
          const marker = document.createComment(`comment-stream:${id}`);
          node.before(marker);
          record = { id, marker, depth: node.getAttribute("depth"), slot: node.getAttribute("slot"), index: this.records.size };
        }
        record.node = node;
        record.created = this.adapter.date(node);
        record.button?.remove();
        const button = document.createElement("button");
        button.type = "button";
        button.className = "rcs-context-button";
        button.textContent = "View context";
        button.setAttribute("aria-label", `View context for ${id}`);
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.onContext(id);
        });
        const actions = this.adapter.actionContainer(node);
        if (actions.matches("ul, ol")) {
          const li = document.createElement("li");
          li.className = "rcs-context-action";
          li.append(button);
          actions.append(li);
          record.button = li;
        } else {
          actions.append(button);
          record.button = button;
        }
        this.records.set(node, record);
        this.latestByID.set(id, record);
      }
      if (!this.end?.isConnected) {
        this.end = document.createComment("comment-stream:end");
        let first = this.adapter.comments()[0];
        while (first && first.parentNode !== this.adapter.root) first = first.parentElement;
        this.adapter.root.insertBefore(this.end, first || null);
      }
      const records = [...this.records.values()].filter((record) => this.adapter.root.contains(record.node)).sort(newestFirst);
      let next = this.end;
      for (const record of [...records].reverse()) {
        const node = record.node;
        node.setAttribute("data-rcs-flat-comment", "");
        if (this.adapter.kind === "new") {
          if (node.getAttribute("depth") !== "0") node.setAttribute("depth", "0");
          node.removeAttribute("slot");
        }
        if (node.parentNode !== this.adapter.root || node.nextSibling !== next) this.adapter.root.insertBefore(node, next);
        next = node;
      }
      this.active = true;
      this.adapter.root.setAttribute("data-rcs-flat", "");
      this.observer.observe(this.adapter.root, { childList: true, subtree: true });
      this.onChange?.({ count: records.length, unknown: records.filter((record) => !record.created).length });
    }
    restore() {
      this.active = false;
      clearTimeout(this.timer);
      this.observer.disconnect();
      for (const record of this.records.values()) {
        const { node, marker } = record;
        record.button?.remove();
        if (node.isConnected && marker.isConnected) marker.before(node);
        node.removeAttribute("data-rcs-flat-comment");
        for (const attr of ["depth", "slot"]) {
          if (record[attr] === null) node.removeAttribute(attr);
          else node.setAttribute(attr, record[attr]);
        }
        marker.remove();
      }
      for (const record of this.expanded.values()) {
        if (record.details?.isConnected) record.details.open = record.open;
        if (record.collapsedAttribute !== null && record.node.isConnected) record.node.setAttribute("collapsed", record.collapsedAttribute);
        if (record.collapsed && record.node.isConnected && !record.node.classList.contains("collapsed")) own(record.node, "a.expand")?.click();
      }
      this.records.clear();
      this.latestByID.clear();
      this.expanded.clear();
      this.end?.remove();
      this.adapter.root.removeAttribute("data-rcs-flat");
    }
  };

  // src/loader.js
  var NativeLoader = class {
    constructor(adapter, { signal, onProgress = () => {
    }, expand = () => {
    }, delayMs = 1e3, timeoutMs = 12e3 } = {}) {
      Object.assign(this, { adapter, signal, onProgress, expand, delayMs, timeoutMs });
      this.attempted = /* @__PURE__ */ new Set();
      this.warnings = /* @__PURE__ */ new Set();
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
        this.signal?.addEventListener("abort", abort, { once: true });
        const timer = setTimeout(abort, 3e4);
        try {
          const response = await fetch(url.href, { credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal, headers: { Accept: "text/html" } });
          if ((response.status === 429 || response.status >= 500) && attempt < 2) {
            const value = response.headers.get("Retry-After");
            const seconds = Number(value);
            const wait = Number.isFinite(seconds) ? seconds * 1e3 : Date.parse(value) - Date.now();
            await pause(Math.max(wait || 0, 2e3 * 2 ** attempt), this.signal);
            continue;
          }
          if (!response.ok) throw new Error(`Reddit returned HTTP ${response.status} while loading a thread.`);
          return await response.text();
        } catch (error) {
          if (this.signal?.aborted) throw stopped();
          if (error.name === "AbortError") throw new Error("Reddit timed out while loading a thread.");
          throw error;
        } finally {
          clearTimeout(timer);
          this.signal?.removeEventListener("abort", abort);
        }
      }
    }
    async click(item) {
      await this.pace();
      const before = this.adapter.comments().length;
      if (item.button?.disabled) throw new Error("A native reply loader is still busy.");
      item.node.scrollIntoView({ block: "center" });
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
      throw new Error("A native reply loader did not reveal more comments.");
    }
    async load({ refresh = false } = {}) {
      let wasStopped = false;
      let quiet = false;
      try {
        if (refresh) {
          const url = new URL(this.adapter.post.path, location.origin);
          url.searchParams.set("sort", "new");
          url.searchParams.set("limit", "500");
          try {
            this.adapter.importPage(await this.fetchPage(url), { sourceURL: url.href });
          } catch (error) {
            if (error.name === "AbortError") throw error;
            this.warnings.add(error.message);
          }
        }
        for (; ; ) {
          if (this.signal?.aborted) throw stopped();
          this.expand();
          const remaining = this.adapter.expanders();
          this.onProgress({ count: this.adapter.comments().length, pending: remaining.length, requests: this.requests });
          const item = remaining.find((item2) => !this.attempted.has(item2.key));
          if (!item) {
            if (quiet) break;
            quiet = true;
            await pause(1200, this.signal);
            continue;
          }
          quiet = false;
          this.attempted.add(item.key);
          try {
            if (item.type === "native") await this.click(item);
            else {
              const result = this.adapter.importPage(await this.fetchPage(item.url), { sourceURL: item.url.href, marker: item.node });
              if (!result.progressed) this.warnings.add("A continuation page did not expose additional native comments.");
            }
          } catch (error) {
            if (error.name === "AbortError") throw error;
            this.warnings.add(error.message || "A reply branch could not be loaded.");
          }
        }
      } catch (error) {
        if (error.name === "AbortError") wasStopped = true;
        else this.warnings.add(error.message);
      }
      const count = this.adapter.comments().length;
      const pending = this.adapter.expanders().length;
      if (pending) this.warnings.add(`${pending} reply loader(s) remain unexpanded.`);
      const total = this.adapter.total();
      if (total !== null && total > count) this.warnings.add(`Reddit reports ${total} comments; not all were available when loading finished. Some may be removed or inaccessible.`);
      return { count, pending, requests: this.requests, stopped: wasStopped, warnings: [...this.warnings], complete: !wasStopped && !this.warnings.size };
    }
  };

  // src/styles.css
  var styles_default = "[data-rcs-flat] { overflow-anchor: none; }\n[data-rcs-flat-comment] { margin-inline-start: 0 !important; padding-inline-start: 0 !important; width: auto !important; max-width: 100% !important; clear: both; }\n.thing.comment[data-rcs-flat-comment] { border-inline-start: 0 !important; margin-block: 12px !important; }\n[data-rcs-context] { outline: 3px solid #087f9b !important; outline-offset: 4px; scroll-margin-block: 100px; }\n.rcs-context-button, .rcs-context-note button { font: inherit; color: var(--color-primary-plain, #086475); background: transparent; border: 0; border-radius: 4px; cursor: pointer; padding: 5px 8px; margin: 0 3px; text-decoration: underline; text-underline-offset: 2px; }\n.rcs-context-button:hover, .rcs-context-note button:hover { background: #087f9b18; }\n.rcs-context-button:focus-visible, .rcs-context-note button:focus-visible { outline: 3px solid #087f9b; outline-offset: 2px; }\n.rcs-context-action { display: inline-block; }\n.rcs-context-note { font: 13px/1.5 system-ui, sans-serif; padding: 6px; color: var(--color-neutral-content, #263640); }\n@media (pointer: coarse) { .rcs-context-button, .rcs-context-note button { min-height: 40px; } }\n@media (prefers-color-scheme: dark) { .rcs-context-button, .rcs-context-note button { color: var(--color-primary-plain, #77cedd); } .rcs-context-note { color: var(--color-neutral-content, #d7eaef); } }\n";

  // src/app.js
  (() => {
    if (window.top !== window.self) return;
    const HOST = "reddit-comment-stream-host";
    if (document.getElementById(HOST)) return;
    let session = null;
    const el = (tag, text, className) => {
      const node = document.createElement(tag);
      if (text) node.textContent = text;
      if (className) node.className = className;
      return node;
    };
    const button = (text, action) => {
      const node = el("button", text);
      node.type = "button";
      node.addEventListener("click", action);
      return node;
    };
    function createSession(adapter) {
      const host = el("div");
      host.id = HOST;
      const shadow = host.attachShadow({ mode: "open" });
      shadow.append(el("style", `
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
      const toolbar = el("div", "", "toolbar");
      toolbar.setAttribute("role", "group");
      toolbar.setAttribute("aria-label", "Comment stream controls");
      const activate = button("Comment stream", () => start({ refresh: state === "flat" }));
      activate.className = "primary";
      const stop = button("Stop loading", () => controller?.abort());
      const normal = button("Normal view", () => restore());
      const floatingReturn = button("Return to normal view", () => restore());
      floatingReturn.className = "return";
      const status = el("p", "", "status");
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      const warnings = el("ul", "", "warnings");
      toolbar.append(activate, stop, normal);
      shadow.append(toolbar, status, warnings, floatingReturn);
      let state = "normal";
      let disposed = false;
      let controller = null;
      let generation = 0;
      let lastResult = null;
      let contextNote = null;
      let selected = null;
      const order = new NativeOrder(adapter, showContext, ({ count, unknown }) => {
        if (state !== "flat") return;
        const partial = lastResult && !lastResult.complete;
        status.textContent = `${partial ? "Partial load · " : ""}${count.toLocaleString()} native comments · Newest first${unknown ? ` · ${unknown} without timestamps are last` : ""}`;
      });
      function controls() {
        const loading = state === "loading";
        activate.disabled = loading;
        activate.textContent = loading ? "Loading comments…" : state === "flat" ? "Load new comments" : "Comment stream";
        activate.setAttribute("aria-pressed", String(state === "flat"));
        stop.hidden = !loading;
        normal.hidden = state === "normal";
        floatingReturn.hidden = state !== "flat";
        warnings.hidden = !warnings.childElementCount;
      }
      function clearContext() {
        contextNote?.remove();
        selected?.removeAttribute("data-rcs-context");
        selected = null;
      }
      function restore() {
        generation++;
        controller?.abort();
        clearContext();
        const visible = adapter.comments().find((node) => {
          const r = node.getBoundingClientRect();
          return r.top >= 0 && r.top < innerHeight;
        });
        order.restore();
        state = "normal";
        status.textContent = "Normal thread order restored.";
        warnings.replaceChildren();
        controls();
        if (visible?.isConnected) visible.scrollIntoView({ block: "nearest" });
      }
      function showContext(id) {
        restore();
        const node = adapter.comments().find((node2) => idOf(node2) === id);
        if (!node) return;
        selected = node;
        node.setAttribute("data-rcs-context", "");
        for (let ancestor = node; ancestor; ancestor = ancestor.parentElement?.closest(COMMENT)) {
          const details = [...ancestor.querySelectorAll('details[role="article"]')].find((child) => child.closest(COMMENT) === ancestor);
          if (details) details.open = true;
          ancestor.removeAttribute("collapsed");
          if (ancestor.classList.contains("collapsed")) ancestor.querySelector("a.expand")?.click();
        }
        contextNote = el("div", "", "rcs-context-note");
        contextNote.append(el("span", "Selected comment · "), button("Back to comment stream", () => start({ load: false })));
        adapter.actionContainer(node).after(contextNote);
        state = "context";
        status.textContent = "Showing the selected comment in Reddit’s original hierarchy.";
        controls();
        node.scrollIntoView({ block: "center" });
        contextNote.querySelector("button").focus({ preventScroll: true });
      }
      async function start({ load = true, refresh = false } = {}) {
        if (disposed || state === "loading") return;
        const run = ++generation;
        clearContext();
        order.restore();
        warnings.replaceChildren();
        if (load) {
          state = "loading";
          controller = new AbortController();
          status.textContent = "Revealing native replies before sorting…";
          controls();
          const loader = new NativeLoader(adapter, {
            signal: controller.signal,
            expand: () => order.expand(),
            onProgress: ({ count, pending, requests }) => {
              if (!disposed && run === generation) status.textContent = `Loading · ${count.toLocaleString()} native comments · ${pending} reply loaders · ${requests} requests`;
            }
          });
          lastResult = await loader.load({ refresh });
          if (disposed || run !== generation) return;
        }
        state = "flat";
        for (const message of lastResult?.warnings || []) warnings.append(el("li", message));
        if (lastResult?.stopped) warnings.prepend(el("li", "Loading stopped. Comments revealed so far are sorted; an in-flight native request may still finish."));
        order.flatten();
        controls();
        if (load) adapter.root.scrollIntoView({ block: "start" });
      }
      controls();
      adapter.mount(host);
      return {
        adapter,
        host,
        dispose() {
          disposed = true;
          generation++;
          controller?.abort();
          order.restore();
          clearContext();
          host.remove();
        }
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
      if (!document.getElementById("reddit-comment-stream-styles")) {
        const style = el("style", styles_default);
        style.id = "reddit-comment-stream-styles";
        (document.head || document.documentElement).append(style);
      }
      if (!session) session = createSession(adapter);
      else if (!session.host.isConnected) adapter.mount(session.host);
    }
    checkRoute();
    window.addEventListener("popstate", checkRoute);
    window.addEventListener("pageshow", checkRoute);
    document.addEventListener("DOMContentLoaded", checkRoute, { once: true });
    window.setInterval(checkRoute, 800);
  })();
})();
