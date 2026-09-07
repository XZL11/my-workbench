// module: butler AI 管家（对话式：先检索「AI 记录库」→ 命中即引用历史产出，不满意才生成；生成结果自动归档）
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui;
  const HISTORY_KEY = 'butler_history';
  const MAX_HISTORY = 40;
  const RETRIEVE_MIN = 0.34;

  const BUTLER_SYSTEM = '你是用户的个人工作台 AI 管家，熟悉用户在工作台里的全部数据（待办、日程、笔记、习惯、书签、记账、内容创作、规划、阅读、赚钱方式等）以及「AI 记录库」（各模块 AI 生成内容的本地存档）。你的职责：1）回答关于这些数据的任何问题；2）帮用户做计划、总结、复盘、灵感发散；3）主动给出可执行建议。风格：全程中文、亲切、简洁，先给结论和行动项，不要啰嗦。若用户问的数据不在下方快照里，就如实说不知道，不要编造。';

  const STORE_LABELS = {
    tasks: '待办/任务', calendar: '日程事件', notes: '笔记',
    habits: '习惯', bookmarks: '书签', finance: '记账', content: '内容创作',
    planning: '规划', reading: '阅读', earnways: '赚钱方式'
  };

  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function fmtDT(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function esc(s) { return ui.escapeHtml(s == null ? '' : String(s)); }
  function srcLabel(src) { try { return WB.ai.recSrcLabel(src); } catch (e) { return src || '工作台'; } }
  function trunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) : s; }

  function summarize(key, it) {
    if (key === 'finance') {
      return '¥' + (it.amount != null ? it.amount : '?') + ' ' + (it.category || '') + ' ' + (it.note || '');
    }
    if (key === 'habits') {
      return (it.name || '') + ' 连续 ' + (it.streak || 0) + ' 天';
    }
    const title = it.title || it.name || it.content || '';
    const body = (it.body || it.note || it.text || '').toString().replace(/[#*`>\[\]()_~]/g, '').slice(0, 60);
    const date = it.date || it.dueDate || it.createdAt || it.updatedAt;
    let s = title ? ('「' + title + '」') : '';
    if (body) s += (s ? '：' : '') + body;
    if (date) s += ' (' + fmtDate(date) + ')';
    return s || '(空)';
  }

  async function buildContext() {
    const lines = [];
    for (const key of Object.keys(STORE_LABELS)) {
      let items = [];
      try { items = (await store.getAll(key)).filter(i => !i._deleted); } catch (e) { items = []; }
      lines.push('【' + STORE_LABELS[key] + '】共 ' + items.length + ' 条');
      const recent = items.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 6);
      recent.forEach(it => lines.push('  · ' + summarize(key, it)));
    }
    return lines.join('\n');
  }

  async function loadHistory() {
    let h = await store.getMeta(HISTORY_KEY, []);
    return Array.isArray(h) ? h : [];
  }
  async function saveHistory(h) {
    if (h.length > MAX_HISTORY) h = h.slice(h.length - MAX_HISTORY);
    await store.setMeta(HISTORY_KEY, h);
  }

  async function render(root) {
    let history = await loadHistory();
    const configured = await WB.ai.isConfigured();
    let busy = false;

    root.innerHTML = `
      <div class="page butler-page">
        ${ui.pageHead('butler', 'AI 管家', { actions: '<button class="btn ghost sm" id="lib">📚 AI 记录库</button><button class="btn ghost sm" id="clear">清空对话</button>' })}
        ${configured ? '' : '<div class="chat-banner">尚未配置 AI：请到「设置 → AI 助手」填写 API Key 后即可对话。</div>'}
        <div class="chat">
          <div class="chat-msgs" id="msgs"></div>
          <div class="chat-input">
            <textarea id="input" class="input" rows="2" placeholder="问问管家：今天该做什么？帮我总结这周的笔记？之前 AI 生成过的东西我忘了…（会先查你的 AI 记录库，命中就不重复生成）"></textarea>
            <button class="btn primary" id="send">发送</button>
          </div>
        </div>
      </div>`;

    const msgsEl = root.querySelector('#msgs');
    const inputEl = root.querySelector('#input');
    const sendBtn = root.querySelector('#send');

    function scrollDown() { msgsEl.scrollTop = msgsEl.scrollHeight; }
    function typingEl() { return msgsEl.querySelector('.typing'); }

    function recMsgHTML(hits) {
      const head = '<div class="rec-note">🔎 我先查了你的「AI 记录库」，命中 ' + hits.length + ' 条历史 AI 产出（引用如下）。满意就直接用；不满意点下方按钮，我再重新生成。</div>';
      const items = hits.map((h, i) => {
        const q = trunc(h.q, 80), a = trunc(h.a, 260);
        return '<div class="rec-item">' +
          '<div class="rec-meta"><b>[' + esc(srcLabel(h.src)) + ']</b><span class="muted">' + esc(fmtDT(h.t)) + '</span></div>' +
          (h.q ? '<div class="rec-q muted">问：' + esc(q) + '</div>' : '') +
          '<div class="rec-a">' + esc(a) + (h.a && h.a.length > 260 ? '…' : '') + '</div>' +
          '<button class="btn ghost sm" data-recview="' + i + '">查看原文</button>' +
        '</div>';
      }).join('');
      return head + items +
        '<div class="rec-regen"><button class="btn ghost sm" data-regen="1">不满意，让 AI 重新回答</button></div>';
    }

    function paint() {
      if (!history.length) {
        msgsEl.innerHTML = '<div class="chat-empty muted">和你的 AI 管家打个招呼吧～它会先检索你的「AI 记录库」（各模块 AI 产出都有存档），命中就直接引用、不重复生成。</div>';
        scrollDown();
        return;
      }
      msgsEl.innerHTML = history.map((m, idx) => {
        const base = 'msg ' + (m.role === 'user' ? 'user' : (m.err ? 'ai err' : 'ai')) + (m.kind === 'rec' ? ' rec' : '');
        const body = m.role === 'user'
          ? ui.escapeHtml(m.content)
          : (m.kind === 'rec' ? recMsgHTML(m.hits || []) : ui.mdLite(m.content));
        return '<div class="' + base + '" data-midx="' + idx + '">' + body + '</div>';
      }).join('');
      scrollDown();
    }

    async function appendUser(text) {
      history.push({ role: 'user', content: text, ts: Date.now() });
      await saveHistory(history);
      paint();
    }
    async function appendAI(content, extra) {
      history.push(Object.assign({ role: 'assistant', content: content, ts: Date.now() }, extra || {}));
      await saveHistory(history);
    }
    function addTyping(txt) {
      if (!typingEl()) {
        const d = document.createElement('div');
        d.className = 'msg ai typing';
        d.textContent = txt || '管家正在思考…';
        msgsEl.appendChild(d); scrollDown();
      }
    }
    function removeTyping() { const t = typingEl(); if (t) t.remove(); }

    // 真正的生成路径（用户问题已在 history 中）：把上下文+历史给 AI，产出归档并回复
    async function askLLM() {
      addTyping('管家正在生成…');
      try {
        const ctx = await buildContext();
        const system = BUTLER_SYSTEM + '\n\n# 用户工作台数据实时快照\n' + ctx;
        const turns = history.filter(m => !m.err && m.kind !== 'rec').map(m => ({ role: m.role, content: m.content }));
        const reply = await WB.ai.chat(system, turns, { temperature: 0.7, src: 'butler' });
        removeTyping();
        await appendAI(reply);
      } catch (e) {
        removeTyping();
        await appendAI('⚠️ ' + (e && e.message ? e.message : e), { err: true });
      }
    }

    // 提问总入口：先检索记录库 → 命中引用；未命中（或用户点“不满意”）→ 生成
    async function process(text) {
      if (busy) return;
      busy = true; sendBtn.disabled = true;
      try {
        let hits = [];
        try { hits = (await WB.ai.retrieve(text, { k: 3, minScore: RETRIEVE_MIN })) || []; } catch (e) { hits = []; }
        if (hits.length) {
          await appendAI('', { kind: 'rec', q: text, hits: hits.map(h => ({ src: h.src, q: h.q, a: h.a, t: h.t })) });
        } else {
          await askLLM();
        }
      } finally {
        busy = false; sendBtn.disabled = false;
        paint();
      }
    }

    async function send() {
      const text = inputEl.value.trim();
      if (!text) return;
      if (!(await WB.ai.isConfigured())) { ui.toast('请先到「设置 → AI 助手」配置 API Key', 'warn'); return; }
      inputEl.value = '';
      await appendUser(text);
      process(text);
    }

    // 消息气泡里的交互：查看原文 / 不满意重新生成
    msgsEl.addEventListener('click', async e => {
      const view = e.target.closest('[data-recview]');
      const regen = e.target.closest('[data-regen]');
      if (!view && !regen) return;
      const bubble = e.target.closest('.msg');
      if (!bubble) return;
      const m = history[Number(bubble.getAttribute('data-midx'))];
      if (!m) return;
      if (view) {
        const rec = (m.hits || [])[Number(view.dataset.recview)];
        if (rec) openRecord(rec);
      } else if (regen) {
        const idx = Number(bubble.getAttribute('data-midx'));
        history.splice(idx, 1); // 撤掉“引用”那条，保留用户问题
        await saveHistory(history);
        paint();
        if (!busy) { busy = true; sendBtn.disabled = true; await askLLM(); busy = false; sendBtn.disabled = false; paint(); }
      }
    });

    sendBtn.onclick = send;
    inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    root.querySelector('#clear').onclick = async () => {
      if (!history.length) return;
      if (await ui.confirm({ title: '清空对话', message: '确定清空所有聊天记录吗？（AI 记录库不受影响）', confirmLabel: '清空', danger: true })) {
        history = [];
        await saveHistory(history);
        paint();
      }
    };
    root.querySelector('#lib').onclick = () => openLibrary();

    paint();

    /* ============ 📚 AI 记录库 ============ */
    function recRowHTML(r) {
      return '<div class="lib-row" data-id="' + esc(r.id) + '">' +
        '<div class="lib-top"><b>[' + esc(srcLabel(r.src)) + ']</b>' +
        '<span class="muted">' + esc(fmtDT(r.t)) + '</span>' +
        '<span class="lib-ops"><button class="btn ghost sm" data-lib="view">原文</button>' +
        '<button class="btn ghost sm danger" data-lib="del">删除</button></span></div>' +
        (r.q ? '<div class="lib-q muted">问：' + esc(trunc(r.q, 120)) + '</div>' : '') +
        '<div class="lib-a">' + esc(trunc(r.a, 300)) + '</div>' +
      '</div>';
    }
    function openLibrary() {
      let recs = [], shown = 40, q = '', srcF = 'all';
      const m = ui.openModal({
        title: '📚 AI 记录库',
        html: '<div class="lib">' +
          '<div class="lib-bar"><input id="lib-q" class="input" placeholder="搜索问题 / 内容…">' +
          '<button class="btn ghost sm" id="lib-clearall">清空全部</button></div>' +
          '<div class="chips lib-srcs" id="lib-srcs"></div>' +
          '<div class="lib-count muted" id="lib-count"></div>' +
          '<div class="lib-list" id="lib-list"></div>' +
          '<button class="btn ghost sm" id="lib-more" style="width:100%;margin-top:6px;display:none">加载更多</button>' +
        '</div>',
        actions: [{ label: '关闭' }]
      });
      const box = m.dialog;
      async function load() {
        try { recs = (await store.getAll('airecords')).filter(r => !r._deleted).sort((a, b) => (b.t || 0) - (a.t || 0)); } catch (e) { recs = []; }
        renderSrcs();
        paintList();
      }
      function srcs() {
        const set = ['all'];
        recs.forEach(r => { const s = r.src || ''; if (s && set.indexOf(s) < 0) set.push(s); });
        return set;
      }
      function renderSrcs() {
        const el = box.querySelector('#lib-srcs');
        el.innerHTML = srcs().map(s =>
          '<button class="chip' + (s === srcF ? ' active' : '') + '" data-src="' + esc(s) + '">' +
          (s === 'all' ? '全部' : esc(srcLabel(s))) + '</button>').join('');
        el.querySelectorAll('[data-src]').forEach(b => { b.onclick = () => { srcF = b.dataset.src; shown = 40; paintList(); }; });
      }
      function filtered() {
        const tq = q.trim().toLowerCase();
        return recs.filter(r => {
          if (srcF !== 'all' && (r.src || '') !== srcF) return false;
          if (tq) {
            const hay = ((r.q || '') + ' ' + (r.a || '')).toLowerCase();
            if (hay.indexOf(tq) < 0) return false;
          }
          return true;
        });
      }
      function paintList() {
        const view = filtered();
        const listEl = box.querySelector('#lib-list');
        box.querySelector('#lib-count').textContent = '共 ' + view.length + ' 条（每次生成自动归档，仅存本地不云同步）';
        const slice = view.slice(0, shown);
        listEl.innerHTML = slice.length ? slice.map(recRowHTML).join('') : '<div class="lib-empty muted">还没有 AI 记录。去任意模块让 AI 生成一次内容（如管家问答、创作助手、笔记摘要、记账洞察、竞彩分析等）就会自动归档到这里。</div>';
        box.querySelector('#lib-more').style.display = view.length > shown ? '' : 'none';
      }
      box.querySelector('#lib-q').addEventListener('input', e => { q = e.target.value; shown = 40; paintList(); });
      box.querySelector('#lib-more').onclick = () => { shown += 40; paintList(); };
      box.querySelector('#lib-clearall').onclick = async () => {
        const total = recs.length;
        if (!total) return;
        if (await ui.confirm({ title: '清空 AI 记录库', message: '确定删除全部 ' + total + ' 条 AI 记录吗？此操作不可恢复。', confirmLabel: '清空', danger: true })) {
          try { await store.clear('airecords'); } catch (e) {}
          await load(); ui.toast('已清空 AI 记录库');
        }
      };
      box.querySelector('#lib-list').addEventListener('click', async e => {
        const btn = e.target.closest('[data-lib]');
        if (!btn) return;
        const row = btn.closest('.lib-row');
        const r = recs.filter(x => x.id === row.dataset.id)[0];
        if (!r) return;
        if (btn.dataset.lib === 'view') { openRecord({ src: r.src, q: r.q, a: r.a, t: r.t }); }
        else if (btn.dataset.lib === 'del') {
          if (await ui.confirm({ title: '删除记录', message: '删除这条 AI 记录？', confirmLabel: '删除', danger: true })) {
            try { await store.hardDelete('airecords', r.id); } catch (e) {}
            await load();
          }
        }
      });
      load();
    }

    // 查看单条记录全文
    function openRecord(rec) {
      if (!rec) return;
      ui.openModal({
        title: 'AI 记录 · ' + srcLabel(rec.src) + ' · ' + fmtDT(rec.t),
        html: '<div class="lib-detail">' +
          (rec.q ? '<div class="lib-detail-q"><div class="k muted">问题 / 触发输入</div><div>' + esc(rec.q) + '</div></div>' : '') +
          '<div class="lib-detail-a"><div class="k muted">AI 产出（原文）</div><pre>' + esc(rec.a) + '</pre></div>' +
        '</div>',
        actions: [
          { label: '关闭' },
          { label: '复制全文', primary: true, onClick: async () => {
            try { await navigator.clipboard.writeText((rec.q ? '问：' + rec.q + '\n\n' : '') + rec.a); ui.toast('已复制'); }
            catch (e) { ui.toast('复制失败，请手动选择文本', 'warn'); }
          } }
        ]
      });
    }
  }

  WB.modules.push({ id: 'butler', title: 'AI 管家', icon: 'butler', render });
})(window.WB = window.WB || {});
