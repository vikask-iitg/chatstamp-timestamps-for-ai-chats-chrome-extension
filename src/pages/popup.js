// Toolbar popup: search stored chats across sites by title, site and date range (FR-10),
// grouped by day or month (FR-11), with a light/dark theme toggle.
(function () {
  const ChatStamp = globalThis.ChatStamp;
  const $ = (id) => document.getElementById(id);
  const MAX_RESULTS = 500;
  const QUERY_KEY = 'popupQuery';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const siteButtons = document.querySelectorAll('#platform button');

  let settings;
  let records = [];
  let platform = '';
  // Dates in effect; the date inputs only take effect when Search is pressed.
  let applied = { from: '', to: '' };

  function readQuery() {
    return { text: $('text').value, platform, range: $('range').value, from: applied.from, to: applied.to };
  }

  // Title with each search word wrapped in <mark>, built without innerHTML.
  function highlighted(title, words) {
    const frag = document.createDocumentFragment();
    if (!words.length) {
      frag.append(title);
      return frag;
    }
    const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const parts = title.split(new RegExp(`(${escaped.join('|')})`, 'gi'));
    parts.forEach((part, i) => {
      if (i % 2) {
        const mark = document.createElement('mark');
        mark.textContent = part;
        frag.append(mark);
      } else if (part) {
        frag.append(part);
      }
    });
    return frag;
  }

  // The group heading already names the day, so rows only repeat what it doesn't.
  function rowTime(ms) {
    const time = ChatStamp.format.formatTime(ms, settings.clock);
    if (settings.groupBy === 'day') return time;
    const d = new Date(ms);
    if (settings.groupBy === 'month') return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${time}`;
    return ChatStamp.format.formatDateTime(ms, settings.clock);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // Site logo bundled in icons/sites/, on a light tile.
  function badgeFor(platform) {
    const badge = el('span', 'badge');
    badge.setAttribute('aria-hidden', 'true');
    const img = document.createElement('img');
    img.src = `../../icons/sites/${platform}.png`;
    img.alt = '';
    img.width = img.height = 18;
    badge.append(img);
    return badge;
  }

  function chatRow(record, words) {
    const link = el('a', 'chat');
    link.href = ChatStamp.search.chatUrl(record);
    link.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: link.href, active: !(e.metaKey || e.ctrlKey) });
    });

    const info = ChatStamp.format.describe(record, settings);
    const badge = badgeFor(record.p);

    const body = el('span', 'body');
    const title = el('span', 'title');
    title.append(highlighted(record.t || 'Untitled chat', words));
    body.append(title, el('span', 'site', ChatStamp.PLATFORM_NAMES[record.p]));

    const time = el('span', `time${info.estimated ? ' estimated' : ''}`, `${info.estimated ? '~' : ''}${rowTime(info.ms)}`);

    link.title = info.tooltip;
    link.append(badge, body, time);
    return link;
  }

  function emptyState(heading, text) {
    const box = el('div', 'empty');
    box.innerHTML =
      '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
    box.append(el('strong', '', heading), el('p', '', text));
    return box;
  }

  function render() {
    const query = readQuery();
    try {
      localStorage.setItem(QUERY_KEY, JSON.stringify({ ...query, text: '' }));
    } catch {}

    $('customRange').hidden = query.range !== 'custom';
    siteButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.platform === platform)));

    const matches = ChatStamp.search.filterRecords(records, query);
    const shown = matches.slice(0, MAX_RESULTS);
    const groups = ChatStamp.search.groupRecords(shown, settings.groupBy);
    const words = query.text.split(/\s+/).filter(Boolean);
    const results = $('results');
    results.replaceChildren();

    const total = records.length;
    $('summary').textContent = !total
      ? 'No chats yet'
      : matches.length === total
        ? `${total} ${total === 1 ? 'chat' : 'chats'}`
        : `${matches.length} of ${total} chats${matches.length > shown.length ? `, newest ${shown.length} shown` : ''}`;

    if (!total) {
      results.append(emptyState('No chats recorded yet', 'Open ChatGPT or Claude and your sidebar chats will appear here.'));
      return;
    }
    if (!matches.length) {
      results.append(emptyState('No matching chats', 'Try a different search or widen the date range.'));
      return;
    }

    for (const group of groups) {
      if (group.label) {
        const heading = el('h2', 'group-label');
        heading.append(el('span', '', group.label), el('span', 'count', String(group.records.length)));
        results.append(heading);
      }
      for (const record of group.records) results.append(chatRow(record, words));
    }
  }

  function restoreQuery() {
    try {
      const saved = JSON.parse(localStorage.getItem(QUERY_KEY) || 'null');
      if (!saved) return;
      if (typeof saved.platform === 'string' && (!saved.platform || ChatStamp.PLATFORM_NAMES[saved.platform])) {
        platform = saved.platform;
      }
      for (const key of ['range', 'from', 'to']) if (saved[key] != null) $(key).value = saved[key];
      applied = { from: $('from').value, to: $('to').value };
    } catch {}
  }

  function showDateError(message) {
    $('dateError').textContent = message;
    $('dateError').hidden = !message;
  }

  function applyDates() {
    const from = $('from').value;
    const to = $('to').value;
    if (from && to && from > to) {
      showDateError('The From date is after the To date.');
      return;
    }
    showDateError('');
    applied = { from, to };
    if (!from && !to) $('range').value = 'all';
    render();
  }

  function clearDates() {
    $('from').value = $('to').value = '';
    applied = { from: '', to: '' };
    showDateError('');
  }

  function renderThemeButton() {
    $('toggleTheme').setAttribute('aria-checked', String(settings.theme === 'dark'));
  }

  $('text').addEventListener('input', render);
  siteButtons.forEach((button) =>
    button.addEventListener('click', () => {
      platform = button.dataset.platform;
      render();
    })
  );

  $('applyDates').addEventListener('click', applyDates);
  $('clearDates').addEventListener('click', () => {
    clearDates();
    $('range').value = 'all';
    render();
  });
  for (const id of ['from', 'to']) {
    $(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyDates();
    });
  }
  // Picking a preset clears the dates; picking "Custom range" opens the date inputs.
  $('range').addEventListener('input', () => {
    if ($('range').value === 'custom') {
      render();
      $('from').focus();
      return;
    }
    clearDates();
    render();
  });
  $('groupBy').addEventListener('change', async (e) => {
    settings.groupBy = e.target.value;
    render();
    await ChatStamp.storage.saveSettings(settings);
  });

  $('toggleTheme').addEventListener('click', async () => {
    settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
    ChatStampTheme.set(settings.theme);
    renderThemeButton();
    await ChatStamp.storage.saveSettings(settings);
  });
  $('openSettings').addEventListener('click', () => chrome.runtime.openOptionsPage());

  // Match the switch to the theme theme.js already applied, so it doesn't slide on open.
  $('toggleTheme').setAttribute('aria-checked', String(document.documentElement.dataset.theme === 'dark'));

  (async () => {
    settings = await ChatStamp.storage.getSettings();
    records = await ChatStamp.storage.getRecords();
    ChatStampTheme.set(settings.theme);
    renderThemeButton();
    $('groupBy').value = settings.groupBy;
    restoreQuery();
    render();
  })();
})();
