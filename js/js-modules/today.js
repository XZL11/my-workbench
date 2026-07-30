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
    const openTasks = overdue.concat(dueToday).sort((a, b) => (a.priority - b.priority) || (a.dueDate || '').localeCompare(b.dueDate || ''));
    const evSorted = events.slice().sort((a, b) => (a.startTime || '23:59').localeCompare(b.startTime || '23:59'));

    // 合并为单一时间线：无具体时间的待办在前（灵活），按时间排的日程在后
    const items = [];
    openTasks.forEach(t => items.push({ kind: 'task', ref: t }));
    evSorted.forEach(e => items.push({ kind: 'event', ref: e }));
    const total = items.length;

    const d = new Date();
    const dateStr = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + '日一二三四五六'[d.getDay()];
    const h = d.getHours();
    const greet = h < 11 ? '早上好' : h < 18 ? '下午好' : '晚上好';

    const rowHTML = it => {
      if (it.kind === 'task') {
        const t = it.ref;
        return `<div class="tl-item task ${t.done ? 'done' : ''}" data-id="${t.id}">
          <div class="tl-time">待定</div>
          <div class="tl-body">
            <div class="tl-title">${ui.escapeHtml(t.title)}</div>
            <div class="tl-meta"><span class="badge">✅ 待办</span><span class="pri pri-${t.priority}">${PRI[t.priority] || '中'}</span>${t.dueDate < todayKey ? '<span class="due over">逾期 ' + ui.escapeHtml(t.dueDate) + '</span>' : ''}</div>
          </div>
          <input type="checkbox" class="chk" ${t.done ? 'checked' : ''}>
        </div>`;
      }
      const e = it.ref;
      return `<div class="tl-item event" data-go="calendar">
        <div class="tl-time">${ui.escapeHtml(e.startTime || '全天')}</div>
        <div class="tl-body">
          <div class="tl-title">${ui.escapeHtml(e.title)}</div>
          <div class="tl-meta"><span class="badge">📅 日程</span>${e.location ? '<span class="muted">📍 ' + ui.escapeHtml(e.location) + '</span>' : ''}</div>
        </div>
        <span class="tl-go">›</span>
      </div>`;
    };

    root.innerHTML = `
      <div class="page">
        <div class="page-head">
          <div><h1>📌 今日</h1><div class="muted" style="font-size:13px">${greet}，${dateStr}</div></div>
        </div>
        <div class="stat-row">
          <div class="stat"><div class="stat-num">${total}</div><div class="stat-label">今日事项</div></div>
          <div class="stat"><div class="stat-num">${evSorted.length}</div><div class="stat-label">已排日程</div></div>
          <div class="stat"><div class="stat-num ${overdue.length ? 'neg' : ''}">${overdue.length}</div><div class="stat-label">已逾期</div></div>
        </div>

        <section class="card section">
          <h2>🗓️ 今日时间线</h2>
          <div id="timeline">
            ${total ? items.map(rowHTML).join('') : ui.emptyState('今天没有安排，享受当下吧 🌿')}
          </div>
        </section>
      </div>`;

    root.querySelector('#timeline').addEventListener('click', async e => {
      const item = e.target.closest('.tl-item'); if (!item) return;
      if (item.dataset.id) {
        if (e.target.classList.contains('chk')) {
          const t = await store.get('tasks', item.dataset.id);
          t.done = e.target.checked; await store.put('tasks', t); WB.app.reload();
        }
      } else if (item.dataset.go) {
        location.hash = '#/' + item.dataset.go;
      }
    });
  }

  // 放到导航最前，作为首页
  WB.modules.unshift({ id: 'today', title: '今日', icon: '📌', render });
})(window.WB = window.WB || {});
