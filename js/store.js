// store.js - IndexedDB 本地数据层（离线优先）
(function (WB) {
  'use strict';
  WB.modules = WB.modules || []; // 功能模块注册表（模块文件先于 app.js 加载）
  const DB_NAME = 'workbench-db';
  const DB_VERSION = 1;
  const STORES = ['tasks', 'calendar', 'notes', 'habits', 'habitlogs', 'bookmarks', 'finance', 'content', 'planning', 'meta'];
  const SYNC_STORES = STORES.filter(s => s !== 'meta');
  let _db = null;
  let _suppressSync = false; // 同步自身的写操作不触发再次同步，避免死循环

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        STORES.forEach(name => {
          if (!db.objectStoreNames.contains(name)) {
            const os = db.createObjectStore(name, { keyPath: 'id' });
            os.createIndex('updatedAt', 'updatedAt', { unique: false });
          }
        });
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  function _tx(store, mode) {
    return open().then(db => db.transaction(store, mode).objectStore(store));
  }
  function _p(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAll(store) {
    const os = await _tx(store, 'readonly');
    return _p(os.getAll());
  }
  async function get(store, id) {
    const os = await _tx(store, 'readonly');
    return _p(os.get(id));
  }
  function afterWrite() {
    if (!_suppressSync && WB.app && WB.app.scheduleSync) WB.app.scheduleSync();
  }
  // L2 数据订阅：写操作后通知视图订阅者，避免散落 reload
  let _subs = {};
  function subscribe(name, cb) {
    (_subs[name] = _subs[name] || new Set()).add(cb);
    return () => { if (_subs[name]) _subs[name].delete(cb); };
  }
  function notify(name) { if (_subs[name]) _subs[name].forEach(cb => { try { cb(); } catch (e) {} }); }
  function clearSubs() { _subs = {}; }
  async function put(store, item) {
    if (store !== 'meta' && item && item.id) {
      item.updatedAt = Math.max(item.updatedAt || 0, Date.now());
    }
    const os = await _tx(store, 'readwrite');
    await _p(os.put(item));
    afterWrite();
    notify(store);
    return item;
  }
  async function bulkPut(store, items) {
    const os = await _tx(store, 'readwrite');
    const tx = os.transaction;
    for (const it of items) {
      if (store !== 'meta' && it && it.id && !it.updatedAt) it.updatedAt = Date.now();
      os.put(it);
    }
    afterWrite();
    notify(store);
    return new Promise((res, rej) => {
      tx.oncomplete = () => res(items);
      tx.onerror = () => rej(tx.error);
    });
  }
  // 软删除（墓碑），便于跨设备同步删除
  async function remove(store, id) {
    const item = await get(store, id);
    if (!item) return;
    if (store === 'meta') {
      const os = await _tx(store, 'readwrite');
      await _p(os.delete(id));
      return;
    }
    item._deleted = true;
    item.updatedAt = Date.now();
    const os = await _tx(store, 'readwrite');
    await _p(os.put(item));
    afterWrite();
    notify(store);
  }
  async function hardDelete(store, id) {
    const os = await _tx(store, 'readwrite');
    await _p(os.delete(id));
  }
  async function clear(store) {
    const os = await _tx(store, 'readwrite');
    await _p(os.clear());
  }
  async function getMeta(key, def) {
    const v = await get('meta', key);
    return v ? v.value : def;
  }
  async function setMeta(key, value) {
    const os = await _tx('meta', 'readwrite');
    await _p(os.put({ id: key, value }));
    return value;
  }

  WB.store = {
    open, getAll, get, put, bulkPut, remove, hardDelete, clear,
    getMeta, setMeta, uid, STORES, SYNC_STORES, DB_NAME,
    subscribe, clearSubs,
    setSuppressSync(v) { _suppressSync = !!v; }
  };
})(window.WB = window.WB || {});
