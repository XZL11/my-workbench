// module: content 内容创作（含短视频脚本、公众号文章更新）
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui;
  const KIND = { shortvideo: '短视频脚本', article: '公众号文章' };
  const STATUS = { idea: '灵感', draft: '草稿', review: '待审', published: '已发布' };

  function formHTML(c) {
    c = c || {};
    return `
      <div class="form">
        <div class="row">
          <label style="flex:2">标题<input id="f-title" class="input" value="${ui.escapeHtml(c.title || '')}" placeholder="标题"></label>
          <label style="flex:1">类型<select id="f-kind" class="input">
            ${Object.keys(KIND).map(k => `<option value="${k}" ${c.kind === k ? 'selected' : ''}>${KIND[k]}</option>`).join('')}
          </select></label>
        </div>
        <div class="row">
          <label style="flex:1">状态<select id="f-status" class="input">
            ${Object.keys(STATUS).map(s => `<option value="${s}" ${c.status === s ? 'selected' : ''}>${STATUS[s]}</option>`).join('')}
          </select></label>
          <label style="flex:1">平台<input id="f-platform" class="input" value="${ui.escapeHtml(c.platform || '')}" placeholder="如：抖音 / 公众号"></label>
        </div>
        <label>备注<input id="f-note" class="input" value="${ui.escapeHtml(c.note || '')}" placeholder="可选"></label>
        <div class="editor">
          <textarea id="f-body" class="input" rows="10" placeholder="正文 / 脚本内容，支持 Markdown">${ui.escapeHtml(c.body || '')}</textarea>
          <div id="f-preview" class="preview md"></div>
        </div>
      </div>`;
  }

  async function render(root) {
    let all = (await store.getAll('content')).filter(i => !i._deleted);
    root.innerHTML = `
      <div class="page">
        <div class="page-head">
          <h1>🎬 内容创作</h1>
          <button class="btn primary" id="add">+ 新建</button>
        </div>
        <div class="toolbar">
          <select id="kfilter" class="input">
            <option value="all">全部类型</option>
            ${Object.keys(KIND).map(k => `<option value="${k}">${KIND[k]}</option>`).join('')}
          </select>
          <select id="sfilter" class="input">
            <option value="all">全部状态</option>
            ${Object.keys(STATUS).map(s => `<option value="${s}">${STATUS[s]}</option>`).join('')}
          </select>
        </div>
        <div id="list" class="list"></div>
      </div>`;
    const list = root.querySelector('#list');
    function paint() {
      let view = all;
      const kf = root.querySelector('#kfilter').value, sf = root.querySelector('#sfilter').value;
      if (kf !== 'all') view = view.filter(i => i.kind === kf);
      if (sf !== 'all') view = view.filter(i => i.status === sf);
      view = view.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      if (!view.length) { list.innerHTML = ui.emptyState('还没有内容，点新建开始创作'); return; }
      list.innerHTML = view.map(c => `
        <div class="card content" data-id="${c.id}">
          <div class="content-main">
            <div class="content-title">${ui.escapeHtml(c.title || '无标题')}</div>
            <div class="content-meta">
              <span class="badge">${KIND[c.kind] || '内容'}</span>
              <span class="badge st-${c.status}">${STATUS[c.status] || '灵感'}</span>
              ${c.platform ? '<span class="tag">' + ui.escapeHtml(c.platform) + '</span>' : ''}
              <span class="muted">${ui.fmtRelative(c.updatedAt)}</span>
            </div>
          </div>
          <div class="row-actions">
            <button class="icon-btn edit" title="编辑">✏️</button>
            <button class="icon-btn del" title="删除">🗑️</button>
          </div>
        </div>`).join('');
    }
    paint();
    root.querySelector('#kfilter').addEventListener('change', paint);
    root.querySelector('#sfilter').addEventListener('change', paint);

    function openForm(c) {
      const m = ui.openModal({
        title: c ? '编辑' : '新建内容', html: formHTML(c),
        actions: [{ label: '取消' }, { label: '保存', primary: true, onClick: async (close) => {
          const title = m.dialog.querySelector('#f-title').value.trim();
          if (!title) { ui.toast('请填写标题', 'warn'); return; }
          const obj = c ? Object.assign({}, c) : { id: store.uid() };
          obj.title = title; obj.kind = m.dialog.querySelector('#f-kind').value;
          obj.status = m.dialog.querySelector('#f-status').value;
          obj.platform = m.dialog.querySelector('#f-platform').value;
          obj.note = m.dialog.querySelector('#f-note').value;
          obj.body = m.dialog.querySelector('#f-body').value;
          await store.put('content', obj); close(); WB.app.reload();
        } }]
      });
      const ta = m.dialog.querySelector('#f-body'), pv = m.dialog.querySelector('#f-preview');
      const upd = () => { pv.innerHTML = ui.mdLite(ta.value); };
      ta.addEventListener('input', upd); upd();
      setTimeout(() => m.dialog.querySelector('#f-title').focus(), 50);
    }
    root.querySelector('#add').onclick = () => openForm(null);
    list.addEventListener('click', async e => {
      const card = e.target.closest('.card'); if (!card) return;
      const id = card.dataset.id;
      if (e.target.closest('.icon-btn.del')) { if (await ui.confirm('删除该内容？')) { await store.remove('content', id); WB.app.reload(); } return; }
      openForm(await store.get('content', id));
    });
  }

  WB.modules.push({ id: 'content', title: '创作', icon: 'pen', render });
})(window.WB = window.WB || {});
