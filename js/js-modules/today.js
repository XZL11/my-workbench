// module: today 今日聚合视图（今天待办 + 今天日程）
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui;
  const PRI = { 1: '高', 2: '中', 3: '低' };

  async function render(root) {
    const todayKey = ui.fmtDate(Date.now());
    const tasks = (await store.getAll('tasks')).filter(i => !i._deleted);
    const events = (await store.getAll('calendar')).filter(i => !i._deleted && i.startDate === todayKey);

    const dueToday = tasks.filter(t => !t.done && t.dueDate === todayKey);
    const overdue = tasks.filter(t => !t.done && t.dueDate && t.dueDate < todayKey);
    const todo = overdue.concat(dueToday).sort((a, b) => (a.priority - b.priority) || (a.dueDate || '').localeCompare(b.dueDate || ''));
    const evSorted = events.slice().sort((a, b) => (a.startTime || '23:59').localeCompare(b.startTime || '23:59'));

    const d = new Date();
    const dateStr = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + '日一二三四五六'[d.getDay()];
    const h = d.getHours();
    const greet = h < 11 ? '早上好' : h < 18 ? '下午好' : '晚上好';

    root.innerHTML = `
      <div class="page">
        <div class="page-head">
          <div><h1>📌 今日</h1><div class="muted" style="font-size:13px">${greet}，${dateStr}</div></div>
        </div>
        <div class="stat-row">
          <div class="stat"><div class="stat-num">${todo.length}</div><div class="stat-label">待办（含逾期）</div></div>
          <div class="stat"><div class="stat-num">${evSorted.length}</div><div class="stat-label">今日日程</div></div>
          <div class="stat"><div class="stat-num ${overdue.length ? 'neg' : ''}">${overdue.length}</div><div class="stat-label">已逾期</div></div>
        </div>

        <section class="card section">
          <h2>⏰ 今日日程</h2>
          ${evSorted.length ? evSorted.map(e => `
            <div class="card ev" data-go="calendar">
              <div class="ev-time">${ui.escapeHtml(e.startTime || '全天')}</div>
              <div class="ev-main">
                <div class="ev-title">${ui.escapeHtml(e.title)}</div>
                ${e.location ? '<div class="muted">📍 ' + ui.escapeHtml(e.location) + '</div>' : ''}
              </div>
            </div>`).join('') : ui.emptyState('今天没有日程')}
        </section>

        <section class="card section">
          <h2>✅ 今日待办 / 逾期</h2>
          <div id="todolist">
            ${todo.length ? todo.map(t => `
              <div class="card task ${t.done ? 'done' : ''}" data-id="${t.id}">
                <input type="checkbox" class="chk" ${t.done ? 'checked' : ''}>
                <div class="task-main">
                  <div class="task-title">${ui.escapeHtml(t.title)}</div>
                  <div class="task-meta">
                    <span class="pri pri-${t.priority}">${PRI[t.priority] || '中'}</span>
                    ${t.dueDate < todayKey ? '<span class="due over">逾期 ' + ui.escapeHtml(t.dueDate) + '</span>'
                      : (t.dueDate ? '<span class="due">' + ui.escapeHtml(t.dueDate) + '</span>' : '<span class="muted">无截止日</span>')}
                  </div>
                </div>
              </div>`).join('') : ui.emptyState('今天没有待办，太棒了 🎉')}
          </div>
        </section>
      </div>`;

    // 勾选完成
    root.querySelector('#todolist').addEventListener('click', async e => {
      const card = e.target.closest('.card'); if (!card) return;
      const id = card.dataset.id;
      if (e.target.classList.contains('chk')) {
        const t = await store.get('tasks', id);
        t.done = e.target.checked; await store.put('tasks', t); WB.app.reload();
      }
    });
    // 点击日程跳转到日程页
    root.querySelectorAll('[data-go]').forEach(el => { el.onclick = () => { location.hash = '#/' + el.dataset.go; }; });
  }

  // 放到导航最前，作为首页
  WB.modules.unshift({ id: 'today', title: '今日', icon: '📌', render });
})(window.WB = window.WB || {});
