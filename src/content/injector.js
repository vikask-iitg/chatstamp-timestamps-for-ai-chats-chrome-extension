// Injector: adds, updates and removes the date label on each sidebar chat (FR-5,
// FR-7, FR-8). Idempotent, so it is safe to run on every DOM mutation.
(function () {
  const ChatStamp = (globalThis.ChatStamp = globalThis.ChatStamp || {});

  const LABEL_CLASS = 'chatstamp';

  function findItems(adapter) {
    for (const selector of adapter.linkSelectors) {
      const nodes = document.querySelectorAll(selector);
      if (nodes.length) return nodes;
    }
    return [];
  }

  function itemId(adapter, el) {
    if (adapter.itemId) return adapter.itemId(el);
    const href = el.getAttribute('href');
    return href ? adapter.chatIdFromUrl(href) : null;
  }

  function titleElement(adapter, el) {
    return (adapter.titleSelector && el.querySelector(adapter.titleSelector)) || el;
  }

  function createLabel() {
    const label = document.createElement('span');
    label.className = LABEL_CLASS;
    const visible = document.createElement('span');
    visible.setAttribute('aria-hidden', 'true');
    const spoken = document.createElement('span');
    spoken.className = 'chatstamp-sr';
    label.append(visible, spoken);
    return label;
  }

  // Right-aligning needs a flex row to push against. If the title's container
  // isn't one, fall back to the link itself, which usually is.
  function alignEnd(el, label) {
    const isFlex = (node) => /flex/.test(getComputedStyle(node).display);
    if (!isFlex(label.parentElement) && label.parentElement !== el && isFlex(el)) el.appendChild(label);
    label.classList.add('chatstamp--end');
  }

  function removeAll() {
    document.querySelectorAll(`.${LABEL_CLASS}`).forEach((label) => label.remove());
  }

  function apply(state, collector) {
    const { adapter, settings, records } = state;
    if (settings.enabled[adapter.id] === false) {
      removeAll();
      return;
    }

    const now = Date.now();
    const missingTitles = [];

    for (const el of findItems(adapter)) {
      const id = itemId(adapter, el);
      const record = id && records.get(id);
      const info = ChatStamp.format.describe(record, settings, now);
      let label = el.querySelector(`.${LABEL_CLASS}`);

      if (!info) {
        if (label) label.remove();
        continue;
      }

      const titleEl = titleElement(adapter, el);
      if (!record.t) {
        let title = titleEl.textContent;
        if (label && titleEl.contains(label)) title = title.replace(label.textContent, '');
        title = title.trim();
        if (title) missingTitles.push({ id, t: title.slice(0, 200) });
      }

      if (!label) {
        label = createLabel();
        if (titleEl === el) el.appendChild(label);
        else titleEl.after(label);
        if (adapter.alignLabelEnd) alignEnd(el, label);
      }
      if (label.dataset.key !== info.short + info.tooltip) {
        label.dataset.key = info.short + info.tooltip;
        label.title = info.tooltip;
        label.classList.toggle('chatstamp--estimated', info.estimated);
        label.firstChild.textContent = info.short;
        label.lastChild.textContent = `, ${info.spoken}`;
      }
    }

    if (missingTitles.length) collector.rememberTitles(missingTitles);
  }

  ChatStamp.injector = { apply, removeAll };
})();
