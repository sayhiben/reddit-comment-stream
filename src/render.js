// Copy only known-safe formatting into fresh elements. Reddit/user HTML is never
// assigned to a live innerHTML sink, and remote images never load automatically.
const ALLOWED = new Set('p br strong b em i blockquote pre code a ul ol li del s hr table thead tbody tr th td sup sub span div h1 h2 h3 h4 h5 h6'.split(' '));
const DROP = new Set('script style iframe object embed svg math form input button textarea select link meta base template'.split(' '));

export function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function safeURL(value, base = location.origin) {
  try {
    const url = new URL(value, base);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function link(text, href) {
  const node = element('a', text);
  const url = safeURL(href);
  if (url) node.href = url;
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  return node;
}

export function renderBody(comment) {
  const container = element('div', undefined, 'body');
  if (!comment.body_html) {
    container.textContent = comment.body || '[No comment text available]';
    container.classList.add('plain');
    return container;
  }
  let source;
  try {
    let html = String(comment.body_html);
    // Older cached API payloads can still HTML-escape the entire markup.
    if (/^\s*&lt;/.test(html)) {
      const decoder = document.createElement('template');
      decoder.innerHTML = html;
      html = decoder.content.textContent;
    }
    // Template contents are inert: even images cannot issue requests before
    // the allowlist copy. Never insert this template's contents into the page.
    const template = document.createElement('template');
    template.innerHTML = html;
    source = template.content;
  } catch {
    // A site can enforce Trusted Types against HTML parsing sinks. Plain text
    // remains useful without weakening that policy or aborting the whole view.
    container.textContent = comment.body || '[No comment text available]';
    container.classList.add('plain');
    return container;
  }
  function copy(node, parent) {
    if (node.nodeType === 3) { parent.append(document.createTextNode(node.textContent)); return; }
    if (node.nodeType !== 1) return;
    const tag = node.localName;
    if (DROP.has(tag)) return;
    if (tag === 'img') {
      const url = safeURL(node.getAttribute('src'));
      if (url) parent.append(link(`[Image${node.getAttribute('alt') ? `: ${node.getAttribute('alt')}` : ''}]`, url));
      return;
    }
    let target = parent;
    if (ALLOWED.has(tag)) {
      target = tag === 'a' ? link('', node.getAttribute('href') || '') : element(tag);
      if (tag === 'a' && !safeURL(node.getAttribute('href') || '')) target.removeAttribute('href');
      parent.append(target);
    }
    for (const child of node.childNodes) copy(child, target);
  }
  for (const node of source.childNodes) copy(node, container);
  if (!container.textContent.trim()) container.textContent = comment.body || '[No comment text available]';
  return container;
}

export function contextChain(comment, comments) {
  const chain = [comment];
  const seen = new Set([comment.name]);
  let parent = comment.parent_id;
  while (parent?.startsWith('t1_') && !seen.has(parent)) {
    const ancestor = comments.get(parent);
    if (!ancestor) return { chain: chain.reverse(), missing: parent };
    chain.push(ancestor);
    seen.add(parent);
    parent = ancestor.parent_id;
  }
  return { chain: chain.reverse(), missing: parent?.startsWith('t1_') ? parent : null };
}
