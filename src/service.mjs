import { emptyState, saveLinks, updateItem, addSnapshot, validateBackup, mergeBackup, eligibleTabs, duplicatePlan, revalidatePlan, normalizeUrl, domainOf, LIMITS } from './core.mjs';

export function createService(platform) {
  let tail = Promise.resolve();
  async function load() {
    const stored = await platform.load();
    return stored ? { ...validateBackup(stored), revision: stored.revision ?? 0 } : emptyState();
  }
  async function persist(state) { const next = { ...state, revision: state.revision + 1 }; await platform.save(next); return next; }
  async function handle(message) {
    const state = await load();
    switch (message.type) {
      case 'state': return state;
      case 'tabs': return eligibleTabs(await platform.tabs());
      case 'save': {
        const result = saveLinks(state, message.links);
        await persist(result.state); return { added: result.added, skipped: result.skipped };
      }
      case 'collect': {
        const result = saveLinks(state, eligibleTabs(await platform.tabs()));
        await persist(result.state); return { added: result.added, skipped: result.skipped };
      }
      case 'update': await persist(updateItem(state, message.id, message.patch ?? {})); return true;
      case 'delete': {
        const item = state.items.find(item => item.id === message.id);
        if (!item) throw new Error('收藏已不存在');
        await persist({ ...state, items: state.items.filter(item => item.id !== message.id) }); return item;
      }
      case 'undo-delete': {
        const item = validateBackup({ version: 1, items: [message.item], sessions: [] }).items[0];
        if (state.items.some(row => row.url === item.url || row.id === item.id)) return false;
        if (state.items.length >= LIMITS.items) throw new Error('收藏数量已达到上限');
        await persist({ ...state, items: [item, ...state.items] }); return true;
      }
      case 'snapshot': await persist(addSnapshot(state, await platform.tabs(), { name: message.name })); return true;
      case 'delete-session': await persist({ ...state, sessions: state.sessions.filter(s => s.id !== message.id) }); return true;
      case 'restore': {
        const snapshot = state.sessions.find(session => session.id === message.id);
        if (!snapshot) throw new Error('快照已不存在');
        if (snapshot.tabs.length > LIMITS.restoreTabs) throw new Error(`该快照超过 ${LIMITS.restoreTabs} 页，请从导出文件分批打开`);
        await platform.restore(snapshot.tabs.map(tab => tab.url)); return snapshot.tabs.length;
      }
      case 'duplicates': return duplicatePlan(await platform.tabs());
      case 'close-duplicates': {
        const current = await platform.tabs(), plan = revalidatePlan(message.plan, current);
        if (!plan.length) return { closed: 0, skipped: message.plan.length };
        // Persist recovery URLs before closing even one tab. A quota failure prevents cleanup.
        await persist(addSnapshot(state, current, { name: '清理前 · 自动快照' }));
        let closed = 0;
        for (const row of plan) {
          const fresh = revalidatePlan([row], await platform.tabs());
          if (fresh.length) { await platform.close(row.id); closed++; }
        }
        return { closed, skipped: message.plan.length - closed };
      }
      case 'group': {
        const tabs = eligibleTabs(await platform.tabs()).filter(tab => !tab.pinned && !tab.audible && (tab.groupId === undefined || tab.groupId === -1));
        const groups = new Map();
        for (const tab of tabs) {
          const domain = domainOf(tab.url), key = `${tab.windowId}\0${domain}`;
          if (!groups.has(key)) groups.set(key, { domain, ids: [] });
          groups.get(key).ids.push(tab.id);
        }
        let count = 0;
        for (const { domain, ids } of groups.values()) if (ids.length > 1) { await platform.group(ids, domain); count++; }
        return count;
      }
      case 'open': await platform.open(normalizeUrl(message.url)); return true;
      case 'focus-tab': {
        const tab = (await platform.tabs()).find(tab => tab.id === message.id);
        if (!tab || tab.incognito) throw new Error('该标签页已关闭');
        await platform.focus(tab.id); return true;
      }
      case 'import': await persist(mergeBackup(state, message.data)); return true;
      case 'export': return state;
      default: throw new Error('未知操作');
    }
  }
  return message => {
    // The service worker owns all mutations. UI windows cannot race read-modify-write.
    const result = tail.then(() => handle(message));
    tail = result.catch(() => {});
    return result;
  };
}
