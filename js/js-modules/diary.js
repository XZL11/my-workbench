// module: diary 日记（按日期一篇 + 心情 + Markdown 正文，独立 store）
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui;

  const MOODS = [
    { value: '😀', label: '😀 不错' },
    { value: '😐', label: '😐 一般' },
    { value: '😢', label: '😢 低落' },
    { value: '😡', label: '😡 烦躁' },
    { value: '😴', label: '😴 累' },
    { value: '💪', label: '💪 充实' }
  ];

  function todayStr() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function snippet(body) {
    return (body || '').replace(/[#*`>\[\]()_~]/g, '').slice(0, 90);
  }

  function formFields(n) {
    n = n || {};
    return [
      { name: 'date', label: '日期', type: 'date', value: n.date || todayStr(), flex: 1 },
      { name: 'mood', label: '心情', type: 'select', value: n.mood || '😐', flex: 1, row: 'a', options: MOODS },
      { name: 'title', label: '标题', value: n.title || '', placeholder: '今天的关键词', required: true, flex: 2 }
    ];
  }

  async function render(root) {
    let all = (await store.getAll('diary')).filter(i => !i._deleted);
    root.innerHTML = `
      <div class="page">
        ${ui.pageHead('diary', '日记', { actions: '<button class="btn primary" id="add">+ 写日记</button>' })}
        <div id="list" class="list"></div>
      </div>`;
    const list = root.querySelector('#list');

    function paint() {
      let view = all.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (b.updatedAt || 0) - (a.updatedAt || 0));
      if (!view.length) {
        list.innerHTML = ui.emptyState('还没有日记，记录今天吧', { action: { label: '写第一篇日记' } });
        const ea = list.querySelector('#empty-add');
        if (ea) ea.onclick = () => openForm(null);
        return;
      }
      list.innerHTML = view.map(d => {
        const prev = snippet(d.body);
        return `
          <div class="card diary" data-id="${d.id}">
            <div class="diary-main">
              <div class="diary-top">
                <span class="diary-date">${ui.escapeHtml(d.date || '')}</span>
                <span class="diary-mood">${ui.escapeHtml(d.mood || '😐')}</span>
              </div>
              <div class="diary-title">${ui.escapeHtml(d.title || '无标题')}</div>
              <div class="diary-prev muted">${ui.escapeHtml(prev)}</div>
            </div>
            <div class="row-actions">
              <button class="icon-btn edit" title="编辑">${ui.icon('pencil', 16)}</button>
              <button class="icon-btn del" title="删除">${ui.icon('trash', 16)}</button>
            </div>
          </div>`;
      }).join('');
    }

    async function refresh() { all = (await store.getAll('diary')).filter(i => !i._deleted); paint(); }

    function openForm(n) {
      const m = ui.openModal({
        title: n ? '编辑日记' : '写日记',
        html: ui.form(formFields(n)) +
          '<div class="editor"><textarea id="f-body" class="input" rows="12" placeholder="今天发生了什么？支持 Markdown。">' + ui.escapeHtml((n && n.body) || '') + '</textarea><div id="f-preview" class="preview md"></div></div>',
        actions: [
          { label: '取消' },
          { label: '保存', primary: true, onClick: async (close) => {
            const title = m.dialog.querySelector('#f-title').value.trim();
            if (!title) { ui.toast('请填写标题', 'warn'); return; }
            const obj = n ? Object.assign({}, n) : { id: store.uid(), createdAt: Date.now() };
            obj.date = m.dialog.querySelector('#f-date').value || todayStr();
            obj.mood = m.dialog.querySelector('#f-mood').value;
            obj.title = title;
            obj.body = m.dialog.querySelector('#f-body').value;
            await store.put('diary', obj); close(); await refresh();
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

    function openView(n) {
      if (!n) return;
      ui.openModal({
        title: ui.escapeHtml(n.title || '无标题'),
        html: `
          <div class="diary-view">
            <div class="diary-view-meta">
              <span class="diary-date">${ui.escapeHtml(n.date || '')}</span>
              <span class="diary-mood">${ui.escapeHtml(n.mood || '😐')}</span>
            </div>
            <div class="diary-view-body md">${ui.mdLite(n.body || '')}</div>
          </div>`,
        actions: [
          { label: '关闭' },
          { label: '编辑', primary: true, onClick: (close) => { close(); openForm(n); } }
        ]
      });
    }

    root.querySelector('#add').onclick = () => openForm(null);
    list.addEventListener('click', async e => {
      const card = e.target.closest('.card'); if (!card) return;
      const id = card.dataset.id;
      const d = await store.get('diary', id);
      if (e.target.closest('.icon-btn.del')) {
        if (await ui.confirm({ title: '删除日记', message: '确定删除这篇日记吗？删除后可在提示中撤销。', confirmLabel: '删除', danger: true })) {
          ui.trash('diary', id, { label: '已删除日记', repaint: refresh });
        }
        return;
      }
      if (e.target.closest('.icon-btn.edit')) { openForm(d); return; }
      openView(d);
    });

    paint();
  }

  WB.modules.push({ id: 'diary', title: '日记', icon: 'diary', render });
})(window.WB = window.WB || {});
