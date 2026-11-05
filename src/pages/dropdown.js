// Styled replacement for a native <select>, whose open menu CSS can't reach. The
// <select> stays in the page, hidden, and remains the source of truth: picking an
// option sets its value and fires its usual events, and sync() picks up changes
// made to it from code.
(function () {
  const svg = (inner) =>
    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const CHEVRON = svg('<path d="m6 9 6 6 6-6"/>');
  const CHECK = svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>');

  let openDropdown = null;

  globalThis.ChatStampDropdown = function (select, icons) {
    const root = document.createElement('div');
    root.className = 'dropdown';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'dropdown-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', select.getAttribute('aria-label'));

    const menu = document.createElement('div');
    menu.className = 'dropdown-menu';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', select.getAttribute('aria-label'));
    menu.hidden = true;

    const options = Array.from(select.options, (option) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'dropdown-option';
      item.setAttribute('role', 'option');
      item.tabIndex = -1;
      item.dataset.value = option.value;
      item.innerHTML = `<span class="dropdown-icon">${svg(icons[option.value])}</span><span class="dropdown-label"></span><span class="dropdown-check">${CHECK}</span>`;
      item.querySelector('.dropdown-label').textContent = option.textContent;
      item.addEventListener('click', () => choose(option.value));
      menu.append(item);
      return item;
    });

    function sync() {
      const current = select.options[select.selectedIndex];
      trigger.innerHTML = `<span class="dropdown-icon">${svg(icons[select.value])}</span><span class="dropdown-label"></span><span class="dropdown-chevron">${CHEVRON}</span>`;
      trigger.querySelector('.dropdown-label').textContent = current ? current.textContent : '';
      options.forEach((item) => item.setAttribute('aria-selected', String(item.dataset.value === select.value)));
    }

    function open() {
      if (openDropdown && openDropdown !== api) openDropdown.close();
      openDropdown = api;
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      (options.find((item) => item.dataset.value === select.value) || options[0]).focus();
    }

    function close(refocus) {
      if (openDropdown === api) openDropdown = null;
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (refocus) trigger.focus();
    }

    function choose(value) {
      const changed = select.value !== value;
      close(true);
      if (!changed) return;
      select.value = value;
      sync();
      // Listeners may move focus (Custom range opens the date fields), so these come last.
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    trigger.addEventListener('click', () => (menu.hidden ? open() : close(true)));
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        open();
      }
    });
    menu.addEventListener('keydown', (e) => {
      const index = options.indexOf(document.activeElement);
      const target = {
        ArrowDown: options[(index + 1) % options.length],
        ArrowUp: options[(index - 1 + options.length) % options.length],
        Home: options[0],
        End: options[options.length - 1],
      }[e.key];
      if (target) {
        e.preventDefault();
        target.focus();
      } else if (e.key === 'Escape') {
        // Otherwise Escape would close the whole popup.
        e.preventDefault();
        e.stopPropagation();
        close(true);
      } else if (e.key === 'Tab') {
        close(false);
      }
    });

    const api = { sync, close };
    select.hidden = true;
    root.append(trigger, menu);
    select.after(root);
    sync();
    return api;
  };

  document.addEventListener('pointerdown', (e) => {
    if (openDropdown && !e.target.closest('.dropdown-menu, .dropdown-trigger')) openDropdown.close(false);
  });
})();
