// sync.js - 基于 GitHub / Gitee Contents API 的双向同步引擎
(function (WB) {
  'use strict';
  const store = WB.store;

  // 平台配置：base=API 基地址, accept=Accept 头, auth=鉴权头, branchDefault=默认分支, createMethod=新建文件用的 HTTP 方法
  const PLATFORMS = {
    github: {
      label: 'GitHub',
      base: 'https://api.github.com',
      accept: 'application/vnd.github+json',
      auth: t => 'Bearer ' + t,
      branchDefault: 'main',
      createMethod: 'PUT'
    },
    gitee: {
      label: 'Gitee',
      base: 'https://gitee.com/api/v5',
      accept: 'application/json',
      auth: t => 'token ' + t,
      branchDefault: 'master',
      createMethod: 'POST'
    }
  };

  let cfg = { platform: 'github', token: null, repo: null, branch: 'main' };

  async function loadCfg() {
    let p = await store.getMeta('sync_platform', 'github');
    if (!PLATFORMS[p]) p = 'github';
    cfg.platform = p;
    cfg.token = await store.getMeta(p + '_token', null);
    cfg.repo = await store.getMeta(p + '_repo', null);
    cfg.branch = await store.getMeta(p + '_branch', null) || PLATFORMS[p].branchDefault;
    // 兼容旧版键名 gh_token/gh_repo/gh_branch（仅 GitHub 平台）
    if (p === 'github' && cfg.token == null) {
      const oldToken = await store.getMeta('gh_token', null);
      if (oldToken != null) {
        cfg.token = oldToken;
        cfg.repo = await store.getMeta('gh_repo', null);
        cfg.branch = await store.getMeta('gh_branch', null) || PLATFORMS.github.branchDefault;
        await store.setMeta('github_token', cfg.token);
        await store.setMeta('github_repo', cfg.repo);
        await store.setMeta('github_branch', cfg.branch);
        await store.setMeta('gh_token', null);
        await store.setMeta('gh_repo', null);
        await store.setMeta('gh_branch', null);
      }
    }
  }
  function isConfigured() { return !!(cfg.token && cfg.repo); }
  async function setConfig(platform, token, repo, branch) {
    cfg.platform = platform;
    cfg.token = token; cfg.repo = repo; cfg.branch = branch || PLATFORMS[platform].branchDefault;
    await store.setMeta('sync_platform', platform);
    await store.setMeta(platform + '_token', token);
    await store.setMeta(platform + '_repo', repo);
    await store.setMeta(platform + '_branch', cfg.branch);
  }
  async function clearConfig() {
    const p = cfg.platform;
    await store.setMeta(p + '_token', null);
    await store.setMeta(p + '_repo', null);
    cfg.token = null; cfg.repo = null;
  }

  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64decode(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function api(path, opts) {
    opts = opts || {};
    const p = PLATFORMS[cfg.platform] || PLATFORMS.github;
    const headers = Object.assign({
      Authorization: p.auth(cfg.token),
      Accept: p.accept
    }, opts.headers || {});
    return fetch(p.base + path, Object.assign({}, opts, { headers }));
  }

  // 保存前校验 Token 能否访问该仓库，避免同步时才报 401
  async function validateToken(platform, token, repo) {
    const p = PLATFORMS[platform] || PLATFORMS.github;
    const r = await fetch(p.base + '/repos/' + repo, {
      headers: { Authorization: p.auth(token), Accept: p.accept }
    });
    if (r.status === 401) throw new Error('Token 无效或已过期，请重新输入');
    if (r.status === 403) throw new Error('令牌无写权限：请在 Gitee 重新生成私人令牌并勾选 projects 权限');
    if (r.status === 404) throw new Error('找不到仓库 ' + repo + '，请检查名称或 Token 权限');
    if (!r.ok) throw new Error('验证失败 ' + r.status);
    return true;
  }

  // 返回 { sha, items } 或 null(404)
  async function getFile(path) {
    const res = await api('/repos/' + cfg.repo + '/contents/' + path + '?ref=' + cfg.branch);
    if (res.status === 404) return null;
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      const label = (PLATFORMS[cfg.platform] || PLATFORMS.github).label;
      throw new Error(label + ' ' + res.status + '：' + (e.message || res.statusText));
    }
    const data = await res.json();
    const content = data.content ? b64decode(data.content) : '[]';
    let json = [];
    try { json = JSON.parse(content); } catch (e) { json = []; }
    return { sha: data.sha, items: Array.isArray(json) ? json : (json.items || []) };
  }

  async function putFile(path, items, sha) {
    const p = PLATFORMS[cfg.platform] || PLATFORMS.github;
    const body = {
      message: 'workbench sync: ' + path + ' @ ' + new Date().toISOString(),
      content: b64encode(JSON.stringify(items, null, 2)),
      branch: cfg.branch
    };
    if (sha) body.sha = sha;
    // GitHub 用 PUT 同时支持新建/更新；Gitee 新建用 POST，更新用 PUT
    const method = sha ? 'PUT' : p.createMethod;
    const res = await api('/repos/' + cfg.repo + '/contents/' + path, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      let msg = e.message || res.statusText;
      if (res.status === 403) msg = '令牌无写权限（请确认 Gitee 私人令牌勾选了 projects 权限）';
      throw new Error('提交失败 ' + res.status + '：' + msg);
    }
    const data = await res.json();
    return data.content.sha;
  }

  function mergeArrays(local, remote) {
    const map = new Map();
    (local || []).forEach(i => { if (i && i.id) map.set(i.id, i); });
    (remote || []).forEach(i => {
      if (!i || !i.id) return;
      const ex = map.get(i.id);
      if (!ex || (i.updatedAt || 0) > (ex.updatedAt || 0)) map.set(i.id, i);
    });
    return Array.from(map.values());
  }

  async function syncModule(name) {
    const local = (await store.getAll(name)).filter(i => i && i.id);
    const remote = await getFile('data/' + name + '.json');
    if (!remote) {
      await putFile('data/' + name + '.json', local, null);
      return local.length;
    }
    const merged = mergeArrays(local, remote.items);
    await store.bulkPut(name, merged);
    await putFile('data/' + name + '.json', merged, remote.sha);
    return merged.length;
  }

  async function syncAll(onProgress) {
    const results = {};
    const errors = [];
    store.setSuppressSync(true); // 同步内部的写操作不要再次触发自动同步
    try {
      for (const name of store.SYNC_STORES) {
        try {
          if (onProgress) onProgress('同步 ' + name + ' …');
          results[name] = await syncModule(name);
        } catch (e) {
          errors.push(name + '：' + e.message);
        }
      }
      await store.setMeta('last_sync_at', Date.now());
    } finally {
      store.setSuppressSync(false);
    }
    if (errors.length) throw new Error('部分模块同步失败 — ' + errors.join('；'));
    return results;
  }

  async function exportAll() {
    const out = {};
    for (const name of store.SYNC_STORES) out[name] = await store.getAll(name);
    return JSON.stringify(out, null, 2);
  }
  async function importAll(text) {
    const data = JSON.parse(text);
    for (const name of store.SYNC_STORES) {
      if (Array.isArray(data[name])) await store.bulkPut(name, data[name]);
    }
    return true;
  }

  WB.sync = {
    loadCfg, isConfigured, setConfig, clearConfig, validateToken,
    syncAll, syncModule, exportAll, importAll,
    get cfg() { return cfg; },
    onOnline(handler) { window.addEventListener('online', handler); }
  };
})(window.WB = window.WB || {});
