// ai.js - AI 中枢：本地配置 + 统一调用（硅基流动 / DeepSeek / OpenAI 兼容接口）
// 设计原则：AI 只是增强层。密钥仅存本地 IndexedDB(meta)，绝不进仓库；没网/没配密钥时原有功能不受影响。
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui;

  // 服务商预设（接入点统一为 OpenAI 兼容的 /v1/chat/completions）
  const PRESETS = {
    siliconflow: { label: '硅基流动 SiliconFlow（推荐，浏览器可直连）', baseurl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
    deepseek: { label: 'DeepSeek', baseurl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    openai: { label: 'OpenAI（需代理/中转，浏览器直连会被 CORS 拦）', baseurl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    custom: { label: '自定义', baseurl: '', model: '' }
  };

  async function getCfg() {
    return {
      provider: await store.getMeta('ai_provider', 'siliconflow'),
      baseurl: (await store.getMeta('ai_baseurl', '')) || (PRESETS.siliconflow.baseurl),
      apikey: await store.getMeta('ai_apikey', ''),
      model: (await store.getMeta('ai_model', '')) || (PRESETS.siliconflow.model)
    };
  }
  async function isConfigured() {
    const c = await getCfg();
    return !!(c.apikey && c.baseurl);
  }

  /* ================= AI 记录库（本地） =================
   * 所有 AI 成功产出自动存档到 airecords（不同步云），供「AI 管家」检索优先。
   * 记录字段：{ id, kind, src, q(问题/触发输入), a(产出), t(时间戳) }，限容 MAX_RECORDS 条。
   */
  const MAX_RECORDS = 600;
  const STOP_CHARS = new Set(('帮我帮请请问呢吗嘛呀的了吗了和或与及个一种些这那哪些什么怎么如何能不能能否给我我想我 你你们它它们').split(''));
  // STOP_CHARS 额外手动补充
  ['帮','我','请','问','吗','么','什','这','那','的','了','和','与','及','个','一','种','些','很','就','都','还','也','要','是','在','对','把','被','给','为','从','到','说','想','能','该','会','有','做','来','去','看','写','查','找','出','下','上','不','没','无','并','或','但','而','其','它','们','哪','里','多','少','大','小','再','次','让','你','您','什么','怎么','如何','哪些','一下'].forEach(ch => STOP_CHARS.add(ch));
  const RECORD_SRC = { butler: '管家对话', content: '创作助手', calendar: '日程·拆解', planning: '规划助手', notes: '笔记助手', notes_summary: '笔记摘要', finance: '记账分析', today_brief: '今日简报', leverage: '杠杆AI日报', lottery: '竞彩分析', assist: 'AI 助手' };

  function recSrcLabel(src) { return RECORD_SRC[src] || src || '工作台'; }

  async function saveRecord(o) {
    if (!o || !o.a) return;
    try {
      const rec = {
        id: (WB.store && WB.store.uid) ? WB.store.uid() : ('r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)),
        kind: o.kind || 'ask',
        src: o.src || '',
        q: String(o.q || '').slice(0, 500),
        a: String(o.a).slice(0, 6000),
        t: Date.now()
      };
      await store.put('airecords', rec);
      // 限容：超过则物理删除最旧（airecords 本地库不用软删墓碑，避免无限堆积）
      const all = (await store.getAll('airecords')).filter(r => !r._deleted);
      if (all.length > MAX_RECORDS) {
        const drop = all.sort((x, y) => (x.t || 0) - (y.t || 0)).slice(0, all.length - MAX_RECORDS);
        for (const d of drop) { try { await store.hardDelete('airecords', d.id); } catch (e) {} }
      }
    } catch (e) { /* 记录失败不影响主流程 */ }
  }

  // 中文/英文混合分词：汉字单字 + 拉丁词（小写）
  function tokenize(text) {
    const s = String(text || '').toLowerCase();
    const out = new Set();
    const wordRe = /[a-z0-9]+(?:\.[a-z0-9]+)*/g;
    let m;
    while ((m = wordRe.exec(s))) { if (m[0].length > 1) out.add(m[0]); }
    for (const ch of s) {
      if (/\p{Script=Han}/u.test(ch)) out.add(ch);
    }
    return Array.from(out);
  }

  // 检索 AI 记录库：q 与 (q+a) 的词集重叠 + 短语命中加分
  async function retrieve(q, opts) {
    opts = opts || {};
    const k = opts.k || 3, minScore = opts.minScore != null ? opts.minScore : 0.34;
    let all = [];
    try { all = (await store.getAll('airecords')).filter(r => !r._deleted); } catch (e) { return []; }
    const query = String(q || '').trim();
    if (!query) return [];
    const qTerms = tokenize(query).filter(t => !STOP_CHARS.has(t));
    if (!qTerms.length) return [];
    const lowerQ = query.toLowerCase();
    const out = [];
    for (const r of all) {
      const hay = ((r.q || '') + ' ' + (r.a || '')).toLowerCase();
      const hSet = new Set(tokenize(hay));
      let hit = 0;
      qTerms.forEach(t => { if (hSet.has(t)) hit++; });
      let score = hit / qTerms.length;
      if (query.length >= 3 && hay.indexOf(lowerQ) >= 0) score = Math.max(score, Math.min(1, score + 0.35)); // 完整短语命中强加分
      if (score < minScore) continue;
      out.push({ id: r.id, score: Math.round(score * 1000) / 1000, src: r.src, q: r.q || '', a: r.a || '', t: r.t || 0 });
    }
    out.sort((x, y) => (y.score - x.score) || ((y.t || 0) - (x.t || 0)));
    return out.slice(0, k);
  }

  // 统一调用（多轮）：messages 由 system + turns([{role,content}]) 组成；失败抛出友好错误
  async function chat(system, turns, opts) {
    const cfg = await getCfg();
    if (!cfg.apikey) throw new Error('未配置 AI：请到「设置 → AI 助手」填写 API Key');
    if (!cfg.baseurl) throw new Error('未配置 AI 接口地址');
    const url = cfg.baseurl.replace(/\/+$/, '') + '/chat/completions';
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    (turns || []).forEach(t => {
      if (t && t.content) messages.push({ role: (t.role === 'assistant') ? 'assistant' : 'user', content: t.content });
    });
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apikey },
        body: JSON.stringify({ model: cfg.model, messages: messages, temperature: (opts && opts.temperature != null ? opts.temperature : 0.7), stream: false })
      });
    } catch (e) {
      const em = (e && e.message) ? e.message : '';
      if (/Failed to fetch|NetworkError|network/i.test(em)) {
        throw new Error('网络请求失败：浏览器连不上该接口。常见原因——①在应用内预览面板测试（沙箱常屏蔽外网），请用浏览器打开线上站点 xzl11.github.io/my-workbench 并硬刷新后再测；②你的网络/防火墙/浏览器插件屏蔽了 api.siliconflow.cn（可在新标签页直接打开该域名验证）；③当前离线。若网络确实屏蔽，可在「接口地址」填一个你自己的代理（如 Cloudflare Worker）来中转。');
      }
      throw new Error('网络请求失败（' + em + '）');
    }
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { const j = await res.json(); if (j && j.error && j.error.message) msg = j.error.message; } catch (e) {}
      if (res.status === 401) msg = 'API Key 无效或无权限（401）';
      else if (res.status === 429) msg = '请求过于频繁或额度不足（429）';
      throw new Error(msg);
    }
    const data = await res.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text) throw new Error('接口未返回有效内容');
    // AI 记录库：默认所有成功产出自动存档（opts.save === false 可关闭，如标题/标签等元数据噪音调用）
    if (!(opts && opts.save === false)) {
      let lastUser = '';
      for (let i = (turns || []).length - 1; i >= 0; i--) {
        const t = turns[i];
        if (t && t.role !== 'assistant' && t.content) { lastUser = t.content; break; }
      }
      try { await saveRecord({ kind: (opts && opts.kind) || 'chat', src: (opts && opts.src) || '', q: lastUser, a: text }); } catch (e) {}
    }
    return text.trim();
  }

  // 两段式（单轮）便捷封装：委托给 chat；opts: { src, kind, save, temperature }
  async function ask(system, user, opts) {
    return await chat(system, [{ role: 'user', content: user }], opts);
  }

  // 把 AI 返回的文本拆成「一行一条」的建议/子任务
  function parseLines(text) {
    return (text || '').split('\n')
      .map(s => s.replace(/^[\s\d.\-、*•·]+/, '').replace(/^[-–—]\s*/, '').trim())
      .filter(Boolean);
  }

  // 从 AI 文本中解析 JSON（容错：去掉 ```json 围栏、截取首个 {...} 块）
  function parseJSON(text) {
    if (!text) return null;
    let s = String(text).trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const start = s.indexOf('{'), end = s.lastIndexOf('}');
    if (start >= 0 && end > start) s = s.slice(start, end + 1);
    try { return JSON.parse(s); } catch (e) { return null; }
  }

  // 通用 AI 助手弹窗：自动生成 → 可编辑结果 → 复制 / 采纳
  // opts: { title, system, user, adoptLabel, onAdopt(text), copyLabel }
  async function assistModal(opts) {
    if (!(await isConfigured())) {
      ui.toast('请先在「设置 → AI 助手」配置 API Key', 'warn');
      setTimeout(() => { location.hash = '#/settings'; }, 400);
      return null;
    }
    const html =
      '<div class="ai-assist">' +
        '<div class="ai-status" id="ai-status"><span class="ai-dot"></span>准备生成…</div>' +
        '<textarea id="ai-out" class="input" rows="12" placeholder="AI 生成结果会显示在这里，你可以直接编辑后再采纳或复制。"></textarea>' +
      '</div>';
    const actions = [
      { label: '关闭' },
      { label: opts.copyLabel || '复制', onClick: async () => {
        const t = m.dialog.querySelector('#ai-out').value;
        try { await navigator.clipboard.writeText(t); ui.toast('已复制到剪贴板'); }
        catch (e) { ui.toast('复制失败，请手动选择文本', 'warn'); }
      } }
    ];
    if (opts.onAdopt) {
      actions.push({ label: opts.adoptLabel || '采纳', primary: true, keepOpen: true, onClick: async () => {
        const t = m.dialog.querySelector('#ai-out').value;
        try { if (opts.onAdopt) opts.onAdopt(t); ui.toast(opts.adoptLabel ? ('已' + opts.adoptLabel.replace(/[为给]/g, '') + '，已应用') : '已采纳'); }
        catch (e) { ui.toast('采纳失败：' + e.message, 'error'); }
      } });
    }
    const m = ui.openModal({ title: opts.title, html: html, actions: actions });
    const statusEl = m.dialog.querySelector('#ai-status');
    const outEl = m.dialog.querySelector('#ai-out');
    try {
      const text = await ask(opts.system, opts.user, { kind: 'assist', src: opts.src, save: opts.save !== false });
      outEl.value = text;
      statusEl.innerHTML = '<span class="ai-dot ok"></span>已生成（可编辑后采纳 / 复制）';
    } catch (e) {
      outEl.value = '';
      statusEl.innerHTML = '<span class="ai-dot err"></span>生成失败：' + ui.escapeHtml(e.message);
      ui.toast('AI 生成失败：' + e.message, 'error');
    }
    return m;
  }

  WB.ai = { PRESETS, getCfg, isConfigured, ask, chat, assistModal, parseLines, parseJSON, saveRecord, retrieve, tokenize, recSrcLabel };
})(window.WB = window.WB || {});
