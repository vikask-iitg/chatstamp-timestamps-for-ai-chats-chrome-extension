// Date formatting for sidebar labels, tooltips and the settings page.
(function () {
  const ChatStamp = (globalThis.ChatStamp = globalThis.ChatStamp || {});

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  function startOfDay(ms) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function formatDate(ms) {
    const d = new Date(ms);
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }

  function formatTime(ms, clock) {
    const d = new Date(ms);
    const minutes = String(d.getMinutes()).padStart(2, '0');
    if (clock === '24') return `${String(d.getHours()).padStart(2, '0')}:${minutes}`;
    const hours = d.getHours() % 12 || 12;
    return `${hours}:${minutes} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
  }

  function formatDateTime(ms, clock) {
    return `${formatDate(ms)}, ${formatTime(ms, clock)}`;
  }

  // Like formatTime but with seconds, for message tooltips.
  function formatTimeSeconds(ms, clock) {
    const d = new Date(ms);
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return formatTime(ms, clock).replace(/^(\d+:\d+)/, `$1:${seconds}`);
  }

  // Calendar days between two timestamps (0 = same day, 1 = yesterday, ...).
  function daysBetween(ms, now) {
    return Math.round((startOfDay(now) - startOfDay(ms)) / DAY);
  }

  function formatRecent(ms, now) {
    const diff = Math.max(0, now - ms);
    if (diff < MINUTE) return 'Just now';
    if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
    const days = daysBetween(ms, now);
    if (days === 0) return `${Math.floor(diff / HOUR)}h ago`;
    if (days === 1) return 'Yesterday';
    return `${days}d ago`;
  }

  function formatRelative(ms, now) {
    const days = daysBetween(ms, now);
    if (days < 7) return formatRecent(ms, now);
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  }

  // Gmail-style: time today, weekday this week, no year this year, no time before that.
  function formatSmart(ms, clock, now) {
    const d = new Date(ms);
    const days = daysBetween(ms, now);
    const time = formatTime(ms, clock);
    if (days <= 0) return time;
    if (days === 1) return `Yesterday ${time}`;
    if (days < 7) return `${WEEKDAYS[d.getDay()]} ${time}`;
    if (d.getFullYear() === new Date(now).getFullYear()) return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${time}`;
    return formatDate(ms);
  }

  // Short text shown in the sidebar.
  function formatLabel(ms, settings, now = Date.now()) {
    const mode = settings.dateFormat;
    if (mode === 'relative') return formatRelative(ms, now);
    if (mode === 'datetime') return formatSmart(ms, settings.clock, now);
    if (mode === 'absolute') {
      return daysBetween(ms, now) === 0 ? formatTime(ms, settings.clock) : formatDate(ms);
    }
    // auto: relative for the last week, absolute for anything older
    return daysBetween(ms, now) < 7 ? formatRecent(ms, now) : formatDate(ms);
  }

  // Display info for one stored record, or null when it has no usable date.
  function describe(record, settings, now = Date.now()) {
    if (!record) return null;
    const estimated = !record.c;
    const ms = record.c || record.f;
    if (!ms) return null;

    const short = (estimated ? '~' : '') + formatLabel(ms, settings, now);
    let full = estimated
      ? `First seen ${formatDateTime(ms, settings.clock)}`
      : `Created ${formatDateTime(ms, settings.clock)}`;
    if (record.u && record.u - ms > MINUTE) full += ` · Updated ${formatDate(record.u)}`;

    const tooltip = estimated ? `${full}\nEstimated: first seen by the extension.` : full;
    const spoken = estimated ? `${full} (estimated)` : full;
    return { ms, short, tooltip, spoken, estimated };
  }

  ChatStamp.format = { formatDate, formatTime, formatTimeSeconds, formatDateTime, formatLabel, describe };
})();
