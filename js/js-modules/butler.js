// module: butler AI 管家（对话式：聚合全工作台数据作为上下文，多轮聊天，记录持久化）
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui;
  const HISTORY_KEY = 'butler_history';
  const MAX_HISTORY = 40;

  const BUTLER_SYSTEM = '你是用户的个人工作台 AI 管家，熟悉用户在工作台里的全部数据（待办、日程、笔记、日记、习惯、书签、记账、内容创作、规划、阅读、赚钱方式等）。你的职责：1）回答关于这些数据的任何问题；2）帮用户做计划、总结、复盘、灵感发散；3）主动给出可执行建议。风格：全程中文、亲切、简洁，先给结论和行动项，不要啰嗦。若用户问的数据不在下方快照里，就如实说不知道，不要编造。';

  const STORE_LABELS = {
    tasks: '待办/任务', calendar: '日程事件', notes: '笔记', diary: '日记',
    habits: '习惯', bookmarks: '书签', finance: '记账', content: '内容创作',
    planning: '规划', reading: '阅读', earnways: '赚钱方式'
  };

  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

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

    root.innerHTML = `
      <div class="page butler-page">
        ${ui.pageHead('butler', 'AI 管家', { actions: '<button class="btn ghost sm" id="clear">清空对话</button>' })}
        ${configured ? '' : '<div class="chat-banner">尚未配置 AI：请到「设置 → AI 助手」填写 API Key 后即可对话。</div>'}
        <div class="chat">
          <div class="chat-msgs" id="msgs"></div>
          <div class="chat-input">
            <textarea id="input" class="input" rows="2" placeholder="问问管家：今天该做什么？帮我总结这周的笔记？给点创作灵感…"></textarea>
            <button class="btn primary" id="send">发送</button>
          </div>
        </div>
      </div>`;

    const msgsEl = root.querySelector('#msgs');
    const inputEl = root.querySelector('#input');
    const sendBtn = root.querySelector('#send');

    function scrollDown() { msgsEl.scrollTop = msgsEl.scrollHeight; }
    function paint() {
      if (!history.length) {
        msgsEl.innerHTML = '<div class="chat-empty muted">和你的 AI 管家打个招呼吧～它可以读到你工作台里的所有数据。</div>';
        scrollDown();
        return;
      }
      msgsEl.innerHTML = history.map(m => {
        const cls = 'msg ' + (m.role === 'user' ? 'user' : (m.err ? 'ai err' : 'ai'));
        const inner = m.role === 'user' ? ui.escapeHtml(m.content) : ui.mdLite(m.content);
        return '<div class="' + cls + '">' + inner + '</div>';
      }).join('');
      scrollDown();
    }

    async function send() {
      const text = inputEl.value.trim();
      if (!text) return;
      if (!(await WB.ai.isConfigured())) { ui.toast('请先到「设置 → AI 助手」配置 API Key', 'warn'); return; }
      inputEl.value = '';
      history.push({ role: 'user', content: text, ts: Date.now() });
      await saveHistory(history);
      paint();
      sendBtn.disabled = true;
      const typing = document.createElement('div');
      typing.className = 'msg ai typing';
      typing.textContent = '管家正在思考…';
      msgsEl.appendChild(typing); scrollDown();
      try {
        const ctx = await buildContext();
        const system = BUTLER_SYSTEM + '\n\n# 用户工作台数据实时快照\n' + ctx;
        const turns = history.filter(m => !m.err).map(m => ({ role: m.role, content: m.content }));
        const reply = await WB.ai.chat(system, turns, { temperature: 0.7 });
        history.push({ role: 'assistant', content: reply, ts: Date.now() });
        await saveHistory(history);
      } catch (e) {
        history.push({ role: 'assistant', content: '⚠️ ' + (e && e.message ? e.message : e), ts: Date.now(), err: true });
        await saveHistory(history);
      } finally {
        sendBtn.disabled = false;
        paint();
      }
    }

    sendBtn.onclick = send;
    inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    root.querySelector('#clear').onclick = async () => {
      if (!history.length) return;
      if (await ui.confirm({ title: '清空对话', message: '确定清空所有聊天记录吗？', confirmLabel: '清空', danger: true })) {
        history = [];
        await saveHistory(history);
        paint();
      }
    };

    paint();
  }

  WB.modules.push({ id: 'butler', title: 'AI 管家', icon: 'butler', render });
})(window.WB = window.WB || {});
