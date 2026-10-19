export const LIMITS = Object.freeze({ items: 2000, sessions: 20, sessionTabs: 100, restoreTabs: 50, importBytes: 2_000_000 });
const TRACKERS = new Set(['fbclid', 'gclid', 'dclid', 'msclkid']);

export function normalizeUrl(input) {
  if (typeof input !== 'string' || input.length > 8000) throw new Error('链接过长或格式无效');
  let url;
  try { url = new URL(input); } catch { throw new Error('请输入完整的 http 或 https 链接'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('只支持不含账号密码的 http / https 链接');
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_') || TRACKERS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  // Preserve fragments, path case, query order and meaningful query parameters.
  return url.href;
}
export function safeUrl(input) { try { return normalizeUrl(input); } catch { return null; } }
export function domainOf(input) { return new URL(normalizeUrl(input)).hostname; }
export function emptyState() { return { version: 1, revision: 0, items: [], sessions: [] }; }
export function text(value, max = 300) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
export function tagsOf(value) {
  const values = Array.isArray(value) ? value : String(value ?? '').split(/[,，]/);
  return [...new Set(values.filter(v => typeof v === 'string').map(v => text(v, 24)).filter(Boolean))].slice(0, 8);
}
function nowValid(now) { if (!Number.isSafeInteger(now) || now < 0) throw new Error('无效时间'); }

export function saveLinks(state, links, { now = Date.now(), id = () => crypto.randomUUID() } = {}) {
  nowValid(now);
  if (!Array.isArray(links) || links.length > LIMITS.items) throw new Error('链接数量超出限制');
  const items = state.items.map(item => ({ ...item })), existing = new Set(items.map(item => item.url));
  let added = 0, skipped = 0;
  for (const link of links) {
    const url = safeUrl(link.url);
    if (!url || existing.has(url)) { skipped++; continue; }
    if (items.length >= LIMITS.items) throw new Error(`花园最多保存 ${LIMITS.items} 条链接，请先导出或清理`);
    items.unshift({ id: id(), url, title: text(link.title) || domainOf(url), note: text(link.note, 1000), tags: tagsOf(link.tags), savedAt: now, readAt: null });
    existing.add(url); added++;
  }
  return { state: { ...state, items }, added, skipped };
}
export function updateItem(state, itemId, patch, now = Date.now()) {
  nowValid(now);
  if (!state.items.some(item => item.id === itemId)) throw new Error('这株收藏已不存在，请刷新');
  return { ...state, items: state.items.map(item => item.id !== itemId ? item : {
    ...item,
    ...(patch.title !== undefined ? { title: text(patch.title) || domainOf(item.url) } : {}),
    ...(patch.note !== undefined ? { note: text(patch.note, 1000) } : {}),
    ...(patch.tags !== undefined ? { tags: tagsOf(patch.tags) } : {}),
    ...(typeof patch.read === 'boolean' ? { readAt: patch.read ? (item.readAt ?? now) : null } : {}),
  }) };
}
export function filterItems(items, { query = '', view = 'unread', tag = '' } = {}) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(item => {
    if (view === 'unread' && item.readAt !== null) return false;
    if (view === 'read' && item.readAt === null) return false;
    if (tag && !item.tags.includes(tag)) return false;
    const haystack = [item.title, item.url, item.note, ...item.tags].join(' ').toLocaleLowerCase();
    return words.every(word => haystack.includes(word));
  });
}
export function pickUnread(items, random = Math.random) {
  const unread = items.filter(item => item.readAt === null);
  if (!unread.length) return null;
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('Invalid random source');
  return unread[Math.floor(value * unread.length)];
}
export function eligibleTabs(tabs) { return tabs.filter(tab => Number.isInteger(tab.id) && !tab.incognito && safeUrl(tab.url)); }
export function duplicatePlan(tabs) {
  const groups = new Map();
  for (const tab of eligibleTabs(tabs)) {
    const key = `${tab.windowId}\0${normalizeUrl(tab.url)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tab);
  }
  const plan = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const protectedTabs = group.filter(tab => tab.active || tab.pinned || tab.audible);
    const keeper = protectedTabs[0] ?? group[0];
    for (const tab of group) if (tab.id !== keeper.id && !tab.active && !tab.pinned && !tab.audible) {
      plan.push({ id: tab.id, url: tab.url, title: tab.title || domainOf(tab.url), keeperId: keeper.id, windowId: tab.windowId });
    }
  }
  return plan;
}
export function revalidatePlan(requested, currentTabs) {
  if (!Array.isArray(requested) || requested.length > LIMITS.sessionTabs) throw new Error('无效的清理计划');
  const valid = new Map(duplicatePlan(currentTabs).map(row => [row.id, row]));
  return requested.filter(row => {
    const current = valid.get(row.id);
    return current && current.url === row.url && current.keeperId === row.keeperId && current.windowId === row.windowId;
  });
}
export function addSnapshot(state, tabs, { name = '未命名快照', now = Date.now(), id = () => crypto.randomUUID() } = {}) {
  nowValid(now);
  const captured = eligibleTabs(tabs);
  if (!captured.length) throw new Error('当前没有可保存的网页标签页');
  if (captured.length > LIMITS.sessionTabs) throw new Error(`一次最多保存 ${LIMITS.sessionTabs} 个标签页，请先分窗整理`);
  const snapshot = { id: id(), name: text(name, 80) || '未命名快照', createdAt: now, tabs: captured.map(tab => ({ url: tab.url, title: text(tab.title) || domainOf(tab.url) })) };
  return { ...state, sessions: [snapshot, ...state.sessions].slice(0, LIMITS.sessions) };
}

function validTimestamp(value) { return Number.isSafeInteger(value) && value >= 0; }
export function validateBackup(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.items) || !Array.isArray(value.sessions) || value.items.length > LIMITS.items || value.sessions.length > LIMITS.sessions) throw new Error('备份格式或数量不正确');
  const itemIds = new Set(), urls = new Set(), sessionIds = new Set();
  const items = value.items.map(item => {
    if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 100 || itemIds.has(item.id) || !validTimestamp(item.savedAt) || !(item.readAt === null || validTimestamp(item.readAt))) throw new Error('备份包含无效的收藏');
    const url = normalizeUrl(item.url);
    if (urls.has(url)) throw new Error('备份包含重复链接');
    urls.add(url); itemIds.add(item.id);
    return { id: item.id, url, title: text(item.title) || domainOf(url), note: text(item.note, 1000), tags: tagsOf(item.tags), savedAt: item.savedAt, readAt: item.readAt };
  });
  const sessions = value.sessions.map(session => {
    if (!session || typeof session.id !== 'string' || !session.id || session.id.length > 100 || sessionIds.has(session.id) || !validTimestamp(session.createdAt) || !Array.isArray(session.tabs) || !session.tabs.length || session.tabs.length > LIMITS.sessionTabs) throw new Error('备份包含无效的快照');
    sessionIds.add(session.id);
    return { id: session.id, name: text(session.name, 80) || '未命名快照', createdAt: session.createdAt, tabs: session.tabs.map(tab => {
      // Restore original URLs, but never allow executable or internal schemes.
      if (!tab || !safeUrl(tab.url)) throw new Error('快照包含不支持的链接');
      return { url: new URL(tab.url).href, title: text(tab.title) || domainOf(tab.url) };
    }) };
  });
  return { version: 1, revision: 0, items, sessions };
}
export function mergeBackup(state, backup, id = () => crypto.randomUUID()) {
  const parsed = validateBackup(backup), urls = new Set(state.items.map(item => item.url));
  const extra = parsed.items.filter(item => !urls.has(item.url)).map(item => ({ ...item, id: id() }));
  if (state.items.length + extra.length > LIMITS.items) throw new Error('合并后收藏数量超出上限');
  const sessionKeys = new Set(state.sessions.map(s => JSON.stringify([s.name, s.createdAt, s.tabs])));
  const sessions = parsed.sessions.filter(s => !sessionKeys.has(JSON.stringify([s.name, s.createdAt, s.tabs]))).map(s => ({ ...s, id: id() }));
  return { ...state, items: [...state.items, ...extra], sessions: [...state.sessions, ...sessions].slice(0, LIMITS.sessions) };
}
