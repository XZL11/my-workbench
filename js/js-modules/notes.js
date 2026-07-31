// module: notes 笔记与知识库（含笔记/私有知识库/时间轴记事本/自媒体灵感库）
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui;
  const TYPES = { note: '笔记', knowledge: '知识库', timeline: '时间轴', idea: '灵感' };

  function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function highlight(text, q) {
    const esc = ui.escapeHtml(text || '');
    if (!q) return esc;
    try {
      const re = new RegExp('(' + escapeReg(q) + ')', 'gi');
      return esc.replace(re, '<mark>$1</mark>');
    } catch (e) { return esc; }
  }
  function snippet(body, q) {
    const plain = (body || '').replace(/[#*`>\[\]()_~]/g, '');
    if (!q) return plain.slice(0, 90);
    const idx = plain.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return plain.slice(0, 90);
    const start = Math.max(0, idx - 30);
    const end = Math.min(plain.length, idx + q.length + 60);
    return (start > 0 ? '…' : '') + plain.slice(start, end) + (end < plain.length ? '…' : '');
  }

  function formFields(n) {
    n = n || {};
    return [
      { name: 'title', label: '标题', value: n.title || '', placeholder: '标题', required: true, flex: 2 },
      { name: 'type', label: '类型', type: 'select', value: n.type, flex: 1, row: 'a', options: Object.keys(TYPES).map(k => ({ value: k, label: TYPES[k] })) },
      { name: 'tags', label: '标签（逗号分隔）', value: (n.tags || []).join(', '), placeholder: '标签' }
    ];
  }

  async function render(root) {
    let all = (await store.getAll('notes')).filter(i => !i._deleted);
    root.innerHTML = `
      <div class="page">
        ${ui.pageHead('note', '笔记与知识库', { actions: '<button class="btn primary" id="add">+ 新建</button>' })}
        <div class="toolbar">
          <input id="search" class="input" placeholder="🔍 搜索标题 / 内容 / 标签">
          <select id="typefilter" class="input">
            <option value="all">全部类型</option>
            ${Object.keys(TYPES).map(k => `<option value="${k}">${TYPES[k]}</option>`).join('')}
          </select>
        </div>
        <div id="list" class="list"></div>
      </div>`;
    const list = root.querySelector('#list');
    function paint() {
      const raw = root.querySelector('#search').value.trim();
      const q = raw.toLowerCase();
      const tf = root.querySelector('#typefilter').value;
      let view = all;
      if (tf !== 'all') view = view.filter(i => i.type === tf);
      if (q) view = view.filter(i => (i.title + ' ' + (i.body || '') + ' ' + (i.tags || []).join(' ')).toLowerCase().includes(q));
      view = view.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      if (!view.length) { list.innerHTML = ui.emptyState('没有匹配的笔记', { action: { label: '新建笔记' } }); bindEmpty(); return; }
      list.innerHTML = view.map(n => {
        const tags = (n.tags || []).map(x => `<span class="tag">${ui.escapeHtml(x)}</span>`).join('');
        const prev = snippet(n.body, raw);
        return `
          <div class="card note" data-id="${n.id}">
            <div class="note-main">
              <div class="note-title">${highlight(n.title || '无标题', raw)}</div>
              <div class="note-meta"><span class="badge">${TYPES[n.type] || '笔记'}</span>${tags}<span class="muted">${ui.fmtRelative(n.updatedAt)}</span></div>
              <div class="note-prev muted">${highlight(prev, raw)}</div>
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
    async function refresh() { all = (await store.getAll('notes')).filter(i => !i._deleted); paint(); }
    root.querySelector('#search').addEventListener('input', paint);
    root.querySelector('#typefilter').addEventListener('change', paint);

    function openForm(n) {
      const m = ui.openModal({
        title: n ? '编辑' : '新建笔记',
        html: ui.form(formFields(n)) + '<div class="editor"><textarea id="f-body" class="input" rows="10" placeholder="支持 Markdown：**粗体**、*斜体*、# 标题、- 列表、[链接](url)">' + ui.escapeHtml((n && n.body) || '') + '</textarea><div id="f-preview" class="preview md"></div></div>',
        actions: [
          { label: '取消' },
          { label: '保存', primary: true, onClick: async (close) => {
            const title = m.dialog.querySelector('#f-title').value.trim();
            if (!title) { ui.toast('请填写标题', 'warn'); return; }
            const obj = n ? Object.assign({}, n) : { id: store.uid(), createdAt: Date.now() };
            obj.title = title;
            obj.type = m.dialog.querySelector('#f-type').value;
            obj.tags = m.dialog.querySelector('#f-tags').value.split(',').map(s => s.trim()).filter(Boolean);
            obj.body = m.dialog.querySelector('#f-body').value;
            await store.put('notes', obj); close(); await refresh();
          } }
        ]
      });
      const ta = m.dialog.querySelector('#f-body');
      const pv = m.dialog.querySelector('#f-preview');
      const upd = () => { pv.innerHTML = ui.mdLite(ta.value); };
      ta.addEventListener('input', upd); upd();
      ui.bindFormValidation(m.dialog);
      setTimeout(() => m.dialog.querySelector('#f-title').focus(), 50);
    }
    root.querySelector('#add').onclick = () => openForm(null);
    list.addEventListener('click', async e => {
      const card = e.target.closest('.card'); if (!card) return;
      const id = card.dataset.id;
      if (e.target.closest('.icon-btn.del')) { ui.trash('notes', id, { label: '已删除笔记', repaint: refresh }); return; }
      openForm(await store.get('notes', id));
    });
  }

  WB.modules.push({ id: 'notes', title: '笔记', icon: 'note', render });
})(window.WB = window.WB || {});
