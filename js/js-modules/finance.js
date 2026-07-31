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
        <label class="checkline"><input type="checkbox" id="f-fixed" ${f.fixed ? 'checked' : ''}> 标记为固定成本（计入「固定月成本」统计）</label>
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

    // 图表：本月支出分类
    const catMap = {};
    monthItems.filter(i => i.type === 'expense').forEach(i => {
      const c = i.category || '其他';
      catMap[c] = (catMap[c] || 0) + (+i.amount || 0);
    });
    const catRows = Object.keys(catMap).map(c => ({ label: c, value: catMap[c] })).sort((a, b) => b.value - a.value);
    const catMax = Math.max.apply(null, catRows.map(r => r.value).concat([1]));
    const catBars = catRows.length ? catRows.map(r => `
      <div class="bar-row">
        <span class="bar-label">${ui.escapeHtml(r.label)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(r.value / catMax * 100).toFixed(1)}%"></div></div>
        <span class="bar-val">${r.value.toFixed(2)}</span>
      </div>`).join('') : ui.emptyState('本月暂无支出');

    // 图表：近 6 个月收支趋势
    const trend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
      const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      const items = all.filter(x => (x.date || '').slice(0, 7) === ym);
      const inc = items.filter(x => x.type === 'income').reduce((s, x) => s + (+x.amount || 0), 0);
      const exp = items.filter(x => x.type === 'expense').reduce((s, x) => s + (+x.amount || 0), 0);
      trend.push({ label: (d.getMonth() + 1) + '月', income: inc, expense: exp });
    }
    const tMax = Math.max.apply(null, trend.flatMap(t => [t.income, t.expense]).concat([1]));
    const trendHTML = `
      <div class="trend">
        ${trend.map(t => `
          <div class="trend-col">
            <div class="trend-bars">
              <div class="trend-bar inc" title="收入 ${t.income.toFixed(2)}" style="height:${(t.income / tMax * 100).toFixed(1)}%"></div>
              <div class="trend-bar exp" title="支出 ${t.expense.toFixed(2)}" style="height:${(t.expense / tMax * 100).toFixed(1)}%"></div>
            </div>
            <div class="trend-label">${t.label}</div>
          </div>`).join('')}
      </div>
      <div class="trend-legend"><span class="lg inc">收入</span><span class="lg exp">支出</span></div>`;

    root.innerHTML = `
      <div class="page">
        ${ui.pageHead('wallet', '记账与成本', { actions: '<button class="btn primary" id="add">+ 记一笔</button>' })}
        <div class="stat-row">
          <div class="stat"><div class="stat-num">${income.toFixed(2)}</div><div class="stat-label">本月收入</div></div>
          <div class="stat"><div class="stat-num">${expense.toFixed(2)}</div><div class="stat-label">本月支出</div></div>
          <div class="stat"><div class="stat-num ${income - expense < 0 ? 'neg' : ''}">${(income - expense).toFixed(2)}</div><div class="stat-label">结余</div></div>
          <div class="stat"><div class="stat-num">${fixedSum.toFixed(2)}</div><div class="stat-label">固定月成本</div></div>
        </div>
        <section class="card section">
          <h2>本月支出分类</h2>
          <div class="bars">${catBars}</div>
        </section>
        <section class="card section">
          <h2>近 6 个月收支趋势</h2>
          ${trendHTML}
        </section>
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
      if (e.target.closest('.icon-btn.edit')) { openForm(await store.get('finance', id)); return; }
      if (e.target.closest('.icon-btn.del')) { if (await ui.confirm('删除该记录？')) { await store.remove('finance', id); WB.app.reload(); } }
    });
  }

  WB.modules.push({ id: 'finance', title: '记账', icon: 'wallet', render });
})(window.WB = window.WB || {});
