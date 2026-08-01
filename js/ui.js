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

  function toast(msg, type, opts) {
    opts = opts || {};
    let box = document.getElementById('toast-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toast-box';
      document.body.appendChild(box);
    }
    const t = document.createElement('div');
    t.className = 'toast ' + (type || 'info');
    const span = document.createElement('span');
    span.className = 'toast-msg';
    span.textContent = msg;
    t.appendChild(span);
    let timer;
    function dismiss() {
      if (t._gone) return;
      t._gone = true;
      t.classList.remove('show');
      clearTimeout(timer);
      setTimeout(() => t.remove(), 300);
    }
    if (opts.action && opts.action.label) {
      const btn = document.createElement('button');
      btn.className = 'toast-action';
      btn.type = 'button';
      btn.textContent = opts.action.label;
      btn.onclick = () => { if (opts.action.run) opts.action.run(); dismiss(); };
      t.appendChild(btn);
    }
    box.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    const dur = opts.duration || (opts.action ? 5000 : 2600);
    timer = setTimeout(dismiss, dur);
    return { dismiss };
  }

  // 模态框：openModal({title, html, actions:[{label, primary, danger, onClick(close)}], onDismiss, dismissable}) -> {close, dialog}
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
    let closed = false;
    function focusables() {
      return Array.from(dialog.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'));
    }
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = ''; // 恢复背景滚动
      overlay.remove();
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        if (opts.dismissable === false) return; // 不可关闭的弹窗忽略 Esc
        if (opts.onDismiss) opts.onDismiss();
        close();
      } else if (e.key === 'Tab') {
        // focus trap：Tab 在弹窗内循环
        const f = focusables();
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    (opts.actions || []).forEach(a => {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (a.primary ? 'primary' : 'ghost') + (a.danger ? ' danger' : '');
      btn.textContent = a.label;
      btn.onclick = async () => {
        if (a.onClick) {
          // L4：主按钮 onClick 执行后默认关闭弹窗；显式返回 false 或 keepOpen 时保持打开
          const r = await a.onClick(close);
          if (r === false || a.keepOpen) return;
          close();
        } else {
          close(); // 无 onClick 的按钮（含“取消”）默认关闭
        }
      };
      foot.appendChild(btn);
    });
    setTimeout(() => overlay.classList.add('show'), 10);
    overlay.addEventListener('click', (e) => { if (e.target === overlay && opts.dismissable !== false) { if (opts.onDismiss) opts.onDismiss(); close(); } });
    document.addEventListener('keydown', onKey, true); // Esc 关闭 + focus trap
    document.body.style.overflow = 'hidden'; // 打开时锁定背景滚动
    setTimeout(() => { const f = focusables(); if (f.length) f[0].focus(); }, 60); // 聚焦首个可交互元素
    return { close, dialog };
  }

  function confirm(opts) {
    let title = '请确认', message = '', confirmLabel = '确定', cancelLabel = '取消', danger = false;
    if (typeof opts === 'string') message = opts;
    else if (opts) {
      title = opts.title || title;
      message = opts.message || '';
      confirmLabel = opts.confirmLabel || confirmLabel;
      cancelLabel = opts.cancelLabel || cancelLabel;
      danger = !!opts.danger;
    }
    return new Promise(resolve => {
      openModal({
        title,
        html: '<p class="confirm-msg">' + escapeHtml(message) + '</p>',
        onDismiss: () => resolve(false), // 点背景关闭也正确 resolve，避免 Promise 永久挂起（CODE-REVIEW H1）
        actions: [
          { label: cancelLabel, onClick: (c) => { c(); resolve(false); } },
          { label: confirmLabel, primary: true, danger, onClick: (c) => { c(); resolve(true); } }
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

  function emptyState(msg, opts) {
    opts = typeof opts === 'string' ? { icon: opts } : (opts || {});
    const icon = opts.icon || '📭';
    const action = opts.action ? '<div class="empty-action"><button class="btn primary" id="empty-add" type="button">' + escapeHtml(opts.action.label || '新建') + '</button></div>' : '';
    return '<div class="empty"><div class="empty-icon">' + escapeHtml(icon) + '</div><div class="empty-text">' + escapeHtml(msg) + '</div>' + action + '</div>';
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

  function pageHead(icon, title, opts) {
    opts = opts || {};
    const actions = opts.actions || '';
    const subtitle = opts.subtitle || '';
    const ic = (WB.ui.icon && icon) ? WB.ui.icon(icon, 22) : '';
    return '<div class="page-head">' +
      '<div class="page-head-ic">' + ic + '</div>' +
      '<div class="page-head-main"><h1>' + escapeHtml(title) + '</h1>' +
      (subtitle ? '<div class="page-head-sub">' + subtitle + '</div>' : '') +
      '</div>' +
      (actions ? '<div class="page-head-actions">' + actions + '</div>' : '') +
      '</div>';
  }

  // 属性值转义（用于 value/placeholder 等属性）
  function escapeAttr(s) {
    return escapeHtml(s == null ? '' : String(s)).replace(/`/g, '&#96;');
  }

  // L3 公共表单组件：ui.field / ui.form，模块统一复用，一处改样式/校验
  function fieldHtml(f) {
    const id = f.id || ('f-' + f.name);
    const val = f.value != null ? f.value : '';
    const req = f.required ? ' data-required' : '';
    const ph = f.placeholder ? ' placeholder="' + escapeAttr(f.placeholder) + '"' : '';
    const pat = f.pattern ? ' data-pattern="' + escapeAttr(f.pattern) + '"' : '';
    const err = f.pattern ? ' data-err="' + escapeAttr(f.err || '格式不正确') + '"' : '';
    const flex = f.flex != null ? ' style="flex:' + f.flex + '"' : '';
    const common = 'id="' + id + '" class="input"' + req + ph + pat + err + flex;
    if (f.type === 'select') {
      const opts = (f.options || []).map(o => {
        const v = typeof o === 'string' ? o : o.value;
        const l = typeof o === 'string' ? o : o.label;
        return '<option value="' + escapeAttr(v) + '"' + (v === val ? ' selected' : '') + '>' + escapeHtml(l) + '</option>';
      }).join('');
      return '<label' + flex + '>' + escapeHtml(f.label || '') + '<select ' + common + '>' + opts + '</select></label>';
    }
    if (f.type === 'textarea') return '<label' + flex + '>' + escapeHtml(f.label || '') + '<textarea ' + common + ' rows="' + (f.rows || 3) + '">' + escapeHtml(val) + '</textarea></label>';
    if (f.type === 'checkbox') return '<label class="checkline"' + flex + '><input type="checkbox" id="' + id + '"' + (val ? ' checked' : '') + '> ' + escapeHtml(f.label || '') + '</label>';
    if (f.type === 'color') return '<label' + flex + '>' + escapeHtml(f.label || '') + '<input type="color" ' + common + ' value="' + escapeAttr(val || '#4f46e5') + '"></label>';
    const it = f.type || 'text';
    const extra = f.min != null ? ' min="' + f.min + '"' : '';
    return '<label' + flex + '>' + escapeHtml(f.label || '') + '<input type="' + it + '" ' + common + extra + ' value="' + escapeAttr(val) + '"></label>';
  }
  function form(fields) {
    let html = '', i = 0;
    while (i < fields.length) {
      const f = fields[i];
      if (f.row != null) {
        const rv = f.row; const group = [];
        while (i < fields.length && fields[i].row === rv) { group.push(fields[i]); i++; }
        html += '<div class="row">' + group.map(fieldHtml).join('') + '</div>';
      } else { html += fieldHtml(f); i++; }
    }
    return '<div class="form">' + html + '</div>';
  }

  // I4 表单实时校验：扫描 data-required / data-pattern，禁用主按钮 + 就近错误提示
  function bindFormValidation(dialog) {
    const primaryBtn = dialog.querySelector('.modal-foot .btn.primary');
    const inputs = dialog.querySelectorAll('[data-required], [data-pattern]');
    if (!primaryBtn) return () => true;
    function validate() {
      let ok = true; let firstErr = null;
      inputs.forEach(inp => {
        let msg = '';
        if (inp.type === 'checkbox') return; // 复选框不强制
        if (inp.hasAttribute('data-required') && !String(inp.value).trim()) msg = '必填';
        else if (inp.hasAttribute('data-pattern')) {
          const p = inp.getAttribute('data-pattern');
          try { if (String(inp.value).trim() && !(new RegExp(p)).test(inp.value)) msg = inp.getAttribute('data-err') || '格式不正确'; }
          catch (e) { /* 非法正则忽略 */ }
        }
        if (msg) { ok = false; if (!firstErr) firstErr = inp; }
        let errEl = inp.parentNode.querySelector('.field-err');
        if (msg) {
          if (errEl) errEl.textContent = msg;
          else { errEl = document.createElement('div'); errEl.className = 'field-err'; errEl.textContent = msg; inp.insertAdjacentElement('afterend', errEl); }
        } else if (errEl) errEl.remove();
      });
      primaryBtn.disabled = !ok;
      return ok;
    }
    inputs.forEach(inp => { inp.addEventListener('input', validate); inp.addEventListener('change', validate); });
    validate();
    return validate;
  }

  // I2 撤销删除（Gmail 式）：软删除 + 撤销 Toast；支持级联（多条记录）
  async function trashRecords(items, opts) {
    opts = opts || {};
    const snap = [];
    for (const it of items) {
      const rec = await store.get(it.store, it.id);
      if (rec) snap.push({ store: it.store, rec: JSON.parse(JSON.stringify(rec)) });
    }
    for (const it of items) await store.remove(it.store, it.id);
    if (opts.repaint) opts.repaint();
    WB.ui.toast(opts.label || '已删除', 'success', {
      action: {
        label: '撤销',
        run: async () => {
          for (const s of snap) { s.rec._deleted = false; s.rec.updatedAt = Date.now(); await store.put(s.store, s.rec); }
          if (opts.repaint) opts.repaint();
        }
      }
    });
  }
  function trash(storeName, id, opts) { return trashRecords([{ store: storeName, id }], opts); }

  // S5 骨架屏占位
  function skeleton(lines) {
    lines = lines || 4;
    let cards = '';
    for (let i = 0; i < lines; i++) cards += '<div class="sk-card"><div class="sk-line w70"></div><div class="sk-line w40"></div></div>';
    return '<div class="page"><div class="sk-line sk-head"></div><div class="sk-grid">' + cards + '</div></div>';
  }

  WB.ui = {
    escapeHtml, escapeAttr, toast, openModal, confirm, pageHead,
    fmtDate, fmtDateTime, fmtRelative, mdLite, emptyState,
    field: fieldHtml, form, bindFormValidation, trash, trashRecords, skeleton,
    initTheme, applyTheme, setTheme
  };
})(window.WB = window.WB || {});
