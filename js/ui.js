// ui.js - 通用 UI 辅助：提示、模态框、主题、轻量 Markdown、日期格式化
(function (WB) {
  'use strict';
  const store = WB.store;

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(msg, type) {
    let box = document.getElementById('toast-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toast-box';
      document.body.appendChild(box);
    }
    const t = document.createElement('div');
    t.className = 'toast ' + (type || 'info');
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => { t.classList.add('show'); }, 10);
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 300);
    }, 2600);
  }

  // 模态框：openModal({title, html, actions:[{label, primary, onClick(close)}]}) -> {close}
  function openModal(opts) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'modal';
    dialog.innerHTML =
      '<div class="modal-head">' + escapeHtml(opts.title || '') + '</div>' +
      '<div class="modal-body">' + (opts.html || '') + '</div>' +
      '<div class="modal-foot"></div>';
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    const foot = dialog.querySelector('.modal-foot');
    function close() { overlay.remove(); }
    (opts.actions || []).forEach(a => {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (a.primary ? 'primary' : (a.danger ? 'danger' : 'ghost'));
      btn.textContent = a.label;
      btn.onclick = () => {
        if (a.onClick) a.onClick(close);
        else if (!a.primary) close(); // 非主按钮（如“取消”）未显式绑定时默认关闭弹窗
      };
      foot.appendChild(btn);
    });
    setTimeout(() => overlay.classList.add('show'), 10);
    overlay.addEventListener('click', (e) => { if (e.target === overlay && opts.dismissable !== false) close(); });
    return { close, dialog };
  }

  function confirm(msg) {
    return new Promise(resolve => {
      openModal({
        title: '请确认',
        html: '<p>' + escapeHtml(msg) + '</p>',
        actions: [
          { label: '取消', onClick: (c) => { c(); resolve(false); } },
          { label: '确定', primary: true, onClick: (c) => { c(); resolve(true); } }
        ]
      });
    });
  }

  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = n => (n < 10 ? '0' + n : '' + n);
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function fmtDateTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = n => (n < 10 ? '0' + n : '' + n);
    return fmtDate(ts) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fmtRelative(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const m = 60000, h = 3600000, d = 86400000;
    if (diff < m) return '刚刚';
    if (diff < h) return Math.floor(diff / m) + ' 分钟前';
    if (diff < d) return Math.floor(diff / h) + ' 小时前';
    if (diff < 30 * d) return Math.floor(diff / d) + ' 天前';
    return fmtDate(ts);
  }

  // 极简 Markdown：先转义，再支持 # 标题、- 列表、**粗体**、*斜体*、`代码`、[链接](url)
  function mdLite(text) {
    const esc = escapeHtml(text || '');
    const lines = esc.split('\n');
    let html = '', inList = false;
    const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
    for (let raw of lines) {
      const line = raw.trimEnd();
      if (/^###\s+/.test(line)) { closeList(); html += '<h3>' + line.replace(/^###\s+/, '') + '</h3>'; }
      else if (/^##\s+/.test(line)) { closeList(); html += '<h2>' + line.replace(/^##\s+/, '') + '</h2>'; }
      else if (/^#\s+/.test(line)) { closeList(); html += '<h1>' + line.replace(/^#\s+/, '') + '</h1>'; }
      else if (/^[-*]\s+/.test(line)) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += '<li>' + inline(line.replace(/^[-*]\s+/, '')) + '</li>';
      }
      else if (line === '') { closeList(); }
      else { closeList(); html += '<p>' + inline(line) + '</p>'; }
    }
    closeList();
    return html;
  }
  function inline(s) {
    return s
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  function emptyState(msg, icon) {
    return '<div class="empty"><div class="empty-icon">' + (icon || '📭') + '</div><div>' + escapeHtml(msg) + '</div></div>';
  }

  // 主题
  async function initTheme() {
    const t = await store.getMeta('theme', 'auto');
    applyTheme(t);
  }
  function applyTheme(t) {
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }
  async function setTheme(t) {
    applyTheme(t);
    await store.setMeta('theme', t);
  }

  WB.ui = {
    escapeHtml, toast, openModal, confirm,
    fmtDate, fmtDateTime, fmtRelative, mdLite, emptyState,
    initTheme, applyTheme, setTheme
  };
})(window.WB = window.WB || {});
