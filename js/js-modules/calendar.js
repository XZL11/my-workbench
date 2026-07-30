// module: calendar 日程安排（月视图）
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui;
  const WK = ['日', '一', '二', '三', '四', '五', '六'];
  let view = new Date(); view.setDate(1);

  function ym(d) { return d.getFullYear() + '-' + (d.getMonth() + 1); }
  function sameDay(a, b) { return ui.fmtDate(a) === ui.fmtDate(b); }

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

  async function render(root) {
    let events = (await store.getAll('calendar')).filter(i => !i._deleted);
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
      </div>`;
    const grid = root.querySelector('#grid');
    const titleEl = root.querySelector('#cal-title');

    function paint() {
      titleEl.textContent = view.getFullYear() + ' 年 ' + (view.getMonth() + 1) + ' 月';
      const y = view.getFullYear(), m = view.getMonth();
      const first = new Date(y, m, 1);
      const startPad = first.getDay();
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const cells = [];
      // 补齐上月
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
          await store.put('calendar', obj); close(); WB.app.reload();
        } }]
      });
      setTimeout(() => m.dialog.querySelector('#f-title').focus(), 50);
    }
    root.querySelector('#add').onclick = () => openForm(null, ui.fmtDate(view));
    grid.addEventListener('click', async e => {
      const ev = e.target.closest('.cal-ev');
      if (ev) { openForm(await store.get('calendar', ev.dataset.id)); return; }
      const cell = e.target.closest('.cal-cell');
      if (cell) {
        if (e.target.classList.contains('cal-num') || e.target.classList.contains('cal-cell')) {
          openForm(null, cell.dataset.date);
        }
      }
    });
  }

  WB.modules.push({ id: 'calendar', title: '日程', icon: '📅', render });
})(window.WB = window.WB || {});
