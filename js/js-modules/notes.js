// module: notes 笔记与知识库（含笔记/私有知识库/时间轴记事本/自媒体灵感库）
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui;
  const TYPES = { note: '笔记', knowledge: '知识库', timeline: '时间轴', idea: '灵感' };
  const SUMMARY_SYSTEM = '你是一个简洁的中文摘要助手。把用户给出的笔记内容压缩成 3-5 条要点摘要，使用中文，保留关键信息，不要发挥。';
  const TITLE_SYSTEM = '你是一个中文笔记标题生成助手。根据用户给出的笔记内容，生成一句简洁、准确的标题（不超过 20 个汉字），直接返回标题本身，不要解释，不要加引号、书名号或序号。';
  const TAGS_SYSTEM = '你是一个中文笔记标签助手。根据用户给出的笔记标题和内容，提炼 3-5 个简短标签（每个 2-6 个汉字或英文单词），用中文逗号分隔返回，不要解释、不要加序号或符号。';

  // 调用 AI 生成摘要并持久化到笔记记录的 summary 字段（自动生成 + 落库，查看时直接展示）
  async function generateAndSaveSummary(id, body) {
    let text;
    try {
      text = await WB.ai.ask(SUMMARY_SYSTEM, '请摘要以下内容：\n\n' + body);
    } catch (e) {
      ui.toast('AI 摘要生成失败：' + (e && e.message ? e.message : e), 'warn');
      return;
    }
    const rec = await store.get('notes', id);
    if (!rec || rec._deleted) return; // 可能已被删除
    rec.summary = text;
    await store.put('notes', rec);
    return text;
  }

  // 标题为空时，AI 自动生成并保存
  async function genTitle(id, body) {
    let text;
    try { text = await WB.ai.ask(TITLE_SYSTEM, body); }
    catch (e) { ui.toast('AI 标题生成失败：' + (e && e.message ? e.message : e), 'warn'); return; }
    text = (text || '').trim().replace(/^["'「『]|["'」』]$/g, '').slice(0, 40) || '未命名笔记';
    const rec = await store.get('notes', id);
    if (!rec || rec._deleted) return;
    rec.title = text;
    await store.put('notes', rec);
  }

  // 标签为空时，AI 自动生成并保存
  async function genTags(id, body, title) {
    let text;
    try { text = await WB.ai.ask(TAGS_SYSTEM, '标题：' + (title || '') + '\n内容：' + body); }
    catch (e) { ui.toast('AI 标签生成失败：' + (e && e.message ? e.message : e), 'warn'); return; }
    const tags = (text || '').split(/[,，\s]+/).map(s => s.replace(/^[#\-*、•·]+/, '').trim()).filter(Boolean).slice(0, 6);
    const rec = await store.get('notes', id);
    if (!rec || rec._deleted) return;
    rec.tags = tags;
    await store.put('notes', rec);
  }

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
      { name: 'title', label: '标题（可空，保存后由 AI 自动生成）', value: n.title || '', placeholder: '标题（留空则由 AI 生成）', flex: 2 },
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
        const summ = n.summary ? `<div class="note-sum muted">✨ ${highlight(ui.escapeHtml(n.summary), raw)}</div>` : '';
        return `
          <div class="card note" data-id="${n.id}">
            <div class="note-main">
              <div class="note-title">${highlight(n.title || '无标题', raw)}</div>
              <div class="note-meta"><span class="badge">${TYPES[n.type] || '笔记'}</span>${tags}<span class="muted">${ui.fmtRelative(n.updatedAt)}</span></div>
              ${summ}
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
      let pendingScript = (n && n.script) || '';
      const m = ui.openModal({
        title: n ? '编辑' : '新建笔记',
        html: ui.form(formFields(n)) +
          '<div class="ai-bar"><button type="button" class="btn ghost sm" id="ai-script">✨ 改写口播稿</button></div>' +
          '<div class="hint muted">保存后若已配置 AI：未填标题会自动生成标题、未填标签会自动生成标签，并自动生成摘要，稍后查看即可看到。正文为纯文本，所见即所得。</div>' +
          '<div class="note-editor">' +
            '<textarea id="f-body" class="input" rows="14" placeholder="写点什么…（纯文本，所见即所得）">' + ui.escapeHtml((n && n.body) || '') + '</textarea>' +
            '<div id="f-script-out" class="script-out"' + (pendingScript ? '' : ' style="display:none"') + '>' +
              '<div class="script-out-head"><span>✨ AI 口播稿</span><button type="button" class="btn ghost sm" id="f-script-copy">复制</button></div>' +
              '<div class="script-out-body" id="f-script-body">' + ui.escapeHtml(pendingScript) + '</div>' +
            '</div>' +
          '</div>',
        actions: [
          { label: '取消' },
          { label: '保存', primary: true, onClick: async (close) => {
            const obj = n ? Object.assign({}, n) : { id: store.uid(), createdAt: Date.now() };
            obj.title = m.dialog.querySelector('#f-title').value.trim();
            obj.type = m.dialog.querySelector('#f-type').value;
            const tagVal = m.dialog.querySelector('#f-tags').value.trim();
            obj.tags = tagVal ? tagVal.split(',').map(s => s.trim()).filter(Boolean) : [];
            obj.body = m.dialog.querySelector('#f-body').value;
            obj.script = pendingScript;
            const hadTitle = !!obj.title, hadTags = obj.tags.length > 0;
            await store.put('notes', obj); close(); await refresh();
            // 后台 AI 自动补全：仅当已配置 AI 且对应字段缺失 / 无摘要时（顺序执行避免同一记录并发写入互相覆盖）
            if (obj.body.trim() && WB.ai.isConfigured()) {
              const id = obj.id;
              ui.toast('AI 正在补全标题 / 标签 / 摘要…');
              (async () => {
                if (!hadTitle) await genTitle(id, obj.body);
                if (!hadTags) await genTags(id, obj.body, obj.title);
                if (!obj.summary) await generateAndSaveSummary(id, obj.body);
                refresh();
              })();
            }
          } }
        ]
      });
      if (!n) m.dialog.classList.add('modal-full'); // 新建笔记铺满屏幕，正文输入框尽量大
      const ta = m.dialog.querySelector('#f-body');
      ui.bindFormValidation(m.dialog);
      m.dialog.querySelector('#ai-script').onclick = () => {
        const src = ta.value.trim();
        if (!src) { ui.toast('请先写点内容', 'warn'); return; }
        WB.ai.assistModal({
          title: 'AI 改写口播稿',
          system: '你是一个自媒体口播稿改写助手。把用户给出的内容改写成适合念出来的口播稿：口语化、有开头钩子和结尾引导，分段清晰，中文。',
          user: '请把以下内容改写成口播稿：\n\n' + src,
          adoptLabel: '采用口播稿',
          onAdopt: (txt) => {
            pendingScript = txt;
            const box = m.dialog.querySelector('#f-script-out');
            box.style.display = '';
            m.dialog.querySelector('#f-script-body').textContent = txt;
            ui.toast('已生成口播稿（原文已保留，见下方）');
          }
        });
      };
      const copyBtn = m.dialog.querySelector('#f-script-copy');
      if (copyBtn) copyBtn.onclick = () => {
        if (pendingScript) { if (navigator.clipboard) navigator.clipboard.writeText(pendingScript); ui.toast('已复制口播稿'); }
      };
      setTimeout(() => m.dialog.querySelector('#f-title').focus(), 50);
    }
    function openView(n) {
      if (!n) return;
      const tags = (n.tags || []).map(x => `<span class="tag">${ui.escapeHtml(x)}</span>`).join(' ');
      const m = ui.openModal({
        title: ui.escapeHtml(n.title || '无标题'),
        html: `
          <div class="note-view">
            <div class="note-view-meta">
              <span class="badge">${TYPES[n.type] || '笔记'}</span>
              ${tags ? '<span class="note-tags">' + tags + '</span>' : ''}
              <span class="muted">${ui.fmtRelative(n.updatedAt)}</span>
            </div>
            <div class="note-summary" id="summary-box"${n.summary ? '' : ' style="display:none"'}>
              <div class="note-summary-head"><span class="spark">✨</span> AI 摘要</div>
              <div class="note-summary-body">${n.summary ? ui.escapeHtml(n.summary) : ''}</div>
            </div>
            <div class="note-view-body">${ui.escapeHtml(n.body || '')}</div>
            ${n.script ? '<div class="note-script"><div class="note-script-head">✨ AI 口播稿</div><div class="note-script-body">' + ui.escapeHtml(n.script) + '</div></div>' : ''}
          </div>`,
        actions: [
          { label: '关闭' },
          { label: n.summary ? '重新生成摘要' : '✨ 生成摘要', onClick: () => {
            const src = (n && n.body) || '';
            if (!src.trim()) { ui.toast('笔记内容为空', 'warn'); return false; }
            ui.toast('正在生成 AI 摘要…');
            generateAndSaveSummary(n.id, src).then(text => {
              if (!text) return;
              n.summary = text;
              const box = m.dialog.querySelector('#summary-box');
              if (box) {
                box.style.display = '';
                box.querySelector('.note-summary-body').textContent = text;
              }
              refresh();
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
