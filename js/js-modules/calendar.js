// module: calendar 日程安排（月视图 + 日详情动画过渡）
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui;
  const WK = ['日', '一', '二', '三', '四', '五', '六'];
  const PRI = { 1: '高', 2: '中', 3: '低' };
  let view = new Date(); view.setDate(1);
  let events = []; // 缓存，避免每次重绘重新读库

  function weekdayCN(d) { const w = '日一二三四五六'; return '周' + w[new Date(d).getDay()]; }

  function formHTML(ev, defDate) {
    ev = ev || {};
    const d = ev.startDate || defDate || ui.fmtDate(Date.now());
    const t = ev.startTime || '';
    return `
      <div class="form">
        <label>标题<input id="f-title" class="input" value="${ui.escapeHtml(ev.title || '')}" placeholder="日程标题"></label>
        <div class="row">
          <label style="flex:1">日期<input id="f-date" class="input" type="date" value="${d}"></label>
          <label style="flex:1">时间<input id="f-time" class="input" type="time" value="${t}"></label>
        </div>
        <label>地点<input id="f-loc" class="input" value="${ui.escapeHtml(ev.location || '')}" placeholder="可选"></label>
        <label>备注<textarea id="f-note" class="input" rows="3">${ui.escapeHtml(ev.note || '')}</textarea></label>
      </div>`;
  }

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
    root.innerHTML = `
      <div class="page">
        <div class="page-head">
          <h1>📅 日程安排</h1>
          <button class="btn primary" id="add">+ 新建</button>
        </div>
        <div class="cal-nav">
          <button class="btn ghost" id="prev">‹</button>
          <button class="btn ghost" id="today">今天</button>
          <div class="cal-title" id="cal-title"></div>
          <button class="btn ghost" id="next">›</button>
        </div>
        <div class="cal-grid" id="grid"></div>
        <p class="muted" style="margin-top:10px;font-size:12px">提示：点击任意日期，可滑入查看并管理当天的日程、待办、习惯与记账。</p>
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
        const evs = events.filter(e => e.startDate === key).sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
        const evHtml = evs.map(e => `<div class="cal-ev" data-id="${e.id}">${e.startTime ? ui.escapeHtml(e.startTime) + ' ' : ''}${ui.escapeHtml(e.title)}</div>`).join('');
        return `<div class="cal-cell ${c.out ? 'out' : ''} ${key === todayKey ? 'today' : ''}" data-date="${key}">
          <div class="cal-num">${c.d.getDate()}</div>${evHtml}</div>`;
      }).join('');
      grid.innerHTML = html;
    }
    paint();

    root.querySelector('#prev').onclick = () => { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); paint(); };
    root.querySelector('#next').onclick = () => { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); paint(); };
    root.querySelector('#today').onclick = () => { view = new Date(); view.setDate(1); paint(); };

    function openForm(ev, defDate) {
      const m = ui.openModal({
        title: ev ? '编辑日程' : '新建日程', html: formHTML(ev, defDate),
        actions: [{ label: '取消' }, { label: '保存', primary: true, onClick: async (close) => {
          const title = m.dialog.querySelector('#f-title').value.trim();
          if (!title) { ui.toast('请填写标题', 'warn'); return; }
          const obj = ev ? Object.assign({}, ev) : { id: store.uid() };
          obj.title = title;
          obj.startDate = m.dialog.querySelector('#f-date').value;
          obj.startTime = m.dialog.querySelector('#f-time').value || '';
          obj.location = m.dialog.querySelector('#f-loc').value;
          obj.note = m.dialog.querySelector('#f-note').value;
          await store.put('calendar', obj);
          events = (await store.getAll('calendar')).filter(i => !i._deleted);
          close(); paint();
          if (dd.classList.contains('open')) paintDay(dd.dataset.key);
        } }]
      });
      setTimeout(() => m.dialog.querySelector('#f-title').focus(), 50);
    }

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
          if (dd.classList.contains('open')) paintDay(dd.dataset.key);
        } }]
      });
      if (!t) setTimeout(() => m.dialog.querySelector('#f-title').focus(), 50);
    }

    root.querySelector('#add').onclick = () => openForm(null, ui.fmtDate(Date.now()));

    grid.addEventListener('click', async e => {
      const evEl = e.target.closest('.cal-ev');
      if (evEl) { openForm(await store.get('calendar', evEl.dataset.id)); return; }
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
      const dayEvents = events.filter(e => e.startDate === dateKey).sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
      const tasks = (await store.getAll('tasks')).filter(i => !i._deleted && i.dueDate === dateKey);
      const habits = (await store.getAll('habits')).filter(i => !i._deleted);
      const logs = (await store.getAll('habitlogs')).filter(i => !i._deleted);
      const finance = (await store.getAll('finance')).filter(i => !i._deleted && (i.date || '') === dateKey);

      const logMap = {}; logs.forEach(l => { if (l && l.id) logMap[l.id] = l; });

      const evHTML = dayEvents.length ? dayEvents.map(e => `
        <div class="dd-item ev" data-id="${e.id}">
          <div class="dd-time">${e.startTime || '全天'}</div>
          <div class="dd-body"><div class="dd-title">${ui.escapeHtml(e.title)}</div>
          ${e.location ? `<div class="muted">📍 ${ui.escapeHtml(e.location)}</div>` : ''}
          ${e.note ? `<div class="dd-note">${ui.escapeHtml(e.note)}</div>` : ''}</div>
          <button class="icon-btn dd-edit" title="编辑">✏️</button>
        </div>`).join('') : ui.emptyState('这一天还没有日程');

      const todoHTML = tasks.length ? tasks.map(t => `
        <div class="dd-item todo ${t.done ? 'done' : ''}" data-id="${t.id}">
          <input type="checkbox" class="chk" ${t.done ? 'checked' : ''}>
          <div class="dd-body"><div class="dd-title">${ui.escapeHtml(t.title)}</div>
          <div class="task-meta"><span class="pri pri-${t.priority}">${PRI[t.priority] || '中'}</span></div></div>
        </div>`).join('') : ui.emptyState('这一天没有待办');

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
        <div class="dd-sec"><div class="dd-sec-head"><h2>📅 日程</h2><button class="btn ghost sm" data-add="ev">+ 日程</button></div><div id="dd-ev">${evHTML}</div></div>
        <div class="dd-sec"><div class="dd-sec-head"><h2>✅ 待办</h2><button class="btn ghost sm" data-add="task">+ 待办</button></div><div id="dd-task">${todoHTML}</div></div>
        <div class="dd-sec"><div class="dd-sec-head"><h2>🔥 习惯打卡</h2></div><div id="dd-habit">${habitHTML}</div></div>
        <div class="dd-sec"><div class="dd-sec-head"><h2>💰 记账</h2></div><div id="dd-fin">${finHTML}</div></div>`;
    }

    // 日详情内部交互（事件委托，仅绑定一次）
    dd.addEventListener('click', async e => {
      if (e.target.closest('.dd-back')) { closeDay(); return; }
      if (e.target.closest('[data-add="ev"]')) { openForm(null, dd.dataset.key); return; }
      if (e.target.closest('[data-add="task"]')) { openTaskForm(null, dd.dataset.key); return; }
      const evItem = e.target.closest('.dd-item.ev');
      if (evItem && (e.target.classList.contains('dd-edit') || e.target.closest('.dd-body'))) {
        openForm(await store.get('calendar', evItem.dataset.id)); return;
      }
      const todoItem = e.target.closest('.dd-item.todo');
      if (todoItem && e.target.classList.contains('chk')) {
        const t = await store.get('tasks', todoItem.dataset.id);
        t.done = e.target.checked; await store.put('tasks', t); paintDay(dd.dataset.key); return;
      }
      const habitBtn = e.target.closest('.habit-check');
      if (habitBtn) {
        const hid = habitBtn.dataset.id; const key = hid + ':' + dd.dataset.key;
        const rec = (await store.getAll('habitlogs')).find(l => l.id === key);
        const done = !(rec && rec.done);
        await store.put('habitlogs', { id: key, habitId: hid, date: dd.dataset.key, done, updatedAt: Date.now() });
        paintDay(dd.dataset.key); return;
      }
    });
  }

  WB.modules.push({ id: 'calendar', title: '日程', icon: '📅', render });
})(window.WB = window.WB || {});
