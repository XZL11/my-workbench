// module: earnways 赚钱门路（副业/变现思路管理）
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui;

  const CATS = ['内容创作', '信息差', '电商带货', '技能变现', '投资理财', '副业兼职', '其他'];
  const STATUS = { idea: '💡 灵感', try: '🚀 尝试中', live: '✅ 已变现', drop: '🛑 已搁置' };
  const LEVELS = { 1: '★ 低', 2: '★★ 中', 3: '★★★ 高' };

  function fmt(n) { return (n || 0).toLocaleString('zh-CN'); }
  function stars(n) { return '★★★'.slice(0, n || 1) + '☆☆☆'.slice(0, 3 - (n || 1)); }

  function formFields(d) {
    d = d || {};
    return [
      { name: 'name', label: '门路名称', value: d.name || '', placeholder: '如：闲鱼倒卖数码', required: true },
      { name: 'cat', label: '分类', type: 'select', value: d.cat || '', options: CATS },
      { name: 'platform', label: '平台 / 渠道', value: d.platform || '', placeholder: '如：小红书 / 闲鱼', row: 1 },
      { name: 'income', label: '预期月收益(¥)', type: 'number', min: 0, value: d.income || '', row: 2 },
      { name: 'cost', label: '投入成本(¥)', type: 'number', min: 0, value: d.cost || '', row: 3 },
      { name: 'payback', label: '回本周期(数值)', type: 'number', min: 0, value: d.payback || '', row: 4 },
      { name: 'paybackUnit', label: '回本单位', type: 'select', value: d.paybackUnit || '月', options: ['天', '周', '月', '年'], row: 4 },
      { name: 'status', label: '状态', type: 'select', value: d.status || 'idea',
        options: [
          { value: 'idea', label: '💡 灵感' }, { value: 'try', label: '🚀 尝试中' },
          { value: 'live', label: '✅ 已变现' }, { value: 'drop', label: '🛑 已搁置' }
        ], row: 5 },
      { name: 'level', label: '难度', type: 'select', value: String(d.level || '1'),
        options: [{ value: '1', label: '★ 低' }, { value: '2', label: '★★ 中' }, { value: '3', label: '★★★ 高' }], row: 5 },
      { name: 'note', label: '备注 / 步骤', type: 'textarea', value: d.note || '' }
    ];
  }

  async function render(root) {
    let all = (await store.getAll('earnways')).filter(i => !i._deleted);
    const cats = ['全部', ...Array.from(new Set(all.map(i => i.cat || '其他')))];
    root.innerHTML = `
      <div class="page">
        ${ui.pageHead('coins', '赚钱门路', { actions: '<button class="btn primary" id="add">+ 新建</button>' })}
        <div id="stats" class="stat-row"></div>
        <div class="filters">
          <div class="search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input id="search" placeholder="搜索名称 / 平台 / 备注…"></div>
          <div class="chips" id="chips">${cats.map(c => `<button class="chip${c === '全部' ? ' active' : ''}" data-c="${ui.escapeHtml(c)}">${ui.escapeHtml(c)}</button>`).join('')}</div>
        </div>
        <div id="list" class="grid cards-grid"></div>
      </div>`;

    const listEl = root.querySelector('#list');
    const statsEl = root.querySelector('#stats');
    const searchEl = root.querySelector('#search');

    function paintStats() {
      const total = all.length;
      const live = all.filter(d => d.status === 'live').length;
      const tryCount = all.filter(d => d.status === 'try').length;
      const liveIncome = all.filter(d => d.status === 'live').reduce((s, d) => s + (+d.income || 0), 0);
      statsEl.innerHTML =
        `<div class="stat"><div class="stat-num">${total}</div><div class="stat-label">门路总数</div></div>
         <div class="stat"><div class="stat-num pos">${live}</div><div class="stat-label">已变现</div></div>
         <div class="stat"><div class="stat-num">${tryCount}</div><div class="stat-label">尝试中</div></div>
         <div class="stat"><div class="stat-num pos">¥${fmt(liveIncome)}</div><div class="stat-label">预期月收益(已变现)</div></div>`;
    }

    function paint(cat, q) {
      cat = cat || '全部';
      q = (q || '').trim().toLowerCase();
      let view = all;
      if (cat !== '全部') view = view.filter(i => (i.cat || '其他') === cat);
      if (q) view = view.filter(i =>
        (i.name || '').toLowerCase().includes(q) ||
        (i.platform || '').toLowerCase().includes(q) ||
        (i.note || '').toLowerCase().includes(q)
      );
      if (!view.length) {
        listEl.innerHTML = ui.emptyState('还没有门路，点右上角「+ 新建」添加一个吧', { action: { label: '新建门路' } });
        bindEmpty(); return;
      }
      // 按预期月收益降序排列
      view.sort((a, b) => (+b.income || 0) - (+a.income || 0));
      listEl.innerHTML = view.map(d => {
        const stLabel = STATUS[d.status] || STATUS.idea;
        return `<div class="card ew st-${d.status}${d.status === 'live' ? ' ew-live' : ''}" data-id="${d.id}">
          <div class="ew-fav">${ui.icon('coins', 20)}</div>
          <div class="ew-main">
            <div class="ew-title">${ui.escapeHtml(d.name)}</div>
            <div class="ew-meta">
              <span class="badge">${ui.escapeHtml(d.cat || '其他')}</span>
              <span class="badge st-${d.status}">${stLabel}</span>
              ${d.platform ? `<span class="badge">${ui.escapeHtml(d.platform)}</span>` : ''}
            </div>
            <div class="ew-row">
              <span class="ew-income">¥${fmt(d.income)}<small>/月</small></span>
              <span class="ew-stars" title="难度 ${LEVELS[d.level] || LEVELS[1]}">${stars(d.level || 1)}</span>
            </div>
            ${(d.cost || d.payback) ? `<div class="ew-row ew-sub">
              ${d.cost !== undefined && d.cost > 0 ? `<span class="badge">投入 ¥${fmt(d.cost)}</span>` : ''}
              ${d.payback ? `<span class="badge">回本 ${fmt(d.payback)}${ui.escapeHtml(d.paybackUnit || '月')}</span>` : ''}
            </div>` : ''}
            ${d.note ? `<div class="ew-note muted">${ui.escapeHtml(d.note)}</div>` : ''}
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
      const ea = listEl.querySelector('#empty-add');
      if (ea) ea.onclick = () => openForm(null);
    }

    let curCat = '全部', curQ = '';
    paintStats();
    paint(curCat, curQ);

    async function refresh() {
      all = (await store.getAll('earnways')).filter(i => !i._deleted);
      // 更新分类 chips
      const newCats = ['全部', ...Array.from(new Set(all.map(i => i.cat || '其他')))];
      root.querySelector('#chips').innerHTML = newCats.map(c =>
        `<button class="chip${c === curCat ? ' active' : ''}" data-c="${ui.escapeHtml(c)}">${ui.escapeHtml(c)}</button>`
      ).join('');
      paintStats();
      paint(curCat, curQ);
    }

    // 筛选
    root.querySelector('#chips').addEventListener('click', e => {
      if (!e.target.dataset.c) return;
      root.querySelectorAll('#chips .chip').forEach(c => c.classList.remove('active'));
      e.target.classList.add('active'); curCat = e.target.dataset.c; paint(curCat, curQ);
    });
    searchEl.addEventListener('input', () => { curQ = searchEl.value.trim(); paint(curCat, curQ); });

    // 表单
    function openForm(d) {
      const m = ui.openModal({
        title: d ? '编辑门路' : '新建门路',
        html: ui.form(formFields(d)),
        actions: [
          { label: '取消' },
          { label: '保存', primary: true, onClick: async (close) => {
            const name = m.dialog.querySelector('#f-name').value.trim();
            if (!name) { ui.toast('请填写门路名称', 'warn'); return; }
            const obj = d ? Object.assign({}, d) : { id: store.uid() };
            obj.name = name;
            obj.cat = m.dialog.querySelector('#f-cat').value.trim();
            obj.platform = m.dialog.querySelector('#f-platform').value.trim();
            obj.income = +m.dialog.querySelector('#f-income').value || 0;
            obj.cost = +m.dialog.querySelector('#f-cost').value || 0;
            obj.payback = +m.dialog.querySelector('#f-payback').value || 0;
            obj.paybackUnit = m.dialog.querySelector('#f-paybackUnit').value;
            obj.status = m.dialog.querySelector('#f-status').value;
            obj.level = parseInt(m.dialog.querySelector('#f-level').value, 10) || 1;
            obj.note = m.dialog.querySelector('#f-note').value.trim();
            await store.put('earnways', obj); close(); await refresh();
          } }
        ]
      });
      ui.bindFormValidation(m.dialog);
      setTimeout(() => m.dialog.querySelector('#f-name').focus(), 50);
    }

    root.querySelector('#add').onclick = () => openForm(null);

    // 卡片交互（编辑/删除）
    listEl.addEventListener('click', async e => {
      const card = e.target.closest('.card'); if (!card) return;
      const id = card.dataset.id;
      if (e.target.closest('.icon-btn.edit')) { openForm(await store.get('earnways', id)); return; }
      if (e.target.closest('.icon-btn.del')) {
        if (await ui.confirm({ title: '删除门路', message: '确定删除这条赚钱门路吗？删除后可在提示中撤销。', confirmLabel: '删除', danger: true })) {
          ui.trash('earnways', id, { label: '已删除门路', repaint: refresh });
        }
        return;
      }
    });
  }

  WB.modules.push({ id: 'earnways', title: '赚钱门路', icon: 'coins', render });
})(window.WB = window.WB || {});
