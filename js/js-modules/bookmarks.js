// module: bookmarks 书签/链接
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui;

  function formHTML(b) {
    b = b || {};
    return `
      <div class="form">
        <label>标题<input id="f-title" class="input" value="${ui.escapeHtml(b.title || '')}" placeholder="网站名称"></label>
        <label>链接<input id="f-url" class="input" value="${ui.escapeHtml(b.url || '')}" placeholder="https://..."></label>
        <label>分类<input id="f-cat" class="input" value="${ui.escapeHtml(b.category || '')}" placeholder="如：工具 / 阅读"></label>
        <label>备注<textarea id="f-note" class="input" rows="2">${ui.escapeHtml(b.note || '')}</textarea></label>
      </div>`;
  }

  async function render(root) {
    let all = (await store.getAll('bookmarks')).filter(i => !i._deleted).sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.title.localeCompare(b.title));
    const cats = ['全部', ...Array.from(new Set(all.map(i => i.category || '未分类')))];
    root.innerHTML = `
      <div class="page">
        ${ui.pageHead('bookmark', '书签 / 链接', { actions: '<button class="btn primary" id="add">+ 新建</button>' })}
        <div class="filters" id="filters">${cats.map(c => `<button class="chip" data-c="${ui.escapeHtml(c)}">${ui.escapeHtml(c)}</button>`).join('')}</div>
        <div id="list" class="grid cards-grid"></div>
      </div>`;
    const list = root.querySelector('#list');
    function paint(cat) {
      const view = cat === '全部' ? all : all.filter(i => (i.category || '未分类') === cat);
      if (!view.length) { list.innerHTML = ui.emptyState('暂无书签'); return; }
      list.innerHTML = view.map(b => `
        <div class="card bm" data-id="${b.id}">
          <div class="bm-fav">${ui.escapeHtml((b.title || '?').slice(0, 1))}</div>
          <div class="bm-main">
            <a class="bm-title" href="${ui.escapeHtml(b.url)}" target="_blank" rel="noopener">${ui.escapeHtml(b.title)}</a>
            <div class="bm-meta"><span class="tag">${ui.escapeHtml(b.category || '未分类')}</span>${b.note ? '<span class="muted">' + ui.escapeHtml(b.note) + '</span>' : ''}</div>
          </div>
          <div class="row-actions">
            <button class="icon-btn edit" title="编辑">${ui.icon('pencil', 16)}</button>
            <button class="icon-btn del" title="删除">${ui.icon('trash', 16)}</button>
          </div>
        </div>`).join('');
    }
    paint('全部');
    async function refresh() { all = (await store.getAll('bookmarks')).filter(i => !i._deleted).sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.title.localeCompare(b.title)); paint(); }
    root.querySelector('#filters').addEventListener('click', e => {
      if (!e.target.dataset.c) return;
      root.querySelectorAll('#filters .chip').forEach(c => c.classList.remove('active'));
      e.target.classList.add('active'); paint(e.target.dataset.c);
    });

    function openForm(b) {
      const m = ui.openModal({
        title: b ? '编辑书签' : '新建书签',
        html: formHTML(b),
        actions: [
          { label: '取消' },
          { label: '保存', primary: true, onClick: async (close) => {
            const title = m.dialog.querySelector('#f-title').value.trim();
            let url = m.dialog.querySelector('#f-url').value.trim();
            if (!title) { ui.toast('请填写标题', 'warn'); return; }
            if (url && !/^https?:\/\//.test(url)) url = 'https://' + url;
            const obj = b ? Object.assign({}, b) : { id: store.uid() };
            obj.title = title; obj.url = url; obj.category = m.dialog.querySelector('#f-cat').value.trim();
            obj.note = m.dialog.querySelector('#f-note').value;
            await store.put('bookmarks', obj); close(); await refresh();
          } }
        ]
      });
      setTimeout(() => m.dialog.querySelector('#f-title').focus(), 50);
    }
    root.querySelector('#add').onclick = () => openForm(null);
    list.addEventListener('click', async e => {
      if (e.target.closest('a')) return; // 链接本身打开
      const card = e.target.closest('.card'); if (!card) return;
      const id = card.dataset.id;
      if (e.target.closest('.icon-btn.edit')) { openForm(await store.get('bookmarks', id)); return; }
      if (e.target.closest('.icon-btn.del')) { if (await ui.confirm('删除该书签？')) { await store.remove('bookmarks', id); await refresh(); } }
    });
  }

  WB.modules.push({ id: 'bookmarks', title: '书签', icon: 'bookmark', render });
})(window.WB = window.WB || {});
