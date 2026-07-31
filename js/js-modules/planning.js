// module: planning 长期规划（目标/里程碑/季度/年度）
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui;
  const TYPE = { year: '年度', quarter: '季度', goal: '目标', milestone: '里程碑' };
  const STATUS = { todo: '待启动', doing: '进行中', done: '已完成' };

  function formHTML(p) {
    p = p || {};
    return `
      <div class="form">
        <label>标题<input id="f-title" class="input" value="${ui.escapeHtml(p.title || '')}" placeholder="如：2026 健康计划"></label>
        <div class="row">
          <label style="flex:1">类型<select id="f-type" class="input">
            ${Object.keys(TYPE).map(k => `<option value="${k}" ${p.type === k ? 'selected' : ''}>${TYPE[k]}</option>`).join('')}
          </select></label>
          <label style="flex:1">状态<select id="f-status" class="input">
            ${Object.keys(STATUS).map(k => `<option value="${k}" ${p.status === k ? 'selected' : ''}>${STATUS[k]}</option>`).join('')}
          </select></label>
        </div>
        <label>截止日期<input id="f-due" class="input" type="date" value="${p.dueDate || ''}"></label>
        <label>备注<textarea id="f-note" class="input" rows="3">${ui.escapeHtml(p.note || '')}</textarea></label>
      </div>`;
  }

  async function render(root) {
    let all = (await store.getAll('planning')).filter(i => !i._deleted);
    root.innerHTML = `
      <div class="page">
        ${ui.pageHead('target', '长期规划', { actions: '<button class="btn primary" id="add">+ 新建</button>' })}
        <div class="filters" id="filters">
          <button class="chip active" data-f="all">全部</button>
          ${Object.keys(TYPE).map(k => `<button class="chip" data-f="${k}">${TYPE[k]}</button>`).join('')}
        </div>
        <div id="list" class="list"></div>
      </div>`;
    const list = root.querySelector('#list');
    function paint(f) {
      let view = all;
      if (f && f !== 'all') view = view.filter(i => i.type === f);
      view = view.sort((a, b) => (a.type).localeCompare(b.type) || (a.dueDate || '').localeCompare(b.dueDate || ''));
      if (!view.length) { list.innerHTML = ui.emptyState('还没有规划，开始制定你的目标吧'); return; }
      list.innerHTML = view.map(p => `
        <div class="card plan st-${p.status}" data-id="${p.id}">
          <div class="plan-main">
            <div class="plan-title">${ui.escapeHtml(p.title)}</div>
            <div class="plan-meta">
              <span class="badge">${TYPE[p.type] || '目标'}</span>
              <span class="badge st-${p.status}">${STATUS[p.status] || '待启动'}</span>
              ${p.dueDate ? '<span class="muted">' + ui.escapeHtml(p.dueDate) + '</span>' : ''}
            </div>
            ${p.note ? '<div class="muted plan-note">' + ui.escapeHtml(p.note) + '</div>' : ''}
          </div>
          <div class="row-actions">
            <button class="icon-btn edit" title="编辑">✏️</button>
            <button class="icon-btn del" title="删除">🗑️</button>
          </div>
        </div>`).join('');
    }
    paint('all');
    root.querySelector('#filters').addEventListener('click', e => {
      if (!e.target.dataset.f) return;
      root.querySelectorAll('#filters .chip').forEach(c => c.classList.remove('active'));
      e.target.classList.add('active'); paint(e.target.dataset.f);
    });

    function openForm(p) {
      const m = ui.openModal({
        title: p ? '编辑规划' : '新建规划', html: formHTML(p),
        actions: [{ label: '取消' }, { label: '保存', primary: true, onClick: async (close) => {
          const title = m.dialog.querySelector('#f-title').value.trim();
          if (!title) { ui.toast('请填写标题', 'warn'); return; }
          const obj = p ? Object.assign({}, p) : { id: store.uid() };
          obj.title = title; obj.type = m.dialog.querySelector('#f-type').value;
          obj.status = m.dialog.querySelector('#f-status').value;
          obj.dueDate = m.dialog.querySelector('#f-due').value || '';
          obj.note = m.dialog.querySelector('#f-note').value;
          await store.put('planning', obj); close(); WB.app.reload();
        } }]
      });
      setTimeout(() => m.dialog.querySelector('#f-title').focus(), 50);
    }
    root.querySelector('#add').onclick = () => openForm(null);
    list.addEventListener('click', async e => {
      const card = e.target.closest('.card'); if (!card) return;
      const id = card.dataset.id;
      if (e.target.closest('.icon-btn.del')) { if (await ui.confirm('删除该规划？')) { await store.remove('planning', id); WB.app.reload(); } return; }
      openForm(await store.get('planning', id));
    });
  }

  WB.modules.push({ id: 'planning', title: '规划', icon: 'target', render });
})(window.WB = window.WB || {});
