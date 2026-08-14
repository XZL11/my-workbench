// module: finance 记账与成本（含记账/支出、固定生活成本台账）
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui;
  const CATS = ['餐饮', '交通', '购物', '居住', '娱乐', '医疗', '教育', '工资', '理财', '其他'];
  const FIN_PARSE_SYSTEM = '你是记账解析助手。用户会给你一段消费/收入描述（中文）。请从中提取结构化信息，只输出一个 JSON 对象（不要任何解释、不要代码块），字段：amount(数字，必填，没有则 0)、type("expense"或"income")、category(从以下选一：餐饮/交通/购物/居住/娱乐/医疗/教育/工资/理财/其他)、note(商户或备注，简短)。示例输入「星巴克 38」→{"amount":38,"type":"expense","category":"餐饮","note":"星巴克"}。';

  function formFields(f) {
    f = f || {};
    return [
      { name: 'type', label: '类型', type: 'select', value: f.type, row: 'a', options: [{ value: 'expense', label: '支出' }, { value: 'income', label: '收入' }] },
      { name: 'amount', label: '金额', type: 'number', value: f.amount || '', placeholder: '0.00', required: true, pattern: '^\\d+(\\.\\d+)?$', err: '请输入有效金额', row: 'a' },
      { name: 'cat', label: '分类', type: 'select', value: f.category, row: 'b', options: CATS.map(c => ({ value: c, label: c })) },
      { name: 'date', label: '日期', type: 'date', value: f.date || ui.fmtDate(Date.now()), row: 'b' },
      { name: 'fixed', label: '标记为固定成本（计入「固定月成本」统计）', type: 'checkbox', value: f.fixed },
      { name: 'note', label: '备注', value: f.note || '' }
    ];
  }

  async function render(root) {
    let all = (await store.getAll('finance')).filter(i => !i._deleted);

    // 汇总计算（初始渲染与保存后局部刷新共用，避免刷新整页）
    function computeSummary() {
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
          <div class="bar-track"><div class="bar-fill exp" style="width:${(r.value / catMax * 100).toFixed(1)}%"></div></div>
          <span class="bar-val">${r.value.toFixed(2)}</span>
        </div>`).join('') : ui.emptyState('本月暂无支出');

      // 图表：本月收入分类
      const incCatMap = {};
      monthItems.filter(i => i.type === 'income').forEach(i => {
        const c = i.category || '其他';
        incCatMap[c] = (incCatMap[c] || 0) + (+i.amount || 0);
      });
      const incCatRows = Object.keys(incCatMap).map(c => ({ label: c, value: incCatMap[c] })).sort((a, b) => b.value - a.value);
      const incCatMax = Math.max.apply(null, incCatRows.map(r => r.value).concat([1]));
      const incCatBars = incCatRows.length ? incCatRows.map(r => `
        <div class="bar-row">
          <span class="bar-label">${ui.escapeHtml(r.label)}</span>
          <div class="bar-track"><div class="bar-fill inc" style="width:${(r.value / incCatMax * 100).toFixed(1)}%"></div></div>
          <span class="bar-val">${r.value.toFixed(2)}</span>
        </div>`).join('') : ui.emptyState('本月暂无收入');

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
      return { income, expense, fixedSum, catBars, incCatBars, trendHTML };
    }
    const summary = computeSummary();

    root.innerHTML = `
      <div class="page">
        ${ui.pageHead('wallet', '记账与成本', { actions: '<button class="btn primary" id="add">+ 记一笔</button>' })}
        <div class="stat-row">
          <div class="stat"><div class="stat-num" id="stat-income">${summary.income.toFixed(2)}</div><div class="stat-label">本月收入</div></div>
          <div class="stat"><div class="stat-num" id="stat-expense">${summary.expense.toFixed(2)}</div><div class="stat-label">本月支出</div></div>
          <div class="stat"><div class="stat-num ${summary.income - summary.expense < 0 ? 'neg' : ''}" id="stat-balance">${(summary.income - summary.expense).toFixed(2)}</div><div class="stat-label">结余</div></div>
          <div class="stat"><div class="stat-num" id="stat-fixed">${summary.fixedSum.toFixed(2)}</div><div class="stat-label">固定月成本</div></div>
        </div>
        <section class="card section">
          <h2>本月收入 / 支出分类</h2>
          <div class="cat-split">
            <div class="cat-half">
              <div class="cat-half-head exp">支出</div>
              <div class="bars" id="cat-bars">${summary.catBars}</div>
            </div>
            <div class="cat-half">
              <div class="cat-half-head inc">收入</div>
              <div class="bars" id="cat-inc-bars">${summary.incCatBars}</div>
            </div>
          </div>
        </section>
        <section class="card section">
          <h2>近 6 个月收支趋势</h2>
          <div id="trend">${summary.trendHTML}</div>
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
      if (!view.length) { list.innerHTML = ui.emptyState('本月还没有记账', { action: { label: '记一笔' } }); bindEmpty(); return; }
      list.innerHTML = view.map(r => `
        <div class="card fin ${r.type}" data-id="${r.id}">
          <div class="fin-amt ${r.type}">${r.type === 'income' ? '+' : '-'}${(+r.amount || 0).toFixed(2)}</div>
          <div class="fin-main">
            <div class="fin-title">${ui.escapeHtml(r.category)}${r.fixed ? ' <span class="badge">固定</span>' : ''}</div>
            <div class="fin-meta"><span class="muted">${ui.escapeHtml(r.date || '')}</span>${r.note ? '<span class="muted">' + ui.escapeHtml(r.note) + '</span>' : ''}</div>
          </div>
          <div class="row-actions">
            <button class="icon-btn edit" title="编辑">${ui.icon('pencil', 16)}</button>
            <button class="icon-btn del" title="删除">${ui.icon('trash', 16)}</button>
          </div>
        </div>      `).join('');
      bindEmpty();
    }
    function bindEmpty() {
      const ea = list.querySelector('#empty-add');
      if (ea) ea.onclick = () => openForm(null);
    }
    paint('all');
    async function refresh() {
      all = (await store.getAll('finance')).filter(i => !i._deleted);
      paint(); // 记录列表
      const s = computeSummary(); // 统计卡 + 本月支出分类 + 近6个月趋势
      const si = root.querySelector('#stat-income'); if (si) si.textContent = s.income.toFixed(2);
      const se = root.querySelector('#stat-expense'); if (se) se.textContent = s.expense.toFixed(2);
      const sb = root.querySelector('#stat-balance');
      if (sb) { sb.textContent = (s.income - s.expense).toFixed(2); sb.classList.toggle('neg', s.income - s.expense < 0); }
      const sf = root.querySelector('#stat-fixed'); if (sf) sf.textContent = s.fixedSum.toFixed(2);
      const cb = root.querySelector('#cat-bars'); if (cb) cb.innerHTML = s.catBars;
      const cib = root.querySelector('#cat-inc-bars'); if (cib) cib.innerHTML = s.incCatBars;
      const tr = root.querySelector('#trend'); if (tr) tr.innerHTML = s.trendHTML;
    }
    root.querySelector('#filters').addEventListener('click', e => {
      if (!e.target.dataset.f) return;
      root.querySelectorAll('#filters .chip').forEach(c => c.classList.remove('active'));
      e.target.classList.add('active'); paint(e.target.dataset.f);
    });

    function openForm(f) {
      const m = ui.openModal({
        title: f ? '编辑记录' : '记一笔', html: ui.form(formFields(f)) +
          '<div class="ai-bar"><button type="button" class="btn ghost sm" id="ai-parse">✨ AI 智能入账</button></div>' +
          '<div id="ai-parse-row" style="display:none"><input id="ai-parse-in" class="input" placeholder="粘贴消费描述，如：星巴克 38 / 午餐 35 美团"><button class="btn ghost sm" id="ai-parse-go">解析</button></div>' +
          '<div class="hint muted">输入「描述 + 金额」，AI 自动识别金额 / 类型 / 分类 / 商户，确认后保存即可。</div>',
        actions: [{ label: '取消' }, { label: '保存', primary: true, onClick: async (close) => {
          const amount = parseFloat(m.dialog.querySelector('#f-amount').value);
          if (isNaN(amount) || amount <= 0) { ui.toast('请输入有效金额', 'warn'); return; }
          const obj = f ? Object.assign({}, f) : { id: store.uid() };
          obj.type = m.dialog.querySelector('#f-type').value;
          obj.amount = amount; obj.category = m.dialog.querySelector('#f-cat').value;
          obj.date = m.dialog.querySelector('#f-date').value || ui.fmtDate(Date.now());
          obj.fixed = m.dialog.querySelector('#f-fixed').checked;
          obj.note = m.dialog.querySelector('#f-note').value;
          await store.put('finance', obj); close(); await refresh();
        } }]
      });
      ui.bindFormValidation(m.dialog);
      const aiParseBtn = m.dialog.querySelector('#ai-parse');
      const aiParseRow = m.dialog.querySelector('#ai-parse-row');
      const aiParseIn = m.dialog.querySelector('#ai-parse-in');
      aiParseBtn.onclick = () => {
        aiParseRow.style.display = (aiParseRow.style.display === 'none') ? 'flex' : 'none';
        if (aiParseRow.style.display === 'flex') aiParseIn.focus();
      };
      m.dialog.querySelector('#ai-parse-go').onclick = async () => {
        const raw = aiParseIn.value.trim();
        if (!raw) { ui.toast('请先输入消费描述', 'warn'); return; }
        if (!(await WB.ai.isConfigured())) { ui.toast('请先到「设置 → AI 助手」配置 API Key', 'warn'); setTimeout(() => { location.hash = '#/settings'; }, 400); return; }
        const goBtn = m.dialog.querySelector('#ai-parse-go');
        goBtn.disabled = true; goBtn.textContent = '解析中…';
        try {
          const parsed = WB.ai.parseJSON(await WB.ai.ask(FIN_PARSE_SYSTEM, raw));
          if (!parsed || !(parsed.amount > 0)) { ui.toast('没能解析出金额，请检查描述', 'warn'); }
          else {
            m.dialog.querySelector('#f-amount').value = parsed.amount;
            if (parsed.type === 'income' || parsed.type === 'expense') m.dialog.querySelector('#f-type').value = parsed.type;
            if (parsed.category && CATS.indexOf(parsed.category) >= 0) m.dialog.querySelector('#f-cat').value = parsed.category;
            if (parsed.note) m.dialog.querySelector('#f-note').value = parsed.note;
            ui.toast('已填入，请确认后保存');
            aiParseRow.style.display = 'none';
          }
        } catch (e) { ui.toast('AI 解析失败：' + e.message, 'error'); }
        finally { goBtn.disabled = false; goBtn.textContent = '解析'; }
      };
      setTimeout(() => m.dialog.querySelector('#f-amount').focus(), 50);
    }
    root.querySelector('#add').onclick = () => openForm(null);
    list.addEventListener('click', async e => {
      const card = e.target.closest('.card'); if (!card) return;
      const id = card.dataset.id;
      if (e.target.closest('.icon-btn.edit')) { openForm(await store.get('finance', id)); return; }
      if (e.target.closest('.icon-btn.del')) {
        if (await ui.confirm({ title: '删除记录', message: '确定删除这条记账吗？删除后可在提示中撤销。', confirmLabel: '删除', danger: true })) {
          ui.trash('finance', id, { label: '已删除记录', repaint: refresh });
        }
      }
    });
  }

  WB.modules.push({ id: 'finance', title: '记账', icon: 'wallet', render });
})(window.WB = window.WB || {});
