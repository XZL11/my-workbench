// module: lottery 中国体育彩票（官方开奖查询 + 历史回顾 + 频次统计）
// 说明：数据来自中国体育彩票官方 web 接口，仅做公开结果的查询与回顾。
//       彩票每期都是独立随机事件，任何统计都不能提高中奖率——UI 上必须明确标注。
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui;

  // 排列3 与排列5 同源于同一次开奖（gameNo 都是 35）：排列3 取前 3 位，排列5 取 5 位
  const GAMES = [
    { id: 'dlt', no: '85', name: '超级大乐透', kind: 'dlt', hint: '前区 1-35 选 5 ＋ 后区 1-12 选 2' },
    { id: 'pls', no: '35', name: '排列3', kind: 'digit', len: 3, hint: '0-9 选 3（与排列5 同一次开奖，取前 3 位）' },
    { id: 'plw', no: '35', name: '排列5', kind: 'digit', len: 5, hint: '0-9 选 5' },
    { id: 'qxc', no: '04', name: '七星彩', kind: 'digit', len: 7, hint: '0-9 选 7' }
  ];
  const PAGE_SIZE = 100;
  const STEP = 20;
  const byId = id => GAMES.filter(g => g.id === id)[0] || GAMES[0];

  // 按 gameNo+页码缓存：排列3/5 共用 35，切换时无需重新请求
  const _cache = {};

  async function fetchDraws(no, pageNo) {
    const key = no + ':' + pageNo;
    if (_cache[key]) return _cache[key];
    const url = 'https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry?gameNo=' + encodeURIComponent(no) +
      '&provinceId=0&pageSize=' + PAGE_SIZE + '&isVerify=1&pageNo=' + pageNo;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const v = j && j.value;
    if (!v) throw new Error('接口未返回数据（可能被限流，稍后再试）');
    const res = { list: v.list || [], pages: v.pages || 1, total: v.total || 0 };
    _cache[key] = res;
    return res;
  }

  function splitNums(s) { return String(s || '').trim().split(/\s+/).filter(Boolean); }

  // 解析一期 → { front:[], back:[], digits:[] }
  function parseOne(game, it) {
    const raw = splitNums(it && it.lotteryDrawResult);
    if (game.kind === 'dlt') return { front: raw.slice(0, 5), back: raw.slice(5, 7) };
    if (game.id === 'plw') {
      const u = splitNums(it && it.lotteryUnsortDrawresult);
      return { digits: (u.length >= 5 ? u : raw).slice(0, 5) };
    }
    return { digits: raw.slice(0, game.len) };
  }

  function money(n) {
    const v = Number(String(n == null ? '' : n).replace(/,/g, '')) || 0;
    if (!v) return '—';
    if (v >= 1e8) return (v / 1e8).toFixed(2) + ' 亿';
    if (v >= 1e4) return (v / 1e4).toFixed(2) + ' 万';
    return String(v);
  }

  // 频次统计：大乐透分前区/后区；数字彩按位统计
  function stats(game, rows) {
    if (game.kind === 'dlt') {
      const f = {}, b = {};
      rows.forEach(it => {
        const p = parseOne(game, it);
        p.front.forEach(n => { f[n] = (f[n] || 0) + 1; });
        p.back.forEach(n => { b[n] = (b[n] || 0) + 1; });
      });
      return { groups: [{ label: '前区', lo: 1, hi: 35, map: f }, { label: '后区', lo: 1, hi: 12, map: b }] };
    }
    const byPos = [];
    for (let i = 0; i < game.len; i++) byPos.push({});
    rows.forEach(it => {
      const p = parseOne(game, it);
      p.digits.forEach((n, i) => { if (byPos[i]) byPos[i][n] = (byPos[i][n] || 0) + 1; });
    });
    return { groups: byPos.map((m, i) => ({ label: '第 ' + (i + 1) + ' 位', lo: 0, hi: 9, map: m })) };
  }

  /* ---------------- 渲染 ---------------- */
  function ball(n, extra) {
    return '<span class="lot-ball ' + (extra || '') + '">' + ui.escapeHtml(n) + '</span>';
  }
  function ballsOf(game, p, small) {
    const s = small ? ' sm' : '';
    if (game.kind === 'dlt') {
      return p.front.map(n => ball(n, 'front' + s)).join('') +
        '<span class="lot-sep">+</span>' + p.back.map(n => ball(n, 'back' + s)).join('');
    }
    return p.digits.map(n => ball(n, 'digit' + s)).join('');
  }

  function latestHTML(game, it) {
    if (!it) return '';
    const p = parseOne(game, it);
    let meta = '';
    if (game.kind === 'dlt') {
      meta = '<div class="lot-meta"><span>奖池 <b>' + money(it.poolBalanceAfterdraw) + '</b></span>' +
        '<span>本期销量 <b>' + money(it.totalSaleAmount) + '</b></span></div>';
    }
    return '<div class="card section lot-latest">' +
      '<div class="lot-lt-head">' + ui.escapeHtml(game.name) +
      ' <span class="muted">第 ' + ui.escapeHtml(it.lotteryDrawNum) + ' 期 · ' + ui.escapeHtml(it.lotteryDrawTime) + '</span></div>' +
      '<div class="lot-balls">' + ballsOf(game, p, false) + '</div>' + meta +
      '<div class="lot-hint muted">' + ui.escapeHtml(game.hint) + '</div>' +
      '</div>';
  }

  function statsHTML(game, rows) {
    if (!rows.length) return '';
    const s = stats(game, rows);
    let h = '<div class="card section">' +
      '<div class="sec-title">出现频次 <span class="muted">基于已加载 ' + rows.length + ' 期 · 仅为历史回顾</span></div>';
    s.groups.forEach(g => {
      const cells = [];
      for (let n = g.lo; n <= g.hi; n++) {
        const k = String(n), k2 = k.length < 2 ? '0' + k : k;
        cells.push({ t: k2, c: g.map[k] || g.map[k2] || 0 });
      }
      const max = cells.reduce((m, x) => Math.max(m, x.c), 1);
      h += '<div class="lot-fg"><div class="lot-fg-label muted">' + ui.escapeHtml(g.label) + '</div>' +
        '<div class="lot-fg-grid">' + cells.map(x => {
          let c = x.c === 0 ? ' zero' : (x.c >= max ? ' hot' : (x.c >= max * 0.75 ? ' warm' : ''));
          return '<span class="lot-cell' + c + '" title="' + x.t + ' 出现 ' + x.c + ' 次">' +
            '<i>' + x.t + '</i><em>' + x.c + '</em></span>';
        }).join('') + '</div></div>';
    });
    h += '<div class="hint muted">冷热号只是对<b>已开奖</b>结果的回顾。每一期都是独立随机事件，' +
      '<b>下一期每个号码的概率完全相同</b>，据此选号不会提高中奖率。</div></div>';
    return h;
  }

  function histHTML(game, rows, shown) {
    return rows.slice(0, shown).map(it => {
      const p = parseOne(game, it);
      return '<div class="lot-row">' +
        '<span class="lot-rn muted">' + ui.escapeHtml(it.lotteryDrawNum) + '</span>' +
        '<span class="lot-rb">' + ballsOf(game, p, true) + '</span>' +
        '<span class="lot-rd muted">' + ui.escapeHtml(it.lotteryDrawTime) + '</span></div>';
    }).join('');
  }

  /* ---------------- 视图 ---------------- */
  async function render(root) {
    let cur = byId(await store.getMeta('lottery_game', 'dlt'));
    let rows = [], total = 0, pages = 1, page = 1, shown = STEP;
    let loading = false, err = '';

    root.innerHTML = '<div class="page">' +
      ui.pageHead('lottery', '体育彩票', { subtitle: '官方开奖查询 · 历史回顾' }) +
      '<div id="lot-body">' + ui.skeleton(3) + '</div>' +
      '<div class="lot-disclaimer">数据来自中国体育彩票官方接口，以官方公告为准。' +
      '彩票为独立随机事件，任何统计都不能提高中奖率，请理性购彩。</div>' +
      '</div>';
    const body = root.querySelector('#lot-body');

    function chipsHTML() {
      return '<div class="chips lot-chips">' + GAMES.map(g =>
        '<button class="chip' + (g.id === cur.id ? ' active' : '') + '" data-g="' + g.id + '">' +
        ui.escapeHtml(g.name) + '</button>').join('') + '</div>';
    }
    function viewHTML() {
      if (loading && !rows.length) return chipsHTML() + '<div class="card section"><div class="lot-empty muted">正在获取开奖数据…</div></div>';
      if (err && !rows.length) return chipsHTML() + '<div class="card section"><div class="lot-empty muted">获取失败：' + ui.escapeHtml(err) + '</div></div>';
      const canMore = shown < rows.length || page < pages;
      return chipsHTML() +
        latestHTML(cur, rows[0]) +
        statsHTML(cur, rows) +
        '<div class="card section">' +
          '<div class="sec-title">历史开奖 <span class="muted">已加载 ' + rows.length + ' / 共 ' + (total || rows.length) + ' 期</span></div>' +
          (rows.length ? '<div class="lot-hist">' + histHTML(cur, rows, shown) + '</div>'
            : '<div class="lot-empty muted">暂无数据</div>') +
          (canMore ? '<button class="btn ghost sm" id="lot-more" style="margin-top:10px">加载更多</button>' : '') +
        '</div>';
    }
    function paint() { body.innerHTML = viewHTML(); bind(); }

    function bind() {
      body.querySelectorAll('[data-g]').forEach(b => {
        b.onclick = () => {
          const id = b.dataset.g;
          if (id === cur.id) return;
          cur = byId(id); page = 1; rows = []; shown = STEP; total = 0; err = '';
          store.setMeta('lottery_game', id);
          load(false);
        };
      });
      const more = body.querySelector('#lot-more');
      if (more) more.onclick = () => {
        if (shown < rows.length) { shown += STEP; paint(); }
        else load(true);
      };
    }

    async function load(next) {
      if (loading) return;
      loading = true; err = '';
      if (next) page++;
      paint();
      try {
        const res = await fetchDraws(cur.no, page);
        if (next) rows = rows.concat(res.list);
        else { rows = res.list; shown = STEP; }
        pages = res.pages; total = res.total;
      } catch (e) {
        err = (e && e.message) || '获取失败';
        if (next) page--;
      }
      loading = false;
      paint();
    }

    load(false);
  }

  // 暴露纯函数，便于校验
  WB.lottery = { GAMES, byId, parseOne, stats, fetchDraws };

  WB.modules.push({ id: 'lottery', title: '体育彩票', icon: 'lottery', render });
})(window.WB = window.WB || {});
