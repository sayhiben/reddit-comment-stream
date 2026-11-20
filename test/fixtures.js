export const path = '/r/test/comments/abc123/a_post/';
export function comment(kind, id, time, children = '', { depth = 0, body = `Body ${id}`, collapsed = false, post = 'abc123' } = {}) {
  const controls = `<button class="vote" type="button">Vote ${id}</button><button class="reply" type="button">Reply ${id}</button><button class="mod" type="button">Remove ${id}</button><button class="native-menu" type="button">More ${id}</button><div class="native-menu-content" hidden>Save · Report · Edit</div><form class="reply-form" hidden><textarea aria-label="Draft ${id}">original draft ${id}</textarea></form>`;
  const date = new Date(1700000000000 + time * 1000).toISOString();
  if (kind === 'old') return `<div class="thing comment ${collapsed ? 'collapsed' : ''}" data-fullname="t1_${id}" id="thing_${id}"><div class="midcol">score</div><div class="entry"><p class="tagline"><a class="expand" href="javascript:void(0)">${collapsed ? '[+]' : '[-]'}</a> u/${id} <time datetime="${date}">time</time></p><div class="md">${body}</div><ul class="flat-list buttons"><li>${controls}</li></ul></div><div class="child"><div class="sitetable">${children}</div></div></div>`;
  return `<shreddit-comment thingid="t1_${id}" postid="t3_${post}" depth="${depth}" ${depth ? 'slot="children"' : ''} created="${date}"><details role="article" ${collapsed ? '' : 'open'}><summary>u/${id} <time datetime="${date}">time</time></summary><div slot="comment">${body}</div><div slot="actionRow">${controls}</div><div id="comment-children">${children}</div></details></shreddit-comment>`;
}
export function more(kind, key) {
  return kind === 'old' ? `<div class="morecomments" id="more_${key}"><button data-native-load="${key}">load more comments</button></div>` : `<faceplate-partial src="/svc/shreddit/more-comments/test/t3_abc123?part=${key}" loading="action" class="more-comments-partial"><input type="hidden" name="cursor" value="${key}"><button data-native-load="${key}">More replies</button></faceplate-partial>`;
}
export function continuation(kind, id) {
  const href = `${path}${id}/?context=8`;
  return kind === 'old' ? `<div class="deepthread"><a href="${href}">continue this thread</a></div>` : `<a class="more-comments-link" top-level="true" href="${href}">More replies</a>`;
}
export function pageHTML(kind, comments, { total, post = 'abc123', script = true } = {}) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  body{font:14px system-ui;margin:12px;max-width:760px} .thing.comment,shreddit-comment{display:block;border:1px solid #ccd5da;border-radius:6px;margin:8px 0;padding:8px} .child,#comment-children{margin-left:20px} .flat-list{list-style:none;margin:0;padding:0} .flat-list li{display:inline} button{cursor:pointer;margin:3px} .collapsed>.child,.collapsed>.entry>.md,.collapsed>.entry>.buttons{display:none} textarea{max-width:100%}
  </style></head><body><main><h1>Native Reddit fixture</h1>${kind === 'old' ? `<div class="thing link" data-fullname="t3_${post}">Post controls</div><div class="commentarea"><div class="menuarea">Sort by: new</div><div class="sitetable">${comments}</div></div>` : `<shreddit-post post-id="t3_${post}">Post controls</shreddit-post><shreddit-comments-sort-dropdown>Sort by: new</shreddit-comments-sort-dropdown><shreddit-comment-tree post-id="t3_${post}" ${total !== undefined ? `total-comments="${total}"` : ''}><section data-comment-section-anchor>${comments}</section></shreddit-comment-tree>`}</main>${script ? `<script>
  window.nativeEvents=[]; window.nativeDirectClicks=0;
  document.querySelectorAll('.vote').forEach(n=>n.addEventListener('click',()=>window.nativeDirectClicks++));
  const tree=document.querySelector('.commentarea,shreddit-comment-tree');
  tree.addEventListener('click',async e=>{
    const button=e.target.closest('button,a.expand'); if(!button)return;
    const node=button.closest('shreddit-comment,.thing.comment');
    if(button.matches('.expand')){e.preventDefault();node.classList.toggle('collapsed');button.textContent=node.classList.contains('collapsed')?'[+]':'[-]';}
    if(button.matches('.vote,.reply,.mod,.native-menu'))window.nativeEvents.push(button.textContent);
    if(button.matches('.reply'))node.querySelector('.reply-form').hidden=false;
    if(button.matches('.mod'))node.dataset.moderated='removed';
    if(button.matches('.native-menu'))node.querySelector('.native-menu-content').hidden=false;
    if(button.dataset.nativeLoad){const marker=button.closest('.morecomments,faceplate-partial');const response=await fetch('/native-more/'+button.dataset.nativeLoad);const template=document.createElement('template');template.innerHTML=await response.text();marker.replaceWith(template.content);}
  });
  </script>` : ''}</body></html>`;
}
