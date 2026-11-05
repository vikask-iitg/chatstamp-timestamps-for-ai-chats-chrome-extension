// PDF button: adds "Print as PDF" beside the site's Share button on an open chat. Idempotent,
// so it is safe to run on every DOM mutation and comes back if the site redraws.
(function () {
  const ChatStamp = (globalThis.ChatStamp = globalThis.ChatStamp || {});

  const BUTTON_CLASS = 'chatstamp-pdf';
  // Share sits in the page header; this keeps out any "Share" further down a chat.
  const HEADER_MAX_TOP_PX = 120;

  function findShareButton(adapter) {
    for (const selector of adapter.shareButtonSelectors || []) {
      const match = document.querySelector(selector);
      if (match) return match;
    }
    for (const el of document.querySelectorAll('button, a[role="button"]')) {
      const name = (el.getAttribute('aria-label') || el.textContent || '').trim().toLowerCase();
      if ((name === 'share' || name.startsWith('share ')) && el.getBoundingClientRect().top < HEADER_MAX_TOP_PX) return el;
    }
    return null;
  }

  ChatStamp.createPdfButton = function (state) {
    const { adapter } = state;

    function remove() {
      document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((button) => button.remove());
    }

    function openPrintPage() {
      const id = adapter.chatIdFromUrl(location.href);
      if (!id) return;
      const record = state.records.get(id);
      const title = (record && record.t) || document.title || 'Untitled chat';
      chrome.runtime
        .sendMessage({ type: 'chatstamp:open-print', p: adapter.id, id, t: title })
        .catch((err) => ChatStamp.info('could not open the PDF page:', err));
    }

    function create() {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = BUTTON_CLASS;
      button.title = 'Print this chat as PDF (ChatStamp)';
      button.setAttribute('aria-label', 'Print this chat as PDF');
      button.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10.5l5 5 5-5M4 20.5h16"/></svg>Print as PDF';
      button.addEventListener('click', openPrintPage);
      return button;
    }

    function apply() {
      const wanted =
        state.settings.pdfButton !== false &&
        state.settings.enabled[adapter.id] !== false &&
        adapter.chatIdFromUrl(location.href);
      if (!wanted) {
        remove();
        return;
      }
      if (document.querySelector(`.${BUTTON_CLASS}`)) return;
      const share = findShareButton(adapter);
      if (share) share.before(create());
    }

    return { apply, remove };
  };
})();
