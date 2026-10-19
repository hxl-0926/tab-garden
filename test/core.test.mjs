import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, emptyState, saveLinks, updateItem, filterItems, pickUnread, duplicatePlan, revalidatePlan, addSnapshot, validateBackup, mergeBackup, LIMITS } from '../src/core.mjs';

test('URL normalization removes trackers while preserving distinct routes and query order', () => {
  assert.equal(normalizeUrl('https://EXAMPLE.com:443/A?utm_source=x&b=2&a=1#detail'), 'https://example.com/A?b=2&a=1#detail');
  assert.notEqual(normalizeUrl('https://a.test/#one'), normalizeUrl('https://a.test/#two'));
  assert.notEqual(normalizeUrl('https://a.test/?page=1'), normalizeUrl('https://a.test/?page=2'));
  assert.throws(() => normalizeUrl('javascript:alert(1)'));
  assert.throws(() => normalizeUrl('https://user:password@a.test/'));
  assert.throws(() => normalizeUrl('file:///private.txt'));
});
test('link saves deduplicate without overwriting notes or read progress', () => {
  let id = 0;
  const first = saveLinks(emptyState(), [{ url: 'https://a.test/', title: 'first', note: 'keep', tags: ['one', 'one'] }], { id: () => String(++id), now: 0 });
  const updated = updateItem(first.state, '1', { read: true }, 10);
  const second = saveLinks(updated, [{ url: 'https://a.test/?utm_source=x', title: 'new' }, { url: 'chrome://settings' }]);
  assert.equal(second.added, 0); assert.equal(second.skipped, 2);
  assert.equal(second.state.items[0].title, 'first'); assert.equal(second.state.items[0].readAt, 10);
  assert.deepEqual(second.state.items[0].tags, ['one']);
  assert.equal(first.state.items[0].readAt, null);
});
test('filtering checks words across title, note, URL and tags', () => {
  const items = saveLinks(emptyState(), [{ url: 'https://a.test/', title: 'SQLite', note: '事务', tags: ['数据库'] }]).state.items;
  assert.equal(filterItems(items, { query: 'sqlite 事务', tag: '数据库' }).length, 1);
  assert.equal(filterItems(items, { query: 'missing' }).length, 0);
  assert.equal(filterItems(items, { view: 'read' }).length, 0);
  assert.equal(pickUnread(items, () => 0).title, 'SQLite');
  assert.equal(pickUnread([], () => 0), null);
});
test('duplicate planning preserves protected tabs and distinguishes windows and fragments', () => {
  const tabs = [
    { id: 1, windowId: 1, url: 'https://a.test/', active: true },
    { id: 2, windowId: 1, url: 'https://a.test/?utm_source=x' },
    { id: 3, windowId: 1, url: 'https://a.test/', pinned: true },
    { id: 4, windowId: 1, url: 'https://a.test/', audible: true },
    { id: 5, windowId: 2, url: 'https://a.test/' },
    { id: 6, windowId: 1, url: 'https://a.test/#other' },
    { id: 7, windowId: 1, url: 'https://a.test/', incognito: true },
  ];
  const plan = duplicatePlan(tabs);
  assert.deepEqual(plan.map(row => row.id), [2]);
  assert.equal(plan[0].keeperId, 1);
  assert.equal(revalidatePlan(plan, tabs.map(t => t.id === 2 ? { ...t, active: true } : t)).length, 0);
  assert.equal(revalidatePlan(plan, tabs.filter(t => t.id !== 1)).length, 0);
  assert.equal(revalidatePlan(plan, tabs.map(t => t.id === 2 ? { ...t, url: 'https://other.test/' } : t)).length, 0);
});
test('snapshots reject oversized windows, retain original URLs and cap history', () => {
  const tabs = [{ id: 1, windowId: 1, url: 'https://a.test/?utm_source=x', title: 'A' }];
  let state = emptyState();
  for (let i = 0; i < 25; i++) state = addSnapshot(state, tabs, { now: i, id: () => String(i) });
  assert.equal(state.sessions.length, LIMITS.sessions);
  assert.equal(state.sessions[0].id, '24');
  assert.equal(state.sessions[0].tabs[0].url, tabs[0].url);
  assert.throws(() => addSnapshot(state, Array.from({ length: 101 }, (_, i) => ({ ...tabs[0], id: i }))));
});
test('backup validation rejects executable links, duplicated IDs, broken times and unknown schema', () => {
  const backup = saveLinks(emptyState(), [{ url: 'https://a.test/' }], { id: () => 'a', now: 0 }).state;
  assert.equal(validateBackup(backup).items.length, 1);
  assert.throws(() => validateBackup({ ...backup, version: 2 }));
  assert.throws(() => validateBackup({ ...backup, items: [...backup.items, ...backup.items] }));
  assert.throws(() => validateBackup({ ...backup, items: [{ ...backup.items[0], url: 'javascript:alert(1)' }] }));
  assert.throws(() => validateBackup({ ...backup, items: [{ ...backup.items[0], savedAt: -1 }] }));
});
test('backup merging preserves local progress and remaps collisions for different links', () => {
  const local = updateItem(saveLinks(emptyState(), [{ url: 'https://a.test/', note: 'mine' }], { id: () => 'same' }).state, 'same', { read: true }, 100);
  const backup = saveLinks(emptyState(), [{ url: 'https://a.test/' }, { url: 'https://b.test/' }], { id: (() => { let i = 0; return () => 'foreign-' + i++; })() }).state;
  const merged = mergeBackup(local, backup, () => 'new-id');
  assert.equal(merged.items.length, 2); assert.equal(merged.items[0].readAt, 100); assert.equal(merged.items[0].note, 'mine');
  assert.equal(merged.items[1].id, 'new-id');
  assert.deepEqual(mergeBackup(merged, backup).items, merged.items);
});
