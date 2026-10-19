import test from 'node:test';
import assert from 'node:assert/strict';
import { createService } from '../src/service.mjs';
import { emptyState } from '../src/core.mjs';

function fixture({ failSave = false, failRestore = false } = {}) {
  let state = emptyState(), tabs = [
    { id: 1, windowId: 1, url: 'https://a.test/', active: true, groupId: -1 },
    { id: 2, windowId: 1, url: 'https://a.test/?utm_source=x', groupId: -1 },
    { id: 3, windowId: 1, url: 'https://b.test/', pinned: true, groupId: -1 },
  ];
  const events = [], groups = [];
  const platform = {
    load: async () => structuredClone(state),
    save: async next => { if (failSave) throw new Error('quota exceeded'); state = structuredClone(next); events.push('saved'); },
    tabs: async () => structuredClone(tabs),
    close: async id => { assert.ok(state.sessions.length > 0); events.push(`close:${id}`); tabs = tabs.filter(t => t.id !== id); },
    group: async (ids, name) => { groups.push({ ids, name }); },
    restore: async urls => { if (failRestore) throw new Error('Window creation failed'); events.push({ restored: urls }); },
    open: async url => events.push({ opened: url }), focus: async () => {},
  };
  return { service: createService(platform), events, groups, setTabs: value => { tabs = value; } };
}

test('concurrent saves are serialized; no lost updates or duplicate URLs', async () => {
  const { service } = fixture();
  await Promise.all(Array.from({ length: 30 }, (_, i) => service({ type: 'save', links: [{ url: `https://site.test/${i % 10}` }] })));
  const state = await service({ type: 'state' });
  assert.equal(state.items.length, 10); assert.equal(state.revision, 30);
});
test('cleanup writes recovery snapshot before closing and rechecks a stale plan', async () => {
  const { service, events } = fixture();
  const plan = await service({ type: 'duplicates' });
  assert.deepEqual(await service({ type: 'close-duplicates', plan }), { closed: 1, skipped: 0 });
  assert.deepEqual(events, ['saved', 'close:2']);
  assert.deepEqual(await service({ type: 'close-duplicates', plan }), { closed: 0, skipped: 1 });
  assert.equal((await service({ type: 'state' })).sessions.length, 1);
});
test('a persistence failure prevents cleanup entirely', async () => {
  const { service, events } = fixture({ failSave: true });
  const plan = await service({ type: 'duplicates' });
  await assert.rejects(service({ type: 'close-duplicates', plan }), /quota/);
  assert.deepEqual(events, []);
  assert.equal((await service({ type: 'duplicates' })).length, 1);
});
test('stale URL and protected-state changes prevent closing', async () => {
  const { service, setTabs } = fixture();
  const plan = await service({ type: 'duplicates' });
  setTabs([{ id: 1, windowId: 1, url: 'https://a.test/', active: true }, { id: 2, windowId: 1, url: 'https://changed.test/' }]);
  assert.equal((await service({ type: 'close-duplicates', plan })).closed, 0);
});
test('delete undo restores progress and repeated undo cannot duplicate records', async () => {
  const { service } = fixture();
  await service({ type: 'save', links: [{ url: 'https://a.test/' }] });
  const id = (await service({ type: 'state' })).items[0].id;
  await service({ type: 'update', id, patch: { read: true, note: 'remember' } });
  const item = await service({ type: 'delete', id });
  assert.equal((await service({ type: 'state' })).items.length, 0);
  await service({ type: 'undo-delete', item }); await service({ type: 'undo-delete', item });
  const state = await service({ type: 'state' }); assert.equal(state.items.length, 1); assert.equal(state.items[0].note, 'remember'); assert.ok(state.items[0].readAt);
});
test('invalid imports are atomic and a rejected command does not poison the queue', async () => {
  const { service } = fixture();
  await assert.rejects(service({ type: 'import', data: { version: 500 } }));
  await service({ type: 'save', links: [{ url: 'https://a.test/' }] });
  assert.equal((await service({ type: 'state' })).items.length, 1);
  await assert.rejects(service({ type: 'open', url: 'javascript:alert(1)' }));
});
test('grouping leaves pinned and existing groups untouched', async () => {
  const { service, groups, setTabs } = fixture();
  setTabs([{ id: 1, windowId: 1, url: 'https://a.test/1', groupId: -1 }, { id: 2, windowId: 1, url: 'https://a.test/2', groupId: -1 }, { id: 3, windowId: 1, url: 'https://a.test/3', groupId: 9 }, { id: 4, windowId: 1, url: 'https://a.test/4', pinned: true }]);
  assert.equal(await service({ type: 'group' }), 1);
  assert.deepEqual(groups, [{ ids: [1, 2], name: 'a.test' }]);
});
test('snapshots restore URLs without consuming the saved snapshot', async () => {
  const { service, events } = fixture();
  await service({ type: 'snapshot', name: 'workspace' });
  const session = (await service({ type: 'state' })).sessions[0];
  assert.equal(await service({ type: 'restore', id: session.id }), 3);
  assert.equal(events[1].restored.length, 3);
  assert.equal((await service({ type: 'state' })).sessions.length, 1);
});
test('failed restore preserves the snapshot and subsequent commands work', async () => {
  const { service } = fixture({ failRestore: true });
  await service({ type: 'snapshot', name: 'keep me' });
  const snapshot = (await service({ type: 'state' })).sessions[0];
  await assert.rejects(service({ type: 'restore', id: snapshot.id }), /Window creation failed/);
  assert.equal((await service({ type: 'state' })).sessions[0].id, snapshot.id);
});
