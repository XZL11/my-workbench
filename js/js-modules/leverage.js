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

  // 生效利率：有「期限总利息」就用它反推，否则退回名义年利率
  function effectiveRates(rec, P, n) {
    const basis = num(rec.dayBasis, 360);
    const method = rec.method || 'daily';
    const ti = (rec.termInterest != null && rec.termInterest !== '') ? num(rec.termInterest) : null;
    let rM = null, src = 'none';
    if (ti != null && ti > 0) {
      const imp = impliedMonthlyRate(P, n, ti, method);
      if (imp != null) { rM = imp; src = 'implied'; }
    }
    if (rM == null && rec.annualRate != null && rec.annualRate !== '') {
      rM = num(rec.annualRate) / 100 / 12;
      src = 'nominal';
    }
    if (rM == null) rM = 0;
    return { rM, rD: rM * 12 / basis, src, termInterest: ti, impliedAnnual: rM * 12 * 100 };
  }

  // 输入记录 + 已计息天数 D，输出各类利息/剩余本金
  function loanState(rec, D) {
    const P = num(rec.principal);
    const n = Math.max(1, num(rec.termMonths, 3));
    const method = rec.method || 'daily';
    const eff = effectiveRates(rec, P, n);
    const rM = eff.rM, rD = eff.rD;
    const o = {
      P, n, rD, rM, method, D, daily: P * rD, accrued: 0, remaining: P,
      total: 0, periods: 0, extra: 0,
      rateSource: eff.src, termInterest: eff.termInterest, impliedAnnual: eff.impliedAnnual
    };

    if (method === 'daily') {
      o.accrued = P * rD * D;
      o.remaining = P;
      o.total = P * rD * (n * 30);
      return o;
    }
    const k = Math.min(n, Math.floor(D / 30));  // 已完整经过的还款期数
    const dIn = Math.max(0, D - k * 30);        // 当期已过天数（提前还款按日补齐）
    o.periods = k;

    if (method === 'equalInstallment') {
      const M = rM === 0 ? P / n : P * rM * Math.pow(1 + rM, n) / (Math.pow(1 + rM, n) - 1);
      const g = Math.pow(1 + rM, k);
      const rem = rM === 0 ? P - (P / n) * k : P * g - M * (g - 1) / rM;
      o.remaining = Math.max(0, rem);
      o.accrued = Math.max(0, k * M - (P - o.remaining));
      o.total = n * M - P;
      o.extra = o.remaining * rD * dIn;
    } else if (method === 'equalPrincipal') {
      const perP = P / n;
      o.remaining = Math.max(0, P - perP * k);
      o.accrued = rM * (k * P - perP * (k * (k - 1) / 2));
      o.total = P * rM * (n + 1) / 2;
      o.extra = o.remaining * rD * dIn;
    } else { // interestFirst 先息后本
      o.remaining = P;
      o.accrued = k * P * rM;
      o.total = n * P * rM;
      o.extra = P * rD * dIn;
    }
    o.accrued += o.extra;
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

  // 解「卖出净得 = 成本」的卖出价（含最低佣金的非线性修正）
  function solvePrice(rec, cost) {
    const f = rates(rec);
    const Q = Math.max(1, num(rec.quantity, 1));
    const kSell = f.comm + f.stamp + f.transfer;
    let S = cost / (Q * (1 - kSell));
    for (let i = 0; i < 3; i++) {
      if (S * Q * f.comm < f.minComm) S = (cost + f.minComm) / (Q * (1 - f.stamp - f.transfer));
      else break;
    }
    return S;
  }

  function calc(rec, curPrice) {
    const Q = num(rec.quantity, 0);
    const buy = num(rec.buyPrice) * Q;
    const cBuy = buyFees(rec, buy);
    const D = daysBetween(rec.startDate);
    const st = loanState(rec, D);
    const prepayFee = st.remaining * rates(rec).prepay;

    // 覆盖总利息：优先用平台报价的「期限总利息」，没填才退回公式推算的整期利息
    const totalForCover = (st.termInterest != null && st.termInterest > 0) ? st.termInterest : st.total;
    const costNow = buy + cBuy + st.accrued + prepayFee;   // 立刻还清：含截至今日利息 + 提前还款违约金
    const costTotal = buy + cBuy + totalForCover;          // 持有到期：吃满整期全部利息
    const breakeven = solvePrice(rec, costNow);
    const coverAll = solvePrice(rec, costTotal);

    const market = curPrice ? curPrice * Q : 0;
    const netIfSell = curPrice ? market - sellFees(rec, market) : 0;
    const pnl = curPrice ? netIfSell - costNow : 0;
    // 每多持有一天，保本价上浮多少
    const drift = st.daily / Math.max(1, Q) / (1 - (rates(rec).comm + rates(rec).stamp + rates(rec).transfer));

    return { Q, buy, cBuy, D, st, prepayFee, totalForCover, costNow, costTotal, breakeven, coverAll, market, netIfSell, pnl, drift, curPrice };
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
        { name: 'loanName', label: '平台 / 名称', value: d('loanName', ''), placeholder: '如：支付宝借呗 / 微信微粒贷', row: 1 },
        { name: 'principal', label: '借款金额(元)', type: 'number', value: d('principal', ''), required: true, min: 0, flex: 1, row: 2 },
        { name: 'termMonths', label: '借款期限(月)', type: 'number', value: d('termMonths', 3), min: 1, flex: 1, row: 2 },
        { name: 'method', label: '还款方式', type: 'select', value: d('method', 'daily'), flex: 1, row: 3, options: Object.keys(METHOD).map(k => ({ value: k, label: METHOD[k] })) },
        { name: 'termInterest', label: '期限总利息(元) · 平台显示', type: 'number', value: d('termInterest', ''), min: 0, flex: 1, row: 3 },
        { name: 'annualRate', label: '年利率 %（选填）', type: 'number', value: d('annualRate', ''), min: 0, flex: 1, row: 4 },
        { name: 'monthlyPayment', label: '每期应还(元) · 选填', type: 'number', value: d('monthlyPayment', ''), min: 0, flex: 1, row: 4 },
        { name: 'startDate', label: '起息日', type: 'date', value: d('startDate', todayISO()), required: true, flex: 1, row: 5 },
        { name: 'dayBasis', label: '日利率基准', type: 'select', value: String(d('dayBasis', 360)), flex: 1, row: 5, options: [{ value: '360', label: '360天(银行常用)' }, { value: '365', label: '365天' }] },
        { name: 'prepayFeeRate', label: '提前还款违约金 %（选填）', type: 'number', value: d('prepayFeeRate', 0), min: 0, row: 6 }
      ]) +
      '<div class="hint muted">「期限总利息」填平台页面上显示的总利息（借3个月共多少利息）。填了它，日利息和保本价上浮都会按它反推的真实利率算，比名义年利率准；它也是「覆盖总利息价」的直接依据。年利率选填，两者都没有则利息按 0 计。</div>' +
      '<div class="form-sec">股票持仓（买入价手动填，之后按实时行情跟踪）</div>' +
      ui.form([
        { name: 'stockCode', label: '股票代码', value: d('stockCode', ''), required: true, placeholder: '如 600519', flex: 1, row: 1 },
        { name: 'quantity', label: '买入数量(股)', type: 'number', value: d('quantity', ''), required: true, min: 1, flex: 1, row: 1 },
        { name: 'buyPrice', label: '买入价(元)', type: 'number', value: d('buyPrice', ''), required: true, min: 0, flex: 1, row: 2 },
        { name: 'buyDate', label: '买入日期', type: 'date', value: d('buyDate', todayISO()), flex: 1, row: 2 }
      ]) +
      '<div class="form-sec">交易费率（已预置 A 股现行标准，按你的券商改）</div>' +
      ui.form([
        { name: 'commissionRate', label: '佣金率 %（万2.5 = 0.025）', type: 'number', value: d('commissionRate', DEF.commissionRate), min: 0, flex: 1, row: 1 },
        { name: 'minCommission', label: '单笔最低佣金(元)', type: 'number', value: d('minCommission', DEF.minCommission), min: 0, flex: 1, row: 1 },
        { name: 'stampRate', label: '印花税 %（仅卖出）', type: 'number', value: d('stampRate', DEF.stampRate), min: 0, flex: 1, row: 2 },
        { name: 'transferRate', label: '过户费 %（双边）', type: 'number', value: d('transferRate', DEF.transferRate), min: 0, flex: 1, row: 2 }
      ]) +
      '<div class="hint muted">佣金万2.5 = 0.025%；印花税 2023-08-28 起减半为 0.05% 单边；过户费 2022-04-29 起沪深两市 0.001% 双向。</div>';
  }

  function openForm(rec, onSaved) {
    const m = ui.openModal({
      title: rec ? '编辑测算' : '新建测算', html: formHTML(rec),
      actions: [{ label: '取消' }, {
        label: '保存', primary: true, onClick: async (close) => {
          const g = id => m.dialog.querySelector('#f-' + id).value.trim();
          const code = g('stockCode').replace(/\D/g, '');
          if (!code) { ui.toast('股票代码格式不对', 'warn'); return; }
          const obj = rec ? Object.assign({}, rec) : { id: store.uid() };
          obj.loanName = g('loanName');
          obj.principal = num(g('principal'));
          obj.annualRate = num(g('annualRate'));
          obj.termInterest = num(g('termInterest'));        // 平台显示：借 N 个月总共利息
          obj.monthlyPayment = num(g('monthlyPayment'));    // 平台显示：每期应还
          obj.method = g('method');
          obj.termMonths = Math.max(1, num(g('termMonths'), 12));
          obj.startDate = g('startDate');
          obj.dayBasis = parseInt(g('dayBasis'), 10) || 360;
          obj.prepayFeeRate = num(g('prepayFeeRate'));
          obj.stockCode = code;
          obj.quantity = Math.max(1, num(g('quantity'), 1));
          obj.buyPrice = num(g('buyPrice'));
          obj.buyDate = g('buyDate');
          obj.commissionRate = num(g('commissionRate'), DEF.commissionRate);
          obj.minCommission = num(g('minCommission'), DEF.minCommission);
          obj.stampRate = num(g('stampRate'), DEF.stampRate);
          obj.transferRate = num(g('transferRate'), DEF.transferRate);
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
    ui.bindFormValidation(m.dialog);
  }

  /* ---------------- 详情视图 ---------------- */
  let _timer = null;
  function clearTimer() { if (_timer) { clearInterval(_timer); _timer = null; } }

  function detailHTML(rec, q, c) {
    const st = c.st;
    let rateDisp;
    if (st.rateSource === 'implied') rateDisp = st.impliedAnnual.toFixed(2) + '% (平台反推)';
    else if (st.rateSource === 'nominal') rateDisp = num(rec.annualRate).toFixed(2) + '%';
    else rateDisp = '未设置，利息按 0 计';
    const tiDisp = (st.termInterest != null && st.termInterest > 0)
      ? money(st.termInterest) + ' <i class="muted">(平台报价)</i>' : money(st.total);
    const mpDisp = rec.monthlyPayment ? money(rec.monthlyPayment) : '—';
    const gapBE = c.curPrice ? (c.breakeven - c.curPrice) / c.curPrice * 100 : 0;
    const gapCA = c.curPrice ? (c.coverAll - c.curPrice) / c.curPrice * 100 : 0;
    const beReached = c.curPrice && c.curPrice >= c.breakeven;
    const caReached = c.curPrice && c.curPrice >= c.coverAll;
    return '' +
      '<div class="page">' +
      '<div class="page-head">' +
        '<button class="icon-btn" id="lev-back" title="返回">' + ui.icon('chevronLeft', 20) + '</button>' +
        '<div class="page-head-main"><h1>' + ui.escapeHtml(q ? (q.name || rec.stockCode) : ('自选 ' + rec.stockCode)) + '</h1>' +
        '<div class="page-head-sub">' + ui.escapeHtml(rec.stockCode) + (rec.loanName ? ' · ' + ui.escapeHtml(rec.loanName) : '') + '</div></div>' +
        '<div class="page-head-actions">' +
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
        '<div class="card section lev-key' + (beReached ? ' lv-ok' : '') + '">' +
          '<div class="lk-label">保本卖出价 <span class="muted">还清贷款+已计息不亏</span></div>' +
          '<div class="lk-price">' + c.breakeven.toFixed(2) + '</div>' +
          '<div class="lk-gap ' + (beReached ? 'lv-up' : 'lv-down') + '">' +
            (c.curPrice ? (beReached ? '现价已达标 ↑' : '距现价还需 ' + pct(gapBE)) : '填现价后显示') + '</div>' +
        '</div>' +
        '<div class="card section lev-key' + (caReached ? ' lv-ok' : '') + '">' +
          '<div class="lk-label">覆盖总利息价 <span class="muted">吃满整期全部利息</span></div>' +
          '<div class="lk-price">' + c.coverAll.toFixed(2) + '</div>' +
          '<div class="lk-gap ' + (caReached ? 'lv-up' : 'lv-down') + '">' +
            (c.curPrice ? (caReached ? '现价已达标 ↑' : '距现价还需 ' + pct(gapCA)) : '填现价后显示') + '</div>' +
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

      '<div class="card section">' +
        '<div class="sec-title">成本拆解（按 ' + c.Q + ' 股）</div>' +
        '<div class="kv-list">' +
          '<div class="kv"><span class="k">买入金额</span><span class="v">' + money(c.buy) + '</span></div>' +
          '<div class="kv"><span class="k">买入手续费</span><span class="v">' + money(c.cBuy) + '</span></div>' +
          '<div class="kv"><span class="k">贷款已计息 <i class="muted">第 ' + c.D + ' 天</i></span><span class="v">' + money(st.accrued) + '</span></div>' +
          '<div class="kv"><span class="k">提前还款违约金</span><span class="v">' + money(c.prepayFee) + '</span></div>' +
          '<div class="kv total"><span class="k">还贷成本合计</span><span class="v">' + money(c.costNow) + '</span></div>' +
          (c.curPrice ? '<div class="kv"><span class="k">当前市值</span><span class="v">' + money(c.market) + '</span></div>' +
            '<div class="kv"><span class="k">卖出到手（扣费）</span><span class="v">' + money(c.netIfSell) + '</span></div>' +
            '<div class="kv total"><span class="k">卖出盈亏</span><span class="v ' + cls(c.pnl) + '">' + money(c.pnl) + '</span></div>' : '') +
        '</div>' +
      '</div>' +

      '<div class="card section">' +
        '<div class="sec-title">贷款信息</div>' +
        '<div class="kv-list">' +
          '<div class="kv"><span class="k">本金 / 有效利率</span><span class="v">' + money0(st.P) + ' · ' + rateDisp + '</span></div>' +
          '<div class="kv"><span class="k">还款方式</span><span class="v">' + METHOD[rec.method || 'daily'] + '</span></div>' +
          '<div class="kv"><span class="k">期限 / 起息日</span><span class="v">' + st.n + ' 个月 · ' + ui.escapeHtml(rec.startDate || '') + '</span></div>' +
          '<div class="kv"><span class="k">每日新增利息</span><span class="v lv-warn">' + money(st.daily) + ' / 天</span></div>' +
          '<div class="kv"><span class="k">已产生利息</span><span class="v">' + money(st.accrued) + '</span></div>' +
          '<div class="kv"><span class="k">剩余本金</span><span class="v">' + money0(st.remaining) + '</span></div>' +
          '<div class="kv"><span class="k">整期总利息</span><span class="v">' + tiDisp + '</span></div>' +
          '<div class="kv"><span class="k">每期应还</span><span class="v">' + mpDisp + '</span></div>' +
          '<div class="kv"><span class="k">保本价每日上浮</span><span class="v lv-warn">+' + c.drift.toFixed(4) + ' / 天</span></div>' +
        '</div>' +
        '<div class="hint muted">多持有一天，保本卖出价就上浮约 ' + c.drift.toFixed(3) + ' 元 —— 这就是杠杆的时间成本。</div>' +
      '</div>' +

      '<div class="lev-disclaimer">本模块仅做成本与盈亏平衡测算，不构成任何投资建议。信贷资金按规定不得用于证券投资，请自行评估合规风险。</div>' +
      '</div>';
  }

  async function openDetail(root, rec) {
    clearTimer();
    root.innerHTML = '<div class="page">' + ui.skeleton(3) + '</div>';
    let q = null, chartType = 'trend';
    try { q = await fetchQuote(rec.stockCode); } catch (e) { q = null; }

    function paint() {
      const c = calc(rec, q ? q.price : null);
      root.innerHTML = detailHTML(rec, q, c);
      root.querySelector('#lev-back').onclick = () => { clearTimer(); render(root); };
      root.querySelector('#lev-edit').onclick = () => openForm(rec, () => openDetail(root, rec));
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
        { price: c.breakeven, label: '保本', color: 'var(--warn)' },
        { price: c.coverAll, label: '覆息', color: 'var(--danger)' },
        { price: num(rec.buyPrice), label: '成本', color: 'var(--muted)' }
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

    function paint() {
      if (!recs.length) {
        list.innerHTML = ui.emptyState('还没有测算，点新建录入一笔贷款 + 一只股票', { action: { label: '新建测算' } });
        const ea = list.querySelector('#empty-add'); if (ea) ea.onclick = () => openForm(null, reload);
        return;
      }
      list.innerHTML = recs.map(r => {
        const c = calc(r, null);
        const rateTxt = c.st.rateSource === 'implied' ? c.st.impliedAnnual.toFixed(2) + '%'
          : (num(r.annualRate) ? num(r.annualRate).toFixed(2) + '%' : '按平台总利息');
        return '<div class="card lev" data-id="' + r.id + '">' +
          '<div class="lev-main">' +
            '<div class="lev-title">' + ui.escapeHtml(r.loanName || '贷款') +
              ' <span class="muted">→ ' + ui.escapeHtml(r.stockCode) + '</span></div>' +
            '<div class="lev-nums">' +
              '<span>本金 <b>' + money0(r.principal) + '</b></span>' +
              '<span>买入 <b>' + num(r.buyPrice).toFixed(2) + '</b></span>' +
              '<span>保本 <b class="lv-warn">' + c.breakeven.toFixed(2) + '</b></span>' +
              '<span>覆息 <b class="lv-danger">' + c.coverAll.toFixed(2) + '</b></span>' +
            '</div>' +
            '<div class="lev-sub muted">' + METHOD[r.method || 'daily'] + ' · ' + rateTxt +
              (c.st.rateSource === 'implied' ? ' (平台反推)' : '') + ' · 第 ' + c.D + ' 天 · 日息 ' + money(c.st.daily) + '</div>' +
          '</div>' +
          '<div class="row-actions">' +
            '<button class="icon-btn del" title="删除">' + ui.icon('trash', 16) + '</button>' +
          '</div>' +
        '</div>';
      }).join('');
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
      const rec = recs.find(r => r.id === id);
      if (rec) openDetail(root, rec);
    });
  }

  // 暴露纯计算函数，便于校验与跨模块复用
  WB.leverage = { METHOD, METHOD_HINT, DEF, loanState, solvePrice, calc, rates, buyFees, sellFees, daysBetween, marketOf };

  WB.modules.push({ id: 'leverage', title: '杠杆测算', icon: 'trendingUp', render });
})(window.WB = window.WB || {});
