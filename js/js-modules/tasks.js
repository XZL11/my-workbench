// module: tasks 任务管理（含事务待办）
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui;
  const PRIORITY = { 1: '高', 2: '中', 3: '低' };

  function formHTML(t) {
    t = t || {};
    return `
      <div class="form">
        <label>标题<input id="f-title" class="input" value="${ui.escapeHtml(t.title || '')}" placeholder="任务标题"></label>
        <div class="row">
          <label>优先级<select id="f-priority" class="input">
            <option value="1" ${t.priority == 1 ? 'selected' : ''}>高</option>
            <option value="2" ${t.priority == 2 ? 'selected' : ''}>中</option>
            <option value="3" ${t.priority == 3 ? 'selected' : ''}>低</option>
          </select></label>
          <label>截止日期<input id="f-due" class="input" type="date" value="${t.dueDate || ''}"></label>
        </div>
        <label>标签（逗号分隔）<input id="f-tags" class="input" value="${ui.escapeHtml((t.tags || []).join(', '))}" placeholder="工作, 紧急"></label>
        <label>备注<textarea id="f-note" class="input" rows="3">${ui.escapeHtml(t.note || '')}</textarea></label>
      </div>`;
  }

  function itemHTML(t, subs) {
    const tags = (t.tags || []).map(x => `<span class="tag">${ui.escapeHtml(x)}</span>`).join('');
    const due = t.dueDate ? `<span class="due ${t.dueDate < ui.fmtDate(Date.now()) && !t.done ? 'over' : ''}">📅 ${ui.escapeHtml(t.dueDate)}</span>` : '';
    return `
      <div class="card task ${t.done ? 'done' : ''}" data-id="${t.id}">
        <input type="checkbox" class="chk" ${t.done ? 'checked' : ''}>
        <div class="task-main">
          <div class="task-title">${ui.escapeHtml(t.title)}</div>
          <div class="task-meta">
            <span class="pri pri-${t.priority}">${PRIORITY[t.priority] || '中'}</span>
            ${due}${tags}
          </div>
        </div>
        <div class="row-actions">
          <button class="icon-btn edit" title="编辑">✏️</button>
          <button class="icon-btn del" title="删除">🗑️</button>
        </div>
      </div>
      ${subs || ''}`;
  }

  async function render(root) {
    let items = (await store.getAll('tasks')).filter(i => !i._deleted);
    const parents = items.filter(i => !i.parentId).sort((a, b) => (a.done - b.done) || (a.priority - b.priority) || (a.createdAt - b.createdAt));
    const subsOf = id => items.filter(i => i.parentId === id).sort((a, b) => (a.done - b.done) || (a.createdAt - b.createdAt));

    root.innerHTML = `
      <div class="page">
        <div class="page-head">
          <h1>✅ 任务管理</h1>
          <button class="btn primary" id="add">+ 新建</button>
        </div>
        <div class="filters" id="filters">
          <button class="chip active" data-f="all">全部</button>
          <button class="chip" data-f="active">进行中</button>
          <button class="chip" data-f="done">已完成</button>
        </div>
        <div id="list" class="list"></div>
      </div>`;

    const list = root.querySelector('#list');
    function paint(filter) {
      let view = parents;
      if (filter === 'active') view = parents.filter(i => !i.done);
      if (filter === 'done') view = parents.filter(i => i.done);
      if (!view.length) { list.innerHTML = ui.emptyState('还没有任务，点右上角新建一个吧'); return; }
      list.innerHTML = view.map(t => {
        const subs = subsOf(t.id);
        const subHtml = subs.length ? '<div class="subs">' + subs.map(s => itemHTML(s)).join('') +
          `<div class="card task addsub" data-parent="${t.id}">+ 添加子任务</div></div>` : '';
        return itemHTML(t, subHtml);
      }).join('');
    }
    paint('all');

    root.querySelector('#filters').addEventListener('click', e => {
      if (!e.target.dataset.f) return;
      root.querySelectorAll('#filters .chip').forEach(c => c.classList.remove('active'));
      e.target.classList.add('active');
      paint(e.target.dataset.f);
    });

    function openForm(t, parentId) {
      const m = ui.openModal({
        title: t ? '编辑任务' : '新建任务',
        html: formHTML(t),
        actions: [
          { label: '取消' },
          { label: '保存', primary: true, onClick: async (close) => {
            const title = m.dialog.querySelector('#f-title').value.trim();
            if (!title) { ui.toast('请填写标题', 'warn'); return; }
            const obj = t ? Object.assign({}, t) : { id: store.uid(), createdAt: Date.now() };
            obj.title = title;
            obj.priority = parseInt(m.dialog.querySelector('#f-priority').value, 10);
            obj.dueDate = m.dialog.querySelector('#f-due').value || '';
            obj.tags = m.dialog.querySelector('#f-tags').value.split(',').map(s => s.trim()).filter(Boolean);
            obj.note = m.dialog.querySelector('#f-note').value;
            if (parentId) obj.parentId = parentId;
            await store.put('tasks', obj);
            close(); WB.app.reload();
          } }
        ]
      });
      setTimeout(() => m.dialog.querySelector('#f-title').focus(), 50);
    }

    root.querySelector('#add').onclick = () => openForm(null);

    list.addEventListener('click', async e => {
      const card = e.target.closest('.card');
      if (!card) return;
      const id = card.dataset.id;
      if (e.target.classList.contains('addsub')) { openForm(null, card.dataset.parent); return; }
      if (e.target.classList.contains('chk')) {
        const t = (await store.get('tasks', id));
        t.done = e.target.checked; await store.put('tasks', t); WB.app.reload(); return;
      }
      if (e.target.classList.contains('edit') || e.target.classList.contains('icon-btn') && e.target.title === '编辑') {
        openForm(await store.get('tasks', id)); return;
      }
      if (e.target.classList.contains('del')) {
        if (await ui.confirm('确定删除该任务？')) { await store.remove('tasks', id); WB.app.reload(); }
        return;
      }
      // 点击卡片其它区域编辑
      if (!e.target.classList.contains('chk')) openForm(await store.get('tasks', id));
    });
  }

  WB.modules.push({ id: 'tasks', title: '任务', icon: '✅', render });
})(window.WB = window.WB || {});
