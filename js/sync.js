// sync.js - 基于 GitHub Contents API 的双向同步引擎
(function (WB) {
  'use strict';
  const store = WB.store;
  let cfg = { token: null, repo: null, branch: 'main' };

  async function loadCfg() {
    cfg.token = await store.getMeta('gh_token', null);
    cfg.repo = await store.getMeta('gh_repo', null);
    cfg.branch = await store.getMeta('gh_branch', 'main');
  }
  function isConfigured() { return !!(cfg.token && cfg.repo); }
  async function setConfig(token, repo, branch) {
    cfg.token = token; cfg.repo = repo; cfg.branch = branch || 'main';
    await store.setMeta('gh_token', token);
    await store.setMeta('gh_repo', repo);
    await store.setMeta('gh_branch', cfg.branch);
  }
  async function clearConfig() {
    cfg.token = null; cfg.repo = null;
    await store.setMeta('gh_token', null);
    await store.setMeta('gh_repo', null);
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
    const headers = Object.assign({
      Authorization: 'token ' + cfg.token,
      Accept: 'application/vnd.github+json'
    }, opts.headers || {});
    return fetch('https://api.github.com' + path, Object.assign({ headers }, opts));
  }

  // 返回 { sha, items } 或 null(404)
  async function getFile(path) {
    const res = await api('/repos/' + cfg.repo + '/contents/' + path + '?ref=' + cfg.branch);
    if (res.status === 404) return null;
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error('GitHub ' + res.status + '：' + (e.message || res.statusText));
    }
    const data = await res.json();
    const content = data.content ? b64decode(data.content) : '[]';
    let json = [];
    try { json = JSON.parse(content); } catch (e) { json = []; }
    return { sha: data.sha, items: Array.isArray(json) ? json : (json.items || []) };
  }

  async function putFile(path, items, sha) {
    const body = {
      message: 'workbench sync: ' + path + ' @ ' + new Date().toISOString(),
      content: b64encode(JSON.stringify(items, null, 2)),
      branch: cfg.branch
    };
    if (sha) body.sha = sha;
    const res = await api('/repos/' + cfg.repo + '/contents/' + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error('提交失败 ' + res.status + '：' + (e.message || res.statusText));
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
    for (const name of store.SYNC_STORES) {
      try {
        if (onProgress) onProgress('同步 ' + name + ' …');
        results[name] = await syncModule(name);
      } catch (e) {
        errors.push(name + '：' + e.message);
      }
    }
    await store.setMeta('last_sync_at', Date.now());
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
    loadCfg, isConfigured, setConfig, clearConfig,
    syncAll, syncModule, exportAll, importAll,
    get cfg() { return cfg; },
    onOnline(handler) { window.addEventListener('online', handler); }
  };
})(window.WB = window.WB || {});
