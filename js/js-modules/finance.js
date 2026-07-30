// module: finance 记账与成本（含记账/支出、固定生活成本台账）
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui;
  const CATS = ['餐饮', '交通', '购物', '居住', '娱乐', '医疗', '教育', '工资', '理财', '其他'];

  function formHTML(f) {
    f = f || {};
    return `
      <div class="form">
        <div class="row">
          <label style="flex:1">类型<select id="f-type" class="input">
            <option value="expense" ${f.type !== 'income' ? 'selected' : ''}>支出</option>
            <option value="income" ${f.type === 'income' ? 'selected' : ''}>收入</option>
          </select></label>
          <label style="flex:1">金额<input id="f-amount" class="input" type="number" step="0.01" value="${f.amount || ''}" placeholder="0.00"></label>
        </div>
        <div class="row">
          <label style="flex:1">分类<select id="f-cat" class="input">${CATS.map(c => `<option ${f.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          <label style="flex:1">日期<input id="f-date" class="input" type="date" value="${f.date || ui.fmtDate(Date.now())}"></label>
        </div>
        <label class="checkline"><input type="checkbox" id="f-fixed" ${f.fixed ? 'checked' : ''}> 设为固定生活成本（每月重复）</label>
        <label>备注<input id="f-note" class="input" value="${ui.escapeHtml(f.note || '')}"></label>
      </div>`;
  }

  async function render(root) {
    const all = (await store.getAll('finance')).filter(i => !i._deleted);
    const month = ui.fmtDate(Date.now()).slice(0, 7);
    const monthItems = all.filter(i => (i.date || '').slice(0, 7) === month);
    const income = monthItems.filter(i => i.type === 'income').reduce((s, i) => s + (+i.amount || 0), 0);
    const expense = monthItems.filter(i => i.type === 'expense').reduce((s, i) => s + (+i.amount || 0), 0);
    const fixedSum = all.filter(i => i.fixed && i.type === 'expense').reduce((s, i) => s + (+i.amount || 0), 0);

    root.innerHTML = `
      <div class="page">
        <div class="page-head">
          <h1>💰 记账与成本</h1>
          <button class="btn primary" id="add">+ 记一笔</button>
        </div>
        <div class="stat-row">
          <div class="stat"><div class="stat-num">${income.toFixed(2)}</div><div class="stat-label">本月收入</div></div>
          <div class="stat"><div class="stat-num">${expense.toFixed(2)}</div><div class="stat-label">本月支出</div></div>
          <div class="stat"><div class="stat-num ${income - expense < 0 ? 'neg' : ''}">${(income - expense).toFixed(2)}</div><div class="stat-label">结余</div></div>
          <div class="stat"><div class="stat-num">${fixedSum.toFixed(2)}</div><div class="stat-label">固定月成本</div></div>
        </div>
        <div class="filters" id="filters">
          <button class="chip active" data-f="all">全部</button>
          <button class="chip" data-f="expense">支出</button>
          <button class="chip" data-f="income">收入</button>
          <button class="chip" data-f="fixed">固定成本</button>
        </div>
        <div id="list" class="list"></div>
      </div>`;
    const list = root.querySelector('#list');
    function paint(f) {
      let view = all;
      if (f === 'expense') view = view.filter(i => i.type === 'expense');
      if (f === 'income') view = view.filter(i => i.type === 'income');
      if (f === 'fixed') view = view.filter(i => i.fixed);
      view = view.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.updatedAt || 0) - (a.updatedAt || 0));
      if (!view.length) { list.innerHTML = ui.emptyState('本月还没有记账'); return; }
      list.innerHTML = view.map(r => `
        <div class="card fin ${r.type}" data-id="${r.id}">
          <div class="fin-amt ${r.type}">${r.type === 'income' ? '+' : '-'}${(+r.amount || 0).toFixed(2)}</div>
          <div class="fin-main">
            <div class="fin-title">${ui.escapeHtml(r.category)}${r.fixed ? ' <span class="badge">固定</span>' : ''}</div>
            <div class="fin-meta"><span class="muted">${ui.escapeHtml(r.date || '')}</span>${r.note ? '<span class="muted">' + ui.escapeHtml(r.note) + '</span>' : ''}</div>
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

    function openForm(f) {
      const m = ui.openModal({
        title: f ? '编辑记录' : '记一笔', html: formHTML(f),
        actions: [{ label: '取消' }, { label: '保存', primary: true, onClick: async (close) => {
          const amount = parseFloat(m.dialog.querySelector('#f-amount').value);
          if (isNaN(amount) || amount <= 0) { ui.toast('请输入有效金额', 'warn'); return; }
          const obj = f ? Object.assign({}, f) : { id: store.uid() };
          obj.type = m.dialog.querySelector('#f-type').value;
          obj.amount = amount; obj.category = m.dialog.querySelector('#f-cat').value;
          obj.date = m.dialog.querySelector('#f-date').value || ui.fmtDate(Date.now());
          obj.fixed = m.dialog.querySelector('#f-fixed').checked;
          obj.note = m.dialog.querySelector('#f-note').value;
          await store.put('finance', obj); close(); WB.app.reload();
        } }]
      });
      setTimeout(() => m.dialog.querySelector('#f-amount').focus(), 50);
    }
    root.querySelector('#add').onclick = () => openForm(null);
    list.addEventListener('click', async e => {
      const card = e.target.closest('.card'); if (!card) return;
      const id = card.dataset.id;
      if (e.target.classList.contains('edit')) { openForm(await store.get('finance', id)); return; }
      if (e.target.classList.contains('del')) { if (await ui.confirm('删除该记录？')) { await store.remove('finance', id); WB.app.reload(); } }
    });
  }

  WB.modules.push({ id: 'finance', title: '记账', icon: '💰', render });
})(window.WB = window.WB || {});
