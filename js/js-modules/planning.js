// module: planning 长期规划（目标/里程碑/季度/年度）
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui;
  const TYPE = { year: '年度', quarter: '季度', goal: '目标', milestone: '里程碑' };
  const STATUS = { todo: '待启动', doing: '进行中', done: '已完成' };

  function formFields(p) {
    p = p || {};
    return [
      { name: 'title', label: '标题', value: p.title || '', placeholder: '如：2026 健康计划', required: true },
      { name: 'type', label: '类型', type: 'select', value: p.type, row: 'a', options: Object.keys(TYPE).map(k => ({ value: k, label: TYPE[k] })) },
      { name: 'status', label: '状态', type: 'select', value: p.status, row: 'a', options: Object.keys(STATUS).map(k => ({ value: k, label: STATUS[k] })) },
      { name: 'dueDate', label: '截止日期', type: 'date', value: p.dueDate || '' },
      { name: 'note', label: '备注', type: 'textarea', value: p.note || '' }
    ];
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
    let currentFilter = 'all';
    function paint(f) {
      currentFilter = f || 'all';
      let view = all;
      if (f && f !== 'all') view = view.filter(i => i.type === f);
      view = view.sort((a, b) => (a.type).localeCompare(b.type) || (a.dueDate || '').localeCompare(b.dueDate || '') || ((a.status === 'done') - (b.status === 'done')));
      if (!view.length) { list.innerHTML = ui.emptyState('还没有规划，开始制定你的目标吧', { action: { label: '新建规划' } }); bindEmpty(); return; }
      const cardHTML = p => {
        const steps = p.steps || [];
        const doneSteps = steps.filter(s => s.done).length;
        const stepRows = steps.length ? steps.map(s => `
          <div class="plan-step ${s.done ? 'done' : ''}" data-step="${s.id}">
            <input type="checkbox" class="chk step-chk" ${s.done ? 'checked' : ''} title="完成此环节">
            <span class="step-title">${ui.escapeHtml(s.title)}</span>
            <div class="row-actions">
              <button class="icon-btn step-edit" title="编辑">${ui.icon('pencil', 14)}</button>
              <button class="icon-btn step-del" title="删除">${ui.icon('trash', 14)}</button>
            </div>
          </div>`).join('') : '';
        const prog = steps.length ? `<div class="plan-prog"><span class="muted">环节 ${doneSteps}/${steps.length}</span>${doneSteps === steps.length ? ' <span class="badge st-done">全完成</span>' : ''}</div>` : '';
        return `<div class="card plan st-${p.status}" data-id="${p.id}">
          <input type="checkbox" class="chk" ${p.status === 'done' ? 'checked' : ''} title="打勾即标记完成">
          <div class="plan-body">
            <div class="plan-main">
              <div class="plan-title">${ui.escapeHtml(p.title)}</div>
              <div class="plan-meta">
                <span class="badge">${TYPE[p.type] || '目标'}</span>
                <span class="badge st-${p.status}">${STATUS[p.status] || '待启动'}</span>
                ${p.dueDate ? '<span class="muted">' + ui.escapeHtml(p.dueDate) + '</span>' : ''}
              </div>
              ${p.note ? '<div class="muted plan-note">' + ui.escapeHtml(p.note) + '</div>' : ''}
              ${prog}
            </div>
            <div class="row-actions">
              <button class="icon-btn ai" title="AI 建议">${ui.icon('sparkles', 16)}</button>
              <button class="icon-btn edit" title="编辑">${ui.icon('pencil', 16)}</button>
              <button class="icon-btn del" title="删除">${ui.icon('trash', 16)}</button>
            </div>
          </div>
          ${stepRows ? '<div class="plan-steps">' + stepRows + '</div>' : ''}
          <button class="btn ghost sm add-step" data-parent="${p.id}">+ 添加环节</button>
        </div>`;
      };
      list.innerHTML = view.map(cardHTML).join('');
      bindEmpty();
    }
    function bindEmpty() {
      const ea = list.querySelector('#empty-add');
      if (ea) ea.onclick = () => openForm(null);
    }
    async function refresh() { all = (await store.getAll('planning')).filter(i => !i._deleted); paint(); }
    paint('all');
    root.querySelector('#filters').addEventListener('click', e => {
      if (!e.target.dataset.f) return;
      root.querySelectorAll('#filters .chip').forEach(c => c.classList.remove('active'));
      e.target.classList.add('active'); paint(e.target.dataset.f);
    });

    function openForm(p) {
      const m = ui.openModal({
        title: p ? '编辑规划' : '新建规划', html: ui.form(formFields(p)),
        actions: [{ label: '取消' }, { label: '保存', primary: true, onClick: async (close) => {
          const title = m.dialog.querySelector('#f-title').value.trim();
          if (!title) { ui.toast('请填写标题', 'warn'); return; }
          const obj = p ? Object.assign({}, p) : { id: store.uid() };
          obj.title = title; obj.type = m.dialog.querySelector('#f-type').value;
          obj.status = m.dialog.querySelector('#f-status').value;
          obj.dueDate = m.dialog.querySelector('#f-dueDate').value || '';
          obj.note = m.dialog.querySelector('#f-note').value;
          await store.put('planning', obj); close(); await refresh();
        } }]
      });
      ui.bindFormValidation(m.dialog);
      setTimeout(() => m.dialog.querySelector('#f-title').focus(), 50);
    }
    root.querySelector('#add').onclick = () => openForm(null);

    // 添加/编辑环节（进度小项）：不强制创建时填写，后期可自由增删改
    function openStepForm(p, stepId) {
      const step = stepId ? (p.steps || []).find(s => s.id === stepId) : null;
      const m = ui.openModal({
        title: step ? '编辑环节' : '添加环节',
        html: `<div class="form"><label>环节名称<input id="f-step" class="input" value="${ui.escapeHtml(step ? step.title : '')}" placeholder="如：报名、练车、考试"></label></div>`,
        actions: [
          { label: '取消' },
          { label: '保存', primary: true, onClick: async (close) => {
            const title = m.dialog.querySelector('#f-step').value.trim();
            if (!title) { ui.toast('请填写环节名称', 'warn'); return; }
            p.steps = p.steps || [];
            if (step) step.title = title;
            else p.steps.push({ id: store.uid(), title, done: false });
            await store.put('planning', p); close(); paint(currentFilter);
          } }
        ]
      });
      setTimeout(() => m.dialog.querySelector('#f-step').focus(), 50);
    }

    // AI 进度建议：基于规划现状给出下一步可执行建议，可一键「采纳为环节」
    function openAiSuggest(p) {
      const steps = (p.steps || []).map(s => s.title).join('、') || '（暂无）';
      const sys = '你是一个目标规划教练。根据用户给出的规划（标题/类型/状态/截止日期/备注/已有环节），给出下一步可执行的具体建议：用中文，每条一行，控制在 5-8 条，务实、可落地，避免空话。';
      const user = '规划标题：' + (p.title || '') + '\n类型：' + (TYPE[p.type] || p.type) +
        '\n状态：' + (STATUS[p.status] || p.status) + (p.dueDate ? ('\n截止：' + p.dueDate) : '') +
        (p.note ? ('\n备注：' + p.note) : '') + '\n已有环节：' + steps +
        '\n\n请给出下一步建议（每行一条）：';
      WB.ai.assistModal({
        title: 'AI 建议：' + (p.title || ''),
        system: sys,
        user: user,
        adoptLabel: '采纳为环节',
        onAdopt: (txt) => {
          const lines = WB.ai.parseLines(txt);
          if (!lines.length) { ui.toast('没有可采纳的建议', 'warn'); return; }
          p.steps = p.steps || [];
          lines.forEach(t => p.steps.push({ id: store.uid(), title: t, done: false }));
          store.put('planning', p).then(() => { paint(currentFilter); ui.toast('已添加 ' + lines.length + ' 个环节'); });
        }
      });
    }

    list.addEventListener('click', async e => {
      const card = e.target.closest('.card.plan'); if (!card) return;
      const id = card.dataset.id;
      const p = all.find(x => x.id === id); if (!p) return;
      // 规划主勾选框：打勾即完成（手动覆盖）
      if (e.target.classList.contains('chk') && !e.target.classList.contains('step-chk')) {
        p.status = e.target.checked ? 'done' : 'todo';
        await store.put('planning', p); paint(currentFilter); return;
      }
      // 环节勾选框
      if (e.target.classList.contains('step-chk')) {
        const stepEl = e.target.closest('.plan-step'); if (!stepEl) return;
        const step = (p.steps || []).find(s => s.id === stepEl.dataset.step); if (!step) return;
        step.done = e.target.checked;
        // 所有环节完成 → 自动完成整条规划
        if (p.steps && p.steps.length && p.steps.every(s => s.done)) p.status = 'done';
        await store.put('planning', p); paint(currentFilter); return;
      }
      // 添加环节
      if (e.target.closest('.add-step')) { openStepForm(p, null); return; }
      // 环节卡片内：编辑/删除
      const stepEl = e.target.closest('.plan-step');
      if (stepEl) {
        const stepId = stepEl.dataset.step;
        if (e.target.closest('.step-del')) {
          if (await ui.confirm({ title: '删除环节', message: '确定删除这个环节吗？', confirmLabel: '删除', danger: true })) {
            p.steps = (p.steps || []).filter(s => s.id !== stepId);
            await store.put('planning', p); paint(currentFilter);
          }
          return;
        }
        if (e.target.closest('.step-edit') || e.target.closest('.step-title')) { openStepForm(p, stepId); return; }
      }
      // AI 建议
      if (e.target.closest('.icon-btn.ai')) { openAiSuggest(p); return; }
      // 删除规划
      if (e.target.closest('.icon-btn.del')) {
        if (await ui.confirm({ title: '删除规划', message: '确定删除这条规划吗？删除后可在提示中撤销。', confirmLabel: '删除', danger: true })) {
          ui.trash('planning', id, { label: '已删除规划', repaint: refresh });
        }
        return;
      }
      // 点击其它区域 → 编辑规划
      openForm(p);
    });
  }

  WB.modules.push({ id: 'planning', title: '规划', icon: 'target', render });
})(window.WB = window.WB || {});
