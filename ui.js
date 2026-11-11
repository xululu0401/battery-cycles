/* 一块电池还能撑几年 · 界面与导出（ui.js）
 * 依赖 core.js（window.AppCore）。不联网、不发请求、不加载外部资源。
 */
'use strict';
(function () {
  var A = window.AppCore;
  var LS_KEY = 'battery-cycles-v1';
  var CFG = A.normCfg(A.DEFAULTS);
  var RES = null;
  var SC = [];
  var SESSION = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  var NOMINAL_V = 3.85;      // 标称电压（页面上写明，只用于把 mAh 折成 Wh）

  /* ─── 小工具 ─────────────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function num(v) { var n = Number(String(v === undefined || v === null ? '' : v).replace(/[,，\s]/g, '')); return isFinite(n) ? n : NaN; }
  function fmt(x, d) {
    if (x === null || x === undefined || !isFinite(x)) return '—';
    var s = Number(x).toFixed(d === undefined ? 2 : d);
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function fmtInt(x) { if (!isFinite(x)) return '—'; return String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function pct(x, d) { return isFinite(x) ? Number(x).toFixed(d === undefined ? 2 : d) + '%' : '—'; }

  /* ─── 输入绑定 ───────────────────────────────────────────────────── */
  var NUM_FIELDS = ['healthNowPct', 'usedYears', 'screenHoursPerDay', 'drainPctPerHour', 'chargesPerDay',
    'chargeFloorPct', 'topCapPct', 'fastSharePct', 'capacityMah'];

  function fillInputs() {
    NUM_FIELDS.forEach(function (k) {
      var inp = $('f-' + k);
      if (inp) inp.value = String(CFG[k]);
    });
    var lb = $('f-label'); if (lb) lb.value = CFG.label || '';
    var box = $('chips-tempBand');
    clear(box);
    A.TEMP_BANDS.forEach(function (b) {
      var c = el('button', 'chip', b.label);
      c.type = 'button';
      c.setAttribute('aria-pressed', String(CFG.tempBand === b.key));
      c.addEventListener('click', function () { CFG.tempBand = b.key; refresh(); });
      box.appendChild(c);
    });
  }
  /* 温度档按钮的选中态：每次重算都同步一次，避免出现「值变了但按钮没亮」 */
  function syncChips() {
    var box = $('chips-tempBand');
    if (!box) return;
    [].slice.call(box.querySelectorAll('.chip')).forEach(function (c, i) {
      var b = A.TEMP_BANDS[i];
      if (b) c.setAttribute('aria-pressed', String(CFG.tempBand === b.key));
    });
    var sbox = $('scenarios');
    if (sbox) {
      [].slice.call(sbox.querySelectorAll('.chip')).forEach(function (c, i) {
        var sc = SCENARIOS[i];
        if (sc) c.setAttribute('aria-pressed', String(CFG.label === A.normCfg(sc.cfg).label));
      });
    }
  }
  function readInputs() {
    NUM_FIELDS.forEach(function (k) {
      var inp = $('f-' + k);
      if (!inp) return;
      var v = inp.value.trim();
      if (v === '') { CFG[k] = NaN; return; }
      var n = num(v);
      CFG[k] = isFinite(n) ? n : NaN;
    });
    var lb = $('f-label'); if (lb && lb.value.trim()) CFG.label = lb.value.trim().slice(0, 40);
    CFG = A.normCfg(CFG);
  }
  function markBadFields(errs) {
    NUM_FIELDS.forEach(function (k) {
      var inp = $('f-' + k);
      if (inp) inp.className = (inp.className || '').replace(/\bbad\b/g, '').trim();
    });
    (errs || []).forEach(function (e) {
      var inp = $('f-' + e.field);
      if (inp) inp.className = (inp.className + ' bad').trim();
    });
  }

  /* ─── 持久化 ─────────────────────────────────────────────────────── */
  function saveLocal() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, cfg: CFG, at: new Date().toISOString() }));
      return true;
    } catch (e) { return false; }
  }
  function loadLocal() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.cfg) return null;
      return A.normCfg(o.cfg);
    } catch (e) { return null; }
  }
  /* 返回「要用的配置对象」或 null —— 绝不要把 'restored'/'fresh' 这种状态字符串当 seed 传下去 */
  function restoreOrSeed() {
    var saved = loadLocal();
    if (saved) return saved;
    return null;
  }

  /* ─── 场景（都是虚构示例） ───────────────────────────────────────── */
  var SCENARIOS = [
    {
      key: 'phone15', label: '手机用了一年半（默认）',
      cfg: { label: '虚构示例：一部手机用了一年半', capacityMah: 4400, healthNowPct: 94, usedYears: 1.5, screenHoursPerDay: 6.5, drainPctPerHour: 4.5, chargesPerDay: 1, chargeFloorPct: 0, topCapPct: 100, fastSharePct: 40, tempBand: 'normal' }
    },
    {
      key: 'phone3', label: '手机用了三年、健康度 86%',
      cfg: { label: '虚构示例：一部手机用了三年', capacityMah: 4400, healthNowPct: 86, usedYears: 3, screenHoursPerDay: 5.5, drainPctPerHour: 4.5, chargesPerDay: 1, chargeFloorPct: 0, topCapPct: 100, fastSharePct: 30, tempBand: 'normal' }
    },
    {
      key: 'heavy', label: '重度：每天两充、长途导航',
      cfg: { label: '虚构示例：重度使用', capacityMah: 5000, healthNowPct: 88, usedYears: 2, screenHoursPerDay: 10, drainPctPerHour: 9, chargesPerDay: 2, chargeFloorPct: 5, topCapPct: 100, fastSharePct: 70, tempBand: 'warm' }
    },
    {
      key: 'careful', label: '保养型：只充到 80%',
      cfg: { label: '虚构示例：只充到 80% 的人', capacityMah: 4400, healthNowPct: 96, usedYears: 2, screenHoursPerDay: 5, drainPctPerHour: 4.5, chargesPerDay: 1, chargeFloorPct: 20, topCapPct: 80, fastSharePct: 10, tempBand: 'cool' }
    },
    {
      key: 'old', label: '已经到 79%（该换了）',
      cfg: { label: '虚构示例：已经到阈值', capacityMah: 4200, healthNowPct: 79, usedYears: 4, screenHoursPerDay: 6, drainPctPerHour: 5, chargesPerDay: 1.5, chargeFloorPct: 0, topCapPct: 100, fastSharePct: 50, tempBand: 'normal' }
    },
    {
      key: 'future', label: '新机（刚用 3 个月）',
      cfg: { label: '虚构示例：刚买三个月', capacityMah: 5000, healthNowPct: 100, usedYears: 0.25, screenHoursPerDay: 7, drainPctPerHour: 5, chargesPerDay: 1, chargeFloorPct: 10, topCapPct: 100, fastSharePct: 60, tempBand: 'normal' }
    }
  ];
  function renderScenarios() {
    var box = $('scenarios');
    clear(box);
    SCENARIOS.forEach(function (s) {
      var b = el('button', 'chip', s.label);
      b.type = 'button';
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () {
        CFG = A.normCfg(s.cfg);
        fillInputs();
        refresh();
      });
      box.appendChild(b);
    });
  }

  /* ─── 周线图（纯几何，便于无头断言） ─────────────────────────────── */
  var CHART = { w: 1000, h: 320, left: 104, right: 968, top: 30, bottom: 268, hMin: 76, hMax: 100 };
  function xOfYears(y, maxYears) {
    var r = Math.min(1, Math.max(0, y / maxYears));
    return CHART.left + r * (CHART.right - CHART.left);
  }
  function yOfHealth(h) {
    var r = (h - CHART.hMin) / (CHART.hMax - CHART.hMin);
    return CHART.bottom - r * (CHART.bottom - CHART.top);
  }
  function svgEl(tag, attrs, txt) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
    if (txt !== undefined) e.textContent = txt;
    return e;
  }
  function drawChart(res) {
    var svg = $('chart');
    clear(svg);
    var strats = res.strategies;
    var maxYears = 2;
    strats.forEach(function (s) { if (s.years !== null) maxYears = Math.max(maxYears, s.years); });
    maxYears = Math.min(15, Math.ceil(Math.max(maxYears, res.yearsTo80 || 0) * 1.05 * 2) / 2);
    if (!(maxYears > 0.5)) maxYears = 0.5;
    CHART.maxYears = maxYears;

    /* 网格与刻度 */
    var ticks = [76, 80, 85, 90, 95, 100];
    ticks.forEach(function (h) {
      var y = yOfHealth(h);
      svg.appendChild(svgEl('line', { x1: CHART.left, y1: y, x2: CHART.right, y2: y, stroke: h === 80 ? '#c99' : '#e3e8ea', 'stroke-width': h === 80 ? 1.4 : 1, 'stroke-dasharray': h === 80 ? '5 4' : '' }));
      svg.appendChild(svgEl('text', { x: CHART.left - 10, y: y + 4, 'text-anchor': 'end', 'font-size': 12, fill: '#7d8a8e' }, h + '%'));
    });
    var stepYear = maxYears <= 3 ? 0.5 : (maxYears <= 7 ? 1 : 2);
    for (var yy = 0; yy <= maxYears + 1e-9; yy += stepYear) {
      var x = xOfYears(yy, maxYears);
      svg.appendChild(svgEl('line', { x1: x, y1: CHART.top, x2: x, y2: CHART.bottom, stroke: '#eef2f3', 'stroke-width': 1 }));
      svg.appendChild(svgEl('text', { x: x, y: CHART.bottom + 20, 'text-anchor': 'middle', 'font-size': 12, fill: '#7d8a8e' }, yy === 0 ? '今天' : ('+' + (Math.round(yy * 10) / 10) + ' 年')));
    }
    svg.appendChild(svgEl('text', { x: CHART.left - 10, y: CHART.top - 12, 'text-anchor': 'end', 'font-size': 11, fill: '#7d8a8e' }, '健康度'));
    /* 80% 区域底纹 */
    svg.appendChild(svgEl('rect', { x: CHART.left, y: yOfHealth(80), width: CHART.right - CHART.left, height: CHART.bottom - yOfHealth(80), fill: '#fdf0ee', opacity: 0.75 }));

    var COLORS = ['#a3251b', '#16657a', '#146b46', '#8a5a00'];
    var labelSlots = [];
    var drawnRates = [];
    strats.forEach(function (s, i) {
      var color = COLORS[i % COLORS.length];
      var years = s.years === null ? maxYears : Math.min(s.years, maxYears);
      /* 年化速率完全相同的两条策略，线是重合的：只画一条，并在图例里说明（不叠一条看不见的线） */
      var dupOf = null;
      for (var d0 = 0; d0 < drawnRates.length; d0++) {
        if (Math.abs(drawnRates[d0].rate - s.rate) < 1e-6) { dupOf = drawnRates[d0]; break; }
      }
      if (dupOf === null) drawnRates.push({ rate: s.rate, key: s.key, label: s.label });
      var pts = [];
      var n = 48;
      for (var k = 0; k <= n; k++) {
        var t = years * k / n;
        var h = res.startHealth - s.rate * t;
        pts.push(xOfYears(t, maxYears) + ',' + yOfHealth(Math.max(CHART.hMin, Math.min(res.startHealth, h))));
      }
      if (dupOf === null) {
        svg.appendChild(svgEl('polyline', {
          points: pts.join(' '), fill: 'none', stroke: color,
          'stroke-width': i === 0 ? 3 : 2.2,
          'stroke-dasharray': s.key === 'current' ? '' : (i % 2 === 0 ? '7 4' : '3 3'),
          'stroke-linejoin': 'round', 'stroke-linecap': 'round'
        }));
      }
      var ex = xOfYears(years, maxYears), ey = yOfHealth(80);
      svg.appendChild(svgEl('circle', { cx: ex, cy: ey, r: i === 0 ? 5 : 4, fill: '#fff', stroke: color, 'stroke-width': 2.2 }));
      if (dupOf !== null) return;                 // 重合线不再重复贴标签
      /* 端点标签：错开纵向位置，且必须落在画布内（超出就换到线的左侧、用 end 对齐） */
      var ly = ey + 6;
      while (labelSlots.some(function (v) { return Math.abs(v - ly) < 15; })) ly += 15;
      if (ly > CHART.bottom + 44) ly = ey + 6;
      labelSlots.push(ly);
      var txt = (s.key === 'current' ? '现在这样 ' : '') + (s.months === null ? '推不出' : (Math.round(s.months / 12 * 10) / 10) + ' 年后');
      var tW = txt.length * 7.2 + 10;
      var toLeft = (ex + 18 + tW) > CHART.right;
      var tx = toLeft ? Math.max(CHART.left, ex - 18) : (ex + 18);
      svg.appendChild(svgEl('line', { x1: ex, y1: ey, x2: toLeft ? ex - 14 : ex + 14, y2: ly - 4, stroke: color, 'stroke-width': 1, opacity: 0.6 }));
      svg.appendChild(svgEl('text', { x: tx, y: ly, 'font-size': 12, fill: color, 'text-anchor': toLeft ? 'end' : 'start' }, txt));
    });
    window.__chart = { xOfYears: xOfYears, yOfHealth: yOfHealth, maxYears: maxYears, CHART: CHART, labels: labelSlots.slice() };
  }

  /* ─── 渲染 ───────────────────────────────────────────────────────── */
  function renderVerdict(res) {
    var t = $('ticket');
    t.className = 'ticket' + (res.alreadyAtThreshold ? ' bad' : (res.yearsTo80 !== null && res.yearsTo80 <= 1.5 ? ' warn' : ' ok'));
    clear($('v-title'));
    $('v-title').textContent = res.headline;
    var scene = $('v-scene');
    if (scene) scene.textContent = '场景：' + (res.cfg.label || '（未填备注）');   // 备注也要看得见，不只影响导出文件名
    clear($('v-why'));
    var why = el('div');
    why.textContent = '系统里那个健康度 ' + fmt(res.startHealth, 0) + '% 是你唯一能读到的实测值：它 ÷ 已经用的 ' + fmt(res.cfg.usedYears, 2) +
      ' 年 = 实测年化衰减 ' + fmt(res.base.aObs, 3) + ' 点/年，还差 ' + fmt(res.remLoss, 0) + ' 个点到 80%。' +
      '照这个速率不变，大约 ' + (res.replaceLabel || '—') + ' 到；误差不在小数位，而在「你掉的那几个点里有多少是充电造成的」—— 这一项本页给了两侧，而不是一个假装精确的数。';
    $('v-why').appendChild(why);

    var kpis = $('kpis');
    clear(kpis);
    function ro(l, v, s2) {
      var d = el('div', 'ro');
      d.appendChild(el('div', 'l', l));
      d.appendChild(el('div', 'v', v));
      if (s2) d.appendChild(el('div', 's', s2));
      kpis.appendChild(d);
    }
    ro('还差多少点到 80%', fmt(res.remLoss, 0) + ' 点', '实测年化 ' + fmt(res.base.aObs, 3) + ' 点/年');
    ro('照现在这样用', res.yearsTo80 === null ? '推不出' : fmt(res.yearsTo80, 2) + ' 年',
      res.monthsTo80 === null ? '健康度还没掉过点' : (res.monthsTo80 + ' 个月，' + (res.replaceLabel || '—')));
    ro('把窗口挪进中段', res.advice.costDropPct > 0 ? ('−' + res.advice.costDropPct + '% 损耗') : '已最优',
      res.advice.kind === 'shallower' ? ('年损耗单元 ' + fmt(res.flow.wearPerYear, 2) + ' → ' + fmt(res.strategies[1].wearPerYear, 2)) : '你现在的窗口已贴着中段');
    ro('最好情况（全归充电）', res.optimisticYears === null ? '—' : fmt(res.optimisticYears, 2) + ' 年',
      res.optimisticLabel ? ('到 ' + res.optimisticLabel + '，多撑 ' + res.advice.gainMonths + ' 个月') : '—');
    ro('每次充电跨过', fmt(res.flow.perChargePct, 2) + '%', '窗口 ' + fmt(res.windows.current.floorPct, 2) + '–' + fmt(res.windows.current.ceilPct, 2) + '%');
    ro('每年放掉', fmt(res.flow.blocksPerYear, 1) + ' 块', fmt(res.flow.capacityPerDay) + ' mAh/天（' + fmt(res.flow.capacityMah) + ' mAh · ' + fmt(res.flow.whCapacity, 2) + ' Wh）');
  }

  function renderMile(res) {
    var tb = $('mile-body');
    clear(tb);
    if (!res.marks.length) {
      var tr0 = el('tr');
      var td0 = el('td', 'n', '当前健康度已经低于 80%，没有可列的里程碑。');
      td0.colSpan = 4;
      tr0.appendChild(td0); tb.appendChild(tr0);
      return;
    }
    res.marks.forEach(function (m) {
      var tr = el('tr');
      tr.appendChild(el('td', 'h', m.health + '%'));
      tr.appendChild(el('td', 'd', m.date ? m.date.label : '—'));
      tr.appendChild(el('td', 'n', m.years === null ? '—' : (fmt(m.years, 2) + ' 年（' + Math.round(m.years * 12) + ' 个月）')));
      tr.appendChild(el('td', 'n', '累计约 ' + fmtInt(m.charges) + ' 次充电' + (m.spreadMonths ? '；速率放缓口径下再晚 ' + m.spreadMonths + ' 个月' : '')));
      tb.appendChild(tr);
    });
  }

  function renderStrategies(res) {
    var box = $('strat');
    clear(box);
    var worst = 0;
    res.strategies.forEach(function (s) { worst = Math.max(worst, s.wearPerYear); });
    res.strategies.forEach(function (s) {
      var d = el('div', 'sc' + (s.key === 'current' ? ' on' : ''));
      var t = el('div', 't');
      t.appendChild(el('span', '', s.label));
      t.appendChild(el('span', 'tag', s.key === 'current' ? '你现在的用法' : (s.improvementPct > 0 ? ('省 ' + s.improvementPct + '%') : '不比现在省')));
      d.appendChild(t);
      var g = el('div', 'g');
      function cell(l, v) { var w = el('div'); w.appendChild(el('div', 'l', l)); w.appendChild(el('div', 'v', v)); g.appendChild(w); }
      cell('窗口', fmt(s.floorPct, 1) + '–' + fmt(s.ceilPct, 1) + '%');
      cell('每次跨过', fmt(s.perChargePct, 2) + '%');
      cell('区间权重', fmt(s.bandCost, 3));
      cell('每年放掉', fmt(res.flow.blocksPerYear, 1) + ' 块');
      cell('年损耗单元', fmt(s.wearPerYear, 2));
      cell('年化衰减', fmt(s.rate, 3) + ' 点/年');
      cell('到 80%', s.years === null ? '推不出' : fmt(s.years, 2) + ' 年');
      cell('比现在', s.deltaMonths === null ? '—' : (s.deltaMonths > 0 ? '+' + s.deltaMonths + ' 个月' : (s.deltaMonths < 0 ? s.deltaMonths + ' 个月' : '一样')));
      d.appendChild(g);
      var bar = el('div', 'bar' + (s.wearPerYear > res.flow.wearPerYear * 1.2 ? ' bad' : (s.wearPerYear < res.flow.wearPerYear * 0.95 ? ' good' : '')));
      var i = el('i');
      i.style.width = Math.max(2, Math.round(s.wearPerYear / worst * 100)) + '%';
      bar.appendChild(i);
      d.appendChild(bar);
      box.appendChild(d);
    });
  }

  function renderAdvice(res) {
    var box = $('advice-body');
    clear(box);
    var a = res.advice;
    var d = el('div', 'adv');
    d.appendChild(el('div', 't', a.kind === 'shallower' ? ('把每次充电挪进中段：' + fmt(a.floorPct, 1) + '%–' + fmt(a.ceilPct, 1) + '%') : '不用改充电窗口'));
    d.appendChild(el('div', 'b', a.text + (a.kind === 'shallower'
      ? '（年损耗单元降 ' + a.costDropPct + '%，' + (res.monthsTo80 === null ? '' : (res.monthsTo80 + ' 个月 → ' + res.strategies[1].months + ' 个月，多撑 ' + a.gainMonths + ' 个月）'))
      : '')));
    var row = el('div', 'btnrow');
    if (a.kind === 'shallower') {
      var b1 = el('button', 'btn primary', '按这个区间算一遍（写回输入）');
      b1.type = 'button';
      b1.addEventListener('click', function () {
        CFG.chargeFloorPct = a.floorPct;
        CFG.topCapPct = a.ceilPct;
        fillInputs();
        refresh();
      });
      row.appendChild(b1);
    }
    var b2 = el('button', 'btn', '把每天充电次数 +1（每次跨得更小）');
    b2.type = 'button';
    b2.addEventListener('click', function () {
      CFG.chargesPerDay = Math.min(6, (isFinite(CFG.chargesPerDay) ? CFG.chargesPerDay : 1) + 1);
      fillInputs(); refresh();
    });
    var b3 = el('button', 'btn', '把快充占比降到 0');
    b3.type = 'button';
    b3.addEventListener('click', function () { CFG.fastSharePct = 0; fillInputs(); refresh(); });
    var b4 = el('button', 'btn', '环境温度调到「凉」档');
    b4.type = 'button';
    b4.addEventListener('click', function () { CFG.tempBand = 'cool'; fillInputs(); refresh(); });
    row.appendChild(b2); row.appendChild(b3); row.appendChild(b4);
    d.appendChild(row);
    box.appendChild(d);

    var d2 = el('div', 'adv');
    d2.appendChild(el('div', 't', '三件不改充电窗口也能做的事'));
    var ul = el('ul', 'notes');
    ul.appendChild(el('li', null, '只要把「每天充电次数」加一，每次跨过的电量就减半，落进中段的那部分就多一截 —— 上面第二个按钮就是它。'));
    ul.appendChild(el('li', null, '快充那一份额外损耗是温和的乘法（全快充比全慢充多 ' + Math.round(CFG.fastPenaltyMax * 100) + '%），别指望它翻盘，但也别忽视。'));
    ul.appendChild(el('li', null, '温度那一档是这里最猛的一根杠杆：很热档把年损耗单元乘 1.90，比把窗口挪进中段能拿回的还多。'));
    d2.appendChild(ul);
    box.appendChild(d2);
  }

  function renderSens(res) {
    var tb = $('sens-body');
    clear(tb);
    var rows = A.sensitivity(CFG);
    var base = rows[0];
    rows.forEach(function (row, i) {
      var tr = el('tr');
      tr.appendChild(el('td', 'c1', row.label));
      tr.appendChild(el('td', 'c2', fmt(row.wearPerYear, 2)));
      tr.appendChild(el('td', 'c3', fmt(row.ratio, 3)));
      tr.appendChild(el('td', 'c4', !row.comparable ? '—' : (row.deltaYears > 0.005 ? ('+' + fmt(row.deltaYears, 2) + ' 年') : '0')));
      var note;
      if (i === 0) {
        note = '基准：就是上面那组输入算出来的年损耗单元（' + fmt(base.wearPerYear, 2) + '），与结论区同源。';
      } else if (!row.comparable) {
        if (row.wearPerYear > base.wearPerYear + 1e-9) note = '这个条件比基准更费（' + fmt(row.wearPerYear, 2) + ' > ' + fmt(base.wearPerYear, 2) + '）—— 本表只报「能拿回多少」，不报「照更费的用法会早多久」，所以这行不给「比基准晚」。';
        else if (row.ratio < 1) note = '比基准更省（' + fmt(row.wearPerYear, 2) + ' < ' + fmt(base.wearPerYear, 2) + '，速率比 ' + row.ratio + '）。这行只换了窗口位置、没换每天用掉多少电，所以是干净的可比项。';
        else note = '与基准相同：这个条件不改变年损耗单元（例如只改充电次数、不动充电窗口）。';
      } else if (row.ratio < 1) {
        note = '已经归一到「每天放掉同样多的电」：每次跨过 ' + fmt(row.perChargePct, 2) + '%（基准 ' + fmt(base.perChargePct, 2) + '%），' +
          '年损耗单元 ' + fmt(row.wearPerYear, 2) + ' < ' + fmt(base.wearPerYear, 2) + '，能多撑 ' + fmt(row.deltaYears, 2) + ' 年。';
      } else {
        note = '已经归一到「每天放掉同样多的电」：每次跨过 ' + fmt(row.perChargePct, 2) + '%，但这个窗口比基准更费，所以记 0。';
      }
      tr.appendChild(el('td', 'c5', note));
      tb.appendChild(tr);
    });
  }

  function renderSelfChecks(res) {
    SC = A.selfChecks(CFG, res);
    var pass = SC.filter(function (x) { return x.pass; }).length;
    $('sc-count').textContent = pass + ' / ' + SC.length + ' 通过';
    var box = $('sc-body');
    clear(box);
    SC.forEach(function (c) {
      var d = el('div', 'chk ' + (c.pass ? 'pass' : 'fail'));
      d.appendChild(el('span', 'm', c.pass ? 'PASS' : 'FAIL'));
      var t = el('span', 't');
      t.appendChild(el('span', 'n', c.name));
      t.appendChild(el('span', 'd', '（' + c.detail + '）'));
      d.appendChild(t);
      box.appendChild(d);
    });
  }

  function renderNotes(res) {
    var box = $('notes');
    clear(box);
    res.notes.forEach(function (n) { box.appendChild(el('li', null, n)); });
    var kv = $('assumptions');
    clear(kv);
    res.assumptions.forEach(function (n) { kv.appendChild(el('li', null, n)); });
  }

  function renderErrors(res) {
    var box = $('sec-err'), body = $('err-body');
    clear(body);
    var fatal = res.fatalErrors || [];
    var soft = (res.errors || []).filter(function (e) { return e.field === 'healthNowPct'; });
    if (!fatal.length && !soft.length) { box.className = 'card err hidden'; markBadFields([]); return; }
    box.className = 'card err';
    if (fatal.length) {
      body.appendChild(el('div', '', '这几处要改一下才算得出来：'));
      var ul = el('ul');
      fatal.forEach(function (e) { ul.appendChild(el('li', null, e.msg)); });
      body.appendChild(ul);
    }
    soft.forEach(function (e) { body.appendChild(el('div', '', e.msg)); });
    markBadFields(fatal);
  }

  function renderFoot(res) {
    $('fb-years').textContent = res.yearsTo80 === null ? '—' : (fmt(res.yearsTo80, 2) + ' 年');
    $('fb-wear').textContent = fmt(res.flow.wearPerYear, 2);
    $('fb-drain').textContent = fmt(res.flow.drainPct, 2) + '%';
    var pass = SC.filter(function (x) { return x.pass; }).length;
    $('fb-sc').textContent = pass + '/' + SC.length;
  }

  /* ─── 主流程 ─────────────────────────────────────────────────────── */
  function refresh(opts) {
    readInputs();
    syncChips();          // 温度档按钮的选中态跟着 CFG 走（不然点了按钮、按钮自己不亮：本轮踩到）
    RES = A.compute(CFG, { nowISO: (opts && opts.nowISO) || new Date().toISOString().slice(0, 10) });
    renderErrors(RES);
    renderVerdict(RES);
    drawChart(RES);
    renderLegend();
    renderMile(RES);
    renderStrategies(RES);
    renderAdvice(RES);
    renderSens(RES);
    renderSelfChecks(RES);
    renderNotes(RES);
    renderFoot(RES);
    return RES;
  }
  function renderLegend() {
    var box = $('legend');
    clear(box);
    var colors = ['#a3251b', '#16657a', '#146b46', '#8a5a00'];
    var shown = [];
    RES.strategies.forEach(function (s, i) {
      var same = null;
      for (var j = 0; j < shown.length; j++) if (Math.abs(shown[j].rate - s.rate) < 1e-6) same = shown[j];
      var d = el('span');
      var i2 = el('i');
      i2.style.background = same ? colors[shown.indexOf(same) % colors.length] : colors[i % colors.length];
      if (same) i2.style.opacity = '0.45';
      d.appendChild(i2);
      d.appendChild(document.createTextNode(s.label +
        (s.years === null ? '（推不出）' : '：' + fmt(s.years, 2) + ' 年') +
        (same ? '（与「' + same.label.slice(0, 8) + '…」速率相同，线重合）' : '')));
      box.appendChild(d);
      shown.push({ rate: s.rate, label: s.label });
    });
  }

  /* ─── 导出 ───────────────────────────────────────────────────────── */
  function slug() {
    var s = (CFG.label || 'battery').replace(/[^\w\u4e00-\u9fa5-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
    return s || 'battery';
  }
  function ts() { return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'); }
  function csvText(r) {
    var out = [];
    out.push('批次,2026-11-12-codex-54');
    out.push('生成时间,' + new Date().toISOString());
    out.push('说明,全部数字来自本页同一套算式；默认值是虚构示例');
    out.push('');
    out.push('输入项,值,单位');
    out.push('当前健康度,' + r.startHealth + ',%');
    out.push('已经用了,' + r.cfg.usedYears + ',年');
    out.push('每天亮屏,' + r.cfg.screenHoursPerDay + ',小时');
    out.push('每小时耗电,' + r.cfg.drainPctPerHour + ',%/小时');
    out.push('每天充电次数,' + r.cfg.chargesPerDay + ',次');
    out.push('最低放到,' + r.cfg.chargeFloorPct + ',%');
    out.push('愿意充到,' + r.cfg.topCapPct + ',%');
    out.push('快充占比,' + r.cfg.fastSharePct + ',%');
    out.push('温度档,' + A.tempBand(r.cfg.tempBand).label + ',');
    out.push('标称容量,' + r.cfg.capacityMah + ',mAh');
    out.push('');
    out.push('主口径,值');
    out.push('实测年化衰减,' + r.base.aObs + ',点每年');
    out.push('当前年损耗单元,' + r.base.wearPerYear + ',单元每年');
    out.push('剩余点数,' + r.remLoss + ',个百分点');
    out.push('悲观剩余年数,' + r.yearsTo80 + ',年');
    out.push('乐观剩余年数,' + r.optimisticYears + ',年');
    out.push('');
    out.push('月份,日期,健康度%,累计掉点,累计充电次数');
    r.timeline.forEach(function (t) {
      out.push([t.month, t.date, t.health, t.loss, t.charges].join(','));
    });
    out.push('');
    out.push('里程碑,健康度%,预计日期,还要多久(年),累计充电次数');
    r.marks.forEach(function (m) {
      out.push([m.health, m.date ? m.date.iso : '', m.years === null ? '' : m.years, m.charges === null ? '' : m.charges].join(','));
    });
    out.push('');
    out.push('策略,窗口下限%,窗口上限%,每次跨过%,区间权重,年损耗单元,速率比,年化衰减,到80%(年),比现在(月)');
    r.strategies.forEach(function (s) {
      out.push([s.label, s.floorPct, s.ceilPct, s.perChargePct, s.bandCost, s.wearPerYear, s.ratio, s.rate, s.years === null ? '' : s.years, s.deltaMonths === null ? '' : s.deltaMonths].join(','));
    });
    return out.join('\n');
  }
  function mdText(r) {
    var L = [];
    L.push('# 一块电池还能撑几年 · 结果摘要');
    L.push('');
    L.push('- 生成时间：' + new Date().toISOString() + '（本页不联网，全部由本地算式得出）');
    L.push('- 场景备注：' + (r.cfg.label || '（未填）') + '（默认值是虚构示例）');
    L.push('');
    L.push('## 结论');
    L.push('');
    L.push(r.headline);
    L.push('');
    L.push('实测年化衰减 ' + r.base.aObs + ' 点/年；还剩 ' + r.remLoss + ' 个点到 80%。');
    L.push('悲观（不改习惯）：' + (r.yearsTo80 === null ? '—' : r.yearsTo80 + ' 年') + '；乐观（换到中段窗口且掉的点全来自循环）：' + (r.optimisticYears === null ? '—' : r.optimisticYears + ' 年') + '。');
    L.push('');
    L.push('## 里程表');
    L.push('');
    L.push('| 健康度 | 预计日期 | 还要多久 | 累计充电次数 |');
    L.push('|---|---|---|---|');
    r.marks.forEach(function (m) {
      L.push('| ' + m.health + '% | ' + (m.date ? m.date.label : '—') + ' | ' + (m.years === null ? '—' : m.years + ' 年') + ' | ' + (m.charges === null ? '—' : m.charges) + ' |');
    });
    L.push('');
    L.push('## 四种充法');
    L.push('');
    L.push('| 策略 | 窗口 | 每次跨过 | 年损耗单元 | 年化衰减 | 到 80% | 比现在 |');
    L.push('|---|---|---|---|---|---|---|');
    r.strategies.forEach(function (s) {
      L.push('| ' + s.label + ' | ' + s.floorPct + '–' + s.ceilPct + '% | ' + s.perChargePct + '% | ' + s.wearPerYear + ' | ' + s.rate + ' 点/年 | ' + (s.years === null ? '—' : s.years + ' 年') + ' | ' + (s.deltaMonths === null ? '—' : s.deltaMonths + ' 个月') + ' |');
    });
    L.push('');
    L.push('## 模型假设');
    L.push('');
    r.assumptions.forEach(function (a) { L.push('- ' + a); });
    L.push('');
    L.push('## 边界');
    L.push('');
    r.notes.forEach(function (n) { L.push('- ' + n); });
    return L.join('\n');
  }
  function jsonText(r) {
    return JSON.stringify({
      schema: 'battery-cycles/v1',
      batch: '2026-11-12-codex-54',
      generated_at: new Date().toISOString(),
      note: '本文件可再次导入本页；所有数字由本地算式得出，默认值是虚构示例。',
      cfg: r.cfg,
      result: {
        headline: r.headline,
        aObs: r.base.aObs, wearPerYear: r.base.wearPerYear, remLoss: r.remLoss,
        yearsTo80: r.yearsTo80, optimisticYears: r.optimisticYears,
        replaceLabel: r.replaceLabel, optimisticLabel: r.optimisticLabel,
        windows: r.windows, advice: r.advice,
        strategies: r.strategies, marks: r.marks, timeline: r.timeline,
        assumptions: r.assumptions, notes: r.notes
      },
      self_checks: SC
    }, null, 2);
  }
  /* 结果卡：1080×1350，用 canvas 画，内容全部取自同一次计算结果 */
  function drawCard(r) {
    var W = 1080, H = 1350, dpr = 1;
    var cv = document.createElement('canvas');
    cv.width = W * dpr; cv.height = H * dpr;
    var g = cv.getContext('2d');
    g.scale(dpr, dpr);
    g.fillStyle = '#f4f6f7'; g.fillRect(0, 0, W, H);
    function rr(x, y, w, h, rad) {
      g.beginPath();
      g.moveTo(x + rad, y); g.lineTo(x + w - rad, y); g.quadraticCurveTo(x + w, y, x + w, y + rad);
      g.lineTo(x + w, y + h - rad); g.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
      g.lineTo(x + rad, y + h); g.quadraticCurveTo(x, y + h, x, y + h - rad);
      g.lineTo(x, y + rad); g.quadraticCurveTo(x, y, x + rad, y); g.closePath();
    }
    /* 标题区 */
    g.fillStyle = '#ffffff'; rr(48, 48, W - 96, 268, 20); g.fill();
    g.fillStyle = '#16657a'; g.fillRect(48, 48, 10, 268);
    g.fillStyle = '#141a1c'; g.font = 'bold 52px -apple-system,"PingFang SC",sans-serif';
    g.fillText('一块电池还能撑几年', 92, 132);
    g.fillStyle = '#4e5a5e'; g.font = '30px -apple-system,"PingFang SC",sans-serif';
    wrapText(g, r.cfg.label + '（虚构示例）', 92, 190, W - 200, 38, 2);
    g.fillStyle = '#16657a'; g.font = 'bold 40px -apple-system,"PingFang SC",sans-serif';
    wrapText(g, r.headline, 92, 268, W - 200, 48, 2);
    /* 读数格 */
    var cells = [
      ['实测年化衰减', fmt(r.base.aObs, 2) + ' 点/年'],
      ['年损耗单元', fmt(r.base.wearPerYear, 2)],
      ['每天放掉', fmt(r.flow.drainPct, 2) + '%'],
      ['每次跨过', fmt(r.flow.perChargePct, 2) + '%'],
      ['悲观到 80%', r.yearsTo80 === null ? '—' : fmt(r.yearsTo80, 2) + ' 年'],
      ['乐观到 80%', r.optimisticYears === null ? '—' : fmt(r.optimisticYears, 2) + ' 年']
    ];
    var cw = (W - 96 - 2 * 24) / 3, ch = 132;
    cells.forEach(function (c, i) {
      var col = i % 3, row = Math.floor(i / 3);
      var x = 48 + col * (cw + 12), y = 344 + row * (ch + 12);
      g.fillStyle = '#ffffff'; rr(x, y, cw, ch, 16); g.fill();
      g.fillStyle = '#7d8a8e'; g.font = '26px -apple-system,"PingFang SC",sans-serif';
      g.fillText(c[0], x + 20, y + 44);
      g.fillStyle = '#141a1c'; g.font = 'bold 38px ui-monospace,Menlo,monospace';
      g.fillText(c[1], x + 20, y + 98);
    });
    /* 里程碑 */
    g.fillStyle = '#ffffff'; rr(48, 644, W - 96, 300, 18); g.fill();
    g.fillStyle = '#141a1c'; g.font = 'bold 32px -apple-system,"PingFang SC",sans-serif';
    g.fillText('里程表', 76, 700);
    g.font = '27px -apple-system,"PingFang SC",sans-serif';
    var my = 750;
    r.marks.slice(0, 5).forEach(function (m) {
      g.fillStyle = '#7d8a8e'; g.fillText(m.health + '%', 76, my);
      g.fillStyle = '#141a1c'; g.fillText(m.date ? m.date.label : '—', 200, my);
      g.fillStyle = '#16657a'; g.fillText(m.years === null ? '—' : (fmt(m.years, 2) + ' 年'), 470, my);
      g.fillStyle = '#7d8a8e'; g.fillText('约 ' + fmtInt(m.charges) + ' 次充电', 700, my);
      my += 46;
    });
    /* 策略 */
    g.fillStyle = '#ffffff'; rr(48, 966, W - 96, 250, 18); g.fill();
    g.fillStyle = '#141a1c'; g.font = 'bold 32px -apple-system,"PingFang SC",sans-serif';
    g.fillText('四种充法', 76, 1022);
    g.font = '26px -apple-system,"PingFang SC",sans-serif';
    var sy = 1070;
    r.strategies.forEach(function (s) {
      g.fillStyle = '#141a1c'; g.fillText(String(s.label).slice(0, 18), 76, sy);
      g.fillStyle = '#4e5a5e'; g.fillText(fmt(s.wearPerYear, 2) + ' 单元/年', 560, sy);
      g.fillStyle = s.improvementPct > 0 ? '#146b46' : '#a3251b';
      g.fillText(s.years === null ? '60 年内不到' : (fmt(s.years, 2) + ' 年'), 830, sy);
      sy += 44;
    });
    /* 页脚 */
    g.fillStyle = '#7d8a8e'; g.font = '22px -apple-system,"PingFang SC",sans-serif';
    g.fillText('2026-11-12-codex-54 · 本页不联网，数字全部由你填的输入算出 · ' + new Date().toISOString().slice(0, 10), 48, 1280);
    g.fillText('模型假设与边界见页面「模型假设与边界」一节；默认值是虚构示例，不对应任何真实设备。', 48, 1316);
    return cv;
  }
  /* 封面 1200×1200：同一套结果对象的读数，不另算一遍 */
  function drawCover(r) {
    var W = 1200, H = 1200;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var g = cv.getContext('2d');
    g.fillStyle = '#f4f6f7'; g.fillRect(0, 0, W, H);
    function rr(x, y, w, h, rad) {
      g.beginPath();
      g.moveTo(x + rad, y); g.lineTo(x + w - rad, y); g.quadraticCurveTo(x + w, y, x + w, y + rad);
      g.lineTo(x + w, y + h - rad); g.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
      g.lineTo(x + rad, y + h); g.quadraticCurveTo(x, y + h, x, y + h - rad);
      g.lineTo(x, y + rad); g.quadraticCurveTo(x, y, x + rad, y); g.closePath();
    }
    g.fillStyle = '#ffffff'; rr(60, 60, W - 120, 420, 28); g.fill();
    g.fillStyle = '#16657a'; g.fillRect(60, 60, 14, 420);
    g.fillStyle = '#141a1c'; g.font = 'bold 86px -apple-system,"PingFang SC",sans-serif';
    g.fillText('一块电池', 120, 200);
    g.fillText('还能撑几年', 120, 305);
    g.fillStyle = '#4e5a5e'; g.font = '34px -apple-system,"PingFang SC",sans-serif';
    wrapText(g, '填一次系统里的电池健康度，算出照现在的用法还能撑几年跌到 80%', 120, 385, W - 260, 46, 2);
    /* 三个大数 */
    var cells = [
      ['照现在这样用', r.yearsTo80 === null ? '推不出' : fmt(r.yearsTo80, 2) + ' 年', r.replaceLabel || '—'],
      ['把窗口挪进中段', r.advice.costDropPct > 0 ? ('损耗 −' + r.advice.costDropPct + '%') : '已最优', r.advice.kind === 'shallower' ? ('多撑 ' + r.advice.gainMonths + ' 个月') : '你已经在最省的位置'],
      ['每年放掉', fmt(r.flow.blocksPerYear, 1) + ' 块', '年损耗单元 ' + fmt(r.flow.wearPerYear, 2)]
    ];
    var cw = (W - 120 - 2 * 24) / 3, ch = 300;
    cells.forEach(function (c, i) {
      var x = 60 + i * (cw + 24), y = 540;
      g.fillStyle = '#ffffff'; rr(x, y, cw, ch, 22); g.fill();
      g.fillStyle = '#7d8a8e'; g.font = '30px -apple-system,"PingFang SC",sans-serif';
      g.fillText(c[0], x + 28, y + 60);
      g.fillStyle = '#16657a'; g.font = 'bold 60px ui-monospace,Menlo,monospace';
      g.fillText(c[1], x + 28, y + 160);
      g.fillStyle = '#4e5a5e'; g.font = '28px -apple-system,"PingFang SC",sans-serif';
      wrapText(g, c[2], x + 28, y + 225, cw - 56, 38, 2);
    });
    /* 口径说明 */
    g.fillStyle = '#ffffff'; rr(60, 880, W - 120, 200, 22); g.fill();
    g.fillStyle = '#4e5a5e'; g.font = '30px -apple-system,"PingFang SC",sans-serif';
    g.fillText('实测年化衰减 ' + fmt(r.base.aObs, 3) + ' 点/年（健康度 ' + fmt(r.startHealth, 0) + '% ÷ 用了 ' + fmt(r.cfg.usedYears, 2) + ' 年）', 96, 950);
    g.fillText('数字全部由你填；默认值是虚构示例，页面不联网、不内置任何品牌参数', 96, 1005);
    g.fillStyle = '#7d8a8e'; g.font = '26px -apple-system,"PingFang SC",sans-serif';
    g.fillText('2026-11-12-codex-54 · battery-cycles', 96, 1052);
    return cv;
  }
  function wrapText(g, text, x, y, maxW, lh, maxLines) {
    var line = '', lines = [];
    for (var i = 0; i < text.length; i++) {
      var test = line + text[i];
      if (g.measureText(test).width > maxW && line) { lines.push(line); line = text[i]; } else line = test;
      if (lines.length >= maxLines) break;
    }
    if (lines.length < maxLines && line) lines.push(line);
    lines.forEach(function (l, k) { g.fillText(l, x, y + k * lh); });
    return lines.length;
  }

  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name; a.style.position = 'fixed'; a.style.left = '-9999px';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 1500);
    return name;
  }
  function downloadPng() {
    var cv = drawCard(RES);
    return new Promise(function (resolve) {
      if (cv.toBlob) {
        cv.toBlob(function (blob) {
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url; a.download = '电池还能撑几年-结果卡-' + ts() + '.png'; a.style.position = 'fixed'; a.style.left = '-9999px';
          document.body.appendChild(a); a.click();
          setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 2000);
          resolve(a.download);
        }, 'image/png');
      } else { resolve(null); }
    });
  }

  window.__exports = {
    csv: function () { return csvText(RES); },
    md: function () { return mdText(RES); },
    json: function () { return String(jsonText(RES)); },
    png: function () { return downloadPng(); },
    names: function (kind) {
      var base = '电池还能撑几年';
      return kind === 'png' ? base + '-结果卡-' + ts() + '.png' : base + '-' + kind.toUpperCase() + '-' + ts() + '.' + (kind === 'md' ? 'md' : kind);
    },
    doCsv: function () { return download(window.__exports.names('csv'), csvText(RES), 'text/csv;charset=utf-8'); },
    doMd: function () { return download(window.__exports.names('md'), mdText(RES), 'text/markdown;charset=utf-8'); },
    doJson: function () { return download(window.__exports.names('json'), jsonText(RES), 'application/json;charset=utf-8'); },
    doPng: function () { return downloadPng(); }
  };
  window.__app = {
    cfg: function () { return CFG; },
    result: function () { return RES; },
    checks: function () { return SC; },
    refresh: refresh,
    setCfg: function (patch) {
      for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) CFG[k] = patch[k];
      CFG = A.normCfg(CFG);
      fillInputs();
      return refresh();
    },
    reset: function () { CFG = A.normCfg(A.DEFAULTS); fillInputs(); return refresh(); },
    clearStore: function () { try { localStorage.removeItem(LS_KEY); } catch (e) { } return true; },
    /* 与文件输入框共用同一条解析逻辑：JSON 文本 → normCfg → 重算 → 存本机 */
    importText: function (txt) {
      try {
        var o = JSON.parse(String(txt));
        if (!o || !o.cfg) return 'no-cfg';
        CFG = A.normCfg(o.cfg); fillInputs(); refresh(); saveLocal();
        return 'imported';
      } catch (e) { return 'err:' + e.message; }
    },
    save: saveLocal,
    seed: function () { var v = restoreOrSeed(); return v ? 'restored' : 'fresh'; },
    scenarios: function () { return SCENARIOS; },
    csvText: function () { return csvText(RES); },
    mdText: function () { return mdText(RES); },
    jsonText: function () { return jsonText(RES); },
    cardSize: function () { var cv = drawCard(RES); return { w: cv.width, h: cv.height }; },
    coverSize: function () { var cv = drawCover(RES); return { w: cv.width, h: cv.height }; },
    saveCover: function (name) {
      var cv = drawCover(RES);
      return new Promise(function (resolve) {
        cv.toBlob(function (blob) {
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url; a.download = (name || 'cover') + '.png';
          a.style.position = 'fixed'; a.style.left = '-9999px';
          document.body.appendChild(a); a.click();
          setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 2000);
          resolve(a.download);
        }, 'image/png');
      });
    },
    lsKey: LS_KEY
  };

  /* ─── 事件 ───────────────────────────────────────────────────────── */
  function bind() {
    ['input', 'change'].forEach(function (evt) {
      document.addEventListener(evt, function (e) {
        var t = e.target;
        if (!t || !t.id || t.id.indexOf('f-') !== 0) return;
        if (t.id === 'file-import') return;
        refresh();
        saveLocal();
      }, true);
    });
    $('btn-calc').addEventListener('click', function () { refresh(); saveLocal(); });
    $('btn-save').addEventListener('click', function () {
      var ok = saveLocal();
      $('btn-save').textContent = ok ? '已保存（刷新会恢复）' : '保存失败';
      setTimeout(function () { $('btn-save').textContent = '保存到本机'; }, 2200);
    });
    $('btn-reset').addEventListener('click', function () {
      CFG = A.normCfg(A.DEFAULTS); fillInputs(); refresh(); saveLocal();
    });
    $('btn-export-json').addEventListener('click', function () { window.__exports.doJson(); });
    $('btn-import-json').addEventListener('click', function () { $('file-import').click(); });
    $('file-import').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var o = JSON.parse(String(fr.result));
          if (o && o.cfg) { CFG = A.normCfg(o.cfg); fillInputs(); refresh(); saveLocal(); }
        } catch (err) { /* 静默忽略坏文件，不改动现有输入 */ }
      };
      fr.readAsText(f);
      e.target.value = '';
    });
  }

  /* ─── 启动 ───────────────────────────────────────────────────────── */
  function init(seed) {
    renderScenarios();
    if (seed) CFG = seed;
    fillInputs();
    bind();
    refresh();
  }
  window.__boot = function (mode) {
    var m = mode || 'restore';
    var seed = null;
    if (m === 'restore') seed = restoreOrSeed();          // 返回 cfg 对象或 null
    else if (m === 'fresh') { try { localStorage.removeItem(LS_KEY); } catch (e) { } }
    init(seed);
    return m;
  };
  if (document.readyState === 'complete' || document.readyState === 'interactive') window.__boot('restore');
  else document.addEventListener('DOMContentLoaded', function () { window.__boot('restore'); });
})();
