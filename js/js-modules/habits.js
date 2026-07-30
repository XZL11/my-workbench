// module: habits 习惯打卡
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui;

  function formHTML(h) {
    h = h || {};
    return `
      <div class="form">
        <div class="row">
          <label style="flex:1">图标<input id="f-emoji" class="input" value="${ui.escapeHtml(h.emoji || '⭐')}" maxlength="2"></label>
          <label style="flex:3">名称<input id="f-name" class="input" value="${ui.escapeHtml(h.name || '')}" placeholder="如：读书 30 分钟"></label>
        </div>
        <div class="row">
          <label style="flex:1">频率<select id="f-freq" class="input">
            <option value="daily" ${h.freq !== 'weekly' ? 'selected' : ''}>每天</option>
            <option value="weekly" ${h.freq === 'weekly' ? 'selected' : ''}>每周</option>
          </select></label>
          <label style="flex:1">目标/周<input id="f-target" class="input" type="number" min="1" value="${h.target || 7}"></label>
          <label style="flex:1">颜色<input id="f-color" class="input" type="color" value="${h.color || '#4f46e5'}"></label>
        </div>
      </div>`;
  }

  function lastNDays(n) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      out.push(ui.fmtDate(d.getTime()));
    }
    return out;
  }
  function streak(logMap) {
    let s = 0; const today = new Date();
    for (let i = 0; ; i++) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const k = ui.fmtDate(d.getTime());
      if (logMap[k] && logMap[k].done) s++; else break;
    }
    return s;
  }

  async function render(root) {
    const habits = (await store.getAll('habits')).filter(i => !i._deleted);
    const logs = (await store.getAll('habitlogs')).filter(i => !i._deleted);
    const logMap = {};
    logs.forEach(l => { logMap[l.habitId + ':' + l.date] = l; });
    const days = lastNDays(7);
    const todayKey = ui.fmtDate(Date.now());

    root.innerHTML = `
      <div class="page">
        <div class="page-head">
          <h1>🔥 习惯打卡</h1>
          <button class="btn primary" id="add">+ 新建</button>
        </div>
        <div id="list" class="list"></div>
      </div>`;
    const list = root.querySelector('#list');

    function paint() {
      if (!habits.length) { list.innerHTML = ui.emptyState('还没有习惯，点击新建开始坚持一件事'); return; }
      list.innerHTML = habits.map(h => {
        const doneToday = logMap[h.id + ':' + todayKey] && logMap[h.id + ':' + todayKey].done;
        const weekDone = days.filter(d => logMap[h.id + ':' + d] && logMap[h.id + ':' + d].done).length;
        const wk = h.freq === 'weekly' ? `<span class="muted">本周 ${weekDone}/${h.target || 7}</span>` : '';
        const week = days.map(d => {
          const on = logMap[h.id + ':' + d] && logMap[h.id + ':' + d].done;
          return `<span class="dot ${on ? 'on' : ''}" title="${d}"></span>`;
        }).join('');
        return `
          <div class="card habit" data-id="${h.id}" style="--hc:${ui.escapeHtml(h.color || '#4f46e5')}">
            <button class="habit-check ${doneToday ? 'on' : ''}" data-id="${h.id}">${h.emoji || '⭐'}</button>
            <div class="habit-main">
              <div class="habit-name">${ui.escapeHtml(h.name)}</div>
              <div class="habit-meta">🔥 连续 ${streak(logMapFor(h.id))} 天 ${wk}</div>
              <div class="week">${week}</div>
            </div>
            <div class="row-actions">
              <button class="icon-btn edit" title="编辑">✏️</button>
              <button class="icon-btn del" title="删除">🗑️</button>
            </div>
          </div>`;
      }).join('');
    }
    function logMapFor(hid) {
      const m = {};
      Object.keys(logMap).forEach(k => { if (k.startsWith(hid + ':')) m[k.split(':').slice(1).join(':')] = logMap[k]; });
      return m;
    }
    paint();

    async function toggle(id) {
      const key = id + ':' + todayKey;
      const existing = logMap[key];
      const done = !(existing && existing.done);
      await store.put('habitlogs', { id: key, habitId: id, date: todayKey, done, updatedAt: Date.now() });
      WB.app.reload();
    }
    list.addEventListener('click', async e => {
      const card = e.target.closest('.card'); if (!card) return;
      const id = card.dataset.id;
      if (e.target.classList.contains('habit-check')) { await toggle(id); return; }
      if (e.target.classList.contains('edit')) {
        const h = await store.get('habits', id);
        const m = ui.openModal({
          title: '编辑习惯', html: formHTML(h),
          actions: [{ label: '取消' }, { label: '保存', primary: true, onClick: async (close) => {
            const name = m.dialog.querySelector('#f-name').value.trim();
            if (!name) { ui.toast('请填写名称', 'warn'); return; }
            h.name = name; h.emoji = m.dialog.querySelector('#f-emoji').value || '⭐';
            h.freq = m.dialog.querySelector('#f-freq').value; h.target = parseInt(m.dialog.querySelector('#f-target').value, 10) || 7;
            h.color = m.dialog.querySelector('#f-color').value; await store.put('habits', h); close(); WB.app.reload();
          } }]
        });
        return;
      }
      if (e.target.classList.contains('del')) {
        if (await ui.confirm('删除该习惯？相关打卡记录也会删除。')) {
          await store.remove('habits', id);
          Object.keys(logMap).forEach(k => { if (k.startsWith(id + ':')) store.remove('habitlogs', k); });
          WB.app.reload();
        }
      }
    });

    root.querySelector('#add').onclick = () => {
      const m = ui.openModal({
        title: '新建习惯', html: formHTML(null),
        actions: [{ label: '取消' }, { label: '保存', primary: true, onClick: async (close) => {
          const name = m.dialog.querySelector('#f-name').value.trim();
          if (!name) { ui.toast('请填写名称', 'warn'); return; }
          const obj = { id: store.uid(), name, emoji: m.dialog.querySelector('#f-emoji').value || '⭐',
            freq: m.dialog.querySelector('#f-freq').value, target: parseInt(m.dialog.querySelector('#f-target').value, 10) || 7,
            color: m.dialog.querySelector('#f-color').value, createdAt: Date.now() };
          await store.put('habits', obj); close(); WB.app.reload();
        } }]
      });
    };
  }

  WB.modules.push({ id: 'habits', title: '习惯', icon: 'flame', render });
})(window.WB = window.WB || {});
