// module: settings 设置（同步配置 / 主题 / 导入导出）
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui, sync = WB.sync, ai = WB.ai;

  const PLATFORM_HELP = {
    github: '在 GitHub 生成一个具有 <b>repo</b> 权限的 Personal Access Token（ghp_...），并准备一个<strong>私有仓库</strong>。Token 仅保存在本机浏览器。',
    gitee: '在 Gitee（码云）生成一个<strong>私人令牌</strong>（设置 → 私人令牌，勾选 projects 权限），并准备一个<strong>私有仓库</strong>。国内访问更快、无需代理。Token 仅保存在本机。'
  };

  function branchDefault(pf) { return pf === 'gitee' ? 'master' : 'main'; }
  function tokenPlaceholder(pf, has) {
    if (has) return '已保存，留空则使用已保存令牌';
    return pf === 'gitee' ? 'Gitee 私人令牌' : 'ghp_...';
  }

  async function render(root) {
    const cfg = sync.cfg;
    const last = await store.getMeta('last_sync_at', null);
    const configured = sync.isConfigured();
    let selPlatform = cfg.platform || 'github';

    root.innerHTML = `
      <div class="page">
        ${ui.pageHead('settings', '设置')}

        <section class="card section">
          <h2>数据同步</h2>
          <p class="muted">选择同步平台，凭证各自独立保存，可随时切换。</p>
          <div class="platform-switch" id="pf-switch">
            <button type="button" class="pf-btn" data-pf="github">GitHub</button>
            <button type="button" class="pf-btn" data-pf="gitee">Gitee</button>
          </div>
          <p class="muted" id="pf-help">${PLATFORM_HELP[selPlatform]}</p>
          <div class="form">
            <label>仓库（owner/name）<input id="s-repo" class="input" placeholder="yourname/my-workbench-data"></label>
            <label>访问令牌<input id="s-token" class="input" type="password" placeholder="${tokenPlaceholder(selPlatform, configured)}"></label>
            <label>分支<input id="s-branch" class="input" value="${branchDefault(selPlatform)}"></label>
          </div>
          <div class="row-actions">
            <button class="btn primary" id="save-cfg">保存配置</button>
            <button class="btn ghost" id="sync-now">立即同步</button>
            <button class="btn ghost danger" id="clear-cfg">清除凭证</button>
          </div>
          <div class="sync-stat" id="sync-stat">${configured ? '已配置（' + (selPlatform === 'gitee' ? 'Gitee' : 'GitHub') + '）· 上次同步：' + (last ? ui.fmtDateTime(last) : '从未') : '未配置'}</div>
        </section>

        <section class="card section">
          <h2>备份</h2>
          <div class="row-actions">
            <button class="btn ghost" id="export">导出全部 JSON</button>
            <button class="btn ghost" id="import">导入 JSON</button>
          </div>
        </section>

        <section class="card section">
          <h2>外观</h2>
          <label>主题
            <select id="s-theme" class="input">
              <option value="auto">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>
          <label style="margin-top:12px">图标主题
            <select id="s-icon-theme" class="input">
              <option value="lucide">默认线条图标</option>
              <option value="mascot">猪猪侠吉祥物</option>
              <option value="spidey">蜘蛛侠像素风</option>
            </select>
          </label>
          <p class="muted" style="margin-top:8px">选择「蜘蛛侠像素风」后，整站切换为深色蓝灰 + 青色像素边框，图标变为 8-bit 蜘蛛侠像素方块。</p>
        </section>

        <section class="card section">
          <h2>AI 助手</h2>
          <p class="muted">配置你自己的大模型 API（硅基流动 / DeepSeek / OpenAI 兼容）。密钥仅保存在本机浏览器，不会上传到任何仓库；未配置时其它功能照常使用。</p>
          <label>服务商
            <select id="ai-provider" class="input">
              ${Object.keys(ai.PRESETS).map(k => `<option value="${k}">${ai.PRESETS[k].label}</option>`).join('')}
            </select>
          </label>
          <label>接口地址（Base URL）<input id="ai-baseurl" class="input" placeholder="https://api.siliconflow.cn/v1"></label>
          <label>模型名<input id="ai-model" class="input" placeholder="deepseek-ai/DeepSeek-V3"></label>
          <label>API Key<input id="ai-apikey" class="input" type="password" placeholder="sk-...（已保存则留空保留）"></label>
          <div class="row-actions">
            <button class="btn primary" id="ai-save">保存 AI 配置</button>
            <button class="btn ghost" id="ai-test">测试连接</button>
          </div>
          <div class="sync-stat" id="ai-stat"></div>
        </section>

        <section class="card section">
          <h2>关于</h2>
          <p class="muted">个人工作台 · 纯静态 PWA · 离线优先 · 数据存于本地与私有仓库。<br>所有数据默认仅存在于你的设备与你的私有仓库（GitHub 或 Gitee）。</p>
        </section>
      </div>`;

    const stat = root.querySelector('#sync-stat');
    const pfHelp = root.querySelector('#pf-help');
    const repoInput = root.querySelector('#s-repo');
    const tokenInput = root.querySelector('#s-token');
    const branchInput = root.querySelector('#s-branch');
    const pfSwitch = root.querySelector('#pf-switch');

    async function applyPlatform(pf, focus) {
      selPlatform = pf;
      pfSwitch.querySelectorAll('.pf-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.pf === pf);
      });
      pfHelp.innerHTML = PLATFORM_HELP[pf];
      const savedRepo = await store.getMeta(pf + '_repo', '');
      const savedBranch = await store.getMeta(pf + '_branch', null) || branchDefault(pf);
      repoInput.value = savedRepo || '';
      branchInput.value = savedBranch;
      tokenInput.value = '';
      tokenInput.placeholder = tokenPlaceholder(pf, !!savedRepo);
      repoInput.placeholder = 'yourname/my-workbench-data';
      if (focus) tokenInput.focus();
    }
    pfSwitch.querySelectorAll('.pf-btn').forEach(b => {
      b.addEventListener('click', () => applyPlatform(b.dataset.pf, true));
    });
    // 初始化为当前已配置平台
    await applyPlatform(selPlatform, false);

    root.querySelector('#s-theme').value = await store.getMeta('theme', 'auto');
    root.querySelector('#s-theme').addEventListener('change', async e => {
      await ui.setTheme(e.target.value); ui.toast('主题已更新');
    });

    root.querySelector('#s-icon-theme').value = (WB.theme && WB.theme.current) || 'lucide';
    root.querySelector('#s-icon-theme').addEventListener('change', e => {
      if (WB.theme && WB.theme.set) { WB.theme.set(e.target.value); }
    });

    // ===== AI 助手配置 =====
    const aiStat = root.querySelector('#ai-stat');
    const aiProvider = root.querySelector('#ai-provider');
    const aiBase = root.querySelector('#ai-baseurl');
    const aiModel = root.querySelector('#ai-model');
    const aiKey = root.querySelector('#ai-apikey');
    async function loadAiCfg() {
      const cfg = await ai.getCfg();
      aiProvider.value = cfg.provider || 'siliconflow';
      aiBase.value = cfg.baseurl || '';
      aiModel.value = cfg.model || '';
      aiKey.value = '';
      aiStat.textContent = cfg.apikey ? '已配置（' + (ai.PRESETS[cfg.provider] ? ai.PRESETS[cfg.provider].label.split('（')[0] : cfg.provider) + '）' : '未配置';
    }
    aiProvider.addEventListener('change', () => {
      const p = ai.PRESETS[aiProvider.value];
      if (p && p.baseurl) { aiBase.value = p.baseurl; aiModel.value = p.model; }
    });
    root.querySelector('#ai-save').onclick = async () => {
      const provider = aiProvider.value;
      const baseurl = aiBase.value.trim();
      const model = aiModel.value.trim();
      const key = aiKey.value.trim();
      if (!baseurl) { ui.toast('请填写接口地址', 'warn'); return; }
      if (!model) { ui.toast('请填写模型名', 'warn'); return; }
      const savedKey = await store.getMeta('ai_apikey', '');
      const finalKey = key || savedKey;
      if (!finalKey) { ui.toast('请填写 API Key（首次保存必填）', 'warn'); return; }
      await store.setMeta('ai_provider', provider);
      await store.setMeta('ai_baseurl', baseurl);
      await store.setMeta('ai_model', model);
      await store.setMeta('ai_apikey', finalKey);
      ui.toast('AI 配置已保存', 'success');
      aiKey.value = '';
      await loadAiCfg();
    };
    root.querySelector('#ai-test').onclick = async () => {
      aiStat.textContent = '测试中…';
      try {
        const r = await ai.ask('你是测试助手。', '请只回复两个字：成功');
        aiStat.textContent = '连接成功：' + (r || '').slice(0, 20);
        ui.toast('AI 连接成功', 'success');
      } catch (e) {
        aiStat.textContent = '测试失败：' + e.message;
        ui.toast('AI 测试失败：' + e.message, 'error');
      }
    };
    await loadAiCfg();

    root.querySelector('#save-cfg').onclick = async () => {
      const repo = repoInput.value.trim();
      const token = tokenInput.value.trim();
      const branch = branchInput.value.trim() || branchDefault(selPlatform);
      if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) { ui.toast('仓库格式应为 owner/name', 'warn'); return; }
      const savedToken = await store.getMeta(selPlatform + '_token', null);
      const finalToken = token || savedToken;
      if (!finalToken) { ui.toast('请填写访问令牌', 'warn'); return; }

      // 先验证 Token 能访问该仓库（按所选平台校验），避免同步时才报 401
      stat.textContent = '验证中…';
      try {
        await sync.validateToken(selPlatform, finalToken, repo);
      } catch (e) {
        stat.textContent = '验证失败：' + e.message;
        ui.toast('配置验证失败：' + e.message, 'error');
        return;
      }

      await sync.setConfig(selPlatform, finalToken, repo, branch);
      stat.textContent = '已配置（' + (selPlatform === 'gitee' ? 'Gitee' : 'GitHub') + '）· ' + repo;
      ui.toast('配置已保存', 'success');

      // 保存后若联网，立即尝试同步一次，把现有数据推上去
      if (navigator.onLine) {
        stat.textContent = '首次同步中…';
        try {
          const r = await sync.syncAll(p => { stat.textContent = '同步中：' + p; });
          const now = await store.getMeta('last_sync_at', null);
          stat.textContent = '已配置（' + (selPlatform === 'gitee' ? 'Gitee' : 'GitHub') + '）· 上次同步：' + (now ? ui.fmtDateTime(now) : '刚刚');
          ui.toast(r && r.pulled ? ('同步完成，已合并 ' + r.pulled + ' 项云端更新') : '同步完成', 'success');
        } catch (e) {
          stat.textContent = '同步失败：' + e.message;
          ui.toast('同步失败：' + e.message, 'error');
        }
      }
    };

    root.querySelector('#clear-cfg').onclick = async () => {
      if (await ui.confirm('确定清除当前平台（' + (selPlatform === 'gitee' ? 'Gitee' : 'GitHub') + '）保存的令牌与仓库信息？')) {
        await sync.clearConfig();
        repoInput.value = ''; branchInput.value = branchDefault(selPlatform); tokenInput.value = '';
        stat.textContent = '未配置'; ui.toast('已清除凭证');
      }
    };

    root.querySelector('#sync-now').onclick = async () => {
      if (!sync.isConfigured()) { ui.toast('请先保存同步配置', 'warn'); return; }
      stat.textContent = '同步中…';
      try {
        const r = await sync.syncAll(p => { stat.textContent = '同步中：' + p; });
        const now = await store.getMeta('last_sync_at', null);
        stat.textContent = '已配置（' + (selPlatform === 'gitee' ? 'Gitee' : 'GitHub') + '）· 上次同步：' + (now ? ui.fmtDateTime(now) : '刚刚');
        ui.toast(r && r.pulled ? ('同步完成，已合并 ' + r.pulled + ' 项云端更新') : '同步完成', 'success');
      } catch (e) {
        stat.textContent = '同步失败';
        ui.toast('同步失败：' + e.message, 'error');
      }
    };

    root.querySelector('#export').onclick = async () => {
      const text = await sync.exportAll();
      const blob = new Blob([text], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'workbench-backup-' + Date.now() + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
      ui.toast('已导出备份', 'success');
    };

    root.querySelector('#import').onclick = () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.json,application/json';
      input.onchange = async () => {
        const f = input.files[0]; if (!f) return;
        try {
          const text = await f.text();
          await sync.importAll(text);
          ui.toast('导入成功，已合并到本地', 'success');
          WB.app.reload();
        } catch (e) { ui.toast('导入失败：' + e.message, 'error'); }
      };
      input.click();
    };
  }

  WB.modules.push({ id: 'settings', title: '设置', icon: 'settings', render });
})(window.WB = window.WB || {});
