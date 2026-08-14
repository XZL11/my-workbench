// module: notes 笔记与知识库（含笔记/私有知识库/时间轴记事本/自媒体灵感库）
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui;
  const TYPES = { note: '笔记', knowledge: '知识库', timeline: '时间轴', idea: '灵感' };

  function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function highlight(text, q) {
    const esc = ui.escapeHtml(text || '');
    if (!q) return esc;
    try {
      const re = new RegExp('(' + escapeReg(q) + ')', 'gi');
      return esc.replace(re, '<mark>$1</mark>');
    } catch (e) { return esc; }
  }
  function snippet(body, q) {
    const plain = (body || '').replace(/[#*`>\[\]()_~]/g, '');
    if (!q) return plain.slice(0, 90);
    const idx = plain.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return plain.slice(0, 90);
    const start = Math.max(0, idx - 30);
    const end = Math.min(plain.length, idx + q.length + 60);
    return (start > 0 ? '…' : '') + plain.slice(start, end) + (end < plain.length ? '…' : '');
  }

  function formFields(n) {
    n = n || {};
    return [
      { name: 'title', label: '标题', value: n.title || '', placeholder: '标题', required: true, flex: 2 },
      { name: 'type', label: '类型', type: 'select', value: n.type, flex: 1, row: 'a', options: Object.keys(TYPES).map(k => ({ value: k, label: TYPES[k] })) },
      { name: 'tags', label: '标签（逗号分隔）', value: (n.tags || []).join(', '), placeholder: '标签' }
    ];
  }

  async function render(root) {
    let all = (await store.getAll('notes')).filter(i => !i._deleted);
    root.innerHTML = `
      <div class="page">
        ${ui.pageHead('note', '笔记与知识库', { actions: '<button class="btn primary" id="add">+ 新建</button>' })}
        <div class="toolbar">
          <input id="search" class="input" placeholder="🔍 搜索标题 / 内容 / 标签">
          <select id="typefilter" class="input">
            <option value="all">全部类型</option>
            ${Object.keys(TYPES).map(k => `<option value="${k}">${TYPES[k]}</option>`).join('')}
          </select>
        </div>
        <div id="list" class="list"></div>
      </div>`;
    const list = root.querySelector('#list');
    function paint() {
      const raw = root.querySelector('#search').value.trim();
      const q = raw.toLowerCase();
      const tf = root.querySelector('#typefilter').value;
      let view = all;
      if (tf !== 'all') view = view.filter(i => i.type === tf);
      if (q) view = view.filter(i => (i.title + ' ' + (i.body || '') + ' ' + (i.tags || []).join(' ')).toLowerCase().includes(q));
      view = view.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      if (!view.length) { list.innerHTML = ui.emptyState('没有匹配的笔记', { action: { label: '新建笔记' } }); bindEmpty(); return; }
      list.innerHTML = view.map(n => {
        const tags = (n.tags || []).map(x => `<span class="tag">${ui.escapeHtml(x)}</span>`).join('');
        const prev = snippet(n.body, raw);
        return `
          <div class="card note" data-id="${n.id}">
            <div class="note-main">
              <div class="note-title">${highlight(n.title || '无标题', raw)}</div>
              <div class="note-meta"><span class="badge">${TYPES[n.type] || '笔记'}</span>${tags}<span class="muted">${ui.fmtRelative(n.updatedAt)}</span></div>
              <div class="note-prev muted">${highlight(prev, raw)}</div>
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
      const ea = list.querySelector('#empty-add');
      if (ea) ea.onclick = () => openForm(null);
    }
    paint();
    async function refresh() { all = (await store.getAll('notes')).filter(i => !i._deleted); paint(); }
    root.querySelector('#search').addEventListener('input', paint);
    root.querySelector('#typefilter').addEventListener('change', paint);

    function openForm(n) {
      const m = ui.openModal({
        title: n ? '编辑' : '新建笔记',
        html: ui.form(formFields(n)) + '<div class="ai-bar"><button type="button" class="btn ghost sm" id="ai-sum">✨ AI 摘要</button><button type="button" class="btn ghost sm" id="ai-script">✨ 改写口播稿</button></div><div class="editor"><textarea id="f-body" class="input" rows="10" placeholder="支持 Markdown：**粗体**、*斜体*、# 标题、- 列表、[链接](url)">' + ui.escapeHtml((n && n.body) || '') + '</textarea><div id="f-preview" class="preview md"></div></div>',
        actions: [
          { label: '取消' },
          { label: '保存', primary: true, onClick: async (close) => {
            const title = m.dialog.querySelector('#f-title').value.trim();
            if (!title) { ui.toast('请填写标题', 'warn'); return; }
            const obj = n ? Object.assign({}, n) : { id: store.uid(), createdAt: Date.now() };
            obj.title = title;
            obj.type = m.dialog.querySelector('#f-type').value;
            obj.tags = m.dialog.querySelector('#f-tags').value.split(',').map(s => s.trim()).filter(Boolean);
            obj.body = m.dialog.querySelector('#f-body').value;
            await store.put('notes', obj); close(); await refresh();
          } }
        ]
      });
      const ta = m.dialog.querySelector('#f-body');
      const pv = m.dialog.querySelector('#f-preview');
      const upd = () => { pv.innerHTML = ui.mdLite(ta.value); };
      ta.addEventListener('input', upd); upd();
      ui.bindFormValidation(m.dialog);
      m.dialog.querySelector('#ai-sum').onclick = () => {
        const src = ta.value.trim();
        if (!src) { ui.toast('请先写点内容再摘要', 'warn'); return; }
        WB.ai.assistModal({
          title: 'AI 摘要',
          system: '你是一个简洁的中文摘要助手。把用户给出的笔记内容压缩成 3-5 条要点摘要，使用中文，保留关键信息，不要发挥。',
          user: '请摘要以下内容：\n\n' + src,
          adoptLabel: '替换正文',
          onAdopt: (txt) => { ta.value = txt; upd(); ui.toast('已替换为摘要'); }
        });
      };
      m.dialog.querySelector('#ai-script').onclick = () => {
        const src = ta.value.trim();
        if (!src) { ui.toast('请先写点内容', 'warn'); return; }
        WB.ai.assistModal({
          title: 'AI 改写口播稿',
          system: '你是一个自媒体口播稿改写助手。把用户给出的内容改写成适合念出来的口播稿：口语化、有开头钩子和结尾引导，分段清晰，中文。',
          user: '请把以下内容改写成口播稿：\n\n' + src,
          adoptLabel: '替换正文',
          onAdopt: (txt) => { ta.value = txt; upd(); ui.toast('已替换为口播稿'); }
        });
      };
      setTimeout(() => m.dialog.querySelector('#f-title').focus(), 50);
    }
    function openView(n) {
      if (!n) return;
      const tags = (n.tags || []).map(x => `<span class="tag">${ui.escapeHtml(x)}</span>`).join(' ');
      ui.openModal({
        title: ui.escapeHtml(n.title || '无标题'),
        html: `
          <div class="note-view">
            <div class="note-view-meta">
              <span class="badge">${TYPES[n.type] || '笔记'}</span>
              ${tags ? '<span class="note-tags">' + tags + '</span>' : ''}
              <span class="muted">${ui.fmtRelative(n.updatedAt)}</span>
            </div>
            <div class="note-view-body md">${ui.mdLite(n.body || '')}</div>
          </div>`,
        actions: [
          { label: '关闭' },
          { label: '✨ AI 摘要', onClick: () => {
            const src = (n && n.body) || '';
            if (!src.trim()) { ui.toast('笔记内容为空', 'warn'); return false; }
            WB.ai.assistModal({
              title: 'AI 摘要：' + (n.title || ''),
              system: '你是一个简洁的中文摘要助手。把用户给出的笔记内容压缩成 3-5 条要点摘要，使用中文，保留关键信息，不要发挥。',
              user: '请摘要以下内容：\n\n' + src
            });
            return false; // 保持查看弹窗打开
          } },
          { label: '编辑', primary: true, onClick: (close) => { close(); openForm(n); } }
        ]
      });
    }
    root.querySelector('#add').onclick = () => openForm(null);
    list.addEventListener('click', async e => {
      const card = e.target.closest('.card'); if (!card) return;
      const id = card.dataset.id;
      const note = await store.get('notes', id);
      if (e.target.closest('.icon-btn.del')) {
        if (await ui.confirm({ title: '删除笔记', message: '确定删除这条笔记吗？删除后可在提示中撤销。', confirmLabel: '删除', danger: true })) {
          ui.trash('notes', id, { label: '已删除笔记', repaint: refresh });
        }
        return;
      }
      if (e.target.closest('.icon-btn.edit')) { openForm(note); return; }
      openView(note);
    });
  }

  WB.modules.push({ id: 'notes', title: '笔记', icon: 'note', render });
})(window.WB = window.WB || {});
