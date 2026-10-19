import { createService } from '../src/service.mjs';
import { emptyState, saveLinks, updateItem, addSnapshot } from '../src/core.mjs';

export function createDemoService(storage = localStorage) {
  const key = 'tab-garden-demo-v1';
  const now = Date.now();
  let tabs = [
    { id: 1, windowId: 1, title: '如何把收藏变成真正学会的知识', url: 'https://example.org/learning', active: true, groupId: -1 },
    { id: 2, windowId: 1, title: 'Chrome Extensions — Getting started', url: 'https://developer.chrome.com/docs/extensions/get-started', groupId: -1 },
    { id: 3, windowId: 1, title: 'Chrome Extensions — 开发指南', url: 'https://developer.chrome.com/docs/extensions/get-started?utm_source=demo', groupId: -1 },
    { id: 4, windowId: 1, title: 'SQLite 的事务是如何工作的', url: 'https://www.sqlite.org/lang_transaction.html', groupId: -1 },
    { id: 5, windowId: 1, title: 'Chrome storage API', url: 'https://developer.chrome.com/docs/extensions/reference/api/storage', groupId: -1 },
    { id: 6, windowId: 1, title: 'SQLite Transactions', url: 'https://www.sqlite.org/lang_transaction.html?utm_campaign=demo', groupId: -1 },
  ];
  if (!storage.getItem(key)) {
    let count = 0;
    let state = saveLinks(emptyState(), [
      { title: '从浏览器标签页，到真正留下来的知识', url: 'https://example.org/learning', tags: ['学习方法'], note: '收藏只是第一步。下次试着读完，用自己的话记下一句话。' },
      { title: '让小工具更好用：那些看不见的交互细节', url: 'https://developer.mozilla.org/zh-CN/docs/Web/Accessibility', tags: ['设计', '前端'] },
      { title: 'Build your first Chrome extension', url: 'https://developer.chrome.com/docs/extensions/get-started', tags: ['开发'], note: '从一个小功能开始，做一个自己每天会用到的工具。' },
      { title: 'SQLite 的事务，为什么值得认真理解', url: 'https://www.sqlite.org/lang_transaction.html', tags: ['数据库', '开发'] },
      { title: 'The quiet pleasure of keeping a small garden', url: 'https://example.org/small-garden', tags: ['生活灵感'] },
      { title: '用 JavaScript 写可以信任的测试', url: 'https://nodejs.org/api/test.html', tags: ['开发'] },
      { title: 'BM25：检索背后的一个简单公式', url: 'https://example.org/bm25', tags: ['AI', '学习方法'] },
    ], { now: now - 86400000, id: () => `demo-${++count}` }).state;
    state = updateItem(state, state.items.find(item => item.url.includes('/bm25')).id, { read: true }, now - 3600000);
    state = addSnapshot(state, tabs.slice(0, 4), { name: '周末的学习现场', now: now - 7200000, id: () => 'demo-session' });
    storage.setItem(key, JSON.stringify(state));
  }
  return createService({
    load: async () => JSON.parse(storage.getItem(key)),
    save: async state => storage.setItem(key, JSON.stringify(state)),
    tabs: async () => structuredClone(tabs),
    close: async id => { tabs = tabs.filter(tab => tab.id !== id); },
    group: async ids => { for (const tab of tabs) if (ids.includes(tab.id)) tab.groupId = 10; },
    restore: async urls => { for (const url of urls) tabs.push({ id: Math.max(0, ...tabs.map(t => t.id)) + 1, windowId: 1, url, title: new URL(url).hostname, groupId: -1 }); },
    open: async () => {},
    focus: async id => { tabs = tabs.map(tab => ({ ...tab, active: tab.id === id })); },
  });
}
