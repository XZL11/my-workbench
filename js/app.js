// app.js - 应用外壳、路由、响应式导航与初始化
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui, sync = WB.sync;
  let viewEl, sidebarEl, bottomEl, syncDot, appEl;

  function currentId() {
    const h = location.hash.replace(/^#\/?/, '');
    const ids = WB.modules.map(m => m.id);
    return ids.indexOf(h) >= 0 ? h : WB.modules[0].id;
  }

  function renderNav() {
    const cur = currentId();
    const item = m => `<button class="nav-item ${m.id === cur ? 'active' : ''}" data-id="${m.id}">
        <span class="nav-icon">${ui.icon(m.icon)}</span><span class="nav-label">${ui.escapeHtml(m.title)}</span></button>`;
    sidebarEl.innerHTML = WB.modules.map(item).join('');
    bottomEl.innerHTML = WB.modules.map(item).join('');
  }

  async function route() {
    const id = currentId();
    const mod = WB.modules.find(m => m.id === id);
    if (!mod) return;
    renderNav();
    viewEl.innerHTML = '<div class="loading">加载中…</div>';
    try { await mod.render(viewEl); }
    catch (e) { viewEl.innerHTML = '<div class="empty">加载出错：' + ui.escapeHtml(e.message) + '</div>'; }
    // 把卡片内的 emoji 操作按钮替换为统一 SVG 图标
    viewEl.querySelectorAll('.icon-btn').forEach(b => {
      const t = (b.textContent || '').trim();
      const map = { '✏️': 'pencil', '🗑️': 'trash', '➕': 'plus', '＋': 'plus' };
      if (map[t]) b.innerHTML = ui.icon(map[t], 16);
    });
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
    try { await sync.syncAll(); }
    catch (e) { ui.toast('自动同步部分失败：' + e.message, 'warn'); }
  }

  // 数据写入后防抖自动同步（2.5s），避免每次编辑都打一次网络请求
  let syncTimer = null;
  function scheduleSync() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { autoSync(); }, 2500);
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
      document.getElementById('theme-toggle').innerHTML = ui.icon(next === 'dark' ? 'sun' : 'moon', 20);
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
    window.addEventListener('online', () => { updateSyncDot(); autoSync(); });
    window.addEventListener('offline', updateSyncDot);
    updateSyncDot();

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
