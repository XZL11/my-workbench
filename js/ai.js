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

  // 统一调用：system/user 两段式提示；失败抛出友好错误
  async function ask(system, user) {
    const cfg = await getCfg();
    if (!cfg.apikey) throw new Error('未配置 AI：请到「设置 → AI 助手」填写 API Key');
    if (!cfg.baseurl) throw new Error('未配置 AI 接口地址');
    const url = cfg.baseurl.replace(/\/+$/, '') + '/chat/completions';
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: user });
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apikey },
        body: JSON.stringify({ model: cfg.model, messages: messages, temperature: 0.7, stream: false })
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
    return text.trim();
  }

  // 把 AI 返回的文本拆成「一行一条」的建议/子任务
  function parseLines(text) {
    return (text || '').split('\n')
      .map(s => s.replace(/^[\s\d.\-、*•·]+/, '').replace(/^[-–—]\s*/, '').trim())
      .filter(Boolean);
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
      const text = await ask(opts.system, opts.user);
      outEl.value = text;
      statusEl.innerHTML = '<span class="ai-dot ok"></span>已生成（可编辑后采纳 / 复制）';
    } catch (e) {
      outEl.value = '';
      statusEl.innerHTML = '<span class="ai-dot err"></span>生成失败：' + ui.escapeHtml(e.message);
      ui.toast('AI 生成失败：' + e.message, 'error');
    }
    return m;
  }

  WB.ai = { PRESETS, getCfg, isConfigured, ask, assistModal, parseLines };
})(window.WB = window.WB || {});
