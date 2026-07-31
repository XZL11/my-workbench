// module: calendar 日程安排（月视图 + 日详情动画过渡）
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui;
  const WK = ['日', '一', '二', '三', '四', '五', '六'];
  const PRI = { 1: '高', 2: '中', 3: '低' };
  let view = new Date(); view.setDate(1);
  let events = []; // 缓存，避免每次重绘重新读库
  let tasks = [];  // 待办缓存（与日程统一展示）
  let habitList = [], logList = [], finList = []; // 日详情用缓存，避免每次打卡反复读库（M1）

  function weekdayCN(d) { const w = '日一二三四五六'; return '周' + w[new Date(d).getDay()]; }

  function taskFormHTML(t) {
    t = t || {};
    return `<div class="form">
      <label>标题<input id="f-title" class="input" value="${ui.escapeHtml(t.title || '')}" placeholder="待办标题"></label>
      <div class="row">
        <label style="flex:1">优先级<select id="f-priority" class="input">
          <option value="1" ${t.priority == 1 ? 'selected' : ''}>高</option>
          <option value="2" ${t.priority == 2 ? 'selected' : ''}>中</option>
          <option value="3" ${t.priority == 3 ? 'selected' : ''}>低</option></select></label>
      </div>
      <label>标签（逗号分隔）<input id="f-tags" class="input" value="${ui.escapeHtml((t.tags || []).join(', '))}" placeholder="工作, 紧急"></label>
      <label>备注<textarea id="f-note" class="input" rows="2">${ui.escapeHtml(t.note || '')}</textarea></label>
    </div>`;
  }

  async function render(root) {
    events = (await store.getAll('calendar')).filter(i => !i._deleted);
    tasks = (await store.getAll('tasks')).filter(i => !i._deleted);
    habitList = (await store.getAll('habits')).filter(i => !i._deleted);
    logList = (await store.getAll('habitlogs')).filter(i => !i._deleted);
    finList = (await store.getAll('finance')).filter(i => !i._deleted);

    // 数据逻辑统一：把遗留「日程事件」(calendar store) 一次性迁移为「待办」(tasks)，
    // 使"待办即日程"成为唯一真相源，消除双 store 不同步。迁移后原事件软删除（墓碑）。
    try {
      if ((await store.getMeta('migrated_calendar_to_tasks', 0)) !== 1) {
        store.setSuppressSync(true);
        try {
          for (const ev of events) {
            if (!ev || ev._deleted) continue;
            await store.put('tasks', {
              id: store.uid(),
              createdAt: ev.updatedAt || ev.createdAt || Date.now(),
              title: ev.title || '（无标题日程）',
              dueDate: ev.startDate || ui.fmtDate(Date.now()),
              priority: 2,
              tags: [],
              note: [ev.location ? '📍 ' + ev.location : '', ev.note || ''].filter(Boolean).join('\n'),
              migratedFrom: ev.id
            });
            await store.remove('calendar', ev.id);
          }
          await store.setMeta('migrated_calendar_to_tasks', 1);
        } finally {
          store.setSuppressSync(false);
        }
        events = (await store.getAll('calendar')).filter(i => !i._deleted);
        tasks = (await store.getAll('tasks')).filter(i => !i._deleted);
      }
    } catch (err) { console.warn('calendar→tasks 迁移跳过', err); }

    root.innerHTML = `
      <div class="page">
        <div class="page-head">
          <h1>📅 日程安排</h1>
          <button class="btn primary" id="add">+ 待办</button>
        </div>
        <div class="cal-nav">
          <button class="btn ghost" id="prev">‹</button>
          <button class="btn ghost" id="today">今天</button>
          <div class="cal-title" id="cal-title"></div>
          <button class="btn ghost" id="next">›</button>
        </div>
        <div class="cal-grid" id="grid"></div>
        <p class="muted" style="margin-top:10px;font-size:12px">提示：点击任意日期，可滑入查看并管理当天的待办、习惯与记账。</p>
      </div>
      <div class="day-detail" id="day">
        <div class="dd-head">
          <button class="icon-btn dd-back" title="返回">‹</button>
          <div class="dd-date" id="dd-date"></div>
        </div>
        <div class="dd-content" id="dd-content"></div>
      </div>`;
    const grid = root.querySelector('#grid');
    const titleEl = root.querySelector('#cal-title');
    const dd = root.querySelector('#day');
    const ddDate = root.querySelector('#dd-date');

    function paint() {
      titleEl.textContent = view.getFullYear() + ' 年 ' + (view.getMonth() + 1) + ' 月';
      const y = view.getFullYear(), m = view.getMonth();
      const first = new Date(y, m, 1);
      const startPad = first.getDay();
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const cells = [];
      for (let i = 0; i < startPad; i++) { const d = new Date(y, m, 1 - (startPad - i)); cells.push({ d, out: true }); }
      for (let i = 1; i <= daysInMonth; i++) cells.push({ d: new Date(y, m, i), out: false });
      while (cells.length % 7 !== 0) { const last = cells[cells.length - 1].d; cells.push({ d: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), out: true }); }

      const todayKey = ui.fmtDate(Date.now());
      let html = WK.map(w => `<div class="cal-wk">${w}</div>`).join('');
      html += cells.map(c => {
        const key = ui.fmtDate(c.d);
      const dayT = tasks.filter(t => t.dueDate === key);
      const taskHtml = dayT.map(t => `<div class="cal-ev todo pri-${t.priority} ${t.done ? 'done' : ''}">${ui.escapeHtml(t.title)}</div>`).join('');
      return `<div class="cal-cell ${c.out ? 'out' : ''} ${key === todayKey ? 'today' : ''}" data-date="${key}">
        <div class="cal-num">${c.d.getDate()}</div>${taskHtml}</div>`;
      }).join('');
      grid.innerHTML = html;
    }
    paint();

    root.querySelector('#prev').onclick = () => { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); paint(); };
    root.querySelector('#next').onclick = () => { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); paint(); };
    root.querySelector('#today').onclick = () => { view = new Date(); view.setDate(1); paint(); };

    function openTaskForm(t, dueDate) {
      const m = ui.openModal({
        title: t ? '编辑待办' : '新建待办', html: taskFormHTML(t),
        actions: [{ label: '取消' }, { label: '保存', primary: true, onClick: async (close) => {
          const title = m.dialog.querySelector('#f-title').value.trim();
          if (!title) { ui.toast('请填写标题', 'warn'); return; }
          const obj = t ? Object.assign({}, t) : { id: store.uid(), createdAt: Date.now() };
          obj.title = title;
          obj.priority = parseInt(m.dialog.querySelector('#f-priority').value, 10);
          obj.dueDate = dueDate || ui.fmtDate(Date.now());
          obj.tags = m.dialog.querySelector('#f-tags').value.split(',').map(s => s.trim()).filter(Boolean);
          obj.note = m.dialog.querySelector('#f-note').value;
          await store.put('tasks', obj); close();
          tasks = (await store.getAll('tasks')).filter(i => !i._deleted);
          paint();
          if (dd.classList.contains('open')) paintDay(dd.dataset.key);
        } }]
      });
      if (!t) setTimeout(() => m.dialog.querySelector('#f-title').focus(), 50);
    }

    root.querySelector('#add').onclick = () => openTaskForm(null, ui.fmtDate(Date.now()));

    grid.addEventListener('click', e => {
      const cell = e.target.closest('.cal-cell');
      if (cell) openDay(cell.dataset.date);
    });

    // ===== 日详情 =====
    function openDay(dateKey) {
      dd.dataset.key = dateKey;
      const d = new Date(dateKey + 'T00:00:00');
      ddDate.textContent = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 · ' + weekdayCN(d);
      dd.classList.add('open');
      paintDay(dateKey);
    }
    function closeDay() { dd.classList.remove('open'); }

    async function paintDay(dateKey) {
      const dayTasks = tasks.filter(i => !i._deleted && i.dueDate === dateKey);
      const habits = habitList;
      const logs = logList;
      const finance = finList.filter(i => (i.date || '') === dateKey);

      const logMap = {}; logs.forEach(l => { if (l && l.id) logMap[l.id] = l; });

      // 当日待办 = 当天待办（待办即日程：统一为 tasks 单一数据源，不再混入 legacy 事件）
      const dayHTML = dayTasks.length ? dayTasks.map(t => `
        <div class="dd-item todo ${t.done ? 'done' : ''}" data-id="${t.id}">
          <input type="checkbox" class="chk" ${t.done ? 'checked' : ''}>
          <div class="dd-body"><div class="dd-title">${ui.escapeHtml(t.title)}</div>
          <div class="task-meta"><span class="pri pri-${t.priority}">${PRI[t.priority] || '中'}</span></div></div>
        </div>`).join('') : ui.emptyState('这一天还没有待办');

      const habitHTML = habits.length ? habits.map(h => {
        const rec = logMap[h.id + ':' + dateKey]; const done = rec && rec.done;
        return `<div class="dd-item habit" data-id="${h.id}">
          <button class="habit-check ${done ? 'on' : ''}" data-id="${h.id}" style="--hc:${ui.escapeHtml(h.color || '#4f46e5')}">${ui.escapeHtml(h.emoji || '⭐')}</button>
          <div class="dd-body"><div class="dd-title">${ui.escapeHtml(h.name)}</div><div class="muted">${done ? '已打卡' : '点击打卡'}</div></div>
        </div>`;
      }).join('') : ui.emptyState('还没有习惯');

      const finHTML = finance.length ? finance.map(f => `
        <div class="dd-item fin">
          <div class="dd-time">${f.type === 'income' ? '收' : '支'}</div>
          <div class="dd-body"><div class="dd-title">${ui.escapeHtml(f.title || f.category || '未命名')}</div>
          ${f.category ? `<div class="muted">${ui.escapeHtml(f.category)}</div>` : ''}</div>
          <div class="fin-amt ${f.type}">${f.type === 'income' ? '+' : '-'}${(+f.amount || 0).toFixed(2)}</div>
        </div>`).join('') : ui.emptyState('这一天没有记账');

      root.querySelector('#dd-content').innerHTML = `
        <div class="dd-sec"><div class="dd-sec-head"><h2>📋 当日待办</h2><button class="btn ghost sm" data-add="task">+ 待办</button></div><div id="dd-task">${dayHTML}</div></div>
        <div class="dd-sec"><div class="dd-sec-head"><h2>🔥 习惯打卡</h2></div><div id="dd-habit">${habitHTML}</div></div>
        <div class="dd-sec"><div class="dd-sec-head"><h2>💰 记账</h2></div><div id="dd-fin">${finHTML}</div></div>`;
    }

    // 日详情内部交互（事件委托，仅绑定一次）
    dd.addEventListener('click', async e => {
      if (e.target.closest('.dd-back')) { closeDay(); return; }
      if (e.target.closest('[data-add="task"]')) { openTaskForm(null, dd.dataset.key); return; }
      const todoItem = e.target.closest('.dd-item.todo');
      if (todoItem && e.target.classList.contains('chk')) {
        const t = await store.get('tasks', todoItem.dataset.id);
        t.done = e.target.checked; await store.put('tasks', t); paintDay(dd.dataset.key); return;
      }
      const habitBtn = e.target.closest('.habit-check');
      if (habitBtn) {
        const hid = habitBtn.dataset.id; const key = hid + ':' + dd.dataset.key;
        const rec = logList.find(l => l.id === key);
        const done = !(rec && rec.done);
        const newRec = { id: key, habitId: hid, date: dd.dataset.key, done, updatedAt: Date.now() };
        await store.put('habitlogs', newRec);
        const idx = logList.findIndex(l => l.id === key);
        if (idx >= 0) logList[idx] = newRec; else logList.push(newRec);
        paintDay(dd.dataset.key); return;
      }
    });
  }

  WB.modules.push({ id: 'calendar', title: '日程', icon: 'calendar', render });
})(window.WB = window.WB || {});
