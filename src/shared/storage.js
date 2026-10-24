// chrome.storage.local wrapper.
//
// One key per chat: "c:<platform>:<chatId>" -> compact record
//   { p: platform, id: chatId, t: title, c: createdAt, u: updatedAt, f: firstSeenAt }
// All times are epoch ms. `c` is the real creation time from the platform; when it
// is missing the date shown is `f` and is marked as estimated. Never message text.
(function () {
  const ChatStamp = (globalThis.ChatStamp = globalThis.ChatStamp || {});
  const PREFIX = 'c:';
  const SETTINGS_KEY = 'settings';

  const keyFor = (platform, id) => `${PREFIX}${platform}:${id}`;
  const isRecordKey = (key) => key.startsWith(PREFIX);

  // Combine an existing record with new information. Returns the merged record,
  // or null if nothing changed.
  function mergeRecord(existing, incoming) {
    const next = existing ? { ...existing } : { p: incoming.p, id: incoming.id };

    // First-seen only ever moves earlier (FR-3).
    if (incoming.f && (!next.f || incoming.f < next.f)) next.f = incoming.f;
    // A real creation time always wins over first-seen (FR-4).
    if (incoming.c && incoming.c !== next.c) next.c = incoming.c;
    if (incoming.u && (!next.u || incoming.u > next.u)) next.u = incoming.u;
    if (incoming.t && incoming.t !== next.t) next.t = incoming.t;

    if (existing && ['f', 'c', 'u', 't'].every((k) => existing[k] === next[k])) return null;
    return next;
  }

  async function getSettings() {
    const { [SETTINGS_KEY]: saved } = await chrome.storage.local.get(SETTINGS_KEY);
    const defaults = ChatStamp.DEFAULT_SETTINGS;
    return {
      ...defaults,
      ...saved,
      enabled: { ...defaults.enabled, ...(saved && saved.enabled) },
    };
  }

  async function saveSettings(settings) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  }

  // All records, optionally limited to one platform.
  async function getRecords(platform) {
    const all = await chrome.storage.local.get(null);
    const records = [];
    for (const [key, value] of Object.entries(all)) {
      if (!isRecordKey(key) || !ChatStamp.PLATFORM_NAMES[value.p]) continue;
      if (!platform || value.p === platform) records.push(value);
    }
    return records;
  }

  // Merge many partial records in one read and one write. Returns the changed records.
  async function mergeRecords(incoming) {
    if (!incoming.length) return [];
    const keys = incoming.map((r) => keyFor(r.p, r.id));
    const existing = await chrome.storage.local.get(keys);
    const updates = {};
    for (const record of incoming) {
      const key = keyFor(record.p, record.id);
      const merged = mergeRecord(updates[key] || existing[key], record);
      if (merged) updates[key] = merged;
    }
    const changed = Object.values(updates);
    if (changed.length) await chrome.storage.local.set(updates);
    return changed;
  }

  async function clearAll() {
    await chrome.storage.local.clear();
  }

  ChatStamp.storage = {
    SETTINGS_KEY,
    keyFor,
    isRecordKey,
    mergeRecord,
    getSettings,
    saveSettings,
    getRecords,
    mergeRecords,
    clearAll,
  };
})();
