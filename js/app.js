// app.js - 应用外壳、路由、响应式导航与初始化
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui, sync = WB.sync;
  let viewEl, sidebarEl, bottomEl, syncDot, appEl;

  let _ids = null;
  function currentId() {
    const h = location.hash.replace(/^#\/?/, '');
    if (!_ids) _ids = WB.modules.map(m => m.id); // L5：模块 id 列表只算一次
    return _ids.indexOf(h) >= 0 ? h : WB.modules[0].id;
  }

  // 导航 DOM 只构建一次（init 时调用），route 时仅切换 active 类，
  // 避免每次切换重建导致焦点丢失、动画重置（I1）
  function buildNav() {
    const item = m => `<button class="nav-item" data-id="${m.id}">
        <span class="nav-icon">${ui.icon(m.icon)}</span><span class="nav-label">${ui.escapeHtml(m.title)}</span></button>`;
    sidebarEl.innerHTML = WB.modules.map(item).join('');
    bottomEl.innerHTML = WB.modules.map(item).join('');
  }

  function setActiveNav(id) {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.id === id));
  }

  async function route() {
    const id = currentId();
    const mod = WB.modules.find(m => m.id === id);
    if (!mod) return;
    setActiveNav(id);
    store.clearSubs(); // L2：清除上一个模块的数据订阅，避免跨页回调
    viewEl.innerHTML = ui.skeleton(6); // S5：骨架屏占位，数据就绪后替换
    try { await mod.render(viewEl); }
    catch (e) { viewEl.innerHTML = '<div class="empty">加载出错：' + ui.escapeHtml(e.message) + '</div>'; }
    closeDrawer();
  }

  function reload() { route(); }

  function updateSyncDot() {
    const online = navigator.onLine;
    syncDot.className = 'sync-dot ' + (online ? 'on' : 'off');
    syncDot.title = online ? '已联网' : '离线（改动将本地保存，联网后自动同步）';
  }

  async function autoSync() {
    if (!sync.isConfigured() || !navigator.onLine) return;
    try {
      const r = await sync.syncAll();
      if (r && r.pulled) ui.toast('已从云端合并 ' + r.pulled + ' 项更新', 'info'); // L6
    }
    catch (e) { ui.toast('自动同步部分失败：' + e.message, 'warn'); }
  }

  // 数据写入后防抖自动同步（2.5s），避免每次编辑都打一次网络请求
  let syncTimer = null;
  function scheduleSync() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { autoSync(); }, 2500);
  }

  // I6 命令面板：Cmd/Ctrl+K 唤起，键盘优先跨模块跳转
  function openPalette() {
    if (document.querySelector('.palette-overlay')) return;
    const overlay = document.createElement('div');
    overlay.className = 'palette-overlay';
    overlay.innerHTML = '<div class="palette"><input class="input palette-input" placeholder="跳转到模块…（↑↓ 选择，Enter 进入，Esc 关闭）"><div class="palette-list"></div></div>';
    document.body.appendChild(overlay);
    const input = overlay.querySelector('.palette-input');
    const listEl = overlay.querySelector('.palette-list');
    let idx = 0;
    function items() {
      const q = (input.value || '').toLowerCase();
      return WB.modules.filter(m => !q || m.title.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
    }
    function renderList() {
      const its = items();
      if (idx >= its.length) idx = Math.max(0, its.length - 1);
      listEl.innerHTML = its.map((m, i) => `<div class="palette-item ${i === idx ? 'active' : ''}" data-id="${m.id}">${ui.icon(m.icon, 16)}<span>${ui.escapeHtml(m.title)}</span></div>`).join('');
    }
    function close() { overlay.remove(); document.body.style.overflow = ''; }
    renderList();
    setTimeout(() => input.focus(), 30);
    input.addEventListener('input', () => { idx = 0; renderList(); });
    input.addEventListener('keydown', e => {
      const its = items();
      if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(idx + 1, its.length - 1); renderList(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(idx - 1, 0); renderList(); }
      else if (e.key === 'Enter') { const m = its[idx]; if (m) { close(); location.hash = '#/' + m.id; } }
      else if (e.key === 'Escape') { close(); }
    });
    listEl.addEventListener('click', e => { const it = e.target.closest('.palette-item'); if (it) { close(); location.hash = '#/' + it.dataset.id; } });
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.body.style.overflow = 'hidden';
  }

  function openDrawer() { appEl.classList.add('drawer-open'); }
  function closeDrawer() { appEl.classList.remove('drawer-open'); }

  async function init() {
    appEl = document.getElementById('app');
    sidebarEl = document.getElementById('sidebar');
    const initDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
      (!document.documentElement.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.getElementById('menu-toggle').innerHTML = ui.icon('menu', 22);
    document.getElementById('theme-toggle').innerHTML = ui.icon(initDark ? 'moon' : 'sun', 20);
    bottomEl = document.getElementById('bottomtabs');
    viewEl = document.getElementById('view');
    syncDot = document.getElementById('sync-dot');

    await store.open();
    await sync.loadCfg();
    await ui.initTheme();

    // 顶部栏交互
    document.getElementById('theme-toggle').onclick = async () => {
      const cur = document.documentElement.getAttribute('data-theme');
      const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const curEff = cur || (sysDark ? 'dark' : 'light');
      const next = curEff === 'dark' ? 'light' : 'dark';
      await ui.setTheme(next);
      // 图标统一表示"当前主题"：深色显示月亮、浅色显示太阳（与 init 保持一致，修复 H3 语义矛盾）
      document.getElementById('theme-toggle').innerHTML = ui.icon(next === 'dark' ? 'moon' : 'sun', 20);
      ui.toast('已切换到' + (next === 'dark' ? '深色' : '浅色'));
    };
    document.getElementById('menu-toggle').onclick = openDrawer;
    document.getElementById('backdrop').onclick = closeDrawer;
    syncDot.onclick = () => { location.hash = '#/settings'; };

    // 导航点击
    document.body.addEventListener('click', e => {
      const item = e.target.closest('.nav-item');
      if (item) { location.hash = '#/' + item.dataset.id; }
    });

    window.addEventListener('hashchange', route);
    document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); } });
    window.addEventListener('online', () => { updateSyncDot(); autoSync(); });
    window.addEventListener('offline', updateSyncDot);
    updateSyncDot();
    buildNav();
    // 阅读模块一次性种子（微信读书同步数据），需在任何 render 之前完成，确保首页面板即时呈现
    if (WB.seedReading) { try { await WB.seedReading(); } catch (e) {} }
    await route();

    // 启动后若已配置且联网，立即同步一次（拉取云端 + 推送本地）
    if (sync.isConfigured() && navigator.onLine) autoSync();

    // 注册 Service Worker（PWA 离线）
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  WB.app = { init, reload, route, scheduleSync };
  document.addEventListener('DOMContentLoaded', init);
})(window.WB = window.WB || {});
