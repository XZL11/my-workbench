// module: today 今日仪表盘（待办 + 跨模块数据概览）
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui;
  const PRI = { 1: '高', 2: '中', 3: '低' };

  function lastNDays(n) { const out = []; for (let i = n - 1; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); out.push(ui.fmtDate(d.getTime())); } return out; }
  function streak(m) { let s = 0; const t = new Date(); for (let i = 0;; i++) { const d = new Date(t); d.setDate(d.getDate() - i); const k = ui.fmtDate(d.getTime()); if (m[k] && m[k].done) s++; else break; } return s; }

  function taskFormHTML(t) {
    t = t || {};
    return `<div class="form">
      <label>标题<input id="f-title" class="input" value="${ui.escapeHtml(t.title || '')}" placeholder="待办标题"></label>
      <div class="row">
        <label style="flex:1">优先级<select id="f-priority" class="input">
          <option value="1" ${t.priority == 1 ? 'selected' : ''}>高</option>
          <option value="2" ${t.priority == 2 ? 'selected' : ''}>中</option>
          <option value="3" ${t.priority == 3 ? 'selected' : ''}>低</option></select></label>
        <label style="flex:1">截止日期<input id="f-due" class="input" type="date" value="${t.dueDate || ui.fmtDate(Date.now())}"></label>
      </div>
      <label>标签（逗号分隔）<input id="f-tags" class="input" value="${ui.escapeHtml((t.tags || []).join(', '))}" placeholder="工作, 紧急"></label>
      <label>备注<textarea id="f-note" class="input" rows="2">${ui.escapeHtml(t.note || '')}</textarea></label>
    </div>`;
  }

  async function render(root) {
    const todayKey = ui.fmtDate(Date.now());
    let tasks = (await store.getAll('tasks')).filter(i => !i._deleted);
    const habits = (await store.getAll('habits')).filter(i => !i._deleted);
    const logs = (await store.getAll('habitlogs')).filter(i => !i._deleted);
    const finance = (await store.getAll('finance')).filter(i => !i._deleted);
    const content = (await store.getAll('content')).filter(i => !i._deleted);
    const planning = (await store.getAll('planning')).filter(i => !i._deleted);
    const notes = (await store.getAll('notes')).filter(i => !i._deleted).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 3);
    const bookmarks = (await store.getAll('bookmarks')).filter(i => !i._deleted).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 3);

    const parents = tasks.filter(t => !t.parentId);
    const childrenOf = pid => tasks.filter(t => t.parentId === pid).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const dueToday = parents.filter(t => !t.done && t.dueDate === todayKey);
    const overdue = parents.filter(t => !t.done && t.dueDate && t.dueDate < todayKey);
    const todo = overdue.concat(dueToday).sort((a, b) => (a.priority - b.priority) || (a.dueDate || '').localeCompare(b.dueDate || ''));

    const logMap = {}; logs.forEach(l => { if (l && l.id) logMap[l.id] = l; });
    const logFor = hid => { const m = {}; Object.keys(logMap).forEach(k => { if (k.startsWith(hid + ':')) m[k.split(':').slice(1).join(':')] = logMap[k]; }); return m; };
    const habitDone = habits.filter(hh => { const m = logFor(hh.id); return m[todayKey] && m[todayKey].done; }).length;

    const month = todayKey.slice(0, 7);
    const monthItems = finance.filter(i => (i.date || '').slice(0, 7) === month);
    const income = monthItems.filter(i => i.type === 'income').reduce((s, i) => s + (+i.amount || 0), 0);
    const expense = monthItems.filter(i => i.type === 'expense').reduce((s, i) => s + (+i.amount || 0), 0);
    const catMap = {}; monthItems.filter(i => i.type === 'expense').forEach(i => { const c = i.category || '其他'; catMap[c] = (catMap[c] || 0) + (+i.amount || 0); });
    const catRows = Object.keys(catMap).map(c => ({ label: c, value: catMap[c] })).sort((a, b) => b.value - a.value).slice(0, 5);
    const catMax = Math.max.apply(null, catRows.map(r => r.value).concat([1]));

    const cStat = { idea: 0, draft: 0, review: 0, published: 0 };
    content.forEach(c => { cStat[c.status] = (cStat[c.status] || 0) + 1; });
    const goals = planning.filter(p => p.type === 'goal' && p.status !== 'done').length;
    const ms = planning.filter(p => p.type === 'milestone' && p.status !== 'done' && p.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];

    const d = new Date();
    const dateStr = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + '日一二三四五六'[d.getDay()];
    const h = d.getHours();
    const greet = h < 11 ? '早上好' : h < 18 ? '下午好' : '晚上好';

    function todoItemHTML(t) {
      const subs = childrenOf(t.id);
      const subHTML = subs.length ? '<div class="subs">' + subs.map(s => `
        <div class="card task sub ${s.done ? 'done' : ''}" data-id="${s.id}">
          <input type="checkbox" class="chk" ${s.done ? 'checked' : ''}>
          <div class="task-main"><div class="task-title">${ui.escapeHtml(s.title)}</div></div>
          <div class="row-actions"><button class="icon-btn del" title="删除">${ui.icon('trash', 16)}</button></div>
        </div>`).join('') + `<div class="card task addsub" data-parent="${t.id}">+ 添加子任务</div></div>` : '';
      return `<div class="task-group">
        <div class="card task ${t.done ? 'done' : ''}" data-id="${t.id}">
          <input type="checkbox" class="chk" ${t.done ? 'checked' : ''}>
          <div class="task-main">
            <div class="task-title">${ui.escapeHtml(t.title)}</div>
            <div class="task-meta"><span class="pri pri-${t.priority}">${PRI[t.priority] || '中'}</span>${t.dueDate < todayKey ? '<span class="due over">逾期 ' + ui.escapeHtml(t.dueDate) + '</span>' : (t.dueDate ? '<span class="due">' + ui.escapeHtml(t.dueDate) + '</span>' : '<span class="muted">无截止日</span>')}</div>
          </div>
          <div class="row-actions"><button class="icon-btn edit" title="编辑">${ui.icon('pencil', 16)}</button><button class="icon-btn del" title="删除">${ui.icon('trash', 16)}</button></div>
        </div>${subHTML}</div>`;
    }
    const todoHTML = todo.length ? todo.map(todoItemHTML).join('') : ui.emptyState('今天没有待办，太棒了 🎉');

    const habitHTML = habits.length ? habits.map(hh => {
      const m = logFor(hh.id); const done = m[todayKey] && m[todayKey].done;
      return `<div class="card habit" data-id="${hh.id}" style="--hc:${ui.escapeHtml(hh.color || '#4f46e5')}">
        <button class="habit-check ${done ? 'on' : ''}" data-id="${hh.id}">${done ? ui.icon('check', 16) : ''}</button>
        <div class="habit-main"><div class="habit-name">${ui.escapeHtml(hh.name)}</div><div class="habit-meta">连续 ${streak(m)} 天</div></div>
      </div>`;
    }).join('') : ui.emptyState('还没有习惯，去「习惯」页添加');

    const catBars = catRows.length ? catRows.map(r => `<div class="bar-row"><span class="bar-label">${ui.escapeHtml(r.label)}</span><div class="bar-track"><div class="bar-fill" style="width:${(r.value / catMax * 100).toFixed(1)}%"></div></div><span class="bar-val">${r.value.toFixed(2)}</span></div>`).join('') : '<span class="muted">本月暂无支出</span>';

    const notesHTML = notes.length ? notes.map(n => `<div class="card note-mini" data-go="notes"><div class="nm-title">${ui.escapeHtml(n.title || '无标题')}</div><div class="muted" style="font-size:12px">${ui.fmtRelative(n.updatedAt)}</div></div>`).join('') : ui.emptyState('暂无笔记');
    const bmHTML = bookmarks.length ? bookmarks.map(b => `<a class="card bm-mini" href="${ui.escapeHtml(b.url)}" target="_blank" rel="noopener"><div class="bm-mini-title">${ui.escapeHtml(b.title)}</div><div class="muted" style="font-size:12px">${ui.escapeHtml(b.category || '未分类')}</div></a>`).join('') : ui.emptyState('暂无书签');

    const finHTML = `<div class="bars">${catBars}</div><div class="muted" style="margin-top:8px;font-size:13px">收入 ${income.toFixed(2)} · 支出 ${expense.toFixed(2)} · 结余 ${(income - expense).toFixed(2)}</div>`;
    const contentHTML = `<div class="chips">
      <span class="chip">💡 灵感 ${cStat.idea}</span>
      <span class="chip">✍️ 草稿 ${cStat.draft}</span>
      <span class="chip">👀 待审 ${cStat.review}</span>
      <span class="chip">✅ 已发布 ${cStat.published}</span>
    </div>`;
    const planningHTML = `<div class="muted" style="font-size:14px">进行中目标 <b>${goals}</b>${ms ? ' · 最近里程碑：' + ui.escapeHtml(ms.title) + '（' + ui.escapeHtml(ms.dueDate) + '）' : ''}</div>`;

    function panelHTML(picon, ptitle, pbody, pgo, pextra, bodyId, wide) {
      return `<section class="card panel${wide ? ' panel-wide' : ''}">
        <div class="panel-head">
          <div class="panel-title"><span class="pi">${ui.icon(picon, 18)}</span>${ptitle}</div>
          <div class="panel-actions">${pextra || ''}<button class="btn ghost sm" data-go="${pgo}">查看全部</button></div>
        </div>
        <div class="panel-body"${bodyId ? ' id="' + bodyId + '"' : ''}>${pbody}</div>
      </section>`;
    }

    root.innerHTML = `
      <div class="page">
        ${ui.pageHead('home', '今日', { subtitle: ui.escapeHtml(greet) + '，' + dateStr + '<div class="muted" style="margin-top:2px">' + todo.length + ' 项待办 · ' + habitDone + '/' + habits.length + ' 习惯已打卡 · 本月结余 ' + (income - expense).toFixed(2) + '</div>' })}
        <div class="stat-row">
          <div class="stat"><div class="stat-num" id="stat-todo">${todo.length}</div><div class="stat-label">待办（含逾期）</div></div>
          <div class="stat"><div class="stat-num ${overdue.length ? 'neg' : ''}" id="stat-overdue">${overdue.length}</div><div class="stat-label">已逾期</div></div>
          <div class="stat"><div class="stat-num" id="stat-balance">${(income - expense).toFixed(2)}</div><div class="stat-label">本月结余</div></div>
          <div class="stat"><div class="stat-num" id="stat-habit">${habitDone}/${habits.length}</div><div class="stat-label">习惯打卡</div></div>
        </div>
        <div class="dash-grid">
          ${panelHTML('check', '今日待办', `<div id="todolist">${todoHTML}</div>`, 'tasks', '<button class="btn primary sm" id="add-task">+ 待办</button>', undefined, true)}
          ${panelHTML('flame', '习惯打卡', `<div id="habits">${habitHTML}</div>`, 'habits', '', 'p-habits')}
          ${panelHTML('wallet', '收支速览', finHTML, 'finance', '', 'p-fin')}
          ${panelHTML('pen', '内容创作', contentHTML, 'content', '', 'p-content')}
          ${panelHTML('target', '长期规划', planningHTML, 'planning', '', 'p-planning')}
          ${panelHTML('note', '最近笔记', notesHTML, 'notes', '', 'p-notes')}
          ${panelHTML('bookmark', '最近书签', bmHTML, 'bookmarks', '', 'p-bookmarks')}
        </div>
      </div>`;

    // 待办交互（含子任务）
    const tl = root.querySelector('#todolist');
    tl.addEventListener('click', async e => {
      const card = e.target.closest('.card'); if (!card) return;
      const id = card.dataset.id;
      if (card.classList.contains('addsub')) { openSubForm(card.dataset.parent); return; }
      if (e.target.classList.contains('chk')) {
        const t = await store.get('tasks', id); t.done = e.target.checked; await store.put('tasks', t);
        card.classList.toggle('done', t.done); // 局部更新，避免整页 reload 闪烁（M1）
        return;
      }
      if (e.target.closest('.icon-btn.del')) {
        const childItems = card.classList.contains('sub') ? [] : childrenOf(id).map(k => ({ store: 'tasks', id: k.id }));
        ui.trashRecords([{ store: 'tasks', id: id }, ...childItems], { label: card.classList.contains('sub') ? '已删除子任务' : '已删除待办', repaint: renderTodo });
        return;
      }
      if (!card.classList.contains('sub') && (e.target.closest('.icon-btn.edit') || e.target.closest('.task-main'))) {
        openTaskForm(await store.get('tasks', id));
      }
    });
    root.querySelector('#add-task').onclick = () => openTaskForm(null);

    // 局部重绘待办面板：增删改待办后调用，避免整页 reload 闪烁（L1）
    async function renderTodo() {
      tasks = (await store.getAll('tasks')).filter(i => !i._deleted);
      const parents = tasks.filter(t => !t.parentId);
      const dueToday = parents.filter(t => !t.done && t.dueDate === todayKey);
      const overdue = parents.filter(t => !t.done && t.dueDate && t.dueDate < todayKey);
      const todo = overdue.concat(dueToday).sort((a, b) => (a.priority - b.priority) || (a.dueDate || '').localeCompare(b.dueDate || ''));
      tl.innerHTML = todo.length ? todo.map(todoItemHTML).join('') : ui.emptyState('今天没有待办，太棒了 🎉');
      const se1 = root.querySelector('#stat-todo'); if (se1) se1.textContent = todo.length;
      const se2 = root.querySelector('#stat-overdue'); if (se2) { se2.textContent = overdue.length; se2.classList.toggle('neg', !!overdue.length); }
    }

    // 习惯打卡
    root.querySelector('#habits').addEventListener('click', async e => {
      const btn = e.target.closest('.habit-check'); if (!btn) return;
      const id = btn.dataset.id; const key = id + ':' + todayKey;
      const ex = logMap[key]; const done = !(ex && ex.done);
      const rec = { id: key, habitId: id, date: todayKey, done, updatedAt: Date.now() };
      await store.put('habitlogs', rec);
      logMap[key] = rec;
      btn.classList.toggle('on', done);
      const habitDone = habits.filter(hh => { const m = logFor(hh.id); return m[todayKey] && m[todayKey].done; }).length;
      const se = root.querySelector('#stat-habit'); if (se) se.textContent = habitDone + '/' + habits.length;
      return;
    });

    // 笔记/书签跳转
    root.querySelectorAll('[data-go]').forEach(el => { el.onclick = () => { location.hash = '#/' + el.dataset.go; }; });

    async function openSubForm(parentId) {
      const p = parentId ? await store.get('tasks', parentId) : null;
      const m = ui.openModal({
        title: '添加子任务', html: `<div class="form"><label>子任务标题<input id="f-sub" class="input" placeholder="例如：写大纲、找素材"></label></div>`,
        actions: [
          { label: '取消' },
          { label: '保存', primary: true, onClick: async (close) => {
            const title = m.dialog.querySelector('#f-sub').value.trim();
            if (!title) { ui.toast('请填写标题', 'warn'); return; }
            const obj = { id: store.uid(), createdAt: Date.now(), title,
              priority: p ? p.priority : 2, dueDate: p ? p.dueDate : ui.fmtDate(Date.now()),
              parentId: parentId || undefined, tags: [], note: '' };
            await store.put('tasks', obj); close(); await renderTodo();
          } }
        ]
      });
      setTimeout(() => m.dialog.querySelector('#f-sub').focus(), 50);
    }

    function openTaskForm(t) {
      const m = ui.openModal({
        title: t ? '编辑待办' : '新建待办', html: taskFormHTML(t),
        actions: [
          { label: '取消' },
          { label: '保存', primary: true, onClick: async (close) => {
            const title = m.dialog.querySelector('#f-title').value.trim();
            if (!title) { ui.toast('请填写标题', 'warn'); return; }
            const obj = t ? Object.assign({}, t) : { id: store.uid(), createdAt: Date.now() };
            obj.title = title; obj.priority = parseInt(m.dialog.querySelector('#f-priority').value, 10);
            obj.dueDate = m.dialog.querySelector('#f-due').value || ui.fmtDate(Date.now());
            obj.tags = m.dialog.querySelector('#f-tags').value.split(',').map(s => s.trim()).filter(Boolean);
            obj.note = m.dialog.querySelector('#f-note').value;
            await store.put('tasks', obj); close(); await renderTodo();
          } }
        ]
      });
      if (!t) setTimeout(() => m.dialog.querySelector('#f-title').focus(), 50);
    }

    // L2 数据订阅：任一数据源变更（含本页操作与云端同步）即增量重绘对应面板，无需整页 reload
    async function liveRepaint(name) {
      if (name === 'tasks') { await renderTodo(); return; }
      if (name === 'habits' || name === 'habitlogs') {
        const nh = (await store.getAll('habits')).filter(i => !i._deleted);
        const nl = (await store.getAll('habitlogs')).filter(i => !i._deleted);
        const lm = {}; nl.forEach(l => { if (l && l.id) lm[l.id] = l; });
        const logFor2 = hid => { const m = {}; Object.keys(lm).forEach(k => { if (k.startsWith(hid + ':')) m[k.split(':').slice(1).join(':')] = lm[k]; }); return m; };
        const total = nh.length;
        const done = nh.filter(hh => { const m = logFor2(hh.id); return m[todayKey] && m[todayKey].done; }).length;
        const body = root.querySelector('#p-habits');
        if (body) body.innerHTML = total ? nh.map(hh => {
          const m = logFor2(hh.id); const on = m[todayKey] && m[todayKey].done;
          return `<div class="card habit" data-id="${hh.id}" style="--hc:${ui.escapeHtml(hh.color || '#4f46e5')}">
            <button class="habit-check ${on ? 'on' : ''}" data-id="${hh.id}">${on ? ui.icon('check', 16) : ''}</button>
            <div class="habit-main"><div class="habit-name">${ui.escapeHtml(hh.name)}</div><div class="habit-meta">连续 ${streak(m)} 天</div></div>
          </div>`;
        }).join('') : ui.emptyState('还没有习惯，去「习惯」页添加');
        const se = root.querySelector('#stat-habit'); if (se) se.textContent = done + '/' + total;
        return;
      }
      if (name === 'finance') {
        const allF = (await store.getAll('finance')).filter(i => !i._deleted);
        const mi = allF.filter(i => (i.date || '').slice(0, 7) === todayKey.slice(0, 7));
        const inc = mi.filter(i => i.type === 'income').reduce((s, i) => s + (+i.amount || 0), 0);
        const exp = mi.filter(i => i.type === 'expense').reduce((s, i) => s + (+i.amount || 0), 0);
        const cm = {}; mi.filter(i => i.type === 'expense').forEach(i => { const c = i.category || '其他'; cm[c] = (cm[c] || 0) + (+i.amount || 0); });
        const cr = Object.keys(cm).map(c => ({ label: c, value: cm[c] })).sort((a, b) => b.value - a.value).slice(0, 5);
        const cmx = Math.max.apply(null, cr.map(r => r.value).concat([1]));
        const bars = cr.length ? cr.map(r => `<div class="bar-row"><span class="bar-label">${ui.escapeHtml(r.label)}</span><div class="bar-track"><div class="bar-fill" style="width:${(r.value / cmx * 100).toFixed(1)}%"></div></div><span class="bar-val">${r.value.toFixed(2)}</span></div>`).join('') : '<span class="muted">本月暂无支出</span>';
        const body = root.querySelector('#p-fin');
        if (body) body.innerHTML = `<div class="bars">${bars}</div><div class="muted" style="margin-top:8px;font-size:13px">收入 ${inc.toFixed(2)} · 支出 ${exp.toFixed(2)} · 结余 ${(inc - exp).toFixed(2)}</div>`;
        const se = root.querySelector('#stat-balance'); if (se) se.textContent = (inc - exp).toFixed(2);
        return;
      }
      if (name === 'content') {
        const allC = (await store.getAll('content')).filter(i => !i._deleted);
        const cs = { idea: 0, draft: 0, review: 0, published: 0 };
        allC.forEach(c => { cs[c.status] = (cs[c.status] || 0) + 1; });
        const body = root.querySelector('#p-content');
        if (body) body.innerHTML = `<div class="chips">
          <span class="chip">💡 灵感 ${cs.idea}</span>
          <span class="chip">✍️ 草稿 ${cs.draft}</span>
          <span class="chip">👀 待审 ${cs.review}</span>
          <span class="chip">✅ 已发布 ${cs.published}</span>
        </div>`;
        return;
      }
      if (name === 'planning') {
        const allP = (await store.getAll('planning')).filter(i => !i._deleted);
        const goals = allP.filter(p => p.type === 'goal' && p.status !== 'done').length;
        const ms = allP.filter(p => p.type === 'milestone' && p.status !== 'done' && p.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
        const body = root.querySelector('#p-planning');
        if (body) body.innerHTML = `<div class="muted" style="font-size:14px">进行中目标 <b>${goals}</b>${ms ? ' · 最近里程碑：' + ui.escapeHtml(ms.title) + '（' + ui.escapeHtml(ms.dueDate) + '）' : ''}</div>`;
        return;
      }
      if (name === 'notes') {
        const allN = (await store.getAll('notes')).filter(i => !i._deleted).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 3);
        const body = root.querySelector('#p-notes');
        if (body) body.innerHTML = allN.length ? allN.map(n => `<div class="card note-mini" data-go="notes"><div class="nm-title">${ui.escapeHtml(n.title || '无标题')}</div><div class="muted" style="font-size:12px">${ui.fmtRelative(n.updatedAt)}</div></div>`).join('') : ui.emptyState('暂无笔记');
        return;
      }
      if (name === 'bookmarks') {
        const allB = (await store.getAll('bookmarks')).filter(i => !i._deleted).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 3);
        const body = root.querySelector('#p-bookmarks');
        if (body) body.innerHTML = allB.length ? allB.map(b => `<a class="card bm-mini" href="${ui.escapeHtml(b.url)}" target="_blank" rel="noopener"><div class="bm-mini-title">${ui.escapeHtml(b.title)}</div><div class="muted" style="font-size:12px">${ui.escapeHtml(b.category || '未分类')}</div></a>`).join('') : ui.emptyState('暂无书签');
        return;
      }
    }
    ['tasks', 'habits', 'habitlogs', 'finance', 'content', 'planning', 'notes', 'bookmarks'].forEach(name => store.subscribe(name, () => liveRepaint(name)));
  }

  WB.modules.unshift({ id: 'today', title: '今日', icon: 'home', render });
})(window.WB = window.WB || {});
