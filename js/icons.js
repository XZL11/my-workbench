// icons.js - 内联 SVG 线性图标（lucide 风格），替代 emoji，提升精致度
(function (WB) {
  'use strict';
  // 每个值为 svg 内部内容，外层由 icon() 包裹；24x24 视图，stroke=currentColor
  const P = {
    menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
    sun: '<circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.5" y1="4.5" x2="6.5" y2="6.5"/><line x1="17.5" y1="17.5" x2="19.5" y2="19.5"/><line x1="4.5" y1="19.5" x2="6.5" y2="17.5"/><line x1="17.5" y1="6.5" x2="19.5" y2="4.5"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"/><path d="M9.5 21v-6h5v6"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="2.5" x2="8" y2="6.5"/><line x1="16" y1="2.5" x2="16" y2="6.5"/>',
    note: '<path d="M14 3H6.5A2.5 2.5 0 0 0 4 5.5v13A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V9z"/><polyline points="14 3 14 9 20 9"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2.1-1-3.1-1.1-2.2-.2-4.2 1.9-6 .6 2.6 2 4.9 4 6.5 2 1.6 3 3.5 3 5.6a7 7 0 1 1-14 0c0-1.2.5-2.3 1.1-3.1.4.9 1 1.6 1.9 1.9.3-1.7-.5-3.3-1.9-4.3.2 2.6 1.4 4 3.4 5z"/>',
    bookmark: '<path d="M19 21l-7-5-7 5V5.5A2.5 2.5 0 0 1 7.5 3h9A2.5 2.5 0 0 1 19 5.5z"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    wallet: '<path d="M21 12.5V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2.5"/><path d="M21 12.5H17a2 2 0 0 0 0 4h4"/><circle cx="15" cy="14.5" r="1"/>',
    pen: '<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/><line x1="14.5" y1="6" x2="18" y2="9.5"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    chevronLeft: '<polyline points="15 18 9 12 15 6"/>',
    chevronRight: '<polyline points="9 18 15 12 9 6"/>',
    search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    bulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2V18h6v-1.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2z"/>',
    coins: '<ellipse cx="9" cy="7" rx="5" ry="5"/><path d="M4 7v3c0 2.2 2.2 4 5 4s5-1.8 5-4V7"/><ellipse cx="15" cy="14" rx="5" ry="5"/><path d="M10 14v3c0 2.2 2.2 4 5 4s5-1.8 5-4v-3"/>',
    sparkles: '<path d="M12 3l1.7 4.6L18 9l-4.3 1.4L12 15l-1.7-4.6L6 9l4.3-1.4z"/><path d="M19 13l.9 2.4L22 16l-2.1.6L19 19l-.9-2.4L16 16l2.1-.6z"/><path d="M5 14l.7 1.9L7.6 16.6 5.7 17.3 5 19l-.7-1.7L2.4 16.6l1.9-.7z"/>',
    butler: '<path d="M21 11.5a8 8 0 0 1-8 8H8l-4 3V19a8 8 0 1 1 17-7.5z"/><circle cx="9" cy="12.5" r="1"/><circle cx="12" cy="12.5" r="1"/><circle cx="15" cy="12.5" r="1"/>',
    diary: '<rect x="4" y="3.5" width="16" height="17" rx="2.5"/><line x1="9" y1="3.5" x2="9" y2="20.5"/><line x1="13" y1="8" x2="17" y2="8"/><line x1="13" y1="12" x2="17" y2="12"/>'
  };
  // 模块图标名 → 吉祥物图片文件名（解决图标名与文件名不一致导致的空白/错配）
  const MASCOT_MAP = {
    home: 'today', calendar: 'calendar', note: 'notes', flame: 'habits',
    bookmark: 'bookmarks', book: 'reading', wallet: 'finance', pen: 'content',
    target: 'planning', bulb: 'recommend', settings: 'settings', tasks: 'tasks'
  };
  const SPIDEY_MAP = {
    home: 'today', calendar: 'calendar', note: 'notes', flame: 'habits',
    bookmark: 'bookmarks', book: 'reading', wallet: 'finance', pen: 'content',
    target: 'planning', bulb: 'recommend', settings: 'settings', tasks: 'tasks', coins: 'coins'
  };
  function icon(name, size) {
    size = size || 20;
    if (WB.theme && WB.theme.isMascot && WB.theme.isMascot()) {
      const m = MASCOT_MAP[name];
      if (m) {
        return '<img class="ic ic-mascot ic-' + name + '" src="assets/mascot/' + m + '.png" width="' + size + '" height="' + size + '" alt="" aria-hidden="true" loading="lazy">';
      }
    }
    if (WB.theme && WB.theme.isSpidey && WB.theme.isSpidey()) {
      const m = SPIDEY_MAP[name];
      if (m) {
        return '<img class="ic ic-spidey ic-' + name + '" src="assets/spidey/' + m + '.png" width="' + size + '" height="' + size + '" alt="" aria-hidden="true" loading="lazy">';
      }
    }
    const inner = P[name];
    if (!inner) return '';
    return '<svg class="ic ic-' + name + '" width="' + size + '" height="' + size +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      inner + '</svg>';
  }
  WB.ui = WB.ui || {};
  WB.ui.icon = icon;
})(window.WB = window.WB || {});
