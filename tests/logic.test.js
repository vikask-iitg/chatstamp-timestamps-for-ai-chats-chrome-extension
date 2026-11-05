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

const sandbox = vm.createContext({ chrome, console, setTimeout, clearTimeout, Date, AbortSignal, URL, btoa });
sandbox.location = { origin: 'https://site.test' };
for (const file of ['core.js', 'format.js', 'storage.js', 'search.js', 'markdown.js']) {
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

test('the timestamps switch removes sidebar and message labels', () => {
  const removed = [];
  const label = (name) => ({ remove: () => removed.push(name) });
  sandbox.document = {
    querySelectorAll: (selector) => {
      if (selector === '.chatstamp') return [label('sidebar')];
      if (selector === '.chatstamp-msg') return [label('message')];
      return [];
    },
  };
  for (const file of ['injector.js', 'messages.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'content', file), 'utf8');
    vm.runInContext(src, sandbox, { filename: file });
  }

  const adapter = {
    id: 'claude',
    linkSelectors: [],
    messageElements: () => assert.fail('should not look for messages while off'),
    fetchMessageTimes: () => assert.fail('should not fetch times while off'),
  };
  const state = { adapter, records: new Map(), settings: { ...settings, timestamps: false } };
  ChatStamp.injector.apply(state, {});
  const stamper = ChatStamp.createMessageStamper(state);
  stamper.onRoute('chat-1');
  stamper.apply();
  assert.deepStrictEqual(removed, ['sidebar', 'message']);
  assert.strictEqual(ChatStamp.DEFAULT_SETTINGS.timestamps, true);
});

test('placeholder chats are recognised', () => {
  const placeholder = (t) => ChatStamp.search.isPlaceholder({ p: 'chatgpt', id: 'x', t });
  assert.strictEqual(placeholder('New chat'), true);
  assert.strictEqual(placeholder('  new CHAT '), true);
  assert.strictEqual(placeholder(''), true);
  assert.strictEqual(placeholder(undefined), true);
  assert.strictEqual(placeholder('New chat ideas for my app'), false);
  assert.strictEqual(placeholder('Sentence correction'), false);
});

test('markdown renders common formats and escapes all chat content', () => {
  const md = ChatStamp.markdownToHtml;
  assert.strictEqual(md('Hello **bold** and *soft* and `x<y`'), '<p>Hello <strong>bold</strong> and <em>soft</em> and <code>x&lt;y</code></p>');
  assert.strictEqual(md('## Title'), '<h3>Title</h3>');
  assert.strictEqual(md('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
  assert.strictEqual(md('1. a\n\n2. b'), '<ol><li>a</li><li>b</li></ol>');
  assert.strictEqual(md('```js\nif (a<b) {}\n```'), '<pre><code>if (a&lt;b) {}</code></pre>');
  assert.strictEqual(md('| a | b |\n| --- | --- |\n| 1 | 2 |'), '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
  assert.strictEqual(md('[site](https://a.com)'), '<p><a href="https://a.com">site</a></p>');
  assert.strictEqual(md('cite\ue200here'), '<p>citehere</p>');

  for (const attack of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '[x](javascript:alert(1))', '```\n</code><script>x</script>\n```', '> <b onclick=y>q</b>', '| <i> |\n| --- |\n| <svg/onload=z> |']) {
    const html = md(attack);
    assert.ok(!/<(script|img|svg|b |i>)/.test(html), html);
    assert.ok(!/href="javascript/.test(html), html);
  }
  assert.ok(md('[x](https://a.com" onclick="y)').indexOf('onclick="y') === -1 || !/<a [^>]*onclick/.test(md('[x](https://a.com" onclick="y)')));
});

function loadAdapter(file, fetchImpl) {
  sandbox.fetch = fetchImpl;
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'platforms', file), 'utf8');
  vm.runInContext(src, sandbox, { filename: file });
}
const json = (body) => ({ ok: true, status: 200, json: async () => body });

test('ChatGPT conversation keeps visible messages on the current branch only', async () => {
  const msg = (id, role, parts, extra = {}) => ({ id, author: { role }, create_time: 1700000000, content: { content_type: 'text', parts }, ...extra });
  const mapping = {
    root: { parent: null, message: msg('root', 'system', ['setup']) },
    hidden: { parent: 'root', message: msg('hidden', 'user', ['context'], { metadata: { is_visually_hidden_from_conversation: true } }) },
    u: { parent: 'hidden', message: msg('u', 'user', ['Hi there']) },
    old: { parent: 'u', message: msg('old', 'assistant', ['old branch']) },
    tool: { parent: 'u', message: msg('tool', 'assistant', ['{"q":1}'], { recipient: 'browser' }) },
    think: { parent: 'tool', message: { id: 'think', author: { role: 'assistant' }, create_time: 1700000001, content: { content_type: 'thoughts', thoughts: [] } } },
    pic: { parent: 'think', message: { id: 'pic', author: { role: 'assistant' }, recipient: 'all', create_time: 1700000002, content: { content_type: 'multimodal_text', parts: ['Look', { content_type: 'image_asset_pointer' }] } } },
  };
  loadAdapter('chatgpt.js', async (url) => (String(url).includes('session') ? json({ accessToken: 'tok' }) : json({ mapping, current_node: 'pic' })));
  const messages = await ChatStamp.platforms.chatgpt.fetchConversation('c1');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(messages)), [
    { role: 'user', t: 1700000000000, text: 'Hi there' },
    { role: 'assistant', t: 1700000002000, text: 'Look\n\n*[Image]*' },
  ]);
});

test('Claude conversation keeps text blocks and notes attachments', async () => {
  const chat = {
    current_leaf_message_uuid: 'b',
    chat_messages: [
      { uuid: 'a', parent_message_uuid: 'root', sender: 'human', created_at: '2026-01-01T00:00:00Z', content: [{ type: 'text', text: 'Question' }], files: [{ file_name: 'a.png' }] },
      { uuid: 'old', parent_message_uuid: 'a', sender: 'assistant', created_at: '2026-01-01T00:00:01Z', content: [{ type: 'text', text: 'Old reply' }] },
      { uuid: 'b', parent_message_uuid: 'a', sender: 'assistant', created_at: '2026-01-01T00:00:02Z', content: [{ type: 'thinking', thinking: 'secret' }, { type: 'tool_use', name: 'x' }, { type: 'text', text: 'Answer' }] },
    ],
  };
  loadAdapter('claude.js', async (url) => (String(url).endsWith('/api/organizations') ? json([{ uuid: 'o1', capabilities: ['chat'] }]) : json(chat)));
  const messages = await ChatStamp.platforms.claude.fetchConversation('c1');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(messages)), [
    { role: 'user', t: Date.parse('2026-01-01T00:00:00Z'), text: 'Question\n\n*[Attachment: a.png]*' },
    { role: 'assistant', t: Date.parse('2026-01-01T00:00:02Z'), text: 'Answer' },
  ]);
});

test('ChatGPT layout tags are removed and the words kept', () => {
  const strip = ChatStamp.stripChatUiTags;
  const reply = [
    '## 1. Best databases',
    '<box gap={3}>',
    '  <row align=start gap={3}>',
    '    <AsyncImage query="PostgreSQL elephant database logo" aspectRatio="1:1" maxWidth="76px"/>',
    '    <box flex="1" gap={1}>',
    '      ## **1. <Entity value="PostgreSQL" category="software"/> — Best overall choice**',
    '      <badge color="success">My recommendation</badge>',
    '    </box>',
    '  </row>',
    '</box>',
    'Best for Todo apps.',
  ].join('\n');
  assert.strictEqual(strip(reply), '## 1. Best databases\n\n## **1. PostgreSQL — Best overall choice**\nMy recommendation\n\nBest for Todo apps.');
  assert.strictEqual(strip('<Entity category="x" value="Redis"/> is fast'), 'Redis is fast');
  assert.strictEqual(strip('<Widget size={2}>Hi</Widget>'), 'Hi');
  assert.strictEqual(strip('<foo gap={1}>Hi'), 'Hi');
});

test('code and ordinary text keep their angle brackets', () => {
  const strip = ChatStamp.stripChatUiTags;
  for (const text of [
    '```jsx\n<Box gap={3}><Entity value="a"/></Box>\n```',
    'Use `<Entity value="a"/>` and `<box>` here',
    'A Promise<Response> or List<String> value',
    'Use a <div> or <span class="a"> tag, and 3 < 4 > 2',
  ]) {
    assert.strictEqual(strip(text), text);
  }
});

test('layout language from real ChatGPT replies is fully removed', () => {
  const strip = ChatStamp.stripChatUiTags;
  const architecture = [
    '<icon name="monitor-smartphone" size="xl"/>',
    '**Frontend**',
    '<text color="secondary" size="sm">React / Next.js / your existing UI</text>',
    '',
    '<box background="rgba(22,163,74,0.10)" border={{size:1,color:"rgba(22,163,74,0.4)"}} radius="lg" padding={3} width="100%" align="center">',
    '<icon name="database" size="xl" color="success"/>',
    '**PostgreSQL — Supabase**',
    '</box>',
  ].join('\n');
  assert.strictEqual(strip(architecture), '**Frontend**\nReact / Next.js / your existing UI\n\n**PostgreSQL — Supabase**');

  const pricing = '<title size="lg">Free</title>\n<title size="2xl" color="success">$0/month</title>\n<text>Official pricing: </text>';
  assert.strictEqual(strip(pricing), '**Free**\n**$0/month**\nOfficial pricing:');

  const form = [
    '{@body const [backend,setBackend] = DIL.useState("Next.js")}',
    '{@body const [note,setNote] = DIL.useState("a } b")}',
    '<text weight="medium">Backend technology</text>',
    '<radio-group value={backend}>',
    '<radio value="Next.js">Next.js</radio>',
    '<radio value="Node.js / Express">Node.js / Express</radio>',
    '</radio-group>',
    '<button onClick={() => send(backend)} variant="primary">Recommend my setup</button>',
    'You chose {backend}.',
  ].join('\n');
  assert.strictEqual(strip(form), 'Backend technology\n\n- Next.js\n- Node.js / Express\n\nYou chose .');

  const mixed = '<icon name="x"/>Hi\n```html\n  <box gap={3}>keep</box>\n```\nUse `<text a="1">` and 3 < 4';
  assert.strictEqual(strip(mixed), 'Hi\n\n```html\n  <box gap={3}>keep</box>\n```\n\nUse `<text a="1">` and 3 < 4');
  assert.ok(!/<|\{@/.test(strip(form) + strip(pricing) + strip(architecture)));
});

test('any capitalised markup tag is removed, whatever its name', () => {
  const strip = ChatStamp.stripChatUiTags;
  assert.strictEqual(
    strip('Here it is.\n\n<WritingBlock id="58321" variant="standard">Source Study Notebook is a learning platform.</WritingBlock>'),
    'Here it is.\n\nSource Study Notebook is a learning platform.'
  );
  assert.strictEqual(strip('<SomeNewThing>Words</SomeNewThing>'), 'Words');
  for (const text of ['A Map<String, Integer> here', 'Returns Promise<Response> and List<String>', 'Compare a <b and c> d']) {
    assert.strictEqual(strip(text), text);
  }
});

test('background opens the print page only for valid requests', () => {
  let onMessage;
  const created = [];
  const fakeChrome = {
    runtime: {
      onInstalled: { addListener() {} },
      OnInstalledReason: {},
      onMessage: { addListener: (fn) => (onMessage = fn) },
      getURL: (u) => `chrome-extension://x/${u}`,
    },
    tabs: { create: (o) => created.push(o) },
  };
  const box = vm.createContext({ chrome: fakeChrome, URLSearchParams, String });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'background.js'), 'utf8'), box);

  onMessage({ type: 'chatstamp:open-print', p: 'claude', id: 'abc', t: 'My chat' }, { tab: { index: 3, windowId: 9 } });
  assert.strictEqual(created.length, 1);
  assert.strictEqual(created[0].url, 'chrome-extension://x/src/pages/print.html?p=claude&id=abc&t=My+chat');
  assert.strictEqual(created[0].index, 4);
  assert.strictEqual(created[0].windowId, 9);

  onMessage({ type: 'chatstamp:open-print', p: 'evil', id: 'abc' }, {});
  onMessage({ type: 'chatstamp:open-print', p: 'claude', id: '' }, {});
  onMessage({ type: 'other' }, {});
  onMessage(null, {});
  assert.strictEqual(created.length, 1);
});

const imageResponse = (type = 'image/png') => ({ ok: true, status: 200, headers: { get: () => type }, arrayBuffer: async () => new Uint8Array([104, 105]).buffer });

test('ChatGPT images are inlined, and the login token never goes to a file host', async () => {
  const mapping = {
    u: { parent: null, message: { id: 'u', author: { role: 'user' }, create_time: 1700000000, content: { content_type: 'multimodal_text', parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_ok' }, { content_type: 'image_asset_pointer', asset_pointer: 'file-service://file-gone' }, 'What is this?'] } } },
    t: { parent: 'u', message: { id: 't', author: { role: 'tool' }, recipient: 'all', create_time: 1700000001, content: { content_type: 'multimodal_text', parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_gen' }, 'internal note'] } } },
    x: { parent: 't', message: { id: 'x', author: { role: 'tool' }, create_time: 1700000002, content: { content_type: 'text', parts: ['tool output'] } } },
  };
  const calls = [];
  loadAdapter('chatgpt.js', async (url, init) => {
    url = String(url);
    calls.push({ url, auth: init && init.headers && init.headers.Authorization });
    if (url.includes('session')) return json({ accessToken: 'tok' });
    if (url.includes('/conversation/')) return json({ mapping, current_node: 'x' });
    if (url.includes('file_ok')) return json({ download_url: 'https://files.example/ok' });
    if (url.includes('file_gen')) return json({ download_url: '/backend-api/estuary/gen' });
    if (url.includes('file-gone')) return { ok: false, status: 404 };
    if (url === 'https://files.example/ok' || url.endsWith('/estuary/gen')) return imageResponse();
    throw new Error(`unexpected ${url}`);
  });
  const messages = JSON.parse(JSON.stringify(await ChatStamp.platforms.chatgpt.fetchConversation('c1')));
  assert.deepStrictEqual(messages, [
    { role: 'user', t: 1700000000000, text: 'What is this?\n\n*[Image]*', images: ['data:image/png;base64,aGk='] },
    { role: 'assistant', t: 1700000001000, text: '', images: ['data:image/png;base64,aGk='] },
  ]);
  assert.strictEqual(calls.find((c) => c.url === 'https://files.example/ok').auth, undefined);
  assert.strictEqual(calls.find((c) => c.url.endsWith('/estuary/gen')).auth, 'Bearer tok');
});

test('image loading rejects non-images and falls back when a host blocks reading', async () => {
  sandbox.fetch = async () => imageResponse('text/html');
  assert.strictEqual(await ChatStamp.loadImage('https://a.test/x'), null);
  sandbox.fetch = async () => ({ ok: false, status: 403 });
  assert.strictEqual(await ChatStamp.loadImage('https://a.test/x'), null);
  sandbox.fetch = async () => { throw new TypeError('CORS'); };
  assert.strictEqual(await ChatStamp.loadImage('https://a.test/x'), 'https://a.test/x');
  assert.strictEqual(await ChatStamp.loadImage('/relative'), null);
});

test('Claude images are inlined; other attachments stay as notes', async () => {
  const chat = { chat_messages: [{ uuid: 'a', index: 0, sender: 'human', created_at: '2026-01-01T00:00:00Z', content: [{ type: 'text', text: 'Look' }], files_v2: [{ file_name: 'p.png', preview_url: '/api/p.png' }, { file_name: 'broken.png', preview_url: '/api/broken' }], attachments: [{ file_name: 'doc.txt' }] }] };
  loadAdapter('claude.js', async (url) => {
    url = String(url);
    if (url.endsWith('/api/organizations')) return json([{ uuid: 'o1', capabilities: ['chat'] }]);
    if (url === '/api/p.png') return imageResponse('image/jpeg');
    if (url === '/api/broken') return { ok: false, status: 500 };
    return json(chat);
  });
  const messages = JSON.parse(JSON.stringify(await ChatStamp.platforms.claude.fetchConversation('c1')));
  assert.deepStrictEqual(messages, [{ role: 'user', t: Date.parse('2026-01-01T00:00:00Z'), text: 'Look\n\n*[Attachment: doc.txt]*\n\n*[Attachment: broken.png]*', images: ['data:image/jpeg;base64,aGk='] }]);
});

test('extension pages have no inline scripts or handlers, which Chrome would block', () => {
  const pages = path.join(__dirname, '..', 'src', 'pages');
  for (const file of fs.readdirSync(pages).filter((f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(pages, file), 'utf8');
    for (const tag of html.match(/<script\b[^>]*>/g) || []) assert.match(tag, /\ssrc=/, `${file}: ${tag}`);
    assert.doesNotMatch(html, /<[a-z][^>]*\son[a-z]+=/i, `${file}: inline event handler`);
    for (const [, url] of html.matchAll(/(?:src|href)="((?!https?:|#)[^"]+)"/g)) {
      assert.ok(fs.existsSync(path.join(pages, url)), `${file}: missing ${url}`);
    }
  }
});
