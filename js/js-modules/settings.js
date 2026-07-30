// module: settings 设置（同步配置 / 主题 / 导入导出）
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui, sync = WB.sync;

  async function render(root) {
    const cfg = sync.cfg;
    const last = await store.getMeta('last_sync_at', null);
    const configured = sync.isConfigured();

    root.innerHTML = `
      <div class="page">
        <div class="page-head"><h1>⚙️ 设置</h1></div>

        <section class="card section">
          <h2>数据同步（GitHub）</h2>
          <p class="muted">在 GitHub 生成一个具有 <b>repo</b> 权限的 Personal Access Token，并准备一个<strong>私有仓库</strong>存放数据。Token 仅保存在本机浏览器。</p>
          <div class="form">
            <label>仓库（owner/name）<input id="s-repo" class="input" value="${ui.escapeHtml(cfg.repo || '')}" placeholder="yourname/my-workbench-data"></label>
            <label>Personal Access Token<input id="s-token" class="input" type="password" placeholder="${configured ? '已保存，留空则不修改' : 'ghp_...'}"></label>
            <label>分支<input id="s-branch" class="input" value="${ui.escapeHtml(cfg.branch || 'main')}"></label>
          </div>
          <div class="row-actions">
            <button class="btn primary" id="save-cfg">保存配置</button>
            <button class="btn ghost" id="sync-now">立即同步</button>
            <button class="btn ghost danger" id="clear-cfg">清除凭证</button>
          </div>
          <div class="sync-stat" id="sync-stat">${configured ? '已配置 · 上次同步：' + (last ? ui.fmtDateTime(last) : '从未') : '未配置'}</div>
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
        </section>

        <section class="card section">
          <h2>关于</h2>
          <p class="muted">个人工作台 · 纯静态 PWA · 离线优先 · 数据存于本地与私有仓库。<br>所有数据默认仅存在于你的设备与你的 GitHub 私有仓库。</p>
        </section>
      </div>`;

    const stat = root.querySelector('#sync-stat');
    root.querySelector('#s-theme').value = await store.getMeta('theme', 'auto');
    root.querySelector('#s-theme').addEventListener('change', async e => {
      await ui.setTheme(e.target.value); ui.toast('主题已更新');
    });

    root.querySelector('#save-cfg').onclick = async () => {
      const repo = root.querySelector('#s-repo').value.trim();
      const token = root.querySelector('#s-token').value.trim();
      const branch = root.querySelector('#s-branch').value.trim() || 'main';
      if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) { ui.toast('仓库格式应为 owner/name', 'warn'); return; }
      const finalToken = token || cfg.token;
      if (!finalToken) { ui.toast('请填写 Token', 'warn'); return; }

      // 先验证 Token 能访问该仓库，避免同步时才报 401
      stat.textContent = '验证中…';
      try {
        const r = await fetch('https://api.github.com/repos/' + repo, {
          headers: { Authorization: 'Bearer ' + finalToken, Accept: 'application/vnd.github+json' }
        });
        if (r.status === 401) throw new Error('Token 无效或已过期，请重新输入');
        if (r.status === 404) throw new Error('找不到仓库 ' + repo + '，请检查名称或 Token 是否有 repo 权限');
        if (!r.ok) throw new Error('验证失败 ' + r.status);
      } catch (e) {
        stat.textContent = '验证失败：' + e.message;
        ui.toast('配置验证失败：' + e.message, 'error');
        return;
      }

      await sync.setConfig(finalToken, repo, branch);
      stat.textContent = '已配置 · ' + repo;
      ui.toast('配置已保存', 'success');

      // 保存后若联网，立即尝试同步一次，把现有数据推上去
      if (navigator.onLine) {
        stat.textContent = '首次同步中…';
        try {
          await sync.syncAll(p => { stat.textContent = '同步中：' + p; });
          const now = await store.getMeta('last_sync_at', null);
          stat.textContent = '已配置 · 上次同步：' + (now ? ui.fmtDateTime(now) : '刚刚');
          ui.toast('同步完成', 'success');
        } catch (e) {
          stat.textContent = '同步失败：' + e.message;
          ui.toast('同步失败：' + e.message, 'error');
        }
      }
    };

    root.querySelector('#clear-cfg').onclick = async () => {
      if (await ui.confirm('确定清除本地保存的 Token 与仓库信息？')) {
        await sync.clearConfig(); stat.textContent = '未配置'; ui.toast('已清除凭证');
      }
    };

    root.querySelector('#sync-now').onclick = async () => {
      if (!sync.isConfigured()) { ui.toast('请先保存同步配置', 'warn'); return; }
      stat.textContent = '同步中…';
      try {
        await sync.syncAll(p => { stat.textContent = '同步中：' + p; });
        const now = await store.getMeta('last_sync_at', null);
        stat.textContent = '已配置 · 上次同步：' + (now ? ui.fmtDateTime(now) : '刚刚');
        ui.toast('同步完成', 'success');
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

  WB.modules.push({ id: 'settings', title: '设置', icon: '⚙️', render });
})(window.WB = window.WB || {});
