// Search, grouping and JSON export/import over stored records (FR-10, FR-11, FR-12).
(function () {
  const ChatStamp = (globalThis.ChatStamp = globalThis.ChatStamp || {});

  const DAY = 24 * 60 * 60 * 1000;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const EXPORT_VERSION = 1;

  const CHAT_URLS = {
    chatgpt: (id) => `https://chatgpt.com/c/${id}`,
    claude: (id) => `https://claude.ai/chat/${id}`,
  };

  const chatUrl = (record) => (CHAT_URLS[record.p] ? CHAT_URLS[record.p](encodeURIComponent(record.id)) : null);

  // The date a record is shown and filtered by: real creation time, else first seen.
  const dateOf = (record) => record.c || record.f || 0;

  function startOfDay(ms) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  // "2026-10-24" (from <input type="date">) -> local midnight in ms, or null.
  function parseDay(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    return match ? new Date(+match[1], +match[2] - 1, +match[3]).getTime() : null;
  }

  // [from, to) bounds in ms for a range name; null means unbounded.
  function rangeBounds(query, now) {
    const today = startOfDay(now);
    switch (query.range) {
      case 'today':
        return [today, null];
      case '7d':
        return [today - 6 * DAY, null];
      case '30d':
        return [today - 29 * DAY, null];
      case 'custom': {
        const from = parseDay(query.from);
        const to = parseDay(query.to);
        return [from, to == null ? null : to + DAY];
      }
      default:
        return [null, null];
    }
  }

  // query: { text, platform ('' = all), range ('all'|'today'|'7d'|'30d'|'custom'), from, to }
  // Returns matching records, newest first.
  function filterRecords(records, query, now = Date.now()) {
    const words = (query.text || '').toLowerCase().split(/\s+/).filter(Boolean);
    const [from, to] = rangeBounds(query, now);
    return records
      .filter((r) => {
        const ms = dateOf(r);
        if (!ms) return false;
        if (query.platform && r.p !== query.platform) return false;
        if (from != null && ms < from) return false;
        if (to != null && ms >= to) return false;
        const title = (r.t || '').toLowerCase();
        return words.every((w) => title.includes(w));
      })
      .sort((a, b) => dateOf(b) - dateOf(a));
  }

  function dayLabel(ms, now) {
    const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    const d = new Date(ms);
    return `${WEEKDAYS[d.getDay()]}, ${ChatStamp.format.formatDate(ms)}`;
  }

  function monthLabel(ms) {
    const d = new Date(ms);
    return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }

  // Splits already-sorted records into [{ label, records }]. mode: 'day' | 'month' | 'none'.
  function groupRecords(records, mode, now = Date.now()) {
    if (mode !== 'day' && mode !== 'month') return records.length ? [{ label: '', records }] : [];
    const groups = [];
    for (const record of records) {
      const label = mode === 'day' ? dayLabel(dateOf(record), now) : monthLabel(dateOf(record));
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.records.push(record);
      else groups.push({ label, records: [record] });
    }
    return groups;
  }

  function buildExport(records, now = Date.now()) {
    return {
      app: 'ChatStamp',
      version: EXPORT_VERSION,
      exportedAt: new Date(now).toISOString(),
      chats: records.map(({ p, id, t, c, u, f }) => ({ p, id, t, c, u, f })),
    };
  }

  const isTime = (v) => v == null || (Number.isFinite(v) && v > 0);

  // Parses an export file. Returns { records, skipped }; throws on unreadable input.
  function parseImport(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('This file is not valid JSON.');
    }
    const chats = Array.isArray(data) ? data : data && data.chats;
    if (!Array.isArray(chats)) throw new Error('This file is not a ChatStamp export.');

    const records = [];
    let skipped = 0;
    for (const chat of chats) {
      const valid =
        chat &&
        typeof chat === 'object' &&
        ChatStamp.PLATFORM_NAMES[chat.p] &&
        typeof chat.id === 'string' &&
        chat.id &&
        (chat.t == null || typeof chat.t === 'string') &&
        isTime(chat.c) &&
        isTime(chat.u) &&
        isTime(chat.f) &&
        (chat.c || chat.f);
      if (!valid) {
        skipped++;
        continue;
      }
      const record = { p: chat.p, id: chat.id };
      for (const k of ['t', 'c', 'u', 'f']) if (chat[k] != null) record[k] = chat[k];
      records.push(record);
    }
    return { records, skipped };
  }

  ChatStamp.search = { chatUrl, dateOf, filterRecords, groupRecords, buildExport, parseImport };
})();
