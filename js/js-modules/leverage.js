// module: leverage 杠杆测算（贷款炒股：盈亏平衡卖出价 / 完全覆盖总利息卖出价）
// 说明：本模块只做中性的成本与盈亏平衡计算，不提供任何投资建议。
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui;

  const METHOD = {
    daily: '随借随还·按日计息',
    equalInstallment: '等额本息',
    equalPrincipal: '等额本金',
    interestFirst: '先息后本'
  };
  const METHOD_HINT = {
    daily: '利息=剩余本金×日利率×实际占用天数，还了当天起停止计息',
    equalInstallment: '每月还款额固定，前期利息多本金少',
    equalPrincipal: '每月本金固定、利息递减，总利息低于等额本息',
    interestFirst: '每月只付息、到期一次还本，总利息最高'
  };

  // A 股现行默认费率（可在表单里改）：佣金万2.5/最低5元、印花税卖出0.05%、过户费0.001%双边
  const DEF = { commissionRate: 0.025, minCommission: 5, stampRate: 0.05, transferRate: 0.001, prepayFeeRate: 0, dayBasis: 360 };

  /* ---------------- 基础工具 ---------------- */
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function daysBetween(startISO, endISO) {
    if (!startISO) return 0;
    const a = new Date(startISO + 'T00:00:00');
    const b = endISO ? new Date(endISO + 'T00:00:00') : new Date();
    return Math.max(0, Math.round((b - a) / 86400000));
  }
  function num(v, dft) { const n = parseFloat(v); return isFinite(n) ? n : (dft || 0); }
  function money(n) {
    const v = Math.round((+n || 0) * 100) / 100;
    return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function money0(n) { return '¥' + Math.round(+n || 0).toLocaleString('zh-CN'); }
  function pct(n) { return (n >= 0 ? '+' : '') + (+n || 0).toFixed(2) + '%'; }
  // A 股习惯：涨红跌绿
  function cls(n) { return n > 0 ? 'lv-up' : (n < 0 ? 'lv-down' : ''); }
  // 给 Promise 加超时，避免离线/被墙时保存卡死
  function withTimeout(p, ms) {
    return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  }

  /* ---------------- 贷款利息引擎 ---------------- */
  // 由平台给出的「期限总利息」反推真实月利率（等额本息无闭式解，二分求解）。
  // 优先反推而不是用名义年利率：平台报价的总利息已含服务费/手续费，更贴近真实成本。
  function impliedMonthlyRate(P, n, totalInterest, method) {
    if (!(P > 0) || !(n > 0) || !(totalInterest > 0)) return null;
    if (method === 'equalPrincipal') return 2 * totalInterest / (P * (n + 1));
    if (method === 'interestFirst') return totalInterest / (n * P);
    if (method === 'daily') return totalInterest / (P * n);
    let lo = 0, hi = 0.2;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      const M = mid === 0 ? P / n : P * mid * Math.pow(1 + mid, n) / (Math.pow(1 + mid, n) - 1);
      if (n * M - P < totalInterest) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // 生效利率优先级：手填日利率 > 总利息(平台/每期求和)反推 > 名义年利率 > 0
  // termInterest 为已解析的「总利息」（可能来自平台期限总利息，也可能来自每期利息求和）
  function effectiveRates(rec, P, n, termInterest) {
    const basis = num(rec.dayBasis, 360);
    const method = rec.method || 'daily';
    // 1) 手动日利率最高优先
    if (rec.dailyRate != null && rec.dailyRate !== '' && num(rec.dailyRate) > 0) {
      const rD = num(rec.dailyRate) / 100;
      return { rM: rD * basis / 12, rD, src: 'manual', termInterest, impliedAnnual: rD * basis * 100 };
    }
    // 2) 总利息反推（平台报价已含服务费/手续费，最贴近真实成本；每期求和亦同）
    const ti = (termInterest != null && termInterest > 0) ? termInterest
      : ((rec.termInterest != null && rec.termInterest !== '') ? num(rec.termInterest) : null);
    if (ti != null && ti > 0) {
      const imp = impliedMonthlyRate(P, n, ti, method);
      if (imp != null) return { rM: imp, rD: imp * 12 / basis, src: 'implied', termInterest: ti, impliedAnnual: imp * 12 * 100 };
    }
    // 3) 名义年利率
    if (rec.annualRate != null && rec.annualRate !== '') {
      const rM = num(rec.annualRate) / 100 / 12;
      return { rM, rD: rM * 12 / basis, src: 'nominal', termInterest, impliedAnnual: num(rec.annualRate) };
    }
    return { rM: 0, rD: 0, src: 'none', termInterest, impliedAnnual: 0 };
  }

  // 解析手填每期利息（逗号/空格/中文逗号分隔），返回过滤后的数组；不足 n 个返回空数组
  function parsePeriodInterestsRaw(rec, n) {
    if (rec.periodInterests == null || String(rec.periodInterests).trim() === '') return [];
    return String(rec.periodInterests).split(/[,，\s]+/).map(s => num(s)).filter(v => isFinite(v) && v >= 0);
  }

  // 还款计划：默认每月 repayDay 号；首期=起息日当月（或次月）的 repayDay
  function buildSchedule(rec, n) {
    const start = rec.startDate ? new Date(rec.startDate + 'T00:00:00') : new Date();
    const day = Math.min(28, Math.max(1, Math.round(num(rec.repayDay, 25))));
    let first;
    if (start.getDate() <= day) first = new Date(start.getFullYear(), start.getMonth(), day);
    else first = new Date(start.getFullYear(), start.getMonth() + 1, day);
    const dates = [];
    for (let i = 0; i < n; i++) dates.push(new Date(first.getFullYear(), first.getMonth() + i, day));
    return dates;
  }

  // 经过 k 个完整还款期后的剩余本金
  function principalAfter(P, n, method, k, rM) {
    if (method === 'interestFirst') return P;                   // 到期一次还本
    if (method === 'equalPrincipal') return Math.max(0, P - P / n * k);
    if (method === 'equalInstallment') {
      if (rM === 0) return Math.max(0, P - P / n * k);
      const g = Math.pow(1 + rM, k);
      const M = P * rM * Math.pow(1 + rM, n) / (Math.pow(1 + rM, n) - 1);
      return Math.max(0, P * g - M * (g - 1) / rM);
    }
    return P;
  }

  // 输入记录 + 已计息天数 D，输出各类利息/剩余本金。
  // 随借随还：按日计息；其余三种：已到期各期用「固定每期利息」，当前未到期期按「日利息×剩余本金×已过天数」(提前还款口径)。
  function loanState(rec, D) {
    const P = num(rec.principal);
    const n = Math.max(1, num(rec.termMonths, 3));
    const method = rec.method || 'daily';

    // 手填每期利息
    const perRaw = parsePeriodInterestsRaw(rec, n);
    const perFilled = perRaw.length === n;
    const sumPI = perFilled ? perRaw.reduce((a, b) => a + b, 0) : null;

    // 总利息优先级：①平台期限总利息(更权威) ②手填每期求和 ③公式兜底
    let termInterest = null, tiSource = 'none';
    const tiPlatform = (rec.termInterest != null && rec.termInterest !== '') ? num(rec.termInterest) : null;
    if (tiPlatform != null && tiPlatform > 0) { termInterest = tiPlatform; tiSource = 'platform'; }
    else if (perFilled) { termInterest = sumPI; tiSource = 'period'; }

    const eff = effectiveRates(rec, P, n, termInterest);
    const rM = eff.rM, rD = eff.rD;
    const o = {
      P, n, rD, rM, method, D, daily: P * rD, accrued: 0, remaining: P,
      total: termInterest || 0, rateSource: eff.src, termInterest, impliedAnnual: eff.impliedAnnual,
      tiSource, schedule: [], perInterest: [], perFilled, maturedCount: 0, accruedMatured: 0, accruedDaily: 0
    };

    if (method === 'daily') {
      o.accrued = P * rD * D;
      o.remaining = P;
      o.total = termInterest != null ? termInterest : P * rD * (n * 30);
      o.daily = P * rD;
      return o;
    }

    // 整期总利息（公式兜底：当无任何总利息来源但又有利率时）
    let tot = termInterest != null ? termInterest : 0;
    if (tot <= 0) {
      if (method === 'equalPrincipal') tot = P * rM * (n + 1) / 2;
      else if (method === 'interestFirst') tot = n * P * rM;
      else { const M = rM === 0 ? P / n : P * rM * Math.pow(1 + rM, n) / (Math.pow(1 + rM, n) - 1); tot = n * M - P; }
    }
    o.total = tot;

    // 每期利息：仅当「每期利息」是总利息来源时才用手填值，否则按总利息平均（保证与权威总利息一致）
    const per = (perFilled && tiSource === 'period') ? perRaw : Array(n).fill(n > 0 ? tot / n : 0);
    const dates = buildSchedule(rec, n);
    o.schedule = dates; o.perInterest = per;

    const today = new Date(); today.setHours(0, 0, 0, 0);
    let accrued = 0, matured = 0, maturedInt = 0, dailyInt = 0, rem = P;
    let prev = rec.startDate ? new Date(rec.startDate + 'T00:00:00') : new Date(today);
    for (let i = 0; i < n; i++) {
      if (dates[i] <= today) {
        accrued += per[i]; maturedInt += per[i]; matured++;
        rem = principalAfter(P, n, method, matured, rM);
        prev = dates[i];
      } else {
        const days = Math.max(0, Math.round((today - prev) / 86400000));
        dailyInt = rD * rem * days;
        accrued += dailyInt;
        break;
      }
    }
    o.accrued = accrued;
    o.accruedMatured = maturedInt;
    o.accruedDaily = dailyInt;
    o.maturedCount = matured;
    o.remaining = rem;
    o.daily = rD * rem;   // 当前未还本金的日利息
    return o;
  }

  /* ---------------- 费率与卖出价求解 ---------------- */
  function rates(rec) {
    const g = (k) => (rec[k] != null && rec[k] !== '' ? num(rec[k]) : DEF[k]);
    return {
      comm: g('commissionRate') / 100,
      minComm: g('minCommission'),
      stamp: g('stampRate') / 100,
      transfer: g('transferRate') / 100,
      prepay: g('prepayFeeRate') / 100
    };
  }
  function buyFees(rec, amt) { const f = rates(rec); return Math.max(amt * f.comm, f.minComm) + amt * f.transfer; }
  function sellFees(rec, amt) { const f = rates(rec); return Math.max(amt * f.comm, f.minComm) + amt * f.stamp + amt * f.transfer; }

  // 解「卖出净得 = 成本」的卖出价（含最低佣金的非线性修正）；qty 缺省用 rec.quantity（兼容旧调用）
  function solvePrice(rec, cost, qty) {
    const f = rates(rec);
    const Q = Math.max(1, qty != null ? qty : num(rec.quantity, 1));
    const kSell = f.comm + f.stamp + f.transfer;
    let S = cost / (Q * (1 - kSell));
    for (let i = 0; i < 3; i++) {
      if (S * Q * f.comm < f.minComm) S = (cost + f.minComm) / (Q * (1 - f.stamp - f.transfer));
      else break;
    }
    return S;
  }

  // 单笔加仓批次 → 归一化贷款记录（百分比利率/设置类可沿用首笔；金额类不沿用，防止误把首笔总利息算到新批）
  function addLoanRec(add, rec) {
    const blank = v => (v == null || v === '');
    return {
      principal: num(add.principal),
      termMonths: num(add.termMonths, rec.termMonths || 3),
      method: add.method || rec.method || 'daily',
      // 金额类：只用批次自己填的；空 → 视为无（不会误继承首笔的金额）
      termInterest: blank(add.termInterest) ? null : num(add.termInterest),
      periodInterests: blank(add.periodInterests) ? null : add.periodInterests,
      monthlyPayment: blank(add.monthlyPayment) ? null : num(add.monthlyPayment),
      // 利率（百分比）：批次未填则沿用首笔
      dailyRate: blank(add.dailyRate) ? rec.dailyRate : add.dailyRate,
      annualRate: blank(add.annualRate) ? rec.annualRate : add.annualRate,
      dayBasis: blank(add.dayBasis) ? num(rec.dayBasis, 360) : num(add.dayBasis),
      startDate: add.date || rec.startDate,
      repayDay: blank(add.repayDay) ? num(rec.repayDay, 25) : num(add.repayDay)
    };
  }
  // 批次贷款状态；纯自有加仓（贷款=0）返回 null，不产生利息。endISO 为计息截止日（结清后不再计息）
  function addState(add, rec, endISO) {
    const ar = addLoanRec(add, rec);
    if (!ar.principal) return null;
    return loanState(ar, daysBetween(ar.startDate, endISO));
  }

  // 聚合计算：持仓合并（总股数/总买入额），各批贷款独立计息后累计；含卖出/还款/结清。
  // 关键原则：原贷款利息不因加仓被清除/重算；结清后利息停止累计；还款按「先息后本」冲抵。
  function calc(rec, curPrice) {
    const adds = Array.isArray(rec.adds) ? rec.adds : [];
    const sells = Array.isArray(rec.sells) ? rec.sells : [];
    const reps = Array.isArray(rec.repayments) ? rec.repayments : [];
    const closed = !!rec.closed;
    const endISO = closed ? (rec.closedAt || rec.buyDate || todayISO()) : undefined; // 结清后停止计息
    const baseQ = num(rec.quantity, 0);
    const Q = adds.reduce((s, a) => s + num(a.qty), baseQ);                    // 总股数（含已卖出）
    const buy = adds.reduce((s, a) => s + num(a.price) * num(a.qty), num(rec.buyPrice) * baseQ); // 总买入额
    const D = daysBetween(rec.startDate, endISO);
    const st = loanState(rec, D);                                              // 首笔贷款状态
    const ast = adds.map(a => addState(a, rec, endISO));                       // 各加仓批次贷款状态

    const P = ast.reduce((s, x) => s + (x ? x.P : 0), st.P);                   // 贷款本金合计
    const own = Math.max(0, buy - P);                                          // 自有本金
    const accrued = ast.reduce((s, x) => s + (x ? x.accrued : 0), st.accrued); // 累计已计息合计
    const remaining = ast.reduce((s, x) => s + (x ? x.remaining : 0), st.remaining);
    const totalForCover = ast.reduce((s, x) => s + (x ? ((x.termInterest != null && x.termInterest > 0) ? x.termInterest : x.total) : 0),
      (st.termInterest != null && st.termInterest > 0) ? st.termInterest : st.total);
    const daily = ast.reduce((s, x) => s + (x ? x.daily : 0), st.daily);
    const prepayFee = remaining * rates(rec).prepay;

    // ---- 卖出聚合（每笔含成交快照，历史数字不随行情变化）----
    const soldQty = sells.reduce((s, x) => s + num(x.qty), 0);
    const leftQty = Math.max(0, Q - soldQty);
    const sellGross = sells.reduce((s, x) => s + num(x.gross), 0);
    const sellFeeTotal = sells.reduce((s, x) => s + num(x.feeTotal), 0);
    const sellNet = sells.reduce((s, x) => s + num(x.net), 0);
    const sellPnlTotal = sells.reduce((s, x) => s + num(x.pnl), 0);            // 已实现盈亏（卖出净收入 − 分摊买入成本 − 分摊利息）

    // ---- 还款聚合（先息后本冲抵）----
    const repayTotal = reps.reduce((s, x) => s + num(x.amount), 0);
    const paidInterest = Math.min(accrued, repayTotal);                        // 先冲利息
    const paidPrincipal = Math.max(0, repayTotal - accrued);                   // 再冲本金
    const remainPrincipal = Math.max(0, P - paidPrincipal);
    const remainInterest = Math.max(0, accrued - repayTotal);
    const cleared = remainPrincipal <= 0.01 && remainInterest <= 0.01;         // 本息已还清
    const settleFee = remainPrincipal * rates(rec).prepay;                     // 立刻结清违约金
    const settleNeed = remainPrincipal + remainInterest + settleFee;           // 一次性结清需付总额

    // ---- 成本与保本价（剩余持仓口径：已落袋的卖出净收入可抵扣成本）----
    const costNow = buy + accrued + prepayFee;
    const costAccrued = buy + accrued;
    const costTotal = buy + totalForCover;
    const leftCost = Q > 0 ? buy * (leftQty / Q) : 0;                          // 剩余持仓分摊买入成本
    const beBase = Math.max(0, costNow - sellNet);
    const caBase = Math.max(0, costAccrued - sellNet);
    const ctBase = Math.max(0, costTotal - sellNet);
    const breakeven = leftQty > 0 ? solvePrice(rec, beBase, leftQty) : 0;
    const coverAccrued = leftQty > 0 ? solvePrice(rec, caBase, leftQty) : 0;
    const coverAll = leftQty > 0 ? solvePrice(rec, ctBase, leftQty) : 0;

    const market = (curPrice && leftQty) ? curPrice * leftQty : 0;
    const netIfSell = curPrice ? market - sellFees(rec, market) : 0;
    // 总盈亏（口径：已落袋卖出净收入 + 剩余持仓现在卖出的净得 − 总成本）
    const pnl = curPrice ? (sellNet + netIfSell - costNow) : (sellNet - costNow);
    const drift = leftQty > 0 ? daily / Math.max(1, leftQty) / (1 - (rates(rec).comm + rates(rec).stamp + rates(rec).transfer)) : 0;

    return { Q, leftQty, soldQty, buy, cBuy: 0, own, D, st, ast, adds, sells, reps, P, accrued, remaining, daily,
      prepayFee, totalForCover, costNow, costAccrued, costTotal, breakeven, coverAccrued, coverAll, leftCost,
      market, netIfSell, pnl, drift, curPrice, closed, endISO,
      repayTotal, paidInterest, paidPrincipal, remainPrincipal, remainInterest, cleared, settleFee, settleNeed,
      sellGross, sellFeeTotal, sellNet, sellPnlTotal };
  }

  /* ---------------- 实时行情（东方财富，已验证支持跨域） ---------------- */
  function marketOf(code) {
    const c = String(code || '').replace(/\D/g, '');
    if (/^(6|9|5|11|13|78)/.test(c)) return 1; // 沪
    return 0;                                   // 深 / 北
  }
  async function fetchQuote(code) {
    const m = marketOf(code);
    const url = 'https://push2.eastmoney.com/api/qt/stock/get?secid=' + m + '.' + code +
      '&fields=f43,f44,f45,f46,f57,f58,f60,f169,f170';
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const d = j && j.data;
    if (!d || d.f43 == null) throw new Error('无行情数据');
    return {
      code: d.f57, name: d.f58,
      price: d.f43 / 100, high: d.f44 / 100, low: d.f45 / 100, open: d.f46 / 100,
      preClose: d.f60 / 100, chg: d.f169 / 100, chgPct: d.f170 / 100
    };
  }
  async function fetchTrend(code) {
    const url = 'https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=' + marketOf(code) + '.' + code +
      '&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=1';
    const r = await fetch(url, { cache: 'no-store' });
    const j = await r.json();
    const t = (j && j.data && j.data.trends) || [];
    return { trends: t, preClose: (j && j.data && j.data.preSettlement) || 0 };
  }
  async function fetchKline(code, lmt) {
    const url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + marketOf(code) + '.' + code +
      '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&fqt=1&end=20500101&lmt=' + (lmt || 90);
    const r = await fetch(url, { cache: 'no-store' });
    const j = await r.json();
    return ((j && j.data && j.data.klines) || []).map(s => {
      const p = s.split(',');
      return { date: p[0], open: +p[1], close: +p[2], high: +p[3], low: +p[4] };
    });
  }

  /* ---------------- 个股新闻 / 公司公告（东财：请求带 Origin 时回显 CORS *，静态站可直连） ---------------- */
  async function fetchNews(code, limit) {
    const param = JSON.stringify({
      uid: '', keyword: String(code), type: ['cmsArticleWebOld'],
      client: 'web', clientType: 'web', clientVersion: 'curr',
      param: { cmsArticleWebOld: { searchScope: 'default', sort: 'time', pageIndex: 1, pageSize: (limit || 8), preTag: '', postTag: '' } }
    });
    const url = 'https://search-api-web.eastmoney.com/search/jsonp?cb=cb&param=' + encodeURIComponent(param);
    const r = await fetch(url, { cache: 'no-store' });
    const txt = await r.text();
    const m = txt.match(/cb\((\{[\s\S]*\})\)\s*$/) || txt.match(/^(\{[\s\S]*\})$/);
    if (!m) return [];
    let j = null; try { j = JSON.parse(m[1]); } catch (e) { return []; }
    const arr = (j && j.result && j.result.cmsArticleWebOld) || [];
    return arr.map(it => ({
      title: String(it.title || '').replace(/<[^>]+>/g, ''),
      date: String(it.date || '').slice(0, 16),
      media: String(it.mediaName || ''),
      url: String(it.url || '')
    })).filter(x => x.title);
  }
  async function fetchAnn(code, limit) {
    const url = 'https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=' + (limit || 5) +
      '&page_index=1&ann_type=A&client_source=web&stock_list=' + encodeURIComponent(code);
    const r = await fetch(url, { cache: 'no-store' });
    const j = await r.json();
    const arr = (j && j.data && j.data.list) || [];
    return arr.map(it => ({
      title: String(it.title || it.title_ch || '').replace(/<[^>]+>/g, ''),
      date: String(it.display_time || it.notice_date || '').slice(0, 16),
      url: 'https://data.eastmoney.com/notices/detail/' + code + '/' + it.art_code + '.html'
    })).filter(x => x.title);
  }

  /* ---------------- AI 日报：每日 07:00 自动刷新，按股票代码缓存（表 levai） ---------------- */
  const AI_HOUR = 7;
  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  // 当日 07:00 之前算作「昨天」——过了 7 点才算新的一天
  function digestKey() {
    const d = new Date();
    if (d.getHours() < AI_HOUR) d.setDate(d.getDate() - 1);
    return ymd(d);
  }
  function msToNextAI() {
    const now = new Date();
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), AI_HOUR, 0, 0, 0);
    if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1);
    return t.getTime() - now.getTime();
  }

  // 生成当日研判：把真实行情 + 真实新闻/公告交给 AI 归纳；失败时降级为只显示新闻，不影响其余功能
  async function buildDigest(rec, q, ks) {
    const code = rec.stockCode;
    let news = [], ann = [];
    try { news = await withTimeout(fetchNews(code, 8), 9000); } catch (e) { news = []; }
    try { ann = await withTimeout(fetchAnn(code, 5), 9000); } catch (e) { ann = []; }

    const d = { stance: '中性', score: 3, summary: '', reasons: [], watch: [], risk: '', error: '' };
    const newsTxt = news.slice(0, 8).map(n => '- ' + n.date + ' ' + n.title + (n.media ? '（' + n.media + '）' : '')).join('\n') || '（暂无）';
    const annTxt = ann.slice(0, 5).map(a => '- ' + a.date + ' ' + a.title).join('\n') || '（暂无）';
    const kTxt = (ks || []).slice(-6).map(k => k.date.slice(5) + ' 收 ' + k.close).join('；') || '（暂无）';
    const qTxt = q ? ('最新价 ' + q.price.toFixed(2) + '，涨跌幅 ' + q.chgPct.toFixed(2) + '%，今开 ' + q.open.toFixed(2) +
      '，最高 ' + q.high.toFixed(2) + '，最低 ' + q.low.toFixed(2) + '，昨收 ' + q.preClose.toFixed(2)) : '（行情未获取）';

    if (!WB.ai || !WB.ai.ask) {
      d.error = 'AI 模块未加载，仅显示新闻';
    } else {
      const sys = '你是A股盘前研究助手。只依据给定的行情与新闻做条件化、概率化表述，'
        + '禁止给出确定性涨跌承诺或具体买卖点，禁止编造给定材料之外的信息。输出必须是纯JSON，不要任何多余文字。';
      const user = '股票：' + (rec.stockName || '') + '(' + code + ')\n'
        + '当前行情：' + qTxt + '\n'
        + '近6日收盘：' + kTxt + '\n'
        + '相关新闻：\n' + newsTxt + '\n'
        + '公司公告：\n' + annTxt + '\n'
        + '请输出JSON：{"stance":"偏多|中性|偏空","score":1-5的整数,"summary":"80字内的当日研判",'
        + '"reasons":["理由1","理由2","理由3"],"watch":["关注点1","关注点2"],"risk":"一条风险提示"}';
      try {
        const txt = await WB.ai.ask(sys, user, { src: 'leverage' });
        const p = WB.ai.parseJSON(txt);
        if (p) {
          d.stance = (['偏多', '中性', '偏空'].indexOf(p.stance) >= 0) ? p.stance : '中性';
          d.score = Math.min(5, Math.max(1, parseInt(p.score, 10) || 3));
          d.summary = String(p.summary || '').slice(0, 200);
          d.reasons = (p.reasons || []).map(String).filter(Boolean).slice(0, 4);
          d.watch = (p.watch || []).map(String).filter(Boolean).slice(0, 4);
          d.risk = String(p.risk || '').slice(0, 200);
        } else {
          d.summary = String(txt || '').slice(0, 300);
          d.error = 'AI 返回格式异常，已原文展示';
        }
      } catch (e) { d.error = e.message || 'AI 生成失败'; }
    }
    return Object.assign({ id: code, code: code, date: digestKey(), ts: Date.now(), news: news, ann: ann }, d);
  }

  /* ---------------- SVG 图表（含保本价参考线） ---------------- */
  function svgWrap(inner, extraLegends) {
    return '<svg class="chart" viewBox="0 0 640 250" preserveAspectRatio="xMidYMid meet" role="img">' +
      '<defs><linearGradient id="lgArea" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="var(--primary)" stop-opacity=".26"/>' +
      '<stop offset="100%" stop-color="var(--primary)" stop-opacity="0"/></linearGradient></defs>' +
      inner + (extraLegends || '') + '</svg>';
  }
  function refLine(yTop, yBot, price, lo, hi, W, PL, PR, label, color) {
    const Y = v => yTop + (hi - v) * (yBot - yTop) / (hi - lo);
    if (!price || price <= 0) return '';
    let y = Y(price), clamped = false;
    if (y < yTop) { y = yTop + 2; clamped = true; }
    if (y > yBot) { y = yBot - 2; clamped = true; }
    const x2 = W - PR;
    return '<line class="chart-ref" x1="' + PL + '" y1="' + y.toFixed(1) + '" x2="' + x2 + '" y2="' + y.toFixed(1) +
      '" stroke="' + (color || 'var(--warn)') + '" stroke-width="1.2" stroke-dasharray="5 4"/>' +
      '<text class="chart-lbl" x="' + (x2 + 4) + '" y="' + (y + 4).toFixed(1) + '" fill="' + (color || 'var(--warn)') + '">' +
      ui.escapeHtml(label) + (clamped ? (price > hi ? '↑' : '↓') : '') + '</text>';
  }
  function trendChart(rows, preClose, refs, W, H) {
    W = W || 640; H = H || 250;
    const PL = 8, PR = 66, PT = 14, PB = 24;
    if (!rows.length) return '';
    let lo = Infinity, hi = -Infinity;
    rows.forEach(r => { lo = Math.min(lo, r.price, r.avg); hi = Math.max(hi, r.price, r.avg); });
    if (preClose) { lo = Math.min(lo, preClose); hi = Math.max(hi, preClose); }
    const pad = (hi - lo) * 0.14 || 1; lo -= pad; hi += pad;
    const X = i => PL + i * (W - PL - PR) / Math.max(1, rows.length - 1);
    const Y = v => PT + (hi - v) * (H - PT - PB) / (hi - lo);
    const line = rows.map((r, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(r.price).toFixed(1)).join(' ');
    const area = line + ' L' + X(rows.length - 1).toFixed(1) + ' ' + Y(lo).toFixed(1) + ' L' + X(0).toFixed(1) + ' ' + Y(lo).toFixed(1) + ' Z';
    const avg = rows.map((r, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(r.avg).toFixed(1)).join(' ');
    let inner = '<path d="' + area + '" fill="url(#lgArea)"/>' +
      '<path d="' + line + '" fill="none" stroke="var(--primary)" stroke-width="1.8"/>' +
      '<path d="' + avg + '" fill="none" stroke="#f5a623" stroke-width="1.2" stroke-dasharray="4 3"/>';
    if (preClose) {
      inner += '<line x1="' + PL + '" y1="' + Y(preClose).toFixed(1) + '" x2="' + (W - PR) + '" y2="' + Y(preClose).toFixed(1) +
        '" stroke="var(--border)" stroke-width="1" stroke-dasharray="3 3"/>';
    }
    (refs || []).forEach(r => { inner += refLine(PT, H - PB, r.price, lo, hi, W, PL, PR, r.label, r.color); });
    // 时间轴
    inner += '<text class="chart-lbl" x="' + PL + '" y="' + (H - 6) + '" fill="var(--muted)">' + ui.escapeHtml(rows[0].time) + '</text>' +
      '<text class="chart-lbl" x="' + (W - PR) + '" y="' + (H - 6) + '" text-anchor="end" fill="var(--muted)">' + ui.escapeHtml(rows[rows.length - 1].time) + '</text>';
    return svgWrap(inner);
  }
  function klineChart(ks, refs, W, H) {
    W = W || 640; H = H || 250;
    const PL = 8, PR = 66, PT = 14, PB = 24;
    if (!ks.length) return '';
    let lo = Infinity, hi = -Infinity;
    ks.forEach(k => { lo = Math.min(lo, k.low); hi = Math.max(hi, k.high); });
    const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    const step = (W - PL - PR) / ks.length;
    const bw = Math.max(1.4, Math.min(8, step * 0.62));
    const Y = v => PT + (hi - v) * (H - PT - PB) / (hi - lo);
    let inner = '';
    ks.forEach((k, i) => {
      const x = PL + i * step + step / 2;
      const up = k.close >= k.open;
      const col = up ? 'var(--danger)' : 'var(--success)';
      const y1 = Y(Math.max(k.open, k.close)), y2 = Y(Math.min(k.open, k.close));
      inner += '<line x1="' + x.toFixed(1) + '" y1="' + Y(k.high).toFixed(1) + '" x2="' + x.toFixed(1) + '" y2="' + Y(k.low).toFixed(1) + '" stroke="' + col + '" stroke-width="1"/>';
      inner += '<rect x="' + (x - bw / 2).toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, y2 - y1).toFixed(1) + '" fill="' + (up ? 'var(--danger)' : 'var(--success)') + '"/>';
    });
    (refs || []).forEach(r => { inner += refLine(PT, H - PB, r.price, lo, hi, W, PL, PR, r.label, r.color); });
    inner += '<text class="chart-lbl" x="' + PL + '" y="' + (H - 6) + '" fill="var(--muted)">' + ui.escapeHtml(ks[0].date.slice(5)) + '</text>' +
      '<text class="chart-lbl" x="' + (W - PR) + '" y="' + (H - 6) + '" text-anchor="end" fill="var(--muted)">' + ui.escapeHtml(ks[ks.length - 1].date.slice(5)) + '</text>';
    return svgWrap(inner);
  }

  /* ---------------- 表单 ---------------- */
  function formHTML(r) {
    r = r || {};
    const d = (k, v) => (r[k] != null && r[k] !== '' ? r[k] : v);
    return '' +
      '<div class="form-sec">贷款信息（照平台页面填，借呗 / 微粒贷都显示这几项）</div>' +
      ui.form([
        { name: 'loanName', label: '平台 / 名称', value: d('loanName', ''), placeholder: '如：支付宝借呗 / 微信微粒贷', flex: 1, row: 1 },
        { name: 'principal', label: '贷款金额(元) · 仅借款部分', type: 'number', value: d('principal', ''), required: true, min: 0, flex: 1, row: 1 },
        { name: 'termMonths', label: '借款期限(月)', type: 'number', value: d('termMonths', 3), min: 1, flex: 1, row: 2 },
        { name: 'method', label: '还款方式', type: 'select', value: d('method', 'daily'), flex: 1, row: 2, options: Object.keys(METHOD).map(k => ({ value: k, label: METHOD[k] })) },
        { name: 'startDate', label: '起息日', type: 'date', value: d('startDate', todayISO()), required: true, flex: 1, row: 3 },
        { name: 'termInterest', label: '期限总利息(元) · 平台显示', type: 'number', value: d('termInterest', ''), min: 0, flex: 1, row: 3 },
        { name: 'periodInterests', label: '每期利息(元) · 逗号分隔', type: 'text', value: d('periodInterests', ''), placeholder: '不同期利息不同就填，如 300,290,280；不填总利息时自动求和当总利息；留空则按总利息平均', flex: 2, row: 4 },
        { name: 'monthlyPayment', label: '每期应还(元) · 选填', type: 'number', value: d('monthlyPayment', ''), min: 0, flex: 1, row: 5 },
        { name: 'dailyRate', label: '日利率 %(手动填·最高优先)', type: 'number', value: d('dailyRate', ''), min: 0, step: 0.0001, flex: 1, row: 5 },
        { name: 'annualRate', label: '年利率 %(选填·次优先)', type: 'number', value: d('annualRate', ''), min: 0, flex: 1, row: 6 },
        { name: 'dayBasis', label: '日利率基准', type: 'select', value: String(d('dayBasis', 360)), flex: 1, row: 6, options: [{ value: '360', label: '360天(银行常用)' }, { value: '365', label: '365天' }] },
        { name: 'repayDay', label: '每月还款日(号)', type: 'number', value: d('repayDay', 25), min: 1, max: 28, flex: 1, row: 7 },
        { name: 'prepayFeeRate', label: '提前还款违约金 %(选填)', type: 'number', value: d('prepayFeeRate', 0), min: 0, flex: 1, row: 7 }
      ]) +
      '<div class="hint muted">「贷款金额」只填借来的钱；买入总价减去它＝你的自有本金，两者都会被保本价同时保护。<b>总利息二选一来源</b>：①填「期限总利息(平台显示)」最省事（两者都填以它为准）；②不填它、改填「每期利息」会自动求和当作总利息。利率三种填法优先级：①手填日利率 ②总利息反推 ③年利率；都不填则利息按 0 计。</div>' +
      '<div class="form-sec">股票持仓（买入价手动填，之后按实时行情跟踪）</div>' +
      ui.form([
        { name: 'stockCode', label: '股票代码', value: d('stockCode', ''), required: true, placeholder: '如 600519', flex: 1, row: 1 },
        { name: 'quantity', label: '买入数量(股)', type: 'number', value: d('quantity', ''), required: true, min: 1, flex: 1, row: 1 },
        { name: 'buyPrice', label: '买入价(元) · 已含买入费用', type: 'number', value: d('buyPrice', ''), required: true, min: 0, flex: 1, row: 2 },
        { name: 'buyDate', label: '买入日期', type: 'date', value: d('buyDate', todayISO()), flex: 1, row: 2 }
      ]) +
      '<div id="f-own" class="hint muted"></div>' +
      '<div class="form-sec">交易费率（国信证券默认，按你的账户改）</div>' +
      ui.form([
        { name: 'commissionRate', label: '佣金率 %（万2.5 = 0.025）', type: 'number', value: d('commissionRate', DEF.commissionRate), min: 0, flex: 1, row: 1 },
        { name: 'minCommission', label: '单笔最低佣金(元)', type: 'number', value: d('minCommission', DEF.minCommission), min: 0, flex: 1, row: 1 },
        { name: 'stampRate', label: '印花税 %（仅卖出）', type: 'number', value: d('stampRate', DEF.stampRate), min: 0, flex: 1, row: 2 },
        { name: 'transferRate', label: '过户费 %（双边）', type: 'number', value: d('transferRate', DEF.transferRate), min: 0, flex: 1, row: 2 }
      ]) +
      '<div class="hint muted">你使用国信证券：买入价已含买入佣金与过户费，下方费率仅用于计算「卖出」时的费用——佣金(万2.5/最低5元) + 印花税(0.05% 单边) + 过户费(0.001% 双边，卖出侧)。都可在设置里改成你的真实费率。</div>' +
      '<div id="f-warn" class="lev-warnbox" style="display:none"></div>';
  }

  /* ---------------- 输入异常校验（本地启发式，只提示不阻断） ----------------
   * 返回 [{lv:'danger'|'warn', msg}]：danger＝极可能填错（保存前二次确认），warn＝提醒。
   * ctx: { quote:{price,name}|null, baseDate: 首笔买入日（加仓场景）, baseBuyPrice, isAdd }
   */
  const CHK = {
    priceDanger: 10,   // 买入价/现价 ≥10 或 ≤1/10 → 极可能多/少填一位
    priceWarn: 3,      // ≥3 或 ≤1/3 → 提醒
    dailyWarn: 0.05,   // 日利率% >0.05（年化≈18.25%）
    dailyDanger: 0.1,  // 日利率% >0.1（年化≈36.5%，高利贷红线）
    annualWarn: 24, annualDanger: 36,
    termMaxMonths: 60,
    pastYears: 5,
    commMax: 0.3, stampMax: 0.2
  };
  function warnList(rec, ctx) {
    ctx = ctx || {};
    const out = [];
    const push = (lv, msg) => out.push({ lv: lv, msg: msg });
    const q = ctx.quote;
    const bp = num(rec.buyPrice);
    const qty = num(rec.quantity);
    const P = num(rec.principal);
    const n = Math.max(1, num(rec.termMonths, 3));

    // 1) 买入价 vs 当前股价（多填/少填一位数是最高频错误）
    if (q && q.price > 0 && bp > 0) {
      const r = bp / q.price;
      if (r >= CHK.priceDanger) {
        push('danger', '买入价 ' + bp.toFixed(2) + ' 是当前股价 ' + q.price.toFixed(2) + ' 的 ' + Math.round(r) + ' 倍，很可能多填了一位，请确认是否填错');
      } else if (r <= 1 / CHK.priceDanger) {
        push('danger', '买入价 ' + bp.toFixed(2) + ' 只有当前股价 ' + q.price.toFixed(2) + ' 的 1/' + Math.round(1 / r) + '，很可能少填了一位，请确认是否填错');
      } else if (r >= CHK.priceWarn) {
        push('warn', '买入价 ' + bp.toFixed(2) + ' 高于当前股价 ' + q.price.toFixed(2) + '（' + r.toFixed(1) + ' 倍），若不是历史高位买入请检查');
      } else if (r <= 1 / CHK.priceWarn) {
        push('warn', '买入价 ' + bp.toFixed(2) + ' 明显低于当前股价 ' + q.price.toFixed(2) + '（仅为 1/' + (1 / r).toFixed(1) + '），请检查是否漏填');
      }
    }

    // 2) 日利率（年化 = 日利率 × 365）
    const dr = num(rec.dailyRate);
    if (dr > CHK.dailyDanger) {
      push('danger', '日利率 ' + dr + '% 相当于年化 ' + (dr * 365).toFixed(1) + '%，超过高利贷红线（年化 36%），请确认是否把年利率填进了日利率');
    } else if (dr > CHK.dailyWarn) {
      push('warn', '日利率 ' + dr + '% 相当于年化 ' + (dr * 365).toFixed(1) + '%，高于常见商业贷款（一般不超过年化 24%）');
    }

    // 3) 年利率
    const ar = num(rec.annualRate);
    if (ar > CHK.annualDanger) push('danger', '年利率 ' + ar + '% 超过 36%（高利贷红线），请确认');
    else if (ar > CHK.annualWarn) push('warn', '年利率 ' + ar + '% 高于司法保护区上限（约 24%），超出部分不受法律保护');

    // 4) 反推年化（覆盖「期限总利息 / 每期利息」口径，只要能算出年化就校验）
    if (P > 0 && bp >= 0 && !ctx.skipImplied) {
      try {
        const st = loanState(Object.assign({}, rec, { principal: P, startDate: rec.startDate || todayISO() }), 0);
        const ia = st.impliedAnnual;
        if (ia > CHK.annualDanger) push('danger', '按本金与总利息反推年化约 ' + ia.toFixed(1) + '%，超过 36%（高利贷红线），请确认总利息是否填错');
        else if (ia > CHK.annualWarn) push('warn', '按本金与总利息反推年化约 ' + ia.toFixed(1) + '%，高于常见商业贷款水平');
      } catch (e) { /* 反推失败则跳过 */ }
    }

    // 5) 每期利息条数 ≠ 期限月数（条数不一致时该字段会被整段忽略）
    if (rec.periodInterests) {
      const arr = String(rec.periodInterests).split(',').map(s => s.trim()).filter(Boolean);
      if (arr.length && arr.length !== n) {
        push('warn', '每期利息填了 ' + arr.length + ' 条，与借款期限 ' + n + ' 个月不一致 —— 条数不一致时该字段不会被采用，请补齐或清空');
      }
    }

    // 6) 期限异常
    if (n > CHK.termMaxMonths) push('warn', '借款期限 ' + n + ' 个月（超过 5 年），消费贷一般不超过 3-5 年，请确认');

    // 7) 起息日
    if (rec.startDate) {
      if (rec.startDate > todayISO()) push('warn', '起息日 ' + rec.startDate + ' 晚于今天，贷款尚未开始计息');
      else if (daysBetween(rec.startDate) > CHK.pastYears * 365) push('warn', '起息日距今已超过 ' + CHK.pastYears + ' 年，请确认是否填错年份');
    }

    // 8) 买入数量不是 100 的整数倍（A股按「手」）
    if (qty > 0 && qty % 100 !== 0) push('warn', '买入数量 ' + qty + ' 股不是 100 的整数倍，A股通常按「手」（100 股）的整数倍买入');

    // 9) 贷款金额 > 买入总额（差额未投入但仍全额计息）
    const buy = bp * qty;
    if (P > buy && buy > 0) push('warn', '贷款金额 ' + money0(P) + ' 大于买入总额 ' + money0(buy) + '，差额未投入股票但仍按全额计息');

    // 10) 加仓日期早于首笔买入日
    if (ctx.baseDate && rec.startDate && rec.startDate < ctx.baseDate) {
      push('warn', '加仓日期 ' + rec.startDate + ' 早于首笔买入日 ' + ctx.baseDate + '，请确认');
    }

    // 11) 费率明显偏离常见水平（仅主表单）
    if (rec.commissionRate != null && num(rec.commissionRate) > CHK.commMax) push('warn', '佣金率 ' + num(rec.commissionRate) + '% 明显高于常见水平（万2.5 = 0.025%）');
    if (rec.stampRate != null && num(rec.stampRate) > CHK.stampMax) push('warn', '印花税 ' + num(rec.stampRate) + '% 明显高于现行标准（0.05%，仅卖出）');

    // 12) 每期应还明显偏小（像是只填了利息）
    const mp = num(rec.monthlyPayment);
    if (mp > 0 && P > 0 && n > 0 && mp < (P / n) * 0.9) {
      push('warn', '每期应还 ' + money0(mp) + ' 小于「本金 ÷ 期数」' + money0(P / n) + '，看起来只填了利息部分？');
    }
    return out;
  }

  function warnBoxHTML(list) {
    if (!list || !list.length) return '';
    return '<div class="lw-head">⚠ 检测到 ' + list.length + ' 处异常（可忽略后继续保存）</div>' +
      list.map(w => '<div class="lw-item ' + w.lv + '">' + ui.escapeHtml(w.msg) + '</div>').join('');
  }
  function renderWarn(box, list) {
    if (!box) return;
    if (!list || !list.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.style.display = '';
    box.innerHTML = warnBoxHTML(list);
  }
  // danger 级异常：保存前二次确认，用户可坚持保存
  async function confirmRisky(list) {
    const danger = (list || []).filter(w => w.lv === 'danger');
    if (!danger.length) return true;
    return await ui.confirm({
      title: '数据异常确认',
      message: '检测到以下可能填错的数据：\n\n· ' + danger.map(w => w.msg).join('\n· ') + '\n\n确定仍要按此保存吗？',
      confirmLabel: '仍然保存', danger: true
    });
  }

  function openForm(rec, onSaved) {
    let quote = null, riskAck = false;
    const m = ui.openModal({
      title: rec ? '编辑测算' : '新建测算', html: formHTML(rec),
      actions: [{ label: '取消' }, {
        label: '保存', primary: true, onClick: async (close) => {
          const g = id => m.dialog.querySelector('#f-' + id).value.trim();
          const code = g('stockCode').replace(/\D/g, '');
          if (!code) { ui.toast('股票代码格式不对', 'warn'); return; }
          // 保存前复检：danger 级异常需二次确认（用户可坚持保存）
          if (!riskAck) {
            const wl = warnList(readRec(), { quote: quote });
            if (!(await confirmRisky(wl))) return;
            riskAck = true;
          }
          const obj = rec ? Object.assign({}, rec) : { id: store.uid() };
          obj.loanName = g('loanName');
          obj.principal = num(g('principal'));
          obj.annualRate = num(g('annualRate'));
          obj.dailyRate = num(g('dailyRate'));              // 手动日利率（最高优先级）
          obj.termInterest = num(g('termInterest'));        // 平台显示：借 N 个月总共利息
          obj.monthlyPayment = num(g('monthlyPayment'));    // 平台显示：每期应还
          obj.method = g('method');
          obj.termMonths = Math.max(1, num(g('termMonths'), 12));
          obj.startDate = g('startDate');
          obj.dayBasis = parseInt(g('dayBasis'), 10) || 360;
          obj.prepayFeeRate = num(g('prepayFeeRate'));
          obj.repayDay = Math.min(28, Math.max(1, num(g('repayDay'), 25)));
          obj.periodInterests = g('periodInterests').replace(/，/g, ',').trim();
          obj.stockCode = code;
          obj.quantity = Math.max(1, num(g('quantity'), 1));
          obj.buyPrice = num(g('buyPrice'));
          obj.buyDate = g('buyDate');
          obj.commissionRate = num(g('commissionRate'), DEF.commissionRate);
          obj.minCommission = num(g('minCommission'), DEF.minCommission);
          obj.stampRate = num(g('stampRate'), DEF.stampRate);
          obj.transferRate = num(g('transferRate'), DEF.transferRate);
          // 尽力解析股票名称并持久化，列表/标题即可直接显示（失败则留空，回退到代码）
          try {
            const nm = await withTimeout(fetchQuote(code).then(q => (q && q.name) ? q.name : null), 3500);
            if (nm) obj.stockName = nm;
          } catch (e) { /* 离线/超时则跳过，下次保存或列表回填时再试 */ }
          obj.updatedAt = Date.now();
          await store.put('leverage', obj);
          close();
          if (onSaved) onSaved(obj);
        }
      }]
    });
    // 还款方式提示随选择变化
    const sel = m.dialog.querySelector('#f-method');
    const hint = document.createElement('div');
    hint.className = 'hint muted'; hint.textContent = METHOD_HINT[sel.value] || '';
    sel.parentNode.appendChild(hint);
    sel.addEventListener('change', () => { hint.textContent = METHOD_HINT[sel.value] || ''; });
    // 实时计算「自有本金 = 买入总价 − 贷款金额」
    const ownEl = m.dialog.querySelector('#f-own');
    const updOwn = () => {
      if (!ownEl) return;
      const bp = parseFloat(m.dialog.querySelector('#f-buyPrice').value) || 0;
      const q = parseFloat(m.dialog.querySelector('#f-quantity').value) || 0;
      const loan = parseFloat(m.dialog.querySelector('#f-principal').value) || 0;
      const total = bp * q;
      const own = Math.max(0, total - loan);
      ownEl.innerHTML = '买入总成本 <b>' + money(total) + '</b> ＝ 贷款 <b>' + money(loan) + '</b> ＋ 自有本金 <b>' + money(own) + '</b>'
        + (loan > total && total > 0 ? '<br>⚠️ 贷款大于买入，差额为未投入现金，仍按全额计息' : '');
    };
    ['buyPrice', 'quantity', 'principal'].forEach(id => {
      const el = m.dialog.querySelector('#f-' + id);
      if (el) el.addEventListener('input', updOwn);
    });
    updOwn();

    // 输入异常校验：实时爆红提示（股价比对需先取一次行情，代码填好后自动拉取）
    const warnEl = m.dialog.querySelector('#f-warn');
    function readRec() {
      const g = id => { const el = m.dialog.querySelector('#f-' + id); return el ? el.value.trim() : ''; };
      return {
        buyPrice: num(g('buyPrice')), quantity: num(g('quantity')), principal: num(g('principal')),
        dailyRate: g('dailyRate'), annualRate: g('annualRate'), termInterest: g('termInterest'),
        periodInterests: g('periodInterests'), monthlyPayment: g('monthlyPayment'),
        termMonths: Math.max(1, num(g('termMonths'), 3)), method: g('method'), startDate: g('startDate'),
        buyDate: g('buyDate'), dayBasis: num(g('dayBasis'), 360), repayDay: num(g('repayDay'), 25),
        commissionRate: num(g('commissionRate'), DEF.commissionRate), stampRate: num(g('stampRate'), DEF.stampRate),
        transferRate: num(g('transferRate'), DEF.transferRate), minCommission: num(g('minCommission'), DEF.minCommission)
      };
    }
    function runCheck() {
      try { renderWarn(warnEl, warnList(readRec(), { quote: quote })); } catch (e) { /* 校验出错不阻塞填写 */ }
    }
    const codeEl = m.dialog.querySelector('#f-stockCode');
    async function loadQuote() {
      const code = (codeEl ? codeEl.value : '').replace(/\D/g, '');
      if (!code || code.length < 5) { quote = null; runCheck(); return; }
      try { quote = await withTimeout(fetchQuote(code), 4000); } catch (e) { quote = null; }
      runCheck();
    }
    if (codeEl) { codeEl.addEventListener('change', loadQuote); codeEl.addEventListener('blur', loadQuote); }
    m.dialog.querySelectorAll('.input').forEach(el => {
      el.addEventListener('input', runCheck);
      el.addEventListener('change', runCheck);
    });
    runCheck();
    if (codeEl && codeEl.value) loadQuote();
    ui.bindFormValidation(m.dialog);
  }

  /* ---------------- 加仓（向现有持仓追加一笔买入，资金可为贷款/存款/混合） ---------------- */
  function openAddForm(rec, onSaved) {
    const METHOD_OPTS = Object.keys(METHOD).map(k => ({ value: k, label: METHOD[k] }));
    const html =
      '<div class="form-sec">本批买入（第 ' + (((rec.adds || []).length) + 2) + ' 批，资金可全部贷款、全部存款或两者混合）</div>' +
      ui.form([
        { name: 'date', label: '加仓日期', type: 'date', value: todayISO(), required: true, flex: 1, row: 1 },
        { name: 'qty', label: '买入数量(股)', type: 'number', value: '', required: true, min: 1, flex: 1, row: 1 },
        { name: 'price', label: '买入价(元) · 已含买入费', type: 'number', value: '', required: true, min: 0, flex: 1, row: 1 },
        { name: 'principal', label: '其中贷款金额(元) · 0=全用存款', type: 'number', value: 0, min: 0, flex: 1, row: 2 }
      ]) +
      '<div id="f-add-sum" class="hint muted"></div>' +
      '<div id="f-add-loan">' +
        '<div class="form-sec">本批贷款条款（利率可沿用首笔；金额类只认本批填写）</div>' +
        ui.form([
          { name: 'method', label: '还款方式', type: 'select', value: rec.method || 'daily', flex: 1, row: 1, options: METHOD_OPTS },
          { name: 'termMonths', label: '借款期限(月)', type: 'number', value: num(rec.termMonths, 3), min: 1, flex: 1, row: 1 },
          { name: 'termInterest', label: '本批期限总利息(元) · 平台显示', type: 'number', value: '', min: 0, flex: 1, row: 2 },
          { name: 'periodInterests', label: '本批每期利息(元) · 逗号分隔', type: 'text', value: '', placeholder: '如 60,55,50；不填总利息时自动求和当总利息', flex: 1, row: 2 },
          { name: 'dailyRate', label: '本批日利率 %(留空沿用首笔)', type: 'number', value: '', min: 0, step: 0.0001, flex: 1, row: 3 },
          { name: 'annualRate', label: '本批年利率 %(留空沿用首笔)', type: 'number', value: '', min: 0, flex: 1, row: 3 }
        ]) +
        '<div class="hint muted">「期限总利息 / 每期利息 / 每期应还」这类<b>金额只按本批填的算</b>，不会沿用首笔（避免把首笔的总利息错算到新批）；日利率 / 年利率留空则沿用首笔贷款设置。</div>' +
      '</div>' +
      '<div id="f-warn" class="lev-warnbox" style="display:none"></div>';
    let quote = null, riskAck = false;
    const m = ui.openModal({
      title: '加仓 · ' + (rec.stockName || rec.stockCode),
      html: html,
      actions: [{ label: '取消' }, {
        label: '保存加仓', primary: true, onClick: async (close) => {
          const g = id => m.dialog.querySelector('#f-' + id).value.trim();
          const qty = Math.max(1, num(g('qty'), 0));
          const price = num(g('price'));
          if (!(qty > 0) || !(price > 0)) { ui.toast('请填买入数量和买入价', 'warn'); return; }
          // 保存前复检：danger 级异常二次确认（用户可坚持保存）
          if (!riskAck) {
            const wl = warnList(readRec(), { quote: quote, baseDate: rec.buyDate || rec.startDate });
            if (!(await confirmRisky(wl))) return;
            riskAck = true;
          }
          const obj = Object.assign({}, rec);
          const add = {
            id: store.uid(),
            date: g('date') || todayISO(),
            qty: qty,
            price: price,
            principal: Math.max(0, num(g('principal')))
          };
          if (add.principal > 0) {
            add.method = g('method');
            add.termMonths = Math.max(1, num(g('termMonths'), num(rec.termMonths, 3)));
            add.termInterest = g('termInterest');
            add.periodInterests = g('periodInterests').replace(/，/g, ',').trim();
            add.dailyRate = g('dailyRate');
            add.annualRate = g('annualRate');
          }
          obj.adds = (rec.adds || []).concat([add]);
          obj.updatedAt = Date.now();
          await store.put('leverage', obj);
          close();
          if (onSaved) onSaved(obj);
        }
      }]
    });
    // 本批小计 + 加仓后均价 实时预览
    const sumEl = m.dialog.querySelector('#f-add-sum');
    const loanBox = m.dialog.querySelector('#f-add-loan');
    const upd = () => {
      const qty = num(m.dialog.querySelector('#f-qty').value);
      const price = num(m.dialog.querySelector('#f-price').value);
      const loan = num(m.dialog.querySelector('#f-principal').value);
      const sub = price * qty;
      const ownPart = Math.max(0, sub - loan);
      const baseQ = num(rec.quantity, 0);
      const baseBuy = num(rec.buyPrice) * baseQ;
      const Q2 = baseQ + qty;
      const buy2 = baseBuy + sub;
      const avg = Q2 > 0 ? buy2 / Q2 : 0;
      sumEl.innerHTML = sub > 0
        ? ('本批买入 <b>' + money(sub) + '</b> ＝ 贷款 <b>' + money(loan) + '</b> ＋ 自有 <b>' + money(ownPart) + '</b>' +
           '　→　加仓后持仓 <b>' + Q2 + '</b> 股 · 新均价 <b>' + avg.toFixed(3) + '</b>' +
           (loan > sub && sub > 0 ? '<br>⚠️ 本批贷款大于买入，差额为未投入现金，仍按全额计息' : ''))
        : '';
      if (loanBox) loanBox.style.display = loan > 0 ? '' : 'none';
    };
    ['f-qty', 'f-price', 'f-principal'].forEach(id => {
      const el = m.dialog.querySelector('#' + id);
      if (el) el.addEventListener('input', upd);
    });
    upd();

    // 输入异常校验（加仓场景：买入价取本批 price，日期取本批 date，沿用首笔费率）
    const warnEl = m.dialog.querySelector('#f-warn');
    function readRec() {
      const g = id => { const el = m.dialog.querySelector('#f-' + id); return el ? el.value.trim() : ''; };
      return {
        buyPrice: num(g('price')), quantity: num(g('qty')), principal: num(g('principal')),
        dailyRate: g('dailyRate'), annualRate: g('annualRate'), termInterest: g('termInterest'),
        periodInterests: g('periodInterests'), monthlyPayment: '',
        termMonths: Math.max(1, num(g('termMonths'), num(rec.termMonths, 3))),
        method: g('method') || rec.method || 'daily', startDate: g('date') || todayISO(),
        dayBasis: num(rec.dayBasis, 360), repayDay: num(rec.repayDay, 25),
        commissionRate: num(rec.commissionRate, DEF.commissionRate), stampRate: num(rec.stampRate, DEF.stampRate),
        transferRate: num(rec.transferRate, DEF.transferRate), minCommission: num(rec.minCommission, DEF.minCommission)
      };
    }
    function runCheck() {
      try { renderWarn(warnEl, warnList(readRec(), { quote: quote, baseDate: rec.buyDate || rec.startDate })); } catch (e) {}
    }
    m.dialog.querySelectorAll('.input').forEach(el => {
      el.addEventListener('input', runCheck);
      el.addEventListener('change', runCheck);
    });
    runCheck();
    // 取一次实时行情用于「买入价 vs 现价」比对
    (async () => {
      try {
        const q0 = await withTimeout(fetchQuote(rec.stockCode), 4000);
        if (q0 && q0.price) { quote = q0; runCheck(); }
      } catch (e) { /* 无行情则跳过价格校验 */ }
    })();
    ui.bindFormValidation(m.dialog);
    setTimeout(() => { const el = m.dialog.querySelector('#f-qty'); if (el) el.focus(); }, 50);
  }

  /* ---------------- 卖出（扣费后结算，快照固化本笔盈亏） ---------------- */
  function openSellForm(rec, onSaved) {
    const c0 = calc(rec, null);
    if (!c0.leftQty) { ui.toast('已无持仓可卖出', 'warn'); return; }
    let quote = null, riskAck = false;
    const html = ui.form([
      { name: 'date', label: '卖出日期', type: 'date', value: todayISO(), required: true, flex: 1, row: 1 },
      { name: 'qty', label: '卖出数量(股)', type: 'number', value: c0.leftQty, required: true, min: 1, flex: 1, row: 1 },
      { name: 'price', label: '卖出价(元)', type: 'number', value: '', required: true, min: 0, step: 0.01, flex: 1, row: 1 }
    ]) +
      '<div id="f-sell-sum" class="hint muted"></div>' +
      '<div class="hint muted">卖出费用按你的费率计算：佣金(万2.5/最低5元) + 印花税(' + num(rec.stampRate, DEF.stampRate) + '%，仅卖出) + 过户费(' + num(rec.transferRate, DEF.transferRate) + '%，双边)。剩余持仓 <b>' + c0.leftQty + '</b> 股。</div>' +
      '<div id="f-warn" class="lev-warnbox" style="display:none"></div>';
    const m = ui.openModal({
      title: '卖出 · ' + (rec.stockName || rec.stockCode),
      html: html,
      actions: [{ label: '取消' }, {
        label: '确认卖出', primary: true, onClick: async (close) => {
          const g = id => m.dialog.querySelector('#f-' + id).value.trim();
          const qty = num(g('qty'), 0), price = num(g('price'));
          if (!(qty > 0) || !(price > 0)) { ui.toast('请填卖出数量和卖出价', 'warn'); return; }
          if (qty > c0.leftQty + 1e-6) { ui.toast('卖出数量超过剩余持仓 ' + c0.leftQty + ' 股', 'warn'); return; }
          if (!riskAck) {
            const wl = sellWarn(price, quote);
            if (!(await confirmRisky(wl))) return;
            riskAck = true;
          }
          const c = calc(rec, null);
          const gross = price * qty;
          const f = rates(rec);
          const comm = Math.max(gross * f.comm, f.minComm), stamp = gross * f.stamp, transfer = gross * f.transfer;
          const feeTotal = comm + stamp + transfer;
          const net = gross - feeTotal;
          const costAlloc = c.Q > 0 ? c.buy * (qty / c.Q) : 0;
          const interestAlloc = c.Q > 0 ? c.accrued * (qty / c.Q) : 0;
          const obj = Object.assign({}, rec);
          obj.sells = (rec.sells || []).concat([{
            id: store.uid(), date: g('date') || todayISO(), qty: qty, price: price,
            gross: gross, comm: comm, stamp: stamp, transfer: transfer, feeTotal: feeTotal, net: net,
            costAlloc: costAlloc, interestAlloc: interestAlloc, pnl: net - costAlloc - interestAlloc
          }]);
          obj.updatedAt = Date.now();
          await store.put('leverage', obj);
          close();
          if (onSaved) onSaved(obj);
        }
      }]
    });
    const sumEl = m.dialog.querySelector('#f-sell-sum');
    const warnEl = m.dialog.querySelector('#f-warn');
    const upd = () => {
      const qty = num(m.dialog.querySelector('#f-qty').value), price = num(m.dialog.querySelector('#f-price').value);
      const gross = qty * price;
      const f = rates(rec);
      const comm = Math.max(gross * f.comm, f.minComm), stamp = gross * f.stamp, transfer = gross * f.transfer;
      const feeTotal = comm + stamp + transfer, net = gross - feeTotal;
      const c = calc(rec, null);
      const costAlloc = c.Q > 0 ? c.buy * (qty / c.Q) : 0;
      const interestAlloc = c.Q > 0 ? c.accrued * (qty / c.Q) : 0;
      sumEl.innerHTML = gross > 0
        ? ('成交额 <b>' + money(gross) + '</b> － 费用 <b>' + money(feeTotal) + '</b>（佣金 ' + money(comm) + ' + 印花税 ' + money(stamp) + ' + 过户费 ' + money(transfer) + '） ＝ <b>到手 ' + money(net) + '</b><br>' +
           '本笔分摊：买入成本 ' + money(costAlloc) + ' + 已计利息 ' + money(interestAlloc) + ' → 本笔盈亏 <b class="' + cls(net - costAlloc - interestAlloc) + '">' + money(net - costAlloc - interestAlloc) + '</b>' + (qty >= c.leftQty - 1e-6 ? '　（清仓）' : '　（剩余 ' + Math.max(0, c.leftQty - qty) + ' 股）'))
        : '';
      renderWarn(warnEl, sellWarn(price, quote));
    };
    ['f-qty', 'f-price'].forEach(id => { const el = m.dialog.querySelector('#' + id); if (el) el.addEventListener('input', upd); });
    upd();
    (async () => {
      try { const q0 = await withTimeout(fetchQuote(rec.stockCode), 4000); if (q0 && q0.price) { quote = q0; upd(); } } catch (e) {}
    })();
    ui.bindFormValidation(m.dialog);
    setTimeout(() => { const el = m.dialog.querySelector('#f-price'); if (el) el.focus(); }, 50);
  }
  // 卖出价异常提示（与买入价同一套倍数逻辑）
  function sellWarn(price, quote) {
    const out = [];
    if (!(price > 0)) return out;
    if (quote && quote.price > 0) {
      const r = price / quote.price;
      if (r >= CHK.priceDanger) out.push({ lv: 'danger', msg: '卖出价 ' + price.toFixed(2) + ' 是当前股价 ' + quote.price.toFixed(2) + ' 的 ' + Math.round(r) + ' 倍，很可能多填了一位' });
      else if (r <= 1 / CHK.priceDanger) out.push({ lv: 'danger', msg: '卖出价 ' + price.toFixed(2) + ' 只有当前股价的 1/' + Math.round(1 / r) + '，很可能少填了一位' });
      else if (r >= CHK.priceWarn) out.push({ lv: 'warn', msg: '卖出价高于当前股价（' + r.toFixed(1) + ' 倍），确认是否填错' });
      else if (r <= 1 / CHK.priceWarn) out.push({ lv: 'warn', msg: '卖出价明显低于当前股价，确认是否填错' });
    }
    return out;
  }

  /* ---------------- 还款（先息后本冲抵；还清后可确认完结） ---------------- */
  function openRepayForm(rec, onSaved) {
    const c0 = calc(rec, null);
    if (c0.remainPrincipal <= 0.01 && c0.remainInterest <= 0.01) { ui.toast('该笔贷款本息已还清', 'warn'); return; }
    const html = ui.form([
      { name: 'date', label: '还款日期', type: 'date', value: todayISO(), required: true, flex: 1, row: 1 },
      { name: 'amount', label: '还款金额(元)', type: 'number', value: (Math.round(c0.settleNeed * 100) / 100), required: true, min: 0, step: 0.01, flex: 1, row: 1 },
      { name: 'note', label: '备注(选填)', value: '', flex: 1, row: 2 }
    ]) +
      '<button type="button" class="btn ghost sm" id="f-fill-settle">填入结清所需 ' + money(c0.settleNeed) + '（含违约金 ' + money(c0.settleFee) + '）</button>' +
      '<div id="f-repay-sum" class="hint muted" style="margin-top:8px"></div>' +
      '<div class="hint muted">还款按「先还利息、再还本金」冲抵。全部本息还清后，系统会询问是否把这笔测算标记为「已完结」（完结后停止计息并生成结算面板）。</div>';
    const m = ui.openModal({
      title: '还款 · ' + (rec.stockName || rec.stockCode),
      html: html,
      actions: [{ label: '取消' }, {
        label: '确认还款', primary: true, onClick: async (close) => {
          const g = id => m.dialog.querySelector('#f-' + id).value.trim();
          const amount = num(g('amount'));
          if (!(amount > 0)) { ui.toast('请填写还款金额', 'warn'); return; }
          const date = g('date') || todayISO();
          const obj = Object.assign({}, rec);
          obj.repayments = (rec.repayments || []).concat([{ id: store.uid(), date: date, amount: amount, note: g('note') }]);
          obj.updatedAt = Date.now();
          const after = calc(obj, null);
          if (after.cleared) {
            const yes = await ui.confirm({
              title: '贷款本息已还清',
              message: '还完这笔后，本金与利息已全部结清。是否将这笔测算标记为「已完结」？完结后停止计息并生成最终结算面板。',
              confirmLabel: '确认完结'
            });
            if (yes) { obj.closed = true; obj.closedAt = date; }
          }
          await store.put('leverage', obj);
          close();
          if (onSaved) onSaved(obj);
        }
      }]
    });
    const sumEl = m.dialog.querySelector('#f-repay-sum');
    const upd = () => {
      const amount = num(m.dialog.querySelector('#f-amount').value);
      const c = calc(rec, null);
      const payI = Math.min(c.accrued, amount), payP = Math.max(0, amount - c.accrued);
      const rp = Math.max(0, c.remainPrincipal - payP), ri = Math.max(0, c.remainInterest - payI);
      const done = rp <= 0.01 && ri <= 0.01;
      sumEl.innerHTML = amount > 0
        ? ('本次 ' + money(amount) + '：先冲利息 <b>' + money(payI) + '</b>' + (payP > 0 ? '，再冲本金 <b>' + money(payP) + '</b>' : '') +
           '<br>还款后剩余：本金 <b>' + money(rp) + '</b> ＋ 待付利息 <b>' + money(ri) + '</b>' + (done ? '　→ <b class="lv-up">本息已结清</b>' : ''))
        : '';
    };
    const fillBtn = m.dialog.querySelector('#f-fill-settle');
    if (fillBtn) fillBtn.onclick = () => { m.dialog.querySelector('#f-amount').value = (Math.round(calc(rec, null).settleNeed * 100) / 100); upd(); };
    const amtEl = m.dialog.querySelector('#f-amount');
    if (amtEl) amtEl.addEventListener('input', upd);
    upd();
    ui.bindFormValidation(m.dialog);
    setTimeout(() => { if (amtEl) amtEl.focus(); }, 50);
  }

  /* ---------------- 详情视图 ---------------- */
  let _timer = null, _aiTimer = null;

  function clearTimer() {
    if (_timer) { clearInterval(_timer); _timer = null; }
    if (_aiTimer) { clearTimeout(_aiTimer); _aiTimer = null; }
  }

  function scheduleHTML(rec, st) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return st.schedule.map((dt, i) => {
      const ds = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
      const matured = dt <= today;
      const cur = i === st.maturedCount;
      return '<div class="kv' + (matured ? ' kv-done' : (cur ? ' kv-cur' : '')) + '">' +
        '<span class="k">第 ' + (i + 1) + ' 期 · ' + ds + (matured ? ' ✓已到期' : (cur ? ' ◀当前' : '')) + '</span>' +
        '<span class="v">' + money(st.perInterest[i]) + (cur ? ' <i class="muted">本期按日息累计</i>' : '') + '</span></div>';
    }).join('');
  }

  function stanceCls(s) { return s === '偏多' ? 'lv-up' : (s === '偏空' ? 'lv-down' : ''); }

  // AI 日报卡片（含新闻/公告列表 + 免责声明）
  function aiCardHTML(dg, updating) {
    let h = '<div class="lev-ai-headrow">' +
      '<div class="sec-title" style="margin:0">AI 日报 <span class="muted">每日 ' + AI_HOUR + ':00 自动更新</span></div>' +
      '<button class="btn ghost sm" id="lev-ai-refresh" title="立即重新生成">' + ui.icon('refresh', 15) + ' 重新生成</button>' +
      '</div>';
    if (!dg) {
      h += updating
        ? '<div class="lev-ai-loading muted"><span class="ai-dot"></span>正在抓取新闻并生成研判…</div>'
        : '<div class="lev-nodata muted">暂无日报，点「重新生成」立即生成（需在「设置 → AI 助手」配置 API Key）。</div>';
      return h;
    }
    const s = dg.stance || '中性';
    const sc = Math.min(5, Math.max(1, dg.score || 3));
    h += '<div class="lev-ai-top">' +
      '<span class="lev-stance ' + stanceCls(s) + '">' + ui.escapeHtml(s) + '</span>' +
      '<span class="lev-stars" title="强度 ' + sc + '/5">' + '★'.repeat(sc) + '☆'.repeat(5 - sc) + '</span>' +
      '<span class="muted lev-ai-date">' + ui.escapeHtml(dg.date || '') + '</span></div>';
    if (dg.summary) h += '<div class="lev-ai-summary">' + ui.escapeHtml(dg.summary) + '</div>';
    if (dg.error) h += '<div class="lev-ai-err">' + ui.escapeHtml(dg.error) + '</div>';
    if (dg.reasons && dg.reasons.length) {
      h += '<div class="lev-ai-sub">研判要点</div><ul class="lev-ai-list">' +
        dg.reasons.map(t => '<li>' + ui.escapeHtml(t) + '</li>').join('') + '</ul>';
    }
    if (dg.watch && dg.watch.length) {
      h += '<div class="lev-ai-sub">今日关注</div><ul class="lev-ai-list">' +
        dg.watch.map(t => '<li>' + ui.escapeHtml(t) + '</li>').join('') + '</ul>';
    }
    if (dg.risk) h += '<div class="lev-ai-risk">风险提示：' + ui.escapeHtml(dg.risk) + '</div>';
    const news = dg.news || [];
    if (news.length) {
      h += '<div class="lev-ai-sub">相关新闻</div><div class="lev-ai-news">' + news.map(n =>
        '<a class="lev-news" href="' + ui.escapeHtml(n.url || '#') + '" target="_blank" rel="noopener">' +
        '<span class="ln-t">' + ui.escapeHtml(n.title) + '</span>' +
        '<span class="ln-m muted">' + ui.escapeHtml((n.media ? n.media + ' · ' : '') + (n.date || '')) + '</span></a>'
      ).join('') + '</div>';
    } else {
      h += '<div class="lev-ai-sub">相关新闻</div><div class="lev-nodata muted">暂未抓到相关新闻</div>';
    }
    const ann = dg.ann || [];
    if (ann.length) {
      h += '<div class="lev-ai-sub">公司公告</div><div class="lev-ai-news">' + ann.map(a =>
        '<a class="lev-news" href="' + ui.escapeHtml(a.url || '#') + '" target="_blank" rel="noopener">' +
        '<span class="ln-t">' + ui.escapeHtml(a.title) + '</span>' +
        '<span class="ln-m muted">' + ui.escapeHtml(a.date || '') + '</span></a>'
      ).join('') + '</div>';
    }
    if (updating) h += '<div class="lev-ai-updating muted"><span class="ai-dot"></span>正在更新今日日报…</div>';
    h += '<div class="lev-ai-disclaimer">以上由 AI 依据公开行情与新闻自动生成，仅供参考，<b>不构成任何投资建议或买卖依据</b>。</div>';
    return h;
  }

  function detailHTML(rec, q, c) {
    const st = c.st;
    let rateDisp;
    if (st.rateSource === 'manual') rateDisp = num(rec.dailyRate).toFixed(4) + '% (手填日利率)';
    else if (st.rateSource === 'implied') rateDisp = st.impliedAnnual.toFixed(2) + '% (平台反推)';
    else if (st.rateSource === 'nominal') rateDisp = num(rec.annualRate).toFixed(2) + '%';
    else rateDisp = '未设置，利息按 0 计';
    const tiDisp = (st.termInterest != null && st.termInterest > 0)
      ? money(st.termInterest) + (st.tiSource === 'period' ? ' <i class="muted">(每期求和)</i>' : (st.tiSource === 'platform' ? ' <i class="muted">(平台报价)</i>' : '')) : money(st.total);
    const mpDisp = rec.monthlyPayment ? money(rec.monthlyPayment) : '—';
    const gapBE = c.curPrice ? (c.breakeven - c.curPrice) / c.curPrice * 100 : 0;
    const gapCA = c.curPrice ? (c.coverAll - c.curPrice) / c.curPrice * 100 : 0;
    const gapAC = c.curPrice ? (c.coverAccrued - c.curPrice) / c.curPrice * 100 : 0;
    const beReached = c.curPrice && c.curPrice >= c.breakeven;
    const caReached = c.curPrice && c.curPrice >= c.coverAll;
    const accReached = c.curPrice && c.curPrice >= c.coverAccrued;
    // 状态徽章与可用操作
    const stateBadge = c.closed ? '<span class="badge lv-st-done">已完结</span>'
      : (c.leftQty <= 0 ? '<span class="badge lv-st-sold">已清仓 · 待还款</span>'
      : (c.reps.length ? '<span class="badge lv-st-part">部分还款</span>' : '<span class="badge lv-st-hold">持有中</span>'));
    const showAdd = c.leftQty > 0 && !c.closed;
    const showSell = c.leftQty > 0 && !c.closed;
    const showRepay = c.P > 0.01 && !c.cleared;
    const showClose = c.cleared && !c.closed;
    return '' +
      '<div class="page">' +
      '<div class="page-head">' +
        '<button class="icon-btn" id="lev-back" title="返回">' + ui.icon('chevronLeft', 20) + '</button>' +
        '<div class="page-head-main"><h1>' + ui.escapeHtml(q ? (q.name || rec.stockCode) : ('自选 ' + rec.stockCode)) + '</h1>' +
        '<div class="page-head-sub">' + ui.escapeHtml(rec.stockCode) + (rec.loanName ? ' · ' + ui.escapeHtml(rec.loanName) : '') + ' ' + stateBadge + '</div></div>' +
        '<div class="page-head-actions">' +
          (showAdd ? '<button class="btn ghost sm lev-addbtn">+ 加仓</button>' : '') +
          (showSell ? '<button class="btn primary sm lev-sellbtn">卖出</button>' : '') +
          (showRepay ? '<button class="btn ghost sm lev-repaybtn">还款</button>' : '') +
          (showClose ? '<button class="btn primary sm lev-closebtn">确认完结</button>' : '') +
          (c.closed ? '<button class="btn ghost sm lev-reopenbtn">撤销完结</button>' : '') +
          '<button class="btn ghost sm" id="lev-refresh">' + ui.icon('refresh', 15) + ' 刷新</button>' +
          '<button class="btn ghost sm" id="lev-edit">' + ui.icon('pencil', 15) + ' 编辑</button>' +
        '</div>' +
      '</div>' +

      '<div class="card section lev-quote">' +
        (q ? (
          '<div class="lq-top"><div class="lq-price ' + cls(q.chg) + '">' + q.price.toFixed(2) + '</div>' +
          '<div class="lq-chg ' + cls(q.chg) + '">' + (q.chg >= 0 ? '+' : '') + q.chg.toFixed(2) + '　' + pct(q.chgPct) + '</div></div>' +
          '<div class="lq-grid">' +
            '<span>今开 <b>' + q.open.toFixed(2) + '</b></span>' +
            '<span>最高 <b class="lv-up">' + q.high.toFixed(2) + '</b></span>' +
            '<span>昨收 <b>' + q.preClose.toFixed(2) + '</b></span>' +
            '<span>最低 <b class="lv-down">' + q.low.toFixed(2) + '</b></span>' +
          '</div>'
        ) : '<div class="lev-nodata muted">实时行情未获取（非交易时段或接口限流），下方价格仍按算法计算。</div>') +
      '</div>' +

      '<div class="lev-keygrid">' +
        '<div class="card section lev-key' + (accReached ? ' lv-ok' : '') + '">' +
          '<div class="lk-label">覆盖累计日利息价 <span class="muted">' + (c.leftQty > 0 ? '剩余 ' + c.leftQty + ' 股' : '已清仓') + '</span></div>' +
          '<div class="lk-price">' + (c.leftQty > 0 ? c.coverAccrued.toFixed(2) : '—') + '</div>' +
          '<div class="lk-gap ' + (accReached ? 'lv-up' : 'lv-down') + '">' +
            (c.leftQty <= 0 ? '已清仓，无剩余持仓' : (c.curPrice ? (accReached ? '现价已达标 ↑' : '距现价还需 ' + pct(gapAC)) : '填现价后显示')) + '</div>' +
        '</div>' +
        '<div class="card section lev-key' + (beReached ? ' lv-ok' : '') + '">' +
          '<div class="lk-label">保本卖出价 <span class="muted">' + (c.leftQty > 0 ? '剩 ' + c.leftQty + ' 股 · 已抵扣卖出所得' : '已清仓') + '</span></div>' +
          '<div class="lk-price">' + (c.leftQty > 0 ? c.breakeven.toFixed(2) : '—') + '</div>' +
          '<div class="lk-gap ' + (beReached ? 'lv-up' : 'lv-down') + '">' +
            (c.leftQty <= 0 ? '已清仓，无剩余持仓' : (c.curPrice ? (beReached ? '现价已达标 ↑' : '距现价还需 ' + pct(gapBE)) : '填现价后显示')) + '</div>' +
        '</div>' +
        '<div class="card section lev-key' + (caReached ? ' lv-ok' : '') + '">' +
          '<div class="lk-label">覆盖总利息价 <span class="muted">' + (c.leftQty > 0 ? '吃满整期全部利息' : '已清仓') + '</span></div>' +
          '<div class="lk-price">' + (c.leftQty > 0 ? c.coverAll.toFixed(2) : '—') + '</div>' +
          '<div class="lk-gap ' + (caReached ? 'lv-up' : 'lv-down') + '">' +
            (c.leftQty <= 0 ? '已清仓，无剩余持仓' : (c.curPrice ? (caReached ? '现价已达标 ↑' : '距现价还需 ' + pct(gapCA)) : '填现价后显示')) + '</div>' +
        '</div>' +
      '</div>' +

      '<div class="card section lev-chart">' +
        '<div class="lc-head">' +
          '<div class="chips">' +
            '<button class="chip active" data-chart="trend">分时</button>' +
            '<button class="chip" data-chart="kline">日K</button>' +
          '</div>' +
          '<span class="muted" style="font-size:12px">虚线＝保本价参考线</span>' +
        '</div>' +
        '<div id="lev-chartbox" class="lc-body"><div class="sk-line w70" style="height:180px"></div></div>' +
      '</div>' +

      '<div class="card section" id="lev-aicard"></div>' +

      '<div class="card section">' +
        '<div class="sec-title">成本拆解（持仓 ' + c.Q + ' 股 · 均价 ' + (c.Q ? (c.buy / c.Q).toFixed(3) : '—') + (c.adds.length ? ' · 加仓 ' + c.adds.length + ' 次' : '') + '）</div>' +
        '<div class="kv-list">' +
          '<div class="kv"><span class="k">买入总额(各批买入价均已含费)</span><span class="v">' + money(c.buy) + '</span></div>' +
          '<div class="kv"><span class="k">└ 贷款本金合计</span><span class="v">' + money0(c.P) + '</span></div>' +
          '<div class="kv"><span class="k">└ 自有本金合计</span><span class="v">' + money0(c.own) + '</span></div>' +
          '<div class="kv"><span class="k">贷款已计息合计 <i class="muted">已到期 ' + c.st.maturedCount + (c.ast ? c.ast.reduce((s, x) => s + (x ? x.maturedCount : 0), 0) : 0) + '/' + (c.st.n + (c.ast ? c.ast.reduce((s, x) => s + (x ? x.n : 0), 0) : 0)) + ' 期 · 含原贷款与加仓</i></span><span class="v">' + money(c.accrued) + '</span></div>' +
          '<div class="kv"><span class="k">└ 已到期固定利息</span><span class="v">' + money(c.st.accruedMatured + (c.ast ? c.ast.reduce((s, x) => s + (x ? x.accruedMatured : 0), 0) : 0)) + '</span></div>' +
          '<div class="kv"><span class="k">└ 本期日息累计</span><span class="v">' + money(c.st.accruedDaily + (c.ast ? c.ast.reduce((s, x) => s + (x ? x.accruedDaily : 0), 0) : 0)) + ' <i class="muted">(提前还款口径)</i></span></div>' +
          '<div class="kv"><span class="k">提前还款违约金</span><span class="v">' + money(c.prepayFee) + '</span></div>' +
          '<div class="kv total"><span class="k">保本总成本(含利息)</span><span class="v">' + money(c.costNow) + '</span></div>' +
          (c.curPrice ? '<div class="kv"><span class="k">当前市值</span><span class="v">' + money(c.market) + '</span></div>' +
            '<div class="kv"><span class="k">卖出到手（扣费）</span><span class="v">' + money(c.netIfSell) + '</span></div>' +
            '<div class="kv total"><span class="k">卖出盈亏</span><span class="v ' + cls(c.pnl) + '">' + money(c.pnl) + '</span></div>' : '') +
        '</div>' +
      '</div>' +

      '<div class="card section">' +
        '<div class="sec-title">买入批次（' + (c.adds.length ? '首笔 + 加仓 ' + c.adds.length + ' 次' : '仅首笔，可加仓') + '）' +
          '<button class="btn primary sm lev-addbtn" style="float:right;margin-top:-2px">+ 加仓</button></div>' +
        '<div class="kv-list">' +
          '<div class="kv"><span class="k">' + ui.escapeHtml(rec.buyDate || rec.startDate || '首笔') + ' · 首笔 ' + num(rec.quantity) + ' 股 × ' + num(rec.buyPrice).toFixed(2) + '</span><span class="v">' + money(num(rec.buyPrice) * num(rec.quantity)) + '</span></div>' +
          c.adds.map((a, i) => {
            const sub = num(a.price) * num(a.qty);
            const loan = num(a.principal);
            const x = c.ast && c.ast[i];
            return '<div class="kv"><span class="k">' + ui.escapeHtml(a.date || '') + ' · 加仓 ' + num(a.qty) + ' 股 × ' + num(a.price).toFixed(2) +
              (loan > 0 ? ' <i class="muted">· 贷 ' + money0(loan) + '</i>' : ' <i class="muted">· 存款</i>') + '</span>' +
              '<span class="v">' + money(sub) + (x ? ' <i class="muted">· 已计息 ' + money(x.accrued) + '</i>' : '') +
              ' <button class="icon-btn lev-adddel" data-idx="' + i + '" title="删除本批加仓">' + ui.icon('trash', 14) + '</button></span></div>';
          }).join('') +
          '<div class="kv total"><span class="k">合并持仓</span><span class="v">' + c.Q + ' 股 · 均价 ' + (c.Q ? (c.buy / c.Q).toFixed(3) : '—') + ' · 总投入 ' + money(c.buy) + '</span></div>' +
        '</div>' +
      '</div>' +

      (() => {
        const segs = [];
        if (rec.method !== 'daily') {
          segs.push('<div class="sec-title">首笔贷款还款计划（每期利息' + (st.perFilled ? '·手填' : '·按总利息平均') + ' · 每月 ' + num(rec.repayDay, 25) + ' 号还款）</div>' +
            '<div class="kv-list">' + scheduleHTML(rec, st) + '</div>');
        }
        (c.adds || []).forEach((a, i) => {
          const x = c.ast && c.ast[i];
          if (!x || x.method === 'daily' || !x.P) return;
          const ar = addLoanRec(a, rec);
          segs.push('<div class="sec-title" style="margin-top:12px">加仓 ' + ui.escapeHtml(a.date || '') + ' · 贷款 ' + money0(x.P) + ' 还款计划（每月 ' + num(ar.repayDay, 25) + ' 号还款）</div>' +
            '<div class="kv-list">' + scheduleHTML(ar, x) + '</div>');
        });
        return segs.length ? '<div class="card section">' + segs.join('') + '</div>' : '';
      })() +

      '<div class="card section">' +
        '<div class="sec-title">贷款信息' + (c.adds.length ? '（合计，含加仓）' : '') + '</div>' +
        '<div class="kv-list">' +
          '<div class="kv"><span class="k">贷款本金合计 / 自有本金合计</span><span class="v">' + money0(c.P) + ' / ' + money0(c.own) + '</span></div>' +
          '<div class="kv"><span class="k">有效利率' + (c.adds.length ? '（首笔）' : '') + '</span><span class="v">' + rateDisp + '</span></div>' +
          '<div class="kv"><span class="k">还款方式' + (c.adds.length ? '（首笔）' : '') + '</span><span class="v">' + METHOD[rec.method || 'daily'] + '</span></div>' +
          '<div class="kv"><span class="k">期限 / 起息日' + (c.adds.length ? '（首笔）' : '') + '</span><span class="v">' + st.n + ' 个月 · ' + ui.escapeHtml(rec.startDate || '') + '</span></div>' +
          '<div class="kv"><span class="k">每日新增利息合计</span><span class="v lv-warn">' + money(c.daily) + ' / 天</span></div>' +
          '<div class="kv"><span class="k">已产生利息合计</span><span class="v">' + money(c.accrued) + '</span></div>' +
          '<div class="kv"><span class="k">剩余本金合计</span><span class="v">' + money0(c.remaining) + '</span></div>' +
          '<div class="kv"><span class="k">整期总利息合计</span><span class="v">' + money(c.totalForCover) + (c.adds.length ? ' <i class="muted">(各批相加)</i>' : '') + '</span></div>' +
          '<div class="kv"><span class="k">每期应还' + (c.adds.length ? '（首笔）' : '') + '</span><span class="v">' + mpDisp + '</span></div>' +
          '<div class="kv"><span class="k">保本价每日上浮</span><span class="v lv-warn">+' + c.drift.toFixed(4) + ' / 天</span></div>' +
        '</div>' +
        '<div class="hint muted">多持有一天，保本卖出价就上浮约 ' + c.drift.toFixed(3) + ' 元 —— 这就是杠杆的时间成本。原贷款利息持续累计，加仓贷款各自独立计息后合并。</div>' +
      '</div>' +

      (c.sells.length ? (
      '<div class="card section">' +
        '<div class="sec-title">卖出记录（' + c.sells.length + ' 笔 · 共 ' + c.soldQty + ' 股）</div>' +
        '<div class="kv-list">' +
          c.sells.map(s => '<div class="kv"><span class="k">' + ui.escapeHtml(s.date || '') + ' · ' + num(s.qty) + ' 股 × ' + num(s.price).toFixed(2) +
            ' <i class="muted">费 ' + money(num(s.feeTotal)) + '</i></span>' +
            '<span class="v">到手 ' + money(num(s.net)) + ' <b class="' + cls(num(s.pnl)) + '">' + (num(s.pnl) >= 0 ? '+' : '') + money(num(s.pnl)) + '</b>' +
            ' <button class="icon-btn lev-selldel" data-id="' + ui.escapeAttr(s.id) + '" title="删除本笔卖出">' + ui.icon('trash', 14) + '</button></span></div>').join('') +
          '<div class="kv total"><span class="k">卖出净收入合计</span><span class="v">' + money(c.sellNet) + '</span></div>' +
          '<div class="kv"><span class="k">卖出费用合计</span><span class="v">' + money(c.sellFeeTotal) + '</span></div>' +
          '<div class="kv total"><span class="k">已实现盈亏</span><span class="v ' + cls(c.sellPnlTotal) + '">' + (c.sellPnlTotal >= 0 ? '+' : '') + money(c.sellPnlTotal) + '</span></div>' +
          '<div class="kv"><span class="k">剩余持仓 / 分摊买入成本</span><span class="v">' + c.leftQty + ' 股 / ' + money(c.leftCost) + '</span></div>' +
        '</div>' +
        '<div class="hint muted">已实现盈亏口径 = 卖出净收入 − 该笔分摊买入成本 − 该笔分摊已计利息（按下单时快照固化，不随行情变化）。</div>' +
      '</div>') : '') +

      (c.reps.length || c.P > 0.01 ? (
      '<div class="card section">' +
        '<div class="sec-title">还款记录（已还 ' + money(c.repayTotal) + '）' + (c.closed ? ' · 已结清' : '') + '</div>' +
        '<div class="kv-list">' +
          c.reps.map(rp => '<div class="kv"><span class="k">' + ui.escapeHtml(rp.date || '') + (rp.note ? ' <i class="muted">' + ui.escapeHtml(rp.note) + '</i>' : '') + '</span>' +
            '<span class="v">' + money(num(rp.amount)) + ' <button class="icon-btn lev-repaydel" data-id="' + ui.escapeAttr(rp.id) + '" title="删除本笔还款">' + ui.icon('trash', 14) + '</button></span></div>').join('') +
          (c.reps.length ? '' : '<div class="muted" style="font-size:13px">暂无还款记录</div>') +
          '<div class="kv"><span class="k">其中：已冲利息 / 已冲本金</span><span class="v">' + money(c.paidInterest) + ' / ' + money(c.paidPrincipal) + '</span></div>' +
          '<div class="kv"><span class="k">剩余应付本金</span><span class="v lv-warn">' + money(c.remainPrincipal) + '</span></div>' +
          '<div class="kv"><span class="k">剩余待付利息</span><span class="v lv-warn">' + money(c.remainInterest) + '</span></div>' +
          '<div class="kv total"><span class="k">一次性结清需付' + (c.closed ? '（已结清）' : '') + '</span><span class="v">' + (c.closed ? money(0) : money(c.settleNeed)) + (c.settleFee > 0 && !c.closed ? ' <i class="muted">含违约金 ' + money(c.settleFee) + '</i>' : '') + '</span></div>' +
        '</div>' +
        (c.cleared && !c.closed ? '<div class="hint lv-warn">本息已还清，点上方「确认完结」结束这笔测算。</div>' : '') +
      '</div>') : '') +

      (c.closed ? (() => {
        const holdDays = Math.max(1, c.D);
        const netProfit = c.sellNet - c.buy - c.accrued - c.prepayFee; // 已落袋 − 总买入 − 全部利息 − 违约金
        const roi = c.own > 0 ? netProfit / c.own * 100 : 0;           // 相对自有资金投入的收益率
        const ann = roi * (365 / holdDays);
        return '<div class="card section lev-final">' +
          '<div class="sec-title">🎉 已完结 · 最终结算面板</div>' +
          '<div class="lev-final-grid">' +
            '<div class="lf-item"><div class="lf-k">净利润</div><div class="lf-v ' + cls(netProfit) + '">' + (netProfit >= 0 ? '+' : '') + money(netProfit) + '</div></div>' +
            '<div class="lf-item"><div class="lf-k">收益率（对自有本金）</div><div class="lf-v ' + cls(roi) + '">' + (roi >= 0 ? '+' : '') + roi.toFixed(2) + '%</div></div>' +
            '<div class="lf-item"><div class="lf-k">折年化</div><div class="lf-v ' + cls(ann) + '">' + (ann >= 0 ? '+' : '') + ann.toFixed(1) + '%</div></div>' +
            '<div class="lf-item"><div class="lf-k">持有天数</div><div class="lf-v">' + holdDays + ' 天</div></div>' +
          '</div>' +
          '<div class="kv-list" style="margin-top:10px">' +
            '<div class="kv"><span class="k">总投入（买入总额）</span><span class="v">' + money(c.buy) + '</span></div>' +
            '<div class="kv"><span class="k">└ 自有本金 / 贷款本金</span><span class="v">' + money0(c.own) + ' / ' + money0(c.P) + '</span></div>' +
            '<div class="kv"><span class="k">卖出净收入合计</span><span class="v">' + money(c.sellNet) + '</span></div>' +
            '<div class="kv"><span class="k">└ 卖出费用合计</span><span class="v">' + money(c.sellFeeTotal) + '</span></div>' +
            '<div class="kv"><span class="k">贷款利息合计</span><span class="v">' + money(c.accrued) + '</span></div>' +
            '<div class="kv"><span class="k">提前还款违约金</span><span class="v">' + money(c.prepayFee) + '</span></div>' +
            '<div class="kv"><span class="k">剩余持仓</span><span class="v">' + c.leftQty + ' 股' + (c.leftQty > 0 && c.curPrice ? '（现值 ' + money(c.market) + '，未计入上方净利润）' : '') + '</span></div>' +
            '<div class="kv total"><span class="k">净利润（已落袋）</span><span class="v ' + cls(netProfit) + '">' + (netProfit >= 0 ? '+' : '') + money(netProfit) + '</span></div>' +
          '</div>' +
          '<div class="hint muted">结算口径：卖出净收入 − 买入总额 − 全部贷款利息 − 违约金。若仍有剩余持仓未卖出，其市值未计入净利润，可继续卖出或手动撤销完结后记录。</div>' +
        '</div>';
      })() : '') +

      '<div class="lev-disclaimer">本模块仅做成本与盈亏平衡测算，不构成任何投资建议。信贷资金按规定不得用于证券投资，请自行评估合规风险。</div>' +
      '</div>';
  }

  async function openDetail(root, rec) {
    clearTimer();
    root.innerHTML = '<div class="page">' + ui.skeleton(3) + '</div>';
    let q = null, chartType = 'trend';
    let lastDg = null, aiReady = false, aiBusy = false;
    try { q = await fetchQuote(rec.stockCode); } catch (e) { q = null; }

    function paintAI(dg, updating) {
      const box = root.querySelector('#lev-aicard');
      if (!box) return;
      box.innerHTML = aiCardHTML(dg, updating);
      const btn = box.querySelector('#lev-ai-refresh');
      if (btn) btn.onclick = () => { ensureDigest(true); };
    }
    // 到下一个 07:00 触发刷新（页面开着才走定时器；没开着则下次打开时补生成）
    function scheduleAI() {
      if (_aiTimer) clearTimeout(_aiTimer);
      _aiTimer = setTimeout(() => { ensureDigest(true); }, msToNextAI());
    }
    async function ensureDigest(force) {
      if (aiBusy) return;
      let dg = null;
      try { dg = await store.get('levai', rec.stockCode); } catch (e) { dg = null; }
      if (!force && dg && dg.date === digestKey()) { lastDg = dg; aiReady = true; paintAI(dg, false); scheduleAI(); return; }
      aiBusy = true;
      paintAI(dg, true);
      try {
        const ks = await withTimeout(fetchKline(rec.stockCode, 6), 9000);
        const nd = await buildDigest(rec, q, ks);
        await store.put('levai', nd);
        lastDg = nd; paintAI(nd, false);
      } catch (e) {
        paintAI(dg, false);
        ui.toast('AI 日报生成失败：' + ((e && e.message) || e), 'warn');
      }
      aiBusy = false; aiReady = true;
      scheduleAI();
    }

    function paint() {
      const c = calc(rec, q ? q.price : null);
      root.innerHTML = detailHTML(rec, q, c);
      paintAI(lastDg, !aiReady);
      root.querySelector('#lev-back').onclick = () => { clearTimer(); render(root); };
      root.querySelector('#lev-edit').onclick = () => openForm(rec, () => openDetail(root, rec));
      const addBtns = root.querySelectorAll('.lev-addbtn');
      addBtns.forEach(b => { b.onclick = () => openAddForm(rec, () => { ui.toast('已加仓，持仓与利息已合并重算'); openDetail(root, rec); }); });
      const sellBtn = root.querySelector('.lev-sellbtn');
      if (sellBtn) sellBtn.onclick = () => openSellForm(rec, () => { ui.toast('已记录卖出'); openDetail(root, rec); });
      const repayBtn = root.querySelector('.lev-repaybtn');
      if (repayBtn) repayBtn.onclick = () => openRepayForm(rec, () => { ui.toast('已记录还款'); openDetail(root, rec); });
      const closeBtn = root.querySelector('.lev-closebtn');
      if (closeBtn) closeBtn.onclick = async () => {
        if (await ui.confirm({ title: '确认完结', message: '确认将这笔测算标记为「已完结」？完结后停止计息并生成最终结算面板。', confirmLabel: '确认完结' })) {
          rec.closed = true; rec.closedAt = todayISO(); rec.updatedAt = Date.now();
          await store.put('leverage', rec);
          ui.toast('已完结，生成结算面板');
          openDetail(root, rec);
        }
      };
      const reopenBtn = root.querySelector('.lev-reopenbtn');
      if (reopenBtn) reopenBtn.onclick = async () => {
        if (await ui.confirm({ title: '撤销完结', message: '撤销后将恢复计息（从原起息日累计到今天），确定吗？', confirmLabel: '撤销完结', danger: true })) {
          rec.closed = false; delete rec.closedAt; rec.updatedAt = Date.now();
          await store.put('leverage', rec);
          openDetail(root, rec);
        }
      };
      root.querySelectorAll('.lev-selldel').forEach(b => {
        b.onclick = async () => {
          if (await ui.confirm({ title: '删除卖出记录', message: '删除这笔卖出记录后，持仓与已实现盈亏会重新计算，确定吗？', confirmLabel: '删除', danger: true })) {
            rec.sells = (rec.sells || []).filter(x => x.id !== b.dataset.id);
            rec.updatedAt = Date.now();
            await store.put('leverage', rec);
            openDetail(root, rec);
          }
        };
      });
      root.querySelectorAll('.lev-repaydel').forEach(b => {
        b.onclick = async () => {
          if (await ui.confirm({ title: '删除还款记录', message: '删除后剩余应付会重新计算，确定吗？', confirmLabel: '删除', danger: true })) {
            rec.repayments = (rec.repayments || []).filter(x => x.id !== b.dataset.id);
            rec.updatedAt = Date.now();
            await store.put('leverage', rec);
            openDetail(root, rec);
          }
        };
      });
      root.querySelectorAll('.lev-adddel').forEach(b => {
        b.onclick = async () => {
          const idx = parseInt(b.dataset.idx, 10);
          if (!isFinite(idx) || !rec.adds || !rec.adds[idx]) return;
          if (await ui.confirm({ title: '删除加仓批次', message: '删除这批加仓后，持仓与利息将按剩余批次重新合并计算。确定删除吗？', confirmLabel: '删除', danger: true })) {
            rec.adds.splice(idx, 1);
            rec.updatedAt = Date.now();
            await store.put('leverage', rec);
            ui.toast('已删除该批加仓');
            openDetail(root, rec);
          }
        };
      });
      root.querySelector('#lev-refresh').onclick = async () => {
        try { q = await fetchQuote(rec.stockCode); ui.toast('行情已刷新'); }
        catch (e) { ui.toast('行情获取失败：' + e.message, 'warn'); }
        paint();
      };
      root.querySelectorAll('[data-chart]').forEach(b => {
        b.onclick = () => {
          chartType = b.dataset.chart;
          root.querySelectorAll('[data-chart]').forEach(x => x.classList.toggle('active', x === b));
          drawChart();
        };
      });
      drawChart();
    }

    async function drawChart() {
      const box = root.querySelector('#lev-chartbox');
      if (!box) return;
      const c = calc(rec, q ? q.price : null);
      const refs = [
        { price: c.coverAccrued, label: '累计息', color: 'var(--success)' },
        { price: c.breakeven, label: '保本', color: 'var(--warn)' },
        { price: c.coverAll, label: '覆息', color: 'var(--danger)' },
        { price: c.Q ? c.buy / c.Q : num(rec.buyPrice), label: '均价', color: 'var(--muted)' }
      ];
      try {
        if (chartType === 'trend') {
          const t = await fetchTrend(rec.stockCode);
          if (!t.trends.length) { box.innerHTML = '<div class="lev-nodata muted">暂无分时数据（非交易时段）</div>'; return; }
          const rows = t.trends.map(s => { const p = s.split(','); return { time: p[0].slice(11, 16), price: +p[2], avg: +p[7] }; });
          box.innerHTML = trendChart(rows, t.preClose || (q ? q.preClose : 0), refs);
        } else {
          const ks = await fetchKline(rec.stockCode, 90);
          if (!ks.length) { box.innerHTML = '<div class="lev-nodata muted">暂无K线数据</div>'; return; }
          box.innerHTML = klineChart(ks, refs);
        }
      } catch (e) {
        box.innerHTML = '<div class="lev-nodata muted">图表加载失败：' + ui.escapeHtml(e.message) + '</div>';
      }
    }

    paint();
    ensureDigest(false);
    // 交易时段每 30 秒自动刷新行情
    _timer = setInterval(async () => {
      try { const nq = await fetchQuote(rec.stockCode); if (nq && nq.price) { q = nq; paint(); } } catch (e) { /* 忽略 */ }
    }, 30000);
  }

  /* ---------------- 列表视图 ---------------- */
  async function render(root) {
    clearTimer();
    let recs = (await store.getAll('leverage')).filter(r => !r._deleted);
    recs = recs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    root.innerHTML = '<div class="page">' +
      ui.pageHead('trendingUp', '杠杆测算', { subtitle: '贷款成本 + 持仓盈亏平衡', actions: '<button class="btn primary" id="add">+ 新建</button>' }) +
      '<div id="list" class="list"></div>' +
      '<div class="lev-disclaimer">仅做成本与盈亏平衡测算，不构成投资建议。信贷资金按规定不得用于证券投资。</div>' +
      '</div>';

    const list = root.querySelector('#list');

    // v49 之前保存的记录没有 stockName，这里一次性回填；每个代码只尝试一次，避免死循环与重复请求
    const triedNames = new Set();
    async function backfillNames() {
      const missing = recs.filter(r => !r.stockName && r.stockCode && !triedNames.has(r.stockCode));
      if (!missing.length) return;
      missing.forEach(r => triedNames.add(r.stockCode));
      for (const r of missing) {
        try {
          const nm = await withTimeout(fetchQuote(r.stockCode).then(q => (q && q.name) ? q.name : null), 3500);
          if (nm) { r.stockName = nm; await store.put('leverage', r); }
        } catch (e) { /* 忽略，列表回退显示代码 */ }
      }
      paint();
    }

    function paint() {
      if (!recs.length) {
        list.innerHTML = ui.emptyState('还没有测算，点新建录入一笔贷款 + 一只股票', { action: { label: '新建测算' } });
        const ea = list.querySelector('#empty-add'); if (ea) ea.onclick = () => openForm(null, reload);
        return;
      }
      list.innerHTML = recs.map(r => {
        const c = calc(r, null);
        const rateTxt = c.st.rateSource === 'manual' ? num(r.dailyRate).toFixed(4) + '%/日'
          : (c.st.rateSource === 'implied' ? c.st.impliedAnnual.toFixed(2) + '%'
          : (num(r.annualRate) ? num(r.annualRate).toFixed(2) + '%' : '按总利息'));
        return '<div class="card lev' + (r.closed ? ' lev-closed' : '') + '" data-id="' + r.id + '">' +
          '<div class="lev-main">' +
            '<div class="lev-title">' + ui.escapeHtml(r.loanName || '贷款') +
              ' <span class="muted">→ ' + ui.escapeHtml(r.stockName ? (r.stockName + ' ' + r.stockCode) : r.stockCode) + '</span>' +
              (r.closed ? ' <span class="badge lv-st-done">已完结</span>' : (c.leftQty <= 0 ? ' <span class="badge lv-st-sold">已清仓</span>' : (c.reps && c.reps.length ? ' <span class="badge lv-st-part">部分还款</span>' : ''))) + '</div>' +
            '<div class="lev-nums">' +
              '<span>贷 <b>' + money0(c.P) + '</b></span>' +
              '<span>自有 <b>' + money0(c.own) + '</b></span>' +
              '<span>均价 <b>' + (c.Q ? (c.buy / c.Q).toFixed(2) : '—') + '</b></span>' +
              '<span>保本 <b class="lv-warn">' + (c.leftQty > 0 ? c.breakeven.toFixed(2) : '—') + '</b></span>' +
              (c.sells.length ? '<span>已实现 <b class="' + cls(c.sellPnlTotal) + '">' + (c.sellPnlTotal >= 0 ? '+' : '') + money0(c.sellPnlTotal) + '</b></span>'
                : '<span>覆息 <b class="lv-danger">' + (c.leftQty > 0 ? c.coverAll.toFixed(2) : '—') + '</b></span>') +
            '</div>' +
            '<div class="lev-sub muted">' + METHOD[r.method || 'daily'] + ' · ' + rateTxt +
              (c.st.rateSource === 'implied' ? ' (反推)' : '') +
              (c.adds && c.adds.length ? ' · 加仓 ' + c.adds.length + ' 次' : '') +
              (c.sells.length ? ' · 已卖 ' + c.soldQty + '/' + c.Q + ' 股' : '') +
              (c.reps.length ? ' · 已还 ' + money0(c.repayTotal) : '') +
              (c.closed ? ' · 已结清' : ' · 第 ' + c.D + ' 天 · 日息 ' + money(c.daily)) + '</div>' +
          '</div>' +
          '<div class="row-actions">' +
            '<button class="btn ghost sm lev-listadd" title="给这只股票加仓">＋加仓</button>' +
            '<button class="icon-btn del" title="删除">' + ui.icon('trash', 16) + '</button>' +
          '</div>' +
        '</div>';
      }).join('');
      backfillNames();
    }

    async function reload() { recs = (await store.getAll('leverage')).filter(r => !r._deleted).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); paint(); }

    paint();
    root.querySelector('#add').onclick = () => openForm(null, reload);
    list.addEventListener('click', async e => {
      const card = e.target.closest('.card'); if (!card) return;
      const id = card.dataset.id;
      if (e.target.closest('.icon-btn.del')) {
        if (await ui.confirm({ title: '删除测算', message: '确定删除这条测算记录吗？删除后可在提示中撤销。', confirmLabel: '删除', danger: true })) {
          ui.trash('leverage', id, { label: '已删除测算', repaint: reload });
        }
        return;
      }
      if (e.target.closest('.lev-listadd')) {
        const r = recs.find(x => x.id === id);
        if (r) openAddForm(r, () => { ui.toast('已加仓，持仓与利息已合并重算'); reload(); });
        return;
      }
      const rec = recs.find(r => r.id === id);
      if (rec) openDetail(root, rec);
    });
  }

  // 暴露纯计算函数，便于校验与跨模块复用
  WB.leverage = { METHOD, METHOD_HINT, DEF, loanState, solvePrice, calc, rates, buyFees, sellFees, daysBetween, marketOf,
    addLoanRec, addState, CHK, warnList, warnBoxHTML, AI_HOUR, digestKey, msToNextAI, fetchNews, fetchAnn, buildDigest, aiCardHTML };

  WB.modules.push({ id: 'leverage', title: '杠杆测算', icon: 'trendingUp', render });
})(window.WB = window.WB || {});
