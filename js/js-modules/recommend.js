// module: recommend 养生选题推荐（每日热门主题 + 上下格文案）
// 数据来源：./data/recommendations.json（每日由自动化脚本追加刷新，全局共享，非用户私有数据）
//   结构：{ updatedAt, days: [ { date, topicCount, topics:[...] }, ... ] }（保留全部历史，按日期堆叠）
// 兜底：内置 FALLBACK，离线或文件暂不可用时仍可浏览首批示例。
(function (WB) {
  'use strict';
  const store = WB.store, ui = WB.ui;

  // —— 兜底数据（与首批 data/recommendations.json 一致）——
  const FALLBACK = {
    date: '2026-08-01',
    topicCount: 7,
    topics: [
      { id: 'r01', title: '末伏出汗越多，祛湿越彻底？', tags: ['#末伏养生', '#祛湿误区', '#中医科普'], copies: [
        { top: '出汗越多，体内的湿气排得越干净？', bottom: '错！大汗淋漓反而伤津耗阳。末伏祛湿宜「微汗」，快走30分钟到后背微微潮润即可，千万别暴汗蒸桑拿。' },
        { top: '三伏天不出汗，就是攒湿气？', bottom: '不一定。久坐空调房不出汗≠积湿，关键在饮食油腻、久坐少动。少甜少油+适度运动，比硬逼出汗更靠谱。' },
        { top: '红豆薏米水，喝一周就能瘦？', bottom: '生薏米偏寒，虚寒体质越喝越伤脾。用炒薏米+赤小豆才对路，且它利水不燃脂，别当减肥神水猛灌。' },
        { top: '拔罐颜色越深，湿气越重？', bottom: '罐印深浅主要看负压和皮肤薄厚，跟「湿毒」没直接关系。同一人不同部位印色都不同，别被颜色吓到。' }
      ] },
      { id: 'r02', title: '夏天喝冰水，真的能降温解暑？', tags: ['#夏日养生', '#肠胃保护', '#解暑误区'], copies: [
        { top: '热得冒汗，来瓶冰水最解暑？', bottom: '错！冰水会刺激胃肠血管骤缩，反而把热量闷在体内散不出。温淡盐水或小口凉水慢慢咽，降温更稳。' },
        { top: '冰箱拿出来就能直接吃，没事？', bottom: '刚冷藏的瓜果，脾胃虚寒者易绞痛。放至室温或温水泡一下再吃，护住「后天之本」脾胃。' },
        { top: '中暑了，灌冰水急救最快？', bottom: '危险！中暑先移到阴凉处、松衣、温水擦身物理降温，再补电解质。猛灌冰水可能诱发心血管意外。' }
      ] },
      { id: 'r03', title: '立秋一到，就得赶紧「贴秋膘」？', tags: ['#立秋养生', '#贴秋膘', '#进补误区'], copies: [
        { top: '立秋这天不吃肉，秋天没底气？', bottom: '错！现代人多营养过剩，盲目贴膘只长血脂。先清夏天积滞，再循序渐进温补，比一顿猛吃强得多。' },
        { top: '秋天该多喝汤浓补养肺？', bottom: '肺喜润恶燥没错，但油腻浓汤反而生痰。银耳、百合、梨这类清润食材，比老火排骨汤更对秋燥。' },
        { top: '贴秋膘=吃越多越好？', bottom: '秋季体重管理更要紧。以优质蛋白+时令蔬果为主，体重每月增幅控制在1-2斤内即可，别报复性进补。' }
      ] },
      { id: 'r04', title: '每天必须喝满「八杯水」？', tags: ['#饮水常识', '#补水误区', '#健康习惯'], copies: [
        { top: '不管渴不渴，一天八杯才健康？', bottom: '错！饮水量看体重、活动量和天气。按每公斤约30ml估算更准，且汤粥水果都算「水」，别硬灌。' },
        { top: '口渴了再喝，说明已经缺水？', bottom: '对，但老人渴觉迟钝易脱水。少量多次、尿色淡黄即达标，比死记杯数科学得多。' },
        { top: '运动完猛灌水补充最快？', bottom: '一次性牛饮会加重心脏负担。每次100-150ml、间隔10分钟，出汗多再补点淡盐水更稳。' }
      ] },
      { id: 'r05', title: '早起空腹一杯淡盐水，排毒又通便？', tags: ['#晨起习惯', '#淡盐水误区', '#肠道养生'], copies: [
        { top: '晨起一杯淡盐水，清肠排毒？', bottom: '错！现代人多钠超标，早起喝盐水反升压、添肾负担。温水或柠檬水更友好，通便靠的是纤维和作息。' },
        { top: '蜂蜜水早上喝，养颜又润肠？', bottom: '蜂蜜本质是高糖，空腹喝易血糖波动、长痘。真要喝，餐后少量、温水冲泡别烫嘴。' },
        { top: '淡盐水能替代日常饮水？', bottom: '不能。长期高钠饮食是高血压推手，白水才是王道，盐只在大量出汗后酌情补一点。' }
      ] },
      { id: 'r06', title: '运动量越大，越养生越长寿？', tags: ['#运动养生', '#过度运动', '#科学健身'], copies: [
        { top: '每天暴汗两小时，身体才够强？', bottom: '错！过度运动产生大量自由基、伤关节心肌。每周150分钟中强度有氧+2次力量，性价比最高。' },
        { top: '步数没过万，等于白走？', bottom: '研究说6000-8000步已显著降低全因死亡，硬凑万步反而伤膝。质量>数量，量力而行。' },
        { top: '膝盖不好，就别运动了？', bottom: '恰恰要动！游泳、骑车、靠墙静蹲等长训练能养膝。完全不动，肌肉萎缩反而更快。' }
      ] },
      { id: 'r07', title: '红枣红糖，最能补血？', tags: ['#补血误区', '#女性养生', '#补铁真相'], copies: [
        { top: '贫血了，多喝红糖红枣水？', bottom: '错！红枣红糖含铁极低且非血红素铁，吸收差。补铁认准瘦肉、动物血、肝脏，植物铁配维C才好吸收。' },
        { top: '经期喝红糖水，能治痛经？', bottom: '热饮缓解的是痉挛性不适，不是「补血」。严重痛经要查妇科，别指望糖水硬扛。' },
        { top: '骨头汤浓白，最补钙？', bottom: '汤里多是脂肪和嘌呤，钙少得可怜。一杯奶的钙顶十碗汤，补钙还得靠奶制品+绿叶菜。' }
      ] }
    ]
  };

  let _cache = null;

  // 读取完整结构（含全部历史 days）；兼容旧的单日结构；失败时回退兜底
  async function _load() {
    if (_cache) return _cache;
    try {
      const r = await fetch('./data/recommendations.json', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      if (d && d.days && Array.isArray(d.days)) {
        _cache = d;
      } else if (d && d.topics && Array.isArray(d.topics)) {
        // 旧结构兼容：包成单日
        _cache = { days: [{ date: d.date || '', topicCount: d.topicCount, topics: d.topics }] };
      } else {
        throw new Error('bad shape');
      }
    } catch (e) {
      _cache = { days: [{ date: FALLBACK.date, topicCount: FALLBACK.topicCount, topics: FALLBACK.topics }] };
      _cache._fallback = true;
    }
    return _cache;
  }

  function sortDays(days) {
    return (days || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

  // 给首页面板用：返回最新一天 {date, topics, topicCount}
  async function getDaily() {
    const full = await _load();
    const days = sortDays(full.days);
    return days[0] || { date: '', topics: [] };
  }

  // 复制文本（兼容非安全上下文）
  function copyText(text, okMsg) {
    const done = () => ui.toast(okMsg || '已复制', 'info');
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { ui.toast('复制失败，请手动选择', 'warn'); }
    document.body.removeChild(ta);
  }

  function tagsHTML(tags) {
    return (tags || []).map(t => `<span class="chip tag">${ui.escapeHtml(t)}</span>`).join('');
  }

  function copiesHTML(copies) {
    return (copies || []).map((c, i) => `
      <div class="reco-copy">
        <div class="reco-part top">
          <span class="reco-tag">上格</span>
          <span class="reco-text">${ui.escapeHtml(c.top || '')}</span>
          <button class="btn ghost xs copy-one" data-copy="${encodeURIComponent(c.top || '')}">复制</button>
        </div>
        <div class="reco-part bottom">
          <span class="reco-tag">下格</span>
          <span class="reco-text">${ui.escapeHtml(c.bottom || '')}</span>
          <button class="btn ghost xs copy-one" data-copy="${encodeURIComponent(c.bottom || '')}">复制</button>
        </div>
      </div>`).join('');
  }

  function topicHTML(t) {
    return `<div class="card reco" data-id="${ui.escapeHtml(t.id)}">
      <div class="reco-head">
        <div class="reco-title">${ui.escapeHtml(t.title)}</div>
        <button class="btn primary xs copy-all" data-id="${ui.escapeHtml(t.id)}">复制全部</button>
      </div>
      <div class="reco-tags">${tagsHTML(t.tags)}</div>
      <div class="reco-copies">${copiesHTML(t.copies)}</div>
    </div>`;
  }

  async function render(root) {
    const full = await _load();
    const days = sortDays(full.days);

    root.innerHTML = ui.pageHead('bulb', '选题推荐', {
      subtitle: '抖音养生/养身账号 · 每日热门选题与上下格文案'
    }) + `
      <div class="reco-bar">
        <select id="reco-date" class="input reco-date" title="选择日期查看历史选题"></select>
        <input id="reco-search" class="input" placeholder="搜索主题或话题标签…">
      </div>
      <div id="reco-meta" class="reco-meta"></div>
      <div id="reco-list" class="reco-list">${ui.skeleton(4)}</div>`;

    const dateSel = root.querySelector('#reco-date');
    const listEl = root.querySelector('#reco-list');
    const metaEl = root.querySelector('#reco-meta');
    const searchEl = root.querySelector('#reco-search');

    if (!days.length) { listEl.innerHTML = ui.emptyState('暂无选题'); return; }

    days.forEach(dy => {
      const o = document.createElement('option');
      o.value = dy.date;
      o.textContent = (dy.date || '未知日期') + (dy.date === days[0].date ? '（今日）' : '');
      dateSel.appendChild(o);
    });
    dateSel.value = days[0].date;

    let current = days[0];

    function paint(filter) {
      filter = (filter || '').trim().toLowerCase();
      const topics = (current.topics || []).filter(t => {
        if (!filter) return true;
        if ((t.title || '').toLowerCase().includes(filter)) return true;
        return (t.tags || []).some(tag => tag.toLowerCase().includes(filter));
      });
      listEl.innerHTML = topics.length ? topics.map(topicHTML).join('') : ui.emptyState('没有匹配的选题');
    }

    function setDay(date) {
      current = days.find(d => d.date === date) || days[0];
      const hist = days.length > 1 ? ` · 历史共 ${days.length} 天` : '';
      if (full._fallback) metaEl.innerHTML = '<span class="muted">（离线兜底示例，联网后显示当日最新选题）</span>';
      else metaEl.innerHTML = `<span class="muted">${ui.escapeHtml(current.date || '')} · 共 ${(current.topics || []).length} 个选题${hist}</span>`;
      paint(searchEl.value);
    }

    setDay(days[0].date);
    dateSel.addEventListener('change', () => setDay(dateSel.value));
    searchEl.addEventListener('input', () => paint(searchEl.value));

    // 复制按钮（事件委托）
    listEl.addEventListener('click', e => {
      const one = e.target.closest('.copy-one');
      if (one) { copyText(decodeURIComponent(one.dataset.copy), '文案已复制'); return; }
      const all = e.target.closest('.copy-all');
      if (all) {
        const t = (current.topics || []).find(x => x.id === all.dataset.id);
        if (!t) return;
        const grouped = (t.copies || []).map((c, i) => `【第${i + 1}组｜上格】${c.top}\n【下格】${c.bottom}`).join('\n\n');
        const tail = (t.tags || []).join(' ');
        copyText(`${t.title}\n\n${grouped}\n\n${tail}`, '整组文案已复制');
      }
    });
  }

  WB.recommend = { render, getDaily, _load };
  WB.modules.push({ id: 'recommend', title: '选题推荐', icon: 'bulb', render });
})(window.WB = window.WB || {});
