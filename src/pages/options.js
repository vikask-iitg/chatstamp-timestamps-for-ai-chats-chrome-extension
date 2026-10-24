// Settings page: date format, clock, per-site toggles (FR-9), JSON export and
// import (FR-12) and clear data (FR-13).
(function () {
  const ChatStamp = globalThis.ChatStamp;
  const $ = (id) => document.getElementById(id);
  const platformInputs = document.querySelectorAll('input[data-platform]');

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
        ? `· ${mine.length} chats${estimated ? `, ${estimated} estimated` : ''}`
        : '';
    }
  }

  function renderForm() {
    $('dateFormat').value = settings.dateFormat;
    $('clock').value = settings.clock;
    $('theme').value = settings.theme;
    $('messageTimes').checked = settings.messageTimes !== false;
    ChatStampTheme.set(settings.theme);
    platformInputs.forEach((input) => {
      input.checked = settings.enabled[input.dataset.platform] !== false;
    });
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

  (async () => {
    settings = await ChatStamp.storage.getSettings();
    renderForm();
    await renderCounts();
  })();
})();
