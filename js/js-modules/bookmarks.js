// module: bookmarks 书签/链接
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui;
  const BM_AI_SYSTEM = '你是书签整理助手。根据用户给出的网页链接 URL 和标题，生成：summary（一句话中文摘要，不超过 40 字）、tags（2-4 个中文标签数组，用于分类检索）。只输出 JSON（不要解释、不要代码块）。示例：输入 URL「https://example.com/ai」标题「AI 入门」→{"summary":"介绍人工智能基础概念的入门文章","tags":["AI","学习","教程"]}。';

  function formFields(b) {
    b = b || {};
    return [
      { name: 'title', label: '标题', value: b.title || '', placeholder: '网站名称', required: true },
      { name: 'url', label: '链接', value: b.url || '', placeholder: 'https://...' },
      { name: 'cat', label: '分类', value: b.category || '', placeholder: '如：工具 / 阅读' },
      { name: 'note', label: '备注', type: 'textarea', value: b.note || '' }
    ];
  }

  async function render(root) {
    let all = (await store.getAll('bookmarks')).filter(i => !i._deleted).sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.title.localeCompare(b.title));
    const cats = ['全部', ...Array.from(new Set(all.map(i => i.category || '未分类')))];
    root.innerHTML = `
      <div class="page">
        ${ui.pageHead('bookmark', '书签 / 链接', { actions: '<button class="btn primary" id="add">+ 新建</button>' })}
        <div class="filters" id="filters">${cats.map(c => `<button class="chip" data-c="${ui.escapeHtml(c)}">${ui.escapeHtml(c)}</button>`).join('')}</div>
        <div id="list" class="grid cards-grid"></div>
      </div>`;
    const list = root.querySelector('#list');
    function paint(cat) {
      const view = cat === '全部' ? all : all.filter(i => (i.category || '未分类') === cat);
      if (!view.length) { list.innerHTML = ui.emptyState('暂无书签', { action: { label: '新建书签' } }); bindEmpty(); return; }
      list.innerHTML = view.map(b => `
        <div class="card bm" data-id="${b.id}">
          <div class="bm-fav">${ui.escapeHtml((b.title || '?').slice(0, 1))}</div>
          <div class="bm-main">
            <a class="bm-title" href="${ui.escapeHtml(b.url)}" target="_blank" rel="noopener">${ui.escapeHtml(b.title)}</a>
            <div class="bm-meta"><span class="tag">${ui.escapeHtml(b.category || '未分类')}</span>${b.note ? '<span class="muted">' + ui.escapeHtml(b.note) + '</span>' : ''}</div>
          </div>
          <div class="row-actions">
            <button class="icon-btn edit" title="编辑">${ui.icon('pencil', 16)}</button>
            <button class="icon-btn del" title="删除">${ui.icon('trash', 16)}</button>
          </div>
        </div>      `).join('');
      bindEmpty();
    }
    function bindEmpty() {
      const ea = list.querySelector('#empty-add');
      if (ea) ea.onclick = () => openForm(null);
    }
    paint('全部');
    async function refresh() { all = (await store.getAll('bookmarks')).filter(i => !i._deleted).sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.title.localeCompare(b.title)); paint(); }
    root.querySelector('#filters').addEventListener('click', e => {
      if (!e.target.dataset.c) return;
      root.querySelectorAll('#filters .chip').forEach(c => c.classList.remove('active'));
      e.target.classList.add('active'); paint(e.target.dataset.c);
    });

    function openForm(b) {
      const m = ui.openModal({
        title: b ? '编辑书签' : '新建书签',
        html: ui.form(formFields(b)) +
          '<div class="ai-bar"><button type="button" class="btn ghost sm" id="ai-bm">✨ AI 摘要+标签</button></div>' +
          '<div class="hint muted">填好标题/链接后点此，AI 自动生成一句话摘要并建议分类标签。</div>',
        actions: [
          { label: '取消' },
          { label: '保存', primary: true, onClick: async (close) => {
            const title = m.dialog.querySelector('#f-title').value.trim();
            let url = m.dialog.querySelector('#f-url').value.trim();
            if (!title) { ui.toast('请填写标题', 'warn'); return; }
            if (url && !/^https?:\/\//.test(url)) url = 'https://' + url;
            const obj = b ? Object.assign({}, b) : { id: store.uid() };
            obj.title = title; obj.url = url; obj.category = m.dialog.querySelector('#f-cat').value.trim();
            obj.note = m.dialog.querySelector('#f-note').value;
            await store.put('bookmarks', obj); close(); await refresh();
          } }
        ]
      });
      ui.bindFormValidation(m.dialog);
      m.dialog.querySelector('#ai-bm').onclick = async () => {
        const url = m.dialog.querySelector('#f-url').value.trim();
        const title = m.dialog.querySelector('#f-title').value.trim();
        if (!title && !url) { ui.toast('请先填写标题或链接', 'warn'); return; }
        if (!(await WB.ai.isConfigured())) { ui.toast('请先到「设置 → AI 助手」配置 API Key', 'warn'); setTimeout(() => { location.hash = '#/settings'; }, 400); return; }
        const btn = m.dialog.querySelector('#ai-bm');
        const old = btn.textContent; btn.disabled = true; btn.textContent = '生成中…';
        try {
          const parsed = WB.ai.parseJSON(await WB.ai.ask(BM_AI_SYSTEM, 'URL：' + (url || '（无）') + '\n标题：' + (title || '（无）')));
          if (parsed) {
            const tags = Array.isArray(parsed.tags) ? parsed.tags.filter(Boolean) : [];
            m.dialog.querySelector('#f-note').value = (parsed.summary || '') + (tags.length ? '  #' + tags.join(' #') : '');
            if (tags.length && !m.dialog.querySelector('#f-cat').value.trim()) m.dialog.querySelector('#f-cat').value = tags[0];
            ui.toast('已生成摘要与标签，请确认');
          } else { ui.toast('AI 返回格式异常，请重试', 'warn'); }
        } catch (e) { ui.toast('AI 生成失败：' + e.message, 'error'); }
        finally { btn.disabled = false; btn.textContent = old; }
      };
      setTimeout(() => m.dialog.querySelector('#f-title').focus(), 50);
    }
    root.querySelector('#add').onclick = () => openForm(null);
    list.addEventListener('click', async e => {
      if (e.target.closest('a')) return; // 链接本身打开
      const card = e.target.closest('.card'); if (!card) return;
      const id = card.dataset.id;
      if (e.target.closest('.icon-btn.edit')) { openForm(await store.get('bookmarks', id)); return; }
      if (e.target.closest('.icon-btn.del')) {
        if (await ui.confirm({ title: '删除书签', message: '确定删除这个书签吗？删除后可在提示中撤销。', confirmLabel: '删除', danger: true })) {
          ui.trash('bookmarks', id, { label: '已删除书签', repaint: refresh });
        }
      }
    });
  }

  WB.modules.push({ id: 'bookmarks', title: '书签', icon: 'bookmark', render });
})(window.WB = window.WB || {});
