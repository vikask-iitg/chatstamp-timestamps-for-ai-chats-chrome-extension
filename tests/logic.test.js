// Run with: node --test
// Loads the shared scripts into a sandbox with a stub `chrome` and checks the
// date formatting, record-merge, search, grouping and import/export rules.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const store = {};
const chrome = {
  runtime: { getManifest: () => ({}) },
  storage: {
    local: {
      async get(keys) {
        if (keys == null) return { ...store };
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, store[k]]));
      },
      async set(items) {
        Object.assign(store, items);
      },
      async clear() {
        for (const k of Object.keys(store)) delete store[k];
      },
    },
  },
};

const sandbox = vm.createContext({ chrome, console, setTimeout, clearTimeout, Date });
for (const file of ['core.js', 'format.js', 'storage.js', 'search.js']) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', file), 'utf8');
  vm.runInContext(src, sandbox, { filename: file });
}
const ChatStamp = sandbox.ChatStamp;
const settings = { ...ChatStamp.DEFAULT_SETTINGS };

const now = new Date(2026, 9, 24, 15, 0).getTime();
const HOUR = 3600 * 1000;

test('auto format: relative for the last week, date after', () => {
  const f = (ms) => ChatStamp.format.formatLabel(ms, { ...settings, dateFormat: 'auto' }, now);
  assert.strictEqual(f(now - 10 * 1000), 'Just now');
  assert.strictEqual(f(now - 5 * 60 * 1000), '5m ago');
  assert.strictEqual(f(now - 2 * HOUR), '2h ago');
  assert.strictEqual(f(new Date(2026, 9, 23, 22, 0).getTime()), 'Yesterday');
  assert.strictEqual(f(new Date(2026, 9, 20, 9, 0).getTime()), '4d ago');
  assert.strictEqual(f(new Date(2026, 2, 12, 16, 30).getTime()), '12 Mar 2026');
});

test('smart date and time format', () => {
  const f = (ms, clock = '12') => ChatStamp.format.formatLabel(ms, { ...settings, dateFormat: 'datetime', clock }, now);
  assert.strictEqual(f(now - HOUR), '2:00 PM');
  assert.strictEqual(f(new Date(2026, 9, 23, 22, 0).getTime()), 'Yesterday 10:00 PM');
  assert.strictEqual(f(new Date(2026, 9, 21, 14, 53).getTime()), 'Wed 2:53 PM');
  assert.strictEqual(f(new Date(2026, 9, 15, 18, 54).getTime()), '15 Oct, 6:54 PM');
  assert.strictEqual(f(new Date(2026, 9, 15, 18, 54).getTime(), '24'), '15 Oct, 18:54');
  assert.strictEqual(f(new Date(2025, 2, 12, 16, 30).getTime()), '12 Mar 2025');
});

test('relative and absolute formats, 12 and 24 hour clocks', () => {
  const march = new Date(2026, 2, 12, 16, 30).getTime();
  assert.strictEqual(ChatStamp.format.formatLabel(march, { ...settings, dateFormat: 'relative' }, now), '7mo ago');
  assert.strictEqual(ChatStamp.format.formatLabel(now - HOUR, { ...settings, dateFormat: 'absolute' }, now), '2:00 PM');
  assert.strictEqual(ChatStamp.format.formatDateTime(march, '12'), '12 Mar 2026, 4:30 PM');
  assert.strictEqual(ChatStamp.format.formatDateTime(march, '24'), '12 Mar 2026, 16:30');
});

test('describe marks first-seen dates as estimated', () => {
  const march = new Date(2026, 2, 12, 16, 30).getTime();
  const est = ChatStamp.format.describe({ f: march }, settings, now);
  assert.strictEqual(est.short, '~12 Mar, 4:30 PM');
  assert.match(est.tooltip, /Estimated: first seen by the extension\./);

  const real = ChatStamp.format.describe({ c: march, f: now, u: new Date(2026, 2, 14).getTime() }, settings, now);
  assert.strictEqual(real.short, '12 Mar, 4:30 PM');
  assert.strictEqual(real.tooltip, 'Created 12 Mar 2026, 4:30 PM · Updated 14 Mar 2026');
  assert.strictEqual(ChatStamp.format.describe(undefined, settings, now), null);
});

test('first-seen never moves later; real creation time wins', async () => {
  await chrome.storage.local.clear();
  const s = ChatStamp.storage;
  await s.mergeRecords([{ p: 'claude', id: 'abc', f: 1000 }]);
  await s.mergeRecords([{ p: 'claude', id: 'abc', f: 5000 }]);
  assert.strictEqual(store['c:claude:abc'].f, 1000);

  await s.mergeRecords([{ p: 'claude', id: 'abc', f: 500 }]);
  assert.strictEqual(store['c:claude:abc'].f, 500);

  await s.mergeRecords([{ p: 'chatgpt', id: 'x', f: 9000 }]);
  await s.mergeRecords([{ p: 'chatgpt', id: 'x', c: 2000, u: 3000, t: 'Hello' }]);
  assert.deepStrictEqual({ ...store['c:chatgpt:x'] }, { p: 'chatgpt', id: 'x', f: 9000, c: 2000, u: 3000, t: 'Hello' });

  const unchanged = await s.mergeRecords([{ p: 'chatgpt', id: 'x', c: 2000, u: 3000, t: 'Hello' }]);
  assert.strictEqual(unchanged.length, 0);
  assert.strictEqual((await s.getRecords('chatgpt')).length, 1);
});

test('settings fill in defaults for missing keys', async () => {
  await chrome.storage.local.set({ settings: { clock: '24', enabled: { claude: false } } });
  const loaded = await ChatStamp.storage.getSettings();
  assert.strictEqual(loaded.clock, '24');
  assert.strictEqual(loaded.dateFormat, 'datetime');
  assert.deepStrictEqual({ ...loaded.enabled }, { chatgpt: true, claude: false });
});

test('search filters by title words, site and date range, newest first', () => {
  const at = (d, h = 12) => new Date(2026, 9, d, h, 0).getTime();
  const records = [
    { p: 'chatgpt', id: 'a', t: 'Loop Time Complexity', c: at(23) },
    { p: 'claude', id: 'b', t: 'Sharpen Center Logo', c: at(15) },
    { p: 'chatgpt', id: 'c', t: 'Sharpen image', f: at(24, 9) },
    { p: 'claude', id: 'd', t: 'Old chat', c: new Date(2026, 2, 1).getTime() },
    { p: 'claude', id: 'e', t: 'No date' },
  ];
  const ids = (q) => ChatStamp.search.filterRecords(records, q, now).map((r) => r.id).join(',');
  assert.strictEqual(ids({}), 'c,a,b,d');
  assert.strictEqual(ids({ text: 'sharpen' }), 'c,b');
  assert.strictEqual(ids({ text: 'SHARPEN logo' }), 'b');
  assert.strictEqual(ids({ platform: 'claude' }), 'b,d');
  assert.strictEqual(ids({ range: 'today' }), 'c');
  assert.strictEqual(ids({ range: '7d' }), 'c,a');
  assert.strictEqual(ids({ range: '30d' }), 'c,a,b');
  assert.strictEqual(ids({ range: 'custom', from: '2026-10-15', to: '2026-10-23' }), 'a,b');
  assert.strictEqual(ids({ range: 'custom', to: '2026-10-22' }), 'b,d');
});

test('grouping by day and month', () => {
  const at = (m, d) => new Date(2026, m, d, 12).getTime();
  const records = [at(9, 24), at(9, 23), at(9, 23), at(9, 15), at(8, 28)].map((c, i) => ({ p: 'claude', id: `${i}`, c }));
  const labels = (mode) => [...ChatStamp.search.groupRecords(records, mode, now)].map((g) => `${g.label}:${g.records.length}`);
  assert.deepStrictEqual(labels('day'), ['Today:1', 'Yesterday:2', 'Thu, 15 Oct 2026:1', 'Mon, 28 Sep 2026:1']);
  assert.deepStrictEqual(labels('month'), ['Oct 2026:4', 'Sep 2026:1']);
  assert.deepStrictEqual(labels('none'), [':5']);
  assert.strictEqual(ChatStamp.search.groupRecords([], 'day', now).length, 0);
});

test('export round-trips through import; bad entries are skipped', () => {
  const records = [{ p: 'claude', id: 'x', t: 'Hi', c: 1000, f: 2000 }];
  const json = JSON.stringify(ChatStamp.search.buildExport(records, now));
  const { records: back, skipped } = ChatStamp.search.parseImport(json);
  assert.deepStrictEqual([...back].map((r) => ({ ...r })), records);
  assert.strictEqual(skipped, 0);

  const mixed = JSON.stringify({ chats: [{ p: 'gemini', id: 'y', c: 1 }, { p: 'claude', id: 'z' }, { p: 'claude', id: 'ok', f: 5 }] });
  const parsed = ChatStamp.search.parseImport(mixed);
  assert.strictEqual(parsed.records.length, 1);
  assert.strictEqual(parsed.skipped, 2);
  assert.throws(() => ChatStamp.search.parseImport('nope'), /not valid JSON/);
  assert.throws(() => ChatStamp.search.parseImport('{"a":1}'), /not a ChatStamp export/);
});

test('chat URLs per site', () => {
  const url = (p) => ChatStamp.search.chatUrl({ p, id: 'abc' });
  assert.strictEqual(url('chatgpt'), 'https://chatgpt.com/c/abc');
  assert.strictEqual(url('claude'), 'https://claude.ai/chat/abc');
});

test('message branch walk and tooltip time with seconds', () => {
  const nodes = {
    root: { id: 'root', parent: null },
    a: { id: 'a', parent: 'root' },
    b1: { id: 'b1', parent: 'a' },
    b2: { id: 'b2', parent: 'a' },
    c: { id: 'c', parent: 'b2' },
  };
  const ids = (leaf) => [...ChatStamp.walkBranch(nodes, leaf, (n) => n.parent)].map((n) => n.id).join(',');
  assert.strictEqual(ids('c'), 'root,a,b2,c');
  assert.strictEqual(ids('b1'), 'root,a,b1');
  assert.strictEqual(ids('missing'), '');

  const ms = new Date(2025, 6, 27, 15, 21, 48).getTime();
  assert.strictEqual(ChatStamp.format.formatTimeSeconds(ms, '12'), '3:21:48 PM');
  assert.strictEqual(ChatStamp.format.formatTimeSeconds(ms, '24'), '15:21:48');
  assert.strictEqual(ChatStamp.format.formatDateTime(ms, '12'), '27 Jul 2025, 3:21 PM');
});
