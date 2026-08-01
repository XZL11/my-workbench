// module: reading 阅读（手动登记 + 微信读书同步入口）
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui;
  const STATUS = { want: '想读', reading: '在读', finished: '读完' };
  const STAT_CLASS = { want: 'st-idea', reading: 'st-doing', finished: 'st-done' };

  function stars(n) {
    n = Math.max(0, Math.min(5, Math.round(n || 0)));
    if (!n) return '';
    return '<span class="stars" title="' + n + ' 分">' + '★'.repeat(n) + '☆'.repeat(5 - n) + '</span>';
  }

  function formFields(r) {
    r = r || {};
    return [
      { name: 'title', label: '书名', value: r.title || '', placeholder: '书名', required: true, flex: 2 },
      { name: 'author', label: '作者', value: r.author || '', placeholder: '作者', flex: 1 },
      { name: 'cover', label: '封面图 URL（可选）', value: r.cover || '', placeholder: 'https://…' },
      { name: 'status', label: '状态', type: 'select', value: r.status || 'want', row: 'a', options: Object.keys(STATUS).map(k => ({ value: k, label: STATUS[k] })) },
      { name: 'progress', label: '进度 %', type: 'number', value: (r.progress != null ? r.progress : 0), row: 'a', attrs: 'min="0" max="100"' },
      { name: 'rating', label: '评分（0-5）', type: 'number', value: (r.rating != null ? r.rating : 0), row: 'b', attrs: 'min="0" max="5" step="0.5"' },
      { name: 'startDate', label: '开始日期', type: 'date', value: r.startDate || '', row: 'b' },
      { name: 'finishDate', label: '读完日期', type: 'date', value: r.finishDate || '', row: 'b' }
    ];
  }

  async function render(root) {
    let all = (await store.getAll('reading')).filter(i => i && i.id && i.id !== 'stat');
    root.innerHTML = `
      <div class="page">
        ${ui.pageHead('book', '阅读', { actions: '<button class="btn primary" id="add">+ 登记</button>' })}
        <div class="toolbar">
          <input id="search" class="input" placeholder="🔍 搜索书名 / 作者">
          <select id="sfilter" class="input">
            <option value="all">全部状态</option>
            ${Object.keys(STATUS).map(k => `<option value="${k}">${STATUS[k]}</option>`).join('')}
          </select>
        </div>
        <div id="list" class="list"></div>
      </div>`;
    const list = root.querySelector('#list');
    function paint() {
      const raw = root.querySelector('#search').value.trim().toLowerCase();
      const sf = root.querySelector('#sfilter').value;
      let view = all;
      if (sf !== 'all') view = view.filter(i => (i.status || 'want') === sf);
      if (raw) view = view.filter(i => ((i.title || '') + ' ' + (i.author || '')).toLowerCase().includes(raw));
      view = view.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      if (!view.length) { list.innerHTML = ui.emptyState('还没有阅读记录，点「登记」开始', { action: { label: '登记阅读' } }); bindEmpty(); return; }
      list.innerHTML = view.map(r => {
        const prog = Math.max(0, Math.min(100, r.progress || 0));
        const cover = r.cover ? `<img class="reading-cover" src="${ui.escapeAttr(r.cover)}" alt="" loading="lazy">` : `<div class="reading-cover reading-cover-empty">${ui.icon('book', 22)}</div>`;
        return `
          <div class="card reading" data-id="${r.id}">
            ${cover}
            <div class="reading-main">
              <div class="reading-title">${ui.escapeHtml(r.title || '无标题')}</div>
              <div class="reading-meta">
                <span class="badge ${STAT_CLASS[r.status] || 'st-idea'}">${STATUS[r.status] || '想读'}</span>
                ${r.author ? '<span class="muted">' + ui.escapeHtml(r.author) + '</span>' : ''}
                ${stars(r.rating)}
                <span class="muted">${ui.fmtRelative(r.updatedAt)}</span>
              </div>
              <div class="reading-progress">
                <div class="bar-track"><div class="bar-fill" style="width:${prog}%"></div></div>
                <span class="progress-num">${prog}%</span>
              </div>
            </div>
            <div class="row-actions">
              <button class="icon-btn edit" title="编辑">${ui.icon('pencil', 16)}</button>
              <button class="icon-btn del" title="删除">${ui.icon('trash', 16)}</button>
            </div>
          </div>`;
      }).join('');
      bindEmpty();
    }
    function bindEmpty() {
      const ea = list.querySelector('#empty-add');
      if (ea) ea.onclick = () => openForm(null);
    }
    paint();
    async function refresh() { all = (await store.getAll('reading')).filter(i => i && i.id && i.id !== 'stat'); paint(); }
    root.querySelector('#search').addEventListener('input', paint);
    root.querySelector('#sfilter').addEventListener('change', paint);

    function openForm(r) {
      const m = ui.openModal({
        title: r ? '编辑' : '登记阅读',
        html: ui.form(formFields(r)) + '<div class="editor"><textarea id="f-note" class="input" rows="6" placeholder="笔记 / 读后感，支持 Markdown">' + ui.escapeHtml((r && r.note) || '') + '</textarea><div id="f-preview" class="preview md"></div></div>',
        actions: [
          { label: '取消' },
          { label: '保存', primary: true, onClick: async (close) => {
            const title = m.dialog.querySelector('#f-title').value.trim();
            if (!title) { ui.toast('请填写书名', 'warn'); return; }
            const obj = r ? Object.assign({}, r) : { id: store.uid(), createdAt: Date.now() };
            obj.title = title;
            obj.author = m.dialog.querySelector('#f-author').value.trim();
            obj.cover = m.dialog.querySelector('#f-cover').value.trim();
            obj.status = m.dialog.querySelector('#f-status').value;
            obj.progress = Math.max(0, Math.min(100, parseInt(m.dialog.querySelector('#f-progress').value, 10) || 0));
            obj.rating = Math.max(0, Math.min(5, parseFloat(m.dialog.querySelector('#f-rating').value) || 0));
            obj.startDate = m.dialog.querySelector('#f-startDate').value;
            obj.finishDate = m.dialog.querySelector('#f-finishDate').value;
            obj.note = m.dialog.querySelector('#f-note').value;
            obj.source = obj.source || 'manual';
            await store.put('reading', obj); close(); await refresh();
          } }
        ]
      });
      const ta = m.dialog.querySelector('#f-note'), pv = m.dialog.querySelector('#f-preview');
      const upd = () => { pv.innerHTML = ui.mdLite(ta.value); };
      ta.addEventListener('input', upd); upd();
      ui.bindFormValidation(m.dialog);
      setTimeout(() => m.dialog.querySelector('#f-title').focus(), 50);
    }
    function openView(r) {
      if (!r) return;
      const cover = r.cover ? `<img class="reading-cover-lg" src="${ui.escapeAttr(r.cover)}" alt="">` : '';
      const prog = Math.max(0, Math.min(100, r.progress || 0));
      ui.openModal({
        title: ui.escapeHtml(r.title || '无标题'),
        html: `
          <div class="reading-view">
            ${cover ? '<div class="reading-view-cover">' + cover + '</div>' : ''}
            <div class="reading-view-meta">
              <span class="badge ${STAT_CLASS[r.status] || 'st-idea'}">${STATUS[r.status] || '想读'}</span>
              ${r.author ? '<span class="muted">' + ui.escapeHtml(r.author) + '</span>' : ''}
              ${stars(r.rating)}
            </div>
            <div class="reading-progress reading-progress-lg">
              <div class="bar-track"><div class="bar-fill" style="width:${prog}%"></div></div>
              <span class="progress-num">${prog}%</span>
            </div>
            ${(r.startDate || r.finishDate) ? '<div class="muted" style="font-size:13px">' + (r.startDate ? '开始 ' + ui.escapeHtml(r.startDate) : '') + (r.startDate && r.finishDate ? ' · ' : '') + (r.finishDate ? '读完 ' + ui.escapeHtml(r.finishDate) : '') + '</div>' : ''}
            ${r.note ? '<div class="reading-view-note md">' + ui.mdLite(r.note) + '</div>' : ''}
          </div>`,
        actions: [
          { label: '关闭' },
          { label: '编辑', primary: true, onClick: (close) => { close(); openForm(r); } }
        ]
      });
    }
    root.querySelector('#add').onclick = () => openForm(null);
    list.addEventListener('click', async e => {
      const card = e.target.closest('.card'); if (!card) return;
      const id = card.dataset.id;
      const r = await store.get('reading', id);
      if (e.target.closest('.icon-btn.del')) {
        if (await ui.confirm({ title: '删除阅读记录', message: '确定删除这条阅读记录吗？删除后可在提示中撤销。', confirmLabel: '删除', danger: true })) {
          ui.trash('reading', id, { label: '已删除阅读记录', repaint: refresh });
        }
        return;
      }
      if (e.target.closest('.icon-btn.edit')) { openForm(r); return; }
      openView(r);
    });
  }

  // 首次启动一次性种子：从同源 data/reading.json（由 sync_reading.js 生成 / 部署时附带）
  // 拉取微信读书同步数据写入本地库。仅当本地阅读库为空且未种子过才执行，避免覆盖用户数据。
  WB.seedReading = async function () {
    try {
      if (await store.getMeta('reading_seeded', false)) return;
      const existing = await store.getAll('reading');
      if (existing && existing.length) { await store.setMeta('reading_seeded', true); return; }
      const res = await fetch('data/reading.json', { cache: 'no-cache' });
      if (!res.ok) { await store.setMeta('reading_seeded', true); return; }
      const arr = await res.json();
      if (Array.isArray(arr) && arr.length) {
        await store.bulkPut('reading', arr);
        await store.setMeta('reading_seeded', true);
      } else {
        await store.setMeta('reading_seeded', true);
      }
    } catch (e) { /* 种子失败不影响正常使用 */ }
  };

  WB.modules.push({ id: 'reading', title: '阅读', icon: 'book', render });
})(window.WB = window.WB || {});
