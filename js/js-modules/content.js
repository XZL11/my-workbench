// module: content 内容创作（含短视频脚本、公众号文章更新）
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui;
  const KIND = { shortvideo: '短视频脚本', article: '公众号文章' };
  const STATUS = { idea: '灵感', draft: '草稿', review: '待审', published: '已发布' };

  const DRAFT_SYSTEM = '你是一个自媒体内容创作助手。根据用户给出的标题、类型、平台和备注，生成一篇可直接使用的初稿。短视频脚本要口语化、有钩子和节奏；公众号文章要有清晰结构和干货。中文，直接给正文，不要解释、不要加标题。';
  const MULTI_SYSTEM = '你是一个多平台内容改写助手。把用户给出的内容改写成多种平台版本：①公众号长文（结构化、有干货）②抖音口播稿（口语化、有钩子/情绪/转化闭环）③小红书笔记（吸睛标题、分段、带 #标签）④微博短文（犀利、有话题）。用【公众号】、【抖音】、【小红书】、【微博】分节，每节直接给内容，不要解释。';
  const DIAGNOSE_SYSTEM = '你是一个爆款内容诊断师。针对用户给出的内容，从标题吸引力、开头钩子、价值密度、情绪共鸣、互动引导、平台适配几个维度给简短诊断：先说 1-2 个亮点，再给 3 条可落地的优化建议。中文，直接给，不要客套。';
  const HUMANIZE_SYSTEM = '你是一个文本润色助手。把用户给出的内容改写得更像人写的：去掉 AI 套话、过度排比和空泛结论，口语自然、有细节和观点，保持原意、长度大致相当。中文，直接给改写后的全文。';

  function formHTML(c) {
    c = c || {};
    return `
      <div class="form">
        <div class="row">
          <label style="flex:2">标题<input id="f-title" class="input" data-required value="${ui.escapeHtml(c.title || '')}" placeholder="标题"></label>
          <label style="flex:1">类型<select id="f-kind" class="input">
            ${Object.keys(KIND).map(k => `<option value="${k}" ${c.kind === k ? 'selected' : ''}>${KIND[k]}</option>`).join('')}
          </select></label>
        </div>
        <div class="row">
          <label style="flex:1">状态<select id="f-status" class="input">
            ${Object.keys(STATUS).map(s => `<option value="${s}" ${c.status === s ? 'selected' : ''}>${STATUS[s]}</option>`).join('')}
          </select></label>
          <label style="flex:1">平台<input id="f-platform" class="input" value="${ui.escapeHtml(c.platform || '')}" placeholder="如：抖音 / 公众号"></label>
        </div>
        <label>备注<input id="f-note" class="input" value="${ui.escapeHtml(c.note || '')}" placeholder="可选"></label>
        <div class="editor">
          <textarea id="f-body" class="input" rows="10" placeholder="正文 / 脚本内容，支持 Markdown">${ui.escapeHtml(c.body || '')}</textarea>
          <div id="f-preview" class="preview md"></div>
        </div>
      </div>
      <div class="ai-bar">
        <button type="button" class="btn ghost sm" id="ai-draft">✨ AI 生成草稿</button>
        <button type="button" class="btn ghost sm" id="ai-multi">✨ 多平台改写</button>
        <button type="button" class="btn ghost sm" id="ai-diagnose">✨ 爆款诊断</button>
        <button type="button" class="btn ghost sm" id="ai-humanize">✨ 去 AI 味</button>
      </div>
      <div class="hint muted">AI 基于你填的标题 / 类型 / 平台 / 正文生成；爆款诊断为启发式建议（非实时抓取数据）。需先在「设置 → AI 助手」配置密钥。</div>`;
  }

  async function render(root) {
    let all = (await store.getAll('content')).filter(i => !i._deleted);
    root.innerHTML = `
      <div class="page">
        ${ui.pageHead('pen', '内容创作', { actions: '<button class="btn primary" id="add">+ 新建</button>' })}
        <div class="toolbar">
          <select id="kfilter" class="input">
            <option value="all">全部类型</option>
            ${Object.keys(KIND).map(k => `<option value="${k}">${KIND[k]}</option>`).join('')}
          </select>
          <select id="sfilter" class="input">
            <option value="all">全部状态</option>
            ${Object.keys(STATUS).map(s => `<option value="${s}">${STATUS[s]}</option>`).join('')}
          </select>
        </div>
        <div class="content-ov" id="content-ov"></div>
        <div id="list" class="list"></div>
      </div>`;
    const list = root.querySelector('#list');
    function paint() {
      let view = all;
      const kf = root.querySelector('#kfilter').value, sf = root.querySelector('#sfilter').value;
      if (kf !== 'all') view = view.filter(i => i.kind === kf);
      if (sf !== 'all') view = view.filter(i => i.status === sf);
      view = view.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      const cnt = { idea: 0, draft: 0, review: 0, published: 0 };
      all.forEach(i => { if (cnt[i.status] != null) cnt[i.status]++; });
      root.querySelector('#content-ov').innerHTML = `
        <span class="ov-idea">灵感 <b>${cnt.idea}</b></span>
        <span class="ov-draft">草稿 <b>${cnt.draft}</b></span>
        <span class="ov-review">待审 <b>${cnt.review}</b></span>
        <span class="ov-published">已发布 <b>${cnt.published}</b></span>`;
      if (!view.length) { list.innerHTML = ui.emptyState('还没有内容，点新建开始创作', { action: { label: '新建内容' } }); bindEmpty(); return; }
      list.innerHTML = view.map(c => `
        <div class="card content st-${c.status}" data-id="${c.id}">
          <div class="content-bar"></div>
          <div class="content-main">
            <div class="content-title">${ui.escapeHtml(c.title || '无标题')}</div>
            <div class="content-meta">
              <span class="badge">${KIND[c.kind] || '内容'}</span>
              <span class="badge st-${c.status}">${STATUS[c.status] || '灵感'}</span>
              ${c.platform ? '<span class="tag">' + ui.escapeHtml(c.platform) + '</span>' : ''}
              <span class="muted">${ui.fmtRelative(c.updatedAt)}</span>
            </div>
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
    async function refresh() { all = (await store.getAll('content')).filter(i => !i._deleted); paint(); }
    paint();
    root.querySelector('#kfilter').addEventListener('change', paint);
    root.querySelector('#sfilter').addEventListener('change', paint);

    function openForm(c) {
      const m = ui.openModal({
        title: c ? '编辑' : '新建内容', html: formHTML(c),
        actions: [{ label: '取消' }, { label: '保存', primary: true, onClick: async (close) => {
          const title = m.dialog.querySelector('#f-title').value.trim();
          if (!title) { ui.toast('请填写标题', 'warn'); return; }
          const obj = c ? Object.assign({}, c) : { id: store.uid() };
          obj.title = title; obj.kind = m.dialog.querySelector('#f-kind').value;
          obj.status = m.dialog.querySelector('#f-status').value;
          obj.platform = m.dialog.querySelector('#f-platform').value;
          obj.note = m.dialog.querySelector('#f-note').value;
          obj.body = m.dialog.querySelector('#f-body').value;
          await store.put('content', obj); close(); await refresh();
        } }]
      });
      const ta = m.dialog.querySelector('#f-body'), pv = m.dialog.querySelector('#f-preview');
      const upd = () => { pv.innerHTML = ui.mdLite(ta.value); };
      ta.addEventListener('input', upd); upd();
      ui.bindFormValidation(m.dialog);
      m.dialog.querySelector('#ai-draft').onclick = () => {
        const title = m.dialog.querySelector('#f-title').value.trim();
        if (!title) { ui.toast('请先填标题', 'warn'); return; }
        const kind = m.dialog.querySelector('#f-kind').value;
        const platform = m.dialog.querySelector('#f-platform').value.trim();
        const note = m.dialog.querySelector('#f-note').value.trim();
        const user = '标题：' + title + '\n类型：' + (KIND[kind] || '') + (platform ? '\n平台：' + platform : '') + (note ? '\n备注：' + note : '');
        WB.ai.assistModal({
          title: 'AI 生成草稿', system: DRAFT_SYSTEM, user,
          adoptLabel: '采用为草稿',
          onAdopt: (txt) => { ta.value = txt; upd(); ui.toast('已生成草稿'); }
        });
      };
      m.dialog.querySelector('#ai-multi').onclick = () => {
        const src = ta.value.trim();
        if (!src) { ui.toast('请先写正文或生成草稿', 'warn'); return; }
        WB.ai.assistModal({ title: '多平台改写', system: MULTI_SYSTEM, user: '请改写以下内容：\n\n' + src });
      };
      m.dialog.querySelector('#ai-diagnose').onclick = () => {
        const src = ta.value.trim();
        if (!src) { ui.toast('请先写正文或生成草稿', 'warn'); return; }
        WB.ai.assistModal({ title: '爆款诊断', system: DIAGNOSE_SYSTEM, user: '请诊断以下内容：\n\n' + src });
      };
      m.dialog.querySelector('#ai-humanize').onclick = () => {
        const src = ta.value.trim();
        if (!src) { ui.toast('请先写正文或生成草稿', 'warn'); return; }
        WB.ai.assistModal({
          title: '去 AI 味', system: HUMANIZE_SYSTEM, user: '请润色以下内容：\n\n' + src,
          adoptLabel: '替换为润色版',
          onAdopt: (txt) => { ta.value = txt; upd(); ui.toast('已去 AI 味'); }
        });
      };
      setTimeout(() => m.dialog.querySelector('#f-title').focus(), 50);
    }
    root.querySelector('#add').onclick = () => openForm(null);
    list.addEventListener('click', async e => {
      const card = e.target.closest('.card'); if (!card) return;
      const id = card.dataset.id;
      if (e.target.closest('.icon-btn.del')) {
        if (await ui.confirm({ title: '删除内容', message: '确定删除这条内容吗？删除后可在提示中撤销。', confirmLabel: '删除', danger: true })) {
          ui.trash('content', id, { label: '已删除内容', repaint: refresh });
        }
        return;
      }
      openForm(await store.get('content', id));
    });
  }

  WB.modules.push({ id: 'content', title: '创作', icon: 'pen', render });
})(window.WB = window.WB || {});
