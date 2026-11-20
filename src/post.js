const ID = /^[a-z0-9]+$/i;

export function parsePostURL(input) {
  let url;
  try { url = new URL(input); } catch { return null; }
  if (!/^https?:$/.test(url.protocol) || !/(^|\.)reddit\.com$/i.test(url.hostname)) return null;
  if (/\.(?:json|rss)\/?$/i.test(url.pathname)) return null;
  const match = url.pathname.match(/^(\/(?:r\/[^/]+\/|user\/[^/]+\/)?comments\/([a-z0-9]+))(?:\/.*)?$/i);
  return match ? { id: match[2].toLowerCase(), path: `${match[1]}/` } : null;
}

export function branchURL(href, currentURL) {
  try {
    const base = new URL(currentURL);
    const url = new URL(href, base);
    const post = parsePostURL(base.href);
    if (!post || url.origin !== base.origin || parsePostURL(url.href)?.id !== post.id) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const tail = parts.slice(parts.indexOf('comments') + 2);
    const comment = url.searchParams.get('comment') || tail[1];
    if (!comment || !ID.test(comment)) return null;
    url.hash = '';
    url.searchParams.set('context', '0');
    url.searchParams.set('sort', 'new');
    url.searchParams.set('limit', '500');
    return { url, comment: comment.toLowerCase() };
  } catch { return null; }
}

export function timestamp(value) {
  if (!value) return 0;
  if (/^\d+(\.\d+)?$/.test(String(value))) {
    const n = Number(value);
    return n > 1e12 ? n : n * 1000;
  }
  const normalized = String(value).replace(/(\.\d{3})\d+/, '$1').replace(/([+-]\d\d)(\d\d)$/, '$1:$2');
  return Date.parse(normalized) || 0;
}

export function newestFirst(a, b) { return b.created - a.created || a.index - b.index; }

export function stopped() { return new DOMException('Loading stopped.', 'AbortError'); }

export function pause(ms, signal) {
  if (signal?.aborted) return Promise.reject(stopped());
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(stopped()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
