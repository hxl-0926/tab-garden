import { domainOf, filterItems, pickUnread, tagsOf, safeUrl, LIMITS } from '../src/core.mjs';

const $ = id => document.getElementById(id);
const isExtension = Boolean(globalThis.chrome?.runtime?.id);
const send = isExtension ? async message => {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error || '花园暂时未响应，请重新打开');
  return result.value;
} : (await import('./demo.mjs')).createDemoService();

let state = { items: [], sessions: [] }, tabs = [], duplicates = [], view = 'unread', query = '', activeTag = '';
let toastTimer, undoAction = null, dialogReturnFocus, refreshToken = 0;
const viewNames = { unread: '待阅读', read: '已读花圃', tabs: '当前标签页', sessions: '会话快照' };
const icon = name => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`); svg.append(use); return svg;
};
function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}
function actionButton(label, glyph, handler, className = 'icon-button') {
  const button = el('button', className); button.type = 'button'; button.title = label; button.setAttribute('aria-label', label);
  button.append(icon(glyph)); button.addEventListener('click', () => perform(handler, button)); return button;
}
function toast(message, undo = null) {
  clearTimeout(toastTimer); $('toast-message').textContent = message; $('toast').hidden = false;
  undoAction = undo; $('toast-undo').hidden = !undo;
  toastTimer = setTimeout(() => { $('toast').hidden = true; undoAction = null; }, undo ? 9000 : 4500);
}
async function perform(fn, button) {
  if (button?.disabled) return;
  if (button) button.disabled = true;
  try { await fn(); }
  catch (error) { toast(error.message || '操作未完成，请重试'); }
  finally { if (button) button.disabled = false; }
}
function bind(id, handler) { $(id).addEventListener('click', () => perform(handler, $(id))); }
function dateText(value) { return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(value); }
function domainBadge(url) {
  const domain = domainOf(url), badge = el('div', 'domain-icon', domain.replace(/^www\./, '')[0].toUpperCase());
  badge.dataset.color = String([...domain].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 5);
  badge.setAttribute('aria-hidden', 'true'); return badge;
}
function tagButton(tag) {
  const button = el('button', 'tag', tag); button.type = 'button';
  button.addEventListener('click', () => { activeTag = tag; if (view === 'tabs' || view === 'sessions') view = 'unread'; render(); });
  return button;
}
async function refresh() {
  const token = ++refreshToken;
  const result = await Promise.all([send({ type: 'state' }), send({ type: 'tabs' }), send({ type: 'duplicates' })]);
  if (token !== refreshToken) return;
  [state, tabs, duplicates] = result;
  render();
}
function render() {
  const unread = state.items.filter(item => item.readAt === null).length, read = state.items.length - unread;
  for (const [id, value] of Object.entries({ 'unread-count': unread, 'read-count': read, 'tab-count': tabs.length, 'session-count': state.sessions.length, 'stat-unread': unread, 'stat-read': read, 'stat-duplicate': duplicates.length })) $(id).textContent = value;
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === view; button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  $('breadcrumb').textContent = viewNames[view];
  const descriptions = {
    unread: ['待阅读的小花园', '种下的每一份好奇，都值得被认真打开。'],
    read: ['已经开花的好奇心', '每读完一篇，都给自己的花园添了一点颜色。'],
    tabs: ['浏览器里的小森林', '查看当前窗口的网页标签页，整理从这里开始。'],
    sessions: ['把阅读现场留住', '快照保存标签页链接；恢复时会打开一个新窗口。'],
  };
  const [title, description] = descriptions[view];
  $('section-title').replaceChildren(document.createTextNode(title + ' '), el('span', '', '0'));
  $('section-description').textContent = description;
  $('search').placeholder = view === 'sessions' ? '搜索快照名称…' : '找标题、链接或笔记…';
  $('tag-clear').hidden = !activeTag || !['read', 'unread'].includes(view);
  $('tag-clear').textContent = activeTag + ' ×';
  const sectionAction = $('section-action');
  sectionAction.hidden = !['tabs', 'sessions'].includes(view);
  sectionAction.textContent = view === 'tabs' ? '按站点分组' : '保存当前窗口';
  $('items').replaceChildren();
  let rows;
  if (view === 'tabs') {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    rows = tabs.filter(tab => terms.every(word => `${tab.title} ${tab.url}`.toLowerCase().includes(word)));
    rows.forEach(tab => $('items').append(renderTab(tab)));
  } else if (view === 'sessions') {
    rows = state.sessions.filter(session => session.name.toLowerCase().includes(query.trim().toLowerCase()));
    rows.forEach(session => $('items').append(renderSession(session)));
  } else {
    rows = filterItems(state.items, { view, query, tag: activeTag });
    rows.forEach(item => $('items').append(renderItem(item)));
  }
  $('section-title').querySelector('span').textContent = rows.length;
  $('empty-state').hidden = Boolean(rows.length);
  const searching = query || activeTag;
  $('empty-title').textContent = searching ? '这次没有找到' : view === 'read' ? '第一朵花，等你读完' : view === 'sessions' ? '给阅读现场拍一张快照' : view === 'tabs' ? '当前没有可整理的网页' : '还没有种下链接';
  $('empty-description').textContent = searching ? '换个词，或者清除标签筛选试试。' : view === 'read' ? '读完一篇后，点收藏旁边的勾，就会出现在这里。' : view === 'sessions' ? '点“保存当前窗口”，下次从这里继续。' : view === 'tabs' ? '支持普通窗口中的 http 和 https 网页。' : '点“收下当前窗口”，让想读的内容有个家。';
  const milestones = [1, 5, 10, 25, 50, 100], target = milestones.find(n => n > read) ?? 100;
  $('growth-label').textContent = read >= 25 ? '枝叶繁茂' : read >= 10 ? '慢慢开花' : read >= 5 ? '正在抽枝' : read >= 1 ? '冒出新芽' : '刚刚播种';
  $('growth-bar').style.width = `${Math.min(100, read / target * 100)}%`;
  $('growth-copy').textContent = read >= 100 ? '已经收获 100 篇以上，继续按自己的节奏生长。' : `已读 ${read} 篇，距离下一次生长还差 ${target - read} 篇。`;
  const tagCounts = new Map();
  for (const item of state.items) for (const tag of item.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  $('tag-list').replaceChildren(...[...tagCounts].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tag]) => tagButton(tag)));
}
function itemSkeleton(url, title) {
  const article = el('article', 'item'); article.append(domainBadge(url));
  const body = el('div', 'item-body'), link = el('a', 'item-title', title);
  link.href = safeUrl(url); link.target = '_blank'; link.rel = 'noopener noreferrer'; body.append(link);
  const meta = el('div', 'item-meta'); meta.append(el('span', '', domainOf(url))); body.append(meta);
  article.append(body); const actions = el('div', 'item-actions'); article.append(actions);
  return { article, body, link, meta, actions };
}
function renderItem(item) {
  const { article, body, meta, actions } = itemSkeleton(item.url, item.title);
  article.dataset.itemId = item.id;
  meta.append(el('span', 'dot', '·'), el('span', '', `${dateText(item.savedAt)} 收下`));
  if (item.note) body.append(el('p', 'item-note', item.note));
  if (item.tags.length) { const tags = el('div', 'item-tags'); tags.append(...item.tags.map(tagButton)); body.append(tags); }
  actions.append(actionButton(item.readAt === null ? '标记已读' : '放回待阅读', 'check', async () => {
    await send({ type: 'update', id: item.id, patch: { read: item.readAt === null } }); await refresh();
    toast(item.readAt === null ? '又一株好奇心开花了。' : '已放回待阅读，随时再读。');
  }, `icon-button read-button ${item.readAt !== null ? 'is-read' : ''}`));
  actions.append(actionButton('编辑收藏', 'edit', () => editDialog(item)));
  actions.append(actionButton('移除收藏', 'trash', async () => {
    const removed = await send({ type: 'delete', id: item.id }); await refresh();
    toast('已移除这条收藏', async () => { await send({ type: 'undo-delete', item: removed }); await refresh(); toast('收藏已回来'); });
  }));
  return article;
}
function renderTab(tab) {
  const { article, body, meta, actions, link } = itemSkeleton(tab.url, tab.title || domainOf(tab.url));
  link.removeAttribute('href'); link.removeAttribute('target'); link.tabIndex = 0; link.setAttribute('role', 'button');
  const focus = () => perform(async () => { await send({ type: 'focus-tab', id: tab.id }); toast(isExtension ? '已切换到标签页' : '演示标签页已切为当前'); });
  link.addEventListener('click', focus); link.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); focus(); } });
  const markers = [tab.active && '当前', tab.pinned && '固定', tab.audible && '播放中', tab.groupId !== -1 && tab.groupId !== undefined && '已分组'].filter(Boolean);
  for (const marker of markers) meta.append(el('span', 'tag', marker));
  const saved = state.items.some(item => item.url === safeUrl(tab.url));
  if (saved) body.append(el('div', 'item-tags', '已在花园中'));
  actions.append(actionButton('收下这个标签页', 'plus', async () => {
    const result = await send({ type: 'save', links: [tab] }); await refresh(); toast(result.added ? '已收下，稍后慢慢读' : '这条链接已经在花园里');
  }));
  return article;
}
function renderSession(session) {
  const article = el('article', 'item'), badge = el('div', 'domain-icon'); badge.append(icon('clock')); article.append(badge);
  const body = el('div', 'item-body'); body.append(el('div', 'item-title', session.name));
  body.append(el('div', 'item-meta', `${dateText(session.createdAt)} 保存 · ${session.tabs.length} 个标签页`));
  body.append(el('p', 'item-note', session.tabs.slice(0, 3).map(tab => tab.title).join(' / '))); article.append(body);
  const actions = el('div', 'item-actions');
  actions.append(actionButton('预览并恢复快照', 'arrow', () => restoreDialog(session)));
  actions.append(actionButton('删除快照', 'trash', () => confirmDialog('移除这张快照？', '花园收藏和当前标签页不会受影响。', async () => { await send({ type: 'delete-session', id: session.id }); await refresh(); toast('快照已移除'); }, { danger: true })));
  article.append(actions); return article;
}
function openDialog(title, copy) {
  const alreadyOpen = $('dialog').open;
  if (!alreadyOpen) dialogReturnFocus = document.activeElement;
  const titleNode = el('h2', 'dialog-title', title); titleNode.id = 'dialog-title';
  $('dialog-content').replaceChildren(titleNode);
  if (copy) $('dialog-content').append(el('p', 'dialog-copy', copy));
  if (!alreadyOpen) $('dialog').showModal();
  return $('dialog-content');
}
function field(form, label, { value = '', type = 'text', required = false, maxLength = 300 } = {}) {
  const wrapper = el('label', 'field', label), input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
  if (type !== 'textarea') input.type = type;
  input.value = value; input.required = required; input.maxLength = maxLength; wrapper.append(input); form.append(wrapper); return input;
}
function formActions(form, label, submit) {
  const error = el('p', 'dialog-error'); error.setAttribute('role', 'alert');
  const actions = el('div', 'dialog-actions'), cancel = el('button', 'button', '算了'), save = el('button', 'button primary', label);
  cancel.type = 'button'; cancel.addEventListener('click', () => $('dialog').close()); save.type = 'submit';
  actions.append(cancel, save); form.append(error, actions);
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (save.disabled) return; save.disabled = true; error.textContent = '';
    try { await submit(); $('dialog').close(); }
    catch (e) { error.textContent = e.message; }
    finally { save.disabled = false; }
  });
}
function editDialog(item = null) {
  const content = openDialog(item ? '照顾一下这株好奇心' : '种下一份新的好奇', '留下一个链接，再写一句想读它的理由。');
  const form = el('form'), url = field(form, '链接', { value: item?.url, type: 'url', required: true, maxLength: 8000 });
  url.readOnly = Boolean(item);
  const title = field(form, '标题（留空则显示站点名）', { value: item?.title });
  const note = field(form, '留给以后的自己', { type: 'textarea', value: item?.note, maxLength: 1000 });
  const tags = field(form, '标签，用逗号分隔', { value: item?.tags.join('，'), maxLength: 250 });
  formActions(form, item ? '保存修改' : '种进花园', async () => {
    const values = { url: url.value, title: title.value, note: note.value, tags: tagsOf(tags.value) };
    if (item) await send({ type: 'update', id: item.id, patch: values });
    else { const result = await send({ type: 'save', links: [values] }); if (!result.added) throw new Error('这条链接已经在花园里，或不是可保存的网页'); }
    await refresh(); toast(item ? '已保存，好奇心被认真照顾了' : '新的一株，种好了');
  });
  content.append(form); (item ? title : url).focus();
}
function confirmDialog(title, copy, confirm, { danger = false, label = '确认', preview = [] } = {}) {
  const content = openDialog(title, copy);
  if (preview.length) { const list = el('div', 'preview-list'); list.append(...preview.map(line => el('p', '', line))); content.append(list); }
  const form = el('form'); formActions(form, label, confirm); if (danger) form.querySelector('button[type="submit"]').className = 'button danger'; content.append(form);
}
function luckyDialog() {
  const selected = pickUnread(state.items);
  if (!selected) { toast('先收下一些链接，再来抽一株好奇心。'); return; }
  const content = openDialog('今天，不妨读这一篇');
  const result = el('div', 'lucky-result'); result.append(el('div', 'lucky-symbol', '✳'), el('p', 'domain-label', domainOf(selected.url)), el('h3', 'dialog-title', selected.title));
  if (selected.note) result.append(el('p', 'item-note', selected.note));
  const actions = el('div', 'dialog-actions'), again = el('button', 'button', '再抽一株'), open = el('a', 'button primary', '去读一读 ↗');
  again.addEventListener('click', luckyDialog); open.href = selected.url; open.target = '_blank'; open.rel = 'noopener noreferrer';
  open.addEventListener('click', () => { $('dialog').close(); toast('慢慢读，读完后回来给它标个勾。'); }); actions.append(again, open); result.append(actions); content.append(result);
}
function restoreDialog(session) {
  confirmDialog(`重新打开「${session.name}」`, `将在新窗口打开 ${session.tabs.length} 个网页。快照只恢复链接，不恢复表单、登录或页面历史。`, async () => {
    const count = await send({ type: 'restore', id: session.id }); await refresh(); toast(isExtension ? `已恢复 ${count} 个标签页` : `演示：已加入 ${count} 个模拟标签页`);
  }, { label: '恢复到新窗口', preview: session.tabs.map(tab => tab.title) });
}
function snapshotDialog() {
  const content = openDialog('留住这一刻的阅读现场', `将保存当前窗口的 ${tabs.length} 个网页链接，不会关闭它们。最多保留最近 20 张快照。`);
  const form = el('form'), name = field(form, '给快照起个名字', { value: `${dateText(Date.now())} 的阅读现场`, required: true, maxLength: 80 });
  formActions(form, '保存快照', async () => { await send({ type: 'snapshot', name: name.value }); await refresh(); toast('阅读现场已留住'); }); content.append(form); name.focus(); name.select();
}
bind('collect-button', async () => { const result = await send({ type: 'collect' }); await refresh(); toast(`种下 ${result.added} 条链接，跳过 ${result.skipped} 条已有收藏`); });
bind('add-button', () => editDialog()); bind('lucky-button', luckyDialog); bind('refresh-button', refresh);
bind('section-action', async () => {
  if (view === 'sessions') snapshotDialog();
  else confirmDialog('按站点，把标签页排在一起', '只整理当前窗口中尚未分组的网页。固定、正在播放音频和已有分组的标签页会保留原状。', async () => {
    const count = await send({ type: 'group' }); await refresh(); toast(`已整理 ${count} 个站点分组`);
  }, { label: '开始分组' });
});
bind('duplicates-button', async () => {
  const plan = await send({ type: 'duplicates' });
  if (!plan.length) { toast('没有需要整理的重复标签页，很清爽。'); return; }
  confirmDialog(`让 ${plan.length} 个重复标签页休息一下`, '保留当前、固定和正在播放的标签页。关闭前会先保存恢复快照；尚未提交的表单内容无法恢复，请先确认。', async () => {
    const result = await send({ type: 'close-duplicates', plan }); await refresh(); toast(`已关闭 ${result.closed} 个重复页${result.skipped ? `，${result.skipped} 个因状态变化已跳过` : '，恢复链接已保存到快照'}`);
  }, { label: '保存快照并关闭', preview: plan.map(row => row.title) });
});
bind('export-button', async () => {
  const data = await send({ type: 'export' }), blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), anchor = el('a'); anchor.href = url; anchor.download = `tab-garden-${new Date().toISOString().slice(0, 10)}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000); toast('备份已导出，记得把它放在安心的位置。');
});
bind('import-button', () => $('import-file').click());
$('import-file').addEventListener('change', event => perform(async () => {
  const file = event.target.files[0]; if (!file) return;
  event.target.value = '';
  if (file.size > LIMITS.importBytes) throw new Error('备份超过 2 MB，请拆分后再导入');
  let data;
  try { data = JSON.parse((await file.text()).replace(/^\uFEFF/, '')); } catch { throw new Error('这不是有效的 JSON 备份文件'); }
  confirmDialog('把另一片花园合进来', '导入会合并收藏和快照，已有链接与阅读进度保留。不同链接会重新分配 ID。', async () => { await send({ type: 'import', data }); await refresh(); toast('另一片花园已经合进来了'); }, { label: '合并导入' });
}));
bind('help-button', () => {
  const content = openDialog('让收藏，变成真的收获', '一个不催你赶进度的小工具。数据保存在当前浏览器本机，没有远端账号或同步服务。');
  const list = el('ol', 'help-list');
  for (const line of ['收下当前窗口：把 http / https 标签页存进待阅读，自动跳过已有链接。', '添加标签和一句笔记，方便以后找回来；按 / 快速搜索。', '读完一篇后点勾，小花园会慢慢生长。打开链接不会自动标记已读。', '标签整理只作用于当前普通窗口，不读取页面正文，不处理隐身页。', '快照只保存网页链接，最多 100 页；一次恢复最多 50 页。', '数据导出为 JSON，支持合并导入。卸载扩展前请先导出备份。']) list.append(el('li', '', line));
  content.append(list);
});
$('toast-undo').addEventListener('click', () => { const undo = undoAction; undoAction = null; if (undo) perform(undo, $('toast-undo')); });
$('dialog-close').addEventListener('click', () => $('dialog').close());
$('dialog').addEventListener('click', event => { if (event.target === $('dialog')) { const rect = $('dialog').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('dialog').close(); } });
$('dialog').addEventListener('close', () => { if (dialogReturnFocus?.isConnected) dialogReturnFocus.focus(); });
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { view = button.dataset.view; query = ''; activeTag = ''; $('search').value = ''; render(); }));
$('search').addEventListener('input', event => { query = event.target.value; render(); });
$('tag-clear').addEventListener('click', () => { activeTag = ''; render(); });
document.addEventListener('keydown', event => {
  const editing = event.target.closest('input,textarea,[contenteditable]');
  if (!$('dialog').open && ((event.key === '/' && !editing) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k'))) { event.preventDefault(); $('search').focus(); }
});
if (isExtension) {
  let refreshTimer;
  chrome.storage.onChanged.addListener((_changes, area) => { if (area === 'local') { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => perform(refresh), 100); } });
} else $('demo-banner').hidden = false;
try { await refresh(); }
catch (error) { $('items').replaceChildren(el('div', 'error-panel', `${error.message}。原有数据没有被重置，请尝试刷新或导出备份。`)); }
