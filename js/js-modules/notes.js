// module: notes 笔记与知识库（含笔记/私有知识库/时间轴记事本/自媒体灵感库）
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui;
  const TYPES = { note: '笔记', knowledge: '知识库', timeline: '时间轴', idea: '灵感' };

  function formHTML(n) {
    n = n || {};
    return `
      <div class="form">
        <div class="row">
          <label style="flex:2">标题<input id="f-title" class="input" value="${ui.escapeHtml(n.title || '')}" placeholder="标题"></label>
          <label style="flex:1">类型<select id="f-type" class="input">
            ${Object.keys(TYPES).map(k => `<option value="${k}" ${n.type === k ? 'selected' : ''}>${TYPES[k]}</option>`).join('')}
          </select></label>
        </div>
        <label>标签（逗号分隔）<input id="f-tags" class="input" value="${ui.escapeHtml((n.tags || []).join(', '))}" placeholder="标签"></label>
        <div class="editor">
          <textarea id="f-body" class="input" rows="10" placeholder="支持 Markdown：**粗体**、*斜体*、# 标题、- 列表、[链接](url)">${ui.escapeHtml(n.body || '')}</textarea>
          <div id="f-preview" class="preview md"></div>
        </div>
      </div>`;
  }

  async function render(root) {
    let all = (await store.getAll('notes')).filter(i => !i._deleted);
    root.innerHTML = `
      <div class="page">
        <div class="page-head">
          <h1>📝 笔记与知识库</h1>
          <button class="btn primary" id="add">+ 新建</button>
        </div>
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
      const q = root.querySelector('#search').value.trim().toLowerCase();
      const tf = root.querySelector('#typefilter').value;
      let view = all;
      if (tf !== 'all') view = view.filter(i => i.type === tf);
      if (q) view = view.filter(i => (i.title + ' ' + (i.body || '') + ' ' + (i.tags || []).join(' ')).toLowerCase().includes(q));
      view = view.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      if (!view.length) { list.innerHTML = ui.emptyState('没有匹配的笔记'); return; }
      list.innerHTML = view.map(n => {
        const tags = (n.tags || []).map(x => `<span class="tag">${ui.escapeHtml(x)}</span>`).join('');
        const prev = (n.body || '').replace(/[#*`>\[\]()]/g, '').slice(0, 80);
        return `
          <div class="card note" data-id="${n.id}">
            <div class="note-main">
              <div class="note-title">${ui.escapeHtml(n.title || '无标题')}</div>
              <div class="note-meta"><span class="badge">${TYPES[n.type] || '笔记'}</span>${tags}<span class="muted">${ui.fmtRelative(n.updatedAt)}</span></div>
              <div class="note-prev muted">${ui.escapeHtml(prev)}</div>
            </div>
            <div class="row-actions">
              <button class="icon-btn edit" title="编辑">✏️</button>
              <button class="icon-btn del" title="删除">🗑️</button>
            </div>
          </div>`;
      }).join('');
    }
    paint();
    root.querySelector('#search').addEventListener('input', paint);
    root.querySelector('#typefilter').addEventListener('change', paint);

    function openForm(n) {
      const m = ui.openModal({
        title: n ? '编辑' : '新建笔记',
        html: formHTML(n),
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
            await store.put('notes', obj); close(); WB.app.reload();
          } }
        ]
      });
      const ta = m.dialog.querySelector('#f-body');
      const pv = m.dialog.querySelector('#f-preview');
      const upd = () => { pv.innerHTML = ui.mdLite(ta.value); };
      ta.addEventListener('input', upd); upd();
      setTimeout(() => m.dialog.querySelector('#f-title').focus(), 50);
    }
    root.querySelector('#add').onclick = () => openForm(null);
    list.addEventListener('click', async e => {
      const card = e.target.closest('.card'); if (!card) return;
      const id = card.dataset.id;
      if (e.target.classList.contains('del')) { if (await ui.confirm('删除该笔记？')) { await store.remove('notes', id); WB.app.reload(); } return; }
      openForm(await store.get('notes', id));
    });
  }

  WB.modules.push({ id: 'notes', title: '笔记', icon: '📝', render });
})(window.WB = window.WB || {});
