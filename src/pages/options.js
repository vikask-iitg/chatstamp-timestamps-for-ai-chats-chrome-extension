// Settings page: date format, clock, per-site toggles (FR-9), JSON export and
// import (FR-12) and clear data (FR-13).
(function () {
  const ChatStamp = globalThis.ChatStamp;
  const $ = (id) => document.getElementById(id);
  const platformInputs = document.querySelectorAll('input[data-platform]');

  const CLOCK = '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';
  const CALENDAR = '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>';
  const dropdowns = [
    ChatStampDropdown($('dateFormat'), {
      datetime: `${CALENDAR}<circle cx="12" cy="15.5" r="1.8" fill="currentColor" stroke="none"/>`,
      auto: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.500M8.5 15.5 6 18"/>',
      relative: '<path d="M3 12a9 9 0 1 0 3-6.700L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
      absolute: CALENDAR,
    }),
    ChatStampDropdown($('theme'), {
      light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.900l1.4 1.400M17.7 17.700l1.4 1.400M2 12h2M20 12h2M4.9 19.100l1.4-1.400M17.7 6.300l1.4-1.4"/>',
      dark: '<path d="M21 12.800A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.800z"/>',
    }),
    ChatStampDropdown($('clock'), { 12: CLOCK, 24: CLOCK }),
  ];

  const PANE_KEY = 'settingsPane';
  const sideLinks = document.querySelectorAll('.side-link');

  function showPane(name) {
    const link = [...sideLinks].find((l) => l.dataset.pane === name) || sideLinks[0];
    sideLinks.forEach((l) => {
      const active = l === link;
      if (active) l.setAttribute('aria-current', 'page');
      else l.removeAttribute('aria-current');
      $(`pane-${l.dataset.pane}`).hidden = !active;
    });
    try {
      localStorage.setItem(PANE_KEY, link.dataset.pane);
    } catch {}
  }

  sideLinks.forEach((link) => link.addEventListener('click', () => showPane(link.dataset.pane)));
  let savedPane = null;
  try {
    savedPane = localStorage.getItem(PANE_KEY);
  } catch {}
  showPane(savedPane);
  $('version').textContent = chrome.runtime.getManifest().version;

  let settings;

  function renderPreview() {
    const now = Date.now();
    const samples = [now - 2 * 3600 * 1000, now - 26 * 3600 * 1000, now - 40 * 86400 * 1000];
    const labels = samples.map((ms) => ChatStamp.format.formatLabel(ms, settings, now));
    $('preview').textContent = `${labels.join('  ·  ')}  ·  hover: ${ChatStamp.format.formatDateTime(samples[0], settings.clock)}`;
  }

  async function renderCounts() {
    const records = await ChatStamp.storage.getRecords();
    for (const platform of Object.keys(ChatStamp.PLATFORM_NAMES)) {
      const mine = records.filter((r) => r.p === platform);
      const estimated = mine.filter((r) => !r.c).length;
      $(`count-${platform}`).textContent = mine.length
        ? `${mine.length} ${mine.length === 1 ? 'chat' : 'chats'}${estimated ? `, ${estimated} estimated` : ''}`
        : 'No chats recorded yet';
    }
  }

  function renderForm() {
    $('dateFormat').value = settings.dateFormat;
    $('clock').value = settings.clock;
    $('theme').value = settings.theme;
    $('messageTimes').checked = settings.messageTimes !== false;
    $('pdfButton').checked = settings.pdfButton !== false;
    ChatStampTheme.set(settings.theme);
    platformInputs.forEach((input) => {
      input.checked = settings.enabled[input.dataset.platform] !== false;
    });
    dropdowns.forEach((dropdown) => dropdown.sync());
    renderPreview();
  }

  async function save() {
    await ChatStamp.storage.saveSettings(settings);
    renderPreview();
  }

  $('dateFormat').addEventListener('change', (e) => {
    settings.dateFormat = e.target.value;
    save();
  });
  $('pdfButton').addEventListener('change', (e) => {
    settings.pdfButton = e.target.checked;
    save();
  });
  $('messageTimes').addEventListener('change', (e) => {
    settings.messageTimes = e.target.checked;
    save();
  });
  $('theme').addEventListener('change', (e) => {
    settings.theme = e.target.value;
    ChatStampTheme.set(settings.theme);
    save();
  });
  $('clock').addEventListener('change', (e) => {
    settings.clock = e.target.value;
    save();
  });
  platformInputs.forEach((input) =>
    input.addEventListener('change', () => {
      settings.enabled = { ...settings.enabled, [input.dataset.platform]: input.checked };
      save();
    })
  );

  $('export').addEventListener('click', async () => {
    const records = await ChatStamp.storage.getRecords();
    const data = ChatStamp.search.buildExport(records);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `chatstamp-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    $('status').textContent = `Exported ${records.length} chats.`;
  });

  $('import').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { records, skipped } = ChatStamp.search.parseImport(await file.text());
      const changed = await ChatStamp.storage.mergeRecords(records);
      await renderCounts();
      $('status').textContent =
        `Imported ${records.length} chats, ${changed.length} new or updated` +
        (skipped ? `, ${skipped} skipped as invalid.` : '.');
    } catch (err) {
      $('status').textContent = `Import failed: ${err.message}`;
    }
  });

  $('clear').addEventListener('click', async () => {
    if (!confirm('Delete all stored chat dates and reset settings? This cannot be undone.')) return;
    await ChatStamp.storage.clearAll();
    settings = await ChatStamp.storage.getSettings();
    renderForm();
    await renderCounts();
    $('status').textContent = 'All data cleared.';
  });

  // The popup can change settings while this page is open; stay current so saving
  // here doesn't overwrite them with old values.
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' || !changes[ChatStamp.storage.SETTINGS_KEY]) return;
    settings = await ChatStamp.storage.getSettings();
    renderForm();
  });

  (async () => {
    settings = await ChatStamp.storage.getSettings();
    renderForm();
    // Two frames, so the loaded switch positions are drawn before transitions turn on.
    requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('ready')));
    await renderCounts();
  })();
})();
