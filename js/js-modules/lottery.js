// module: lottery 竞彩（竞彩足球 / 竞彩篮球）——官方公开赔率查询 + AI 单场分析 + 每日购彩参考
// 说明：
//   数据来自中国体彩官方 web 接口（webapi.sporttery.cn/gateway/jc/*，CORS 开放），仅展示公开赛事与赔率。
//   竞彩是真实体育赛事，AI 只做"赔率隐含概率 + 盘口 + 常识"的条件化解读，不保证赛果。
//   UI 与 AI 输出一律强制标注：理性购彩、量力而行、不构成购彩建议；18 岁以下不得购彩。
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui;

  const API = 'https://webapi.sporttery.cn/gateway/jc/';
  const SPORTS = [
    { id: 'football', name: '竞彩足球', seg: 'football', listPools: 'had,hhad', fullPools: 'had,hhad,ttg' },
    { id: 'basketball', name: '竞彩篮球', seg: 'basketball', listPools: 'mnl,hdc,hilo', fullPools: 'mnl,hdc,hilo' }
  ];
  const bySport = id => SPORTS.filter(s => s.id === id)[0] || SPORTS[0];

  const FOOT_TTG_LABEL = ['0球', '1球', '2球', '3球', '4球', '5球', '6球', '7+球'];
  const STATUS_TXT = { Selling: '受注中', Playing: '进行中', Finished: '已完场', Closed: '停售', Cancelled: '取消' };
  const DISCLAIMER = '数据来自中国体育彩票官方公开接口，以官方为准。' +
    '竞彩是真实赛事，任何分析都不保证赛果；AI 内容仅供参考，不构成购彩建议。' +
    '请理性购彩、量力而行，18 岁以下禁止购彩。';

  /* ---------------- 工具 ---------------- */
  const _payload = {}; // 内存缓存：key=sport:pools -> {t, v}
  async function fetchValue(sport, pools) {
    const key = sport.id + ':' + pools;
    const hit = _payload[key];
    if (hit && Date.now() - hit.t < 60000) return hit.v;
    const url = API + sport.seg + '/getMatchCalculatorV1.qry?poolCode=' + pools + '&channel=c';
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20000);
    let j;
    try {
      const r = await fetch(url, { cache: 'no-store', signal: ac.signal });
      j = await r.json();
    } finally { clearTimeout(timer); }
    const v = j && j.value;
    if (!v || !v.matchInfoList) throw new Error('接口未返回数据（可能被限流，稍后重试）');
    _payload[key] = { t: Date.now(), v };
    return v;
  }
  function num(v) { const x = Number(v); return isFinite(x) ? x : null; }
  function odds(v) { // 赔率对象 -> {数值键}; 仅保留有值的
    if (!v || typeof v !== 'object') return {};
    const o = {};
    Object.keys(v).forEach(k => { const x = num(v[k]); if (x != null) o[k] = x; });
    return o;
  }
  function lineTxt(g) {
    if (g == null || g === '' || g === undefined) return '';
    const n = Number(g);
    if (!isFinite(n)) return String(g);
    const s = String(g);
    if (n > 0 && s.indexOf('+') < 0) return '+' + s;
    return s;
  }
  function hm(t) { return String(t || '').slice(0, 5); }
  function esc(s) { return ui.escapeHtml(s == null ? '' : String(s)); }

  // 把官方一条比赛规范化为内部结构
  function normMatch(s, sport) {
    const isFoot = sport.id === 'football';
    const m = {
      sport: sport.id,
      matchId: s.matchId,
      num: s.matchNumStr || '',
      busDate: s.businessDate || '',
      kt: (s.matchDate || '') + ' ' + hm(s.matchTime),
      status: s.matchStatus || '',
      sell: s.sellStatus,
      league: s.leagueAllName || s.leagueAbbName || '',
      home: s.homeTeamAllName || s.homeTeamAbbName || '',
      away: s.awayTeamAllName || s.awayTeamAbbName || '',
      hr: s.homeRank, ar: s.awayRank,
      had: odds(s.had), hhad: odds(s.hhad), ttg: odds(s.ttg),
      mnl: odds(s.mnl), hdc: odds(s.hdc), hilo: odds(s.hilo)
    };
    // 让球/让分线（goalLine 作用于主队）
    if (isFoot && s.hhad) m.hhad.g = s.hhad.goalLine;
    else if (!isFoot) {
      if (s.hdc) m.hdc.g = s.hdc.goalLine;
      if (s.hilo) m.hilo.g = s.hilo.goalLine;
    }
    return m;
  }
  function sellOk(m) {
    return m.sell === 1 || !m.status || m.status === 'Selling' || m.status === '';
  }

  // 单场概要文本（喂给 AI / 列表底部展示）
  function buildBrief(m) {
    const p = [];
    if (m.num) p.push(m.num);
    p.push(m.league || '');
    const rk = (m.hr ? '（排名' + m.hr + '）' : '') + ' vs ';
    p.push(m.home + rk + m.away);
    p.push(m.kt);
    const o3 = x => (x == null ? '—' : x.toFixed(2));
    if (m.sport === 'football') {
      const h = m.had;
      p.push('胜平负 主胜' + o3(h.h) + '/平' + o3(h.d) + '/客胜' + o3(h.a));
      const hh = m.hhad;
      if (hh && hh.g !== undefined && hh.g !== null) {
        p.push('让球(' + lineTxt(hh.g) + ') 胜' + o3(hh.h) + '/平' + o3(hh.d) + '/负' + o3(hh.a));
      }
      const t = m.ttg;
      if (t) {
        const seg = FOOT_TTG_LABEL.map((lb, i) => { const x = t['s' + i]; return x == null ? '' : lb + o3(x); }).filter(Boolean).join(' ');
        if (seg) p.push('总进球 ' + seg);
      }
    } else {
      p.push('胜负 主胜' + o3(m.mnl.h) + '/客胜' + o3(m.mnl.a));
      const hd = m.hdc;
      if (hd && hd.g !== undefined && hd.g !== null) {
        p.push('让分(主' + lineTxt(hd.g) + ') 主' + o3(hd.h) + '/客' + o3(hd.a));
      }
      const hi = m.hilo;
      if (hi && hi.g !== undefined && hi.g !== null && hi.h != null) {
        p.push('大小分(' + hi.g + ') 大' + o3(hi.h) + '/小' + o3(hi.l));
      }
    }
    return p.filter(Boolean).join(' | ');
  }

  function todayStamp() { return new Date().toISOString().slice(0, 10).replace(/-/g, ''); }
  function stars(n) { let s = ''; for (let i = 0; i < 5; i++) s += i < n ? '★' : '☆'; return s; }
  function fmtO(x) { return (x == null) ? '—' : x.toFixed(2); }

  /* ---------------- AI ---------------- */
  const SYS_MATCH = '你是面向中国竞彩（竞彩足球/竞彩篮球）的赛事分析助手。' +
    '你会收到某一场比赛的公开数据：对阵、联赛、开赛时间、官方玩法赔率（胜平负/让球/总进球 或 胜负/让分/大小分）。' +
    '请基于"赔率隐含概率 + 盘口解读 + 一般体育常识"做客观、条件化的概率倾向分析。' +
    '硬性约束：禁止保证赛果/中奖/收益；禁止编造未提供的数据（如伤停、近期战绩、交锋记录）；' +
    '禁止使用"必中、稳赢"等确定性措辞；务必说明不确定性。' +
    '只输出严格 JSON（不要代码块标记、不要多余文字）：' +
    '{"stance":"简明倾向结论","conf":2到5的整数信心分,"probs":{"h":0到1,"d":0到1,"a":0到1},"key":"盘口与赔率解读要点(2-3句)","focus":"决定赛果的关键看点(1-2句)","risk":"本场最需警惕的风险(1-2句)"}' +
    '其中 probs 为你的主队胜/平/客胜概率估计(篮球为 h/a，可省略 d)；总概率约等于1。';

  const SYS_REC = '你是中国竞彩的购彩参考助手。我会给你今天可投注的若干场竞彩比赛及官方赔率。' +
    '请从中挑选你认为"风险相对低、赔率信息最有参考价值"的最多3场，给出保守倾向，不追求高赔。' +
    '硬性约束：不得保证中奖/收益；只基于所给赔率与盘口做条件化判断，禁止编造数据；' +
    '没有合适的比赛就返回空 recs。只输出严格 JSON（无代码块标记）：' +
    '{"recs":[{"matchId":数字,"pick":"具体选项，如 胜平负-主胜 / 让球-主 / 总进球2-3球 / 让分-客 / 大小分-小","odds":"该选项参考赔率数字","conf":1到5整数,"why":"50字内理由"}],"note":"总体风险提示(60字内)"}';

  function aiOK() { return !!(WB.ai && WB.ai.ask && WB.ai.parseJSON); }

  // 生成单场分析并缓存（表 jcai，id=jcm:{sport}:{matchId}）
  async function genMatchAI(m) {
    if (!aiOK()) return null;
    const txt = await WB.ai.ask(SYS_MATCH, buildBrief(m) + '\n\n请输出 JSON。', { src: 'lottery' });
    const p = WB.ai.parseJSON(txt);
    const rec = { id: 'jcm:' + m.sport + ':' + m.matchId, busDate: m.busDate, ai: p, updatedAt: Date.now() };
    try { await store.put('jcai', rec); } catch (e) { /* 缓存失败不阻塞展示 */ }
    return rec;
  }
  // 生成今日购彩参考并缓存（id=jcr:{sport}:{yyyymmdd}）
  async function genRecAI(sport, rows) {
    if (!aiOK()) return null;
    const list = rows.filter(sellOk).slice(0, 30);
    const body = '今日共' + list.length + '场' + sport.name + '：\n' + list.map((m, i) => (i + 1) + '. ' + buildBrief(m)).join('\n') + '\n\n请输出 JSON。';
    const txt = await WB.ai.ask(SYS_REC, body, { src: 'lottery' });
    const p = WB.ai.parseJSON(txt);
    const rec = { id: 'jcr:' + sport.id + ':' + todayStamp(), sport: sport.id, list: list.map(m => m.matchId), ai: p, updatedAt: Date.now() };
    try { await store.put('jcai', rec); } catch (e) {}
    return rec;
  }

  /* ---------------- 视图 ---------------- */
  async function render(root) {
    let sport = bySport(await store.getMeta('jc_sport', 'football'));
    let periods = [], lastUpd = '', loading = true, err = '';
    let rec = null, recBusy = false, recErr = '';

    root.innerHTML = '<div class="page">' +
      ui.pageHead('lottery', '竞彩', { subtitle: '竞彩足球 / 竞彩篮球 · AI 单场分析' }) +
      '<div id="jc-top"></div>' +
      '<div id="jc-list" class="lot-disclaimer-note"></div>' +
      '<div class="lot-disclaimer">' + DISCLAIMER + '</div>' +
      '</div>';
    const top = root.querySelector('#jc-top');
    const listEl = root.querySelector('#jc-list');

    function chipsHTML() {
      return '<div class="chips jc-chips">' + SPORTS.map(s =>
        '<button class="chip' + (s.id === sport.id ? ' active' : '') + '" data-s="' + s.id + '">' +
        s.name + '</button>').join('') + '</div>';
    }
    function topHTML() {
      let h = chipsHTML() +
        '<div class="jc-toolbar">' +
          '<button class="btn ghost sm" id="jc-refresh">⟳ 刷新赔率</button>' +
          '<button class="btn sm ' + (recBusy ? '' : 'primary') + '" id="jc-rec-btn">' +
          (recBusy ? '正在生成今日参考…' : '✨ 今日购彩参考') + '</button>' +
        '</div>';
      if (recErr) h += '<div class="jc-err muted">' + esc(recErr) + '</div>';
      if (rec) h += recCardHTML(rec);
      return h;
    }
    function listHTML() {
      if (loading && !periods.length) return '<div class="card section"><div class="lot-empty muted">正在获取赛事与赔率…</div></div>';
      if (err && !periods.length) return '<div class="card section"><div class="lot-empty muted">获取失败：' + esc(err) + '</div></div>';
      let h = '<div class="jc-upd muted">数据更新于 ' + esc(lastUpd) + ' · 点击任一场次查看 AI 单场分析</div>';
      periods.forEach(pd => {
        h += '<div class="card section jc-period">' +
          '<div class="sec-title">' + esc(pd.weekday || '') + ' ' + esc(pd.busDate) + ' · ' + esc(pd.name) +
          '<span class="muted"> 共 ' + pd.rows.length + ' 场</span></div>';
        pd.rows.forEach(m => {
          const stTxt = STATUS_TXT[m.status] || (m.sell === 1 ? '受注中' : '');
          h += '<div class="jc-row" data-mid="' + m.matchId + '" data-bus="' + esc(m.busDate) + '">' +
            '<div class="jc-row-top">' +
              '<span class="jc-league muted">' + esc(m.league) + '</span>' +
              '<span class="jc-num muted">' + esc(m.num) + '</span>' +
              (stTxt ? '<span class="jc-st">' + esc(stTxt) + '</span>' : '') +
              '<span class="jc-time muted">' + esc(m.kt) + '</span>' +
            '</div>' +
            '<div class="jc-row-vs">' +
              '<b>' + esc(m.home) + '</b><i class="muted"> VS </i><b>' + esc(m.away) + '</b>' +
              '<span class="jc-arrow">›</span>' +
            '</div>' +
            '<div class="jc-odds muted">' + mainOddsTxt(m) + '</div>' +
          '</div>';
        });
        h += '</div>';
      });
      return h;
    }

    function mainOddsTxt(m) {
      if (m.sport === 'football') {
        return '胜平负 主' + fmtO(m.had.h) + ' 平' + fmtO(m.had.d) + ' 客' + fmtO(m.had.a) +
          (m.hhad.h != null ? '　让球' + lineTxt(m.hhad.g) + ' 胜' + fmtO(m.hhad.h) + ' 平' + fmtO(m.hhad.d) + ' 负' + fmtO(m.hhad.a) : '');
      }
      return '胜负 主' + fmtO(m.mnl.h) + ' 客' + fmtO(m.mnl.a) +
        (m.hdc.h != null ? '　让分' + lineTxt(m.hdc.g) + ' 主' + fmtO(m.hdc.h) + ' 客' + fmtO(m.hdc.a) : '') +
        (m.hilo.h != null ? '　大小' + lineTxt(m.hilo.g) + ' 大' + fmtO(m.hilo.h) + ' 小' + fmtO(m.hilo.l) : '');
    }

    function recCardHTML(r) {
      const ai = r.ai || {};
      const items = (ai.recs || []);
      const note = ai.note || '';
      let h = '<div class="card section jc-rec">' +
        '<div class="sec-title">✨ 今日购彩参考 <span class="muted">' + esc(sport.name) +
        (r.updatedAt ? ' · ' + new Date(r.updatedAt).toTimeString().slice(0, 5) : '') + '</span></div>';
      if (!items.length) {
        h += '<div class="jc-empty muted">' + (note ? esc(note) : 'AI 认为今日没有特别值得参考的比赛。') + '</div>';
      } else {
        h += items.map(it => {
          const mid = it.matchId;
          const m = periods.reduce((a, pd) => a || pd.rows.filter(x => x.matchId === mid)[0] || null, null);
          const conf = Math.max(1, Math.min(5, Math.round(Number(it.conf) || 1)));
          return '<div class="jc-rec-item" data-mid="' + mid + '">' +
            '<div class="jc-rec-l1"><b>' + (m ? esc(m.num + ' ' + m.home + ' vs ' + m.away) : '场次#' + mid) + '</b>' +
            '<span class="jc-rec-pick">' + esc(it.pick || '') + '</span>' +
            (it.odds ? '<span class="jc-rec-odds muted">参考赔率 ' + esc(it.odds) + '</span>' : '') +
            '<span class="jc-rec-conf">' + stars(conf) + '</span></div>' +
            (it.why ? '<div class="jc-rec-why muted">' + esc(it.why) + '</div>' : '') +
          '</div>';
        }).join('');
        if (note) h += '<div class="jc-rec-note warn">' + esc(note) + '</div>';
      }
      h += '<div class="lev-ai-disclaimer">AI 生成，仅供参考，不构成购彩建议；竞彩无稳赢，请理性投注。</div></div>';
      return h;
    }

    function paint() {
      top.innerHTML = topHTML();
      listEl.innerHTML = listHTML();
      bind();
    }

    function bind() {
      top.querySelectorAll('[data-s]').forEach(b => {
        b.onclick = () => {
          if (b.dataset.s === sport.id) return;
          sport = bySport(b.dataset.s);
          store.setMeta('jc_sport', sport.id);
          reload();
        };
      });
      const rf = top.querySelector('#jc-refresh');
      if (rf) rf.onclick = () => { Object.keys(_payload).forEach(k => { if (k.indexOf(sport.id) === 0) delete _payload[k]; }); reload(); };
      const rb = top.querySelector('#jc-rec-btn');
      if (rb) rb.onclick = () => genRec(true);
      const recIt = top.querySelectorAll('.jc-rec-item[data-mid]');
      recIt.forEach(el => { el.onclick = () => { const m = findMatch(Number(el.dataset.mid)); if (m) openDetail(root, m); }; });
      listEl.querySelectorAll('.jc-row[data-mid]').forEach(el => {
        el.onclick = () => { const m = findMatch(Number(el.dataset.mid)); if (m) openDetail(root, m); };
      });
    }

    function findMatch(mid) {
      for (const pd of periods) { const f = pd.rows.filter(m => m.matchId === mid)[0]; if (f) return f; }
      return null;
    }

    async function genRec(manual) {
      if (recBusy) return;
      recBusy = true; recErr = ''; paint();
      try {
        rec = await genRecAI(sport, periods.reduce((a, pd) => a.concat(pd.rows), []));
      } catch (e) { recErr = (e && e.message) || 'AI 生成失败，请稍后重试'; }
      recBusy = false;
      paint();
    }

    async function reload() {
      loading = true; err = ''; periods = [];
      paint();
      try {
        const v = await fetchValue(sport, sport.listPools);
        lastUpd = v.lastUpdateTime || '';
        periods = (v.matchInfoList || []).map(pd => ({
          busDate: pd.businessDate, weekday: pd.weekday || '', matchNumDate: pd.matchNumDate || '', name: sport.name,
          rows: (pd.subMatchList || []).map(s => normMatch(s, sport))
        }));
      } catch (e) { err = (e && e.message) || '获取失败'; }
      loading = false;
      paint();
      // 今日参考：没缓存且配置了 AI → 自动补生成
      if (!err && periods.length) {
        const cached = await store.get('jcai', 'jcr:' + sport.id + ':' + todayStamp()).catch(() => null);
        if (cached && cached.ai && (cached.ai.recs || cached.ai.note)) { rec = cached; paint(); }
        else if (aiOK() && !recBusy) genRec(false);
      }
    }

    await reload();
  }

  /* ---------------- 单场详情 ---------------- */
  async function openDetail(root, m) {
    const sport = bySport(m.sport);
    let ai = null, aiBusy = false, aiErr = '';
    root.innerHTML = '<div class="page">' +
      ui.pageHead('lottery', '单场分析', { subtitle: sport.name + ' · ' + m.num }) +
      '<div id="jc-detail"><div class="card section"><div class="lot-empty muted">加载中…</div></div></div>' +
      '<div class="lot-disclaimer">' + DISCLAIMER + '</div>' +
      '</div>';
    const box = root.querySelector('#jc-detail');

    // 需要完整玩法(足球含总进球)时补拉一次全量
    if (m.sport === 'football' && (m.ttg == null || Object.keys(m.ttg).length === 0)) {
      try {
        const v = await fetchValue(sport, sport.fullPools);
        for (const pd of (v.matchInfoList || [])) {
          for (const s of (pd.subMatchList || [])) {
            if (s.matchId === m.matchId) { m = normMatch(s, sport); break; }
          }
        }
      } catch (e) { /* 拉不到完整玩法就按已有数据显示 */ }
    }
    const cached = await store.get('jcai', 'jcm:' + m.sport + ':' + m.matchId).catch(() => null);
    if (cached && cached.ai && cached.ai.stance) ai = cached;

    function aiHTML() {
      if (!aiOK()) return '<div class="card section"><div class="sec-title">AI 单场分析</div>' +
        '<div class="jc-empty muted">尚未在「设置 → AI 助手」配置 API Key，暂无法生成分析。赔率数据仍可正常查看。</div></div>';
      if (aiBusy) return '<div class="card section"><div class="sec-title">AI 单场分析</div>' +
        '<div class="sk-line w70"></div><div class="sk-line w50" style="margin-top:6px"></div><div class="sk-line w80" style="margin-top:6px"></div>' +
        '<div class="jc-empty muted" style="padding-top:6px">AI 正在解读赔率与盘口…</div></div>';
      if (aiErr) return '<div class="card section"><div class="sec-title">AI 单场分析</div>' +
        '<div class="jc-err">生成失败：' + esc(aiErr) + '</div>' +
        '<button class="btn sm" id="jc-ai-regen">重试生成</button></div>';
      if (!ai) return '<div class="card section"><div class="sec-title">AI 单场分析</div>' +
        '<div class="jc-empty muted">本场还没有 AI 分析。</div>' +
        '<button class="btn sm primary" id="jc-ai-gen">生成分析</button></div>';
      const a = ai.ai || {};
      const conf = Math.max(1, Math.min(5, Math.round(Number(a.conf) || 1)));
      const pb = a.probs || {};
      let pbTxt = '';
      if (m.sport === 'football') {
        pbTxt = '主胜 ' + Math.round((pb.h || 0) * 100) + '% · 平 ' + Math.round((pb.d || 0) * 100) + '% · 客胜 ' + Math.round((pb.a || 0) * 100) + '%';
      } else {
        pbTxt = '主胜 ' + Math.round((pb.h || 0) * 100) + '% · 客胜 ' + Math.round((pb.a || 0) * 100) + '%';
      }
      return '<div class="card section jc-ai">' +
        '<div class="lev-ai-headrow"><div class="sec-title">AI 单场分析</div>' +
        '<span class="lev-ai-date muted">' + (ai.updatedAt ? new Date(ai.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '') + '</span>' +
        '<button class="btn ghost sm" id="jc-ai-regen">重新生成</button></div>' +
        '<div class="jc-ai-stance"><span class="lev-stance lv-up">' + esc(a.stance || '倾向不明') + '</span>' +
        '<span class="lev-stars">' + stars(conf) + '</span></div>' +
        (pbTxt && pbTxt.indexOf('0% ·') === -1 ? '<div class="jc-ai-probs muted">参考概率：' + pbTxt + '</div>' : '') +
        (a.key ? '<div class="lev-ai-sub">盘口解读</div><div class="lev-ai-summary">' + esc(a.key) + '</div>' : '') +
        (a.focus ? '<div class="lev-ai-sub">关键看点</div><div class="lev-ai-summary">' + esc(a.focus) + '</div>' : '') +
        (a.risk ? '<div class="lev-ai-risk">⚠ ' + esc(a.risk) + '</div>' : '') +
        '<div class="lev-ai-disclaimer">AI 基于官方赔率与盘口生成的条件化解读，仅供参考，不构成购彩建议。</div></div>';
    }

    function oddsHTML() {
      if (m.sport === 'football') {
        const t = m.ttg || {};
        const ttgRows = FOOT_TTG_LABEL.map((lb, i) => [lb, t['s' + i]]).filter(r => r[1] != null);
        return '<div class="card section">' +
          '<div class="sec-title">官方赔率</div>' +
          '<div class="jc-grid">' + oddsTile('胜平负', '主胜', fmtO(m.had.h), '平', fmtO(m.had.d), '客胜', fmtO(m.had.a)) +
          (m.hhad.h != null ? oddsTile('让球胜平负', '让球' + lineTxt(m.hhad.g), '胜', fmtO(m.hhad.h), '平', fmtO(m.hhad.d), '负', fmtO(m.hhad.a)) : '') +
          '</div>' +
          (ttgRows.length ? '<div class="jc-ttg">' + ttgRows.map(r =>
            '<span class="jc-ttg-cell"><i>' + esc(r[0]) + '</i><em>' + fmtO(r[1]) + '</em></span>').join('') + '</div>' : '') +
          '</div>';
      }
      return '<div class="card section">' +
        '<div class="sec-title">官方赔率</div>' +
        '<div class="jc-grid">' + oddsTile('胜负', '主胜', fmtO(m.mnl.h), '—', '', '客胜', fmtO(m.mnl.a)) +
        (m.hdc.h != null ? oddsTile('让分胜负', '让分' + lineTxt(m.hdc.g), '主', fmtO(m.hdc.h), '—', '', '客', fmtO(m.hdc.a)) : '') +
        (m.hilo.h != null ? oddsTile('大小分', '盘口' + lineTxt(m.hilo.g), '大', fmtO(m.hilo.h), '—', '', '小', fmtO(m.hilo.l)) : '') +
        '</div></div>';
    }
    function oddsTile(title, lblA, vA, lblB, vB, lblC, vC) {
      return '<div class="jc-tile"><div class="jc-tile-t">' + esc(title) + '</div>' +
        '<div class="jc-tile-rows">' +
        '<span class="jc-od"><i>' + esc(lblA) + '</i><em>' + esc(vA) + '</em></span>' +
        (lblB ? '<span class="jc-od"><i>' + esc(lblB) + '</i><em>' + esc(vB) + '</em></span>' : '') +
        '<span class="jc-od"><i>' + esc(lblC) + '</i><em>' + esc(vC) + '</em></span>' +
        '</div></div>';
    }
    function matchHeadHTML() {
      const stTxt = STATUS_TXT[m.status] || (m.sell === 1 ? '受注中' : '');
      return '<div class="card section jc-mh">' +
        '<div class="jc-row-top"><span class="jc-league muted">' + esc(m.league) + '</span>' +
        '<span class="jc-num muted">' + esc(m.num) + '</span>' +
        (stTxt ? '<span class="jc-st">' + esc(stTxt) + '</span>' : '') + '</div>' +
        '<div class="jc-mh-vs">' +
          '<div class="jc-team"><b>' + esc(m.home) + '</b><span class="muted">主' + (m.hr ? ' · 排名' + esc(m.hr) : '') + '</span></div>' +
          '<div class="jc-vs muted">VS</div>' +
          '<div class="jc-team right"><b>' + esc(m.away) + '</b><span class="muted">客' + (m.ar ? ' · 排名' + esc(m.ar) : '') + '</span></div>' +
        '</div>' +
        '<div class="jc-mh-time muted">开赛 ' + esc(m.kt) + '</div></div>';
    }
    function paint() {
      box.innerHTML = matchHeadHTML() + oddsHTML() + aiHTML() +
        '<div style="display:flex;gap:8px"><button class="btn ghost sm" id="jc-d-back">‹ 返回列表</button></div>';
      box.querySelector('#jc-d-back').onclick = () => render(root);
      const regen = box.querySelector('#jc-ai-regen');
      if (regen) regen.onclick = () => gen();
      const gen = box.querySelector('#jc-ai-gen');
      if (gen) gen.onclick = () => gen();
    }
    async function gen() {
      aiBusy = true; aiErr = ''; paint();
      try {
        const r = await genMatchAI(m);
        ai = r && r.ai && r.ai.stance ? r : null;
        if (!ai && !aiErr) aiErr = 'AI 返回内容无法解析，请重试';
      } catch (e) { aiErr = (e && e.message) || 'AI 生成失败'; }
      aiBusy = false;
      paint();
    }
    paint();
    // 配置了 AI 且无缓存 → 自动补生成
    if (aiOK() && !ai && !aiBusy) gen();
  }

  // 暴露纯函数便于校验
  WB.lottery = { SPORTS, bySport, normMatch, buildBrief, lineTxt, fmtO, sellOk, todayStamp, fetchValue };

  WB.modules.push({ id: 'lottery', title: '竞彩', icon: 'lottery', render });
})(window.WB = window.WB || {});
