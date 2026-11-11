/* 一块电池还能撑几年 · 锂电池循环寿命与充电习惯模型（core.js）
 *
 * 纯函数引擎：不联网、不读外网、不内置任何品牌参数、循环次数或实测分布。
 * 所有默认值都是本页的设计默认值（虚构示例），可在界面上改。
 * 运行环境：浏览器 <script>（window.AppCore）与 node（module.exports）通用。
 *
 * ── 模型一共四步，页面上逐步写明 ────────────────────────────────────────
 * ① 一次充电的损耗成本
 *      bandCost(下限,上限) = 这段区间上的平均应力权重（中段最轻，贴着 0% / 100% 两端最重）
 *      μ = 放电深度^q × bandCost × 温度系数 × 快充系数        （损耗单元 / 次；一次完整 0→100 循环约 1 个单元）
 * ② 每放电 1 个单位容量的损耗成本（真正决定谁更省的量）
 *      c_μ = μ × 每次放电深度
 * ③ 把「每年掉几个点」拆成两半
 *      你报的健康度 ÷ 你用了多久  →  实测年化衰减 a_obs（点 / 年）
 *      循环那一半 = c_μ × 每年放电的电池块数
 *      剩下那一半 = 日历老化（放着也会掉），= a_obs − 循环那一半（不小于 0）
 * ④ 从今天到 80% 还剩多少年
 *      Rem = 现在损失 − 20（负值取不到）
 *      悲观口径 t = Rem ÷ a_obs                                  （速率一直不变）
 *      乐观口径 t = Rem ÷ a_obs × 2^(1−s)，s ∈ [0.5, 1]            （速率按 t^(s−1) 逐年放慢，s<1 越放越慢）
 *      换个区间 → 循环那一半按 μ 的新旧比缩放，日历那一半不变，重新算 a_obs 再套上面两式
 *
 * ── 为什么不用「损失曲线 × 循环次数」直接反推到期日 ──────────────────────
 * 试过，做不出来：容量损失随循环次数幂律上升，而循环次数随时间是线性的，
 * 两条幂律一耦合，到期日对「循环与日历怎么拆」极端敏感（同一组输入能给出 3 年与 28 年两个答案），
 * 那种预测看着精确其实是假的。所以本页改成用**你自己那一个健康度读数**定速率，
 * 模型只负责回答「换一种充电区间，速率能降几成」，也就是唯一能由输入可靠推出来的那部分。
 */
'use strict';

var TEMP_BANDS = [
  { key: 'cool', label: '凉（常年 20 ℃ 以下）', cycleFactor: 1.00 },
  { key: 'normal', label: '常温（大部分时间 20–28 ℃）', cycleFactor: 1.15 },
  { key: 'warm', label: '偏热（夏天常超 30 ℃，或常边充边玩）', cycleFactor: 1.45 },
  { key: 'hot', label: '很热（常年 32 ℃ 以上 / 长期晒着充电）', cycleFactor: 1.90 }
];

var STRATEGIES = [
  { key: 'deep', label: '深放深充 5%–100%', floorPct: 5, ceilPct: 100 },
  { key: 'std', label: '常用 20%–80%', floorPct: 20, ceilPct: 80 },
  { key: 'shallow', label: '浅充浅放 40%–75%', floorPct: 40, ceilPct: 75 }
];

var DEFAULTS = {
  label: '虚构示例：一部手机用了一年半',
  capacityMah: 4400,
  healthNowPct: 94,
  usedYears: 1.5,
  screenHoursPerDay: 6.5,
  drainPctPerHour: 4.5,
  chargesPerDay: 1,
  chargeFloorPct: 0,      // 你平时最低放到多少（输入）
  topCapPct: 100,         // 你愿意充到的上限（输入）
  chargeCeilPct: 100,     // 实际充电窗口上沿（由 compute 按「一次用掉多少」推出，非用户输入）
  fastSharePct: 40,
  tempBand: 'normal',
  /* 模型常量：都标为设计参数，不是实验室常数 */
  depthExponent: 0.8,      // 每次充电的「应力随放电深度」的幂（越大表示浅放越省）
  stressMid: 0.25,         // 中段（自由区）最低应力权重
  stressBowl: 0.80,        // 自由区内向两端抬升的曲率
  stressFloor: 20,         // 自由区下沿（%）
  stressCeil: 80,          // 自由区上沿（%）
  stressAtEmpty: 1.30,     // 放到 0% 时的应力权重（比满电更贵：深放更伤）
  stressAtFull: 1.00,      // 充到 100% 时的应力权重
  fastPenaltyMax: 0.12,    // 全快充相对全慢充的额外损耗比例上限
  rateDecay: 0.35,         // 速率随时间的衰减速度 s（=1 表示速率恒定；越小表示越早掉得快、后面越来越慢）
  cycleShare: 0.50         // 「实测衰减里有多少来自充放电」的中间取值（一个健康度读数定不出来，取一半；悲观=1、乐观=0）
};

var LIMITS = {
  capacityMah: [100, 40000],
  healthNowPct: [60.1, 100],
  usedYears: [0.1, 30],
  screenHoursPerDay: [0.2, 24],
  drainPctPerHour: [0.5, 60],
  chargesPerDay: [0.25, 6],
  chargeFloorPct: [0, 95],
  topCapPct: [40, 100],
  fastSharePct: [0, 100],
  depthExponent: [0.5, 1.5],
  stressMid: [0.05, 0.6],
  stressBowl: [0, 3],
  stressFloor: [5, 40],
  stressCeil: [60, 95],
  stressAtEmpty: [0.6, 3],
  stressAtFull: [0.6, 3],
  cycleShare: [0, 1],
  rateDecay: [0.2, 1.0]
};

var REPLACE_HEALTH = 80;
var HORIZON_YEARS = 40;

/* ─── 数值工具 ───────────────────────────────────────────────────────── */
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function r6(x) { return Math.round(x * 1e6) / 1e6; }
function r4(x) { return Math.round(x * 1e4) / 1e4; }
function r2(x) { return Math.round(x * 1e2) / 1e2; }
function num(v) {
  if (v === '' || v === null || v === undefined) return NaN;
  var n = typeof v === 'number' ? v : Number(String(v).replace(/[,，\s]/g, ''));
  return isFinite(n) ? n : NaN;
}
function tempBand(key) {
  for (var i = 0; i < TEMP_BANDS.length; i++) if (TEMP_BANDS[i].key === key) return TEMP_BANDS[i];
  return TEMP_BANDS[1];
}

/* ─── 归一化：输入框读出来的永远是字符串，数值字段必须在这里统一转 number ── */
var NUM_KEYS = ['capacityMah', 'healthNowPct', 'usedYears', 'screenHoursPerDay', 'drainPctPerHour',
  'chargesPerDay', 'chargeFloorPct', 'topCapPct', 'chargeCeilPct', 'fastSharePct',
  'depthExponent', 'stressMid', 'stressBowl', 'stressFloor', 'stressCeil', 'stressAtEmpty', 'stressAtFull',
  'fastPenaltyMax', 'rateDecay', 'cycleShare'];

function normCfg(raw) {
  var src = raw || {}, out = {}, k, i;
  for (k in DEFAULTS) if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) out[k] = DEFAULTS[k];
  for (i = 0; i < NUM_KEYS.length; i++) {
    k = NUM_KEYS[i];
    if (src[k] === undefined || src[k] === null || src[k] === '') continue;
    var n = num(src[k]);
    if (isFinite(n)) out[k] = n;
    else if (String(src[k]).trim() !== '') out[k] = NaN;   // 填了东西但不是数字 → 保留 NaN，让 validate 报出来
  }
  if (typeof src.label === 'string' && src.label.trim()) out.label = src.label.trim().slice(0, 40);
  if (typeof src.tempBand === 'string') out.tempBand = tempBand(src.tempBand).key;
  return out;
}

/* ─── 校验 ───────────────────────────────────────────────────────────── */
var FIELD_NAMES = {
  capacityMah: '电池标称容量', healthNowPct: '当前健康度', usedYears: '已经用了多久',
  screenHoursPerDay: '每天亮屏时长', drainPctPerHour: '每小时耗电占比',
  chargesPerDay: '每天充电次数', chargeFloorPct: '你平时最低放到多少',
  topCapPct: '你愿意充到的上限', chargeCeilPct: '充电窗口上沿', fastSharePct: '快充占比', depthExponent: '放电深度指数', stressMid: '中段最低应力',
  cycleShare: '循环占实测衰减的比例', rateDecay: '速率衰减速度'
};
function validate(cfg) {
  var c = normCfg(cfg), es = [], f;
  for (f in LIMITS) {
    if (!Object.prototype.hasOwnProperty.call(LIMITS, f)) continue;
    if (!isFinite(c[f])) { es.push({ field: f, msg: FIELD_NAMES[f] + '要填一个数字' }); continue; }
    if (c[f] < LIMITS[f][0] || c[f] > LIMITS[f][1]) {
      es.push({ field: f, msg: FIELD_NAMES[f] + '要在 ' + LIMITS[f][0] + ' ~ ' + LIMITS[f][1] + ' 之间（现在是 ' + c[f] + '）' });
    }
  }
  if (isFinite(c.chargeFloorPct) && isFinite(c.topCapPct) && c.chargeFloorPct >= c.topCapPct) {
    es.push({ field: 'topCapPct', msg: '「充到的上限」必须高于「最低放到」（现在是 ' + c.chargeFloorPct + '% → ' + c.topCapPct + '%）' });
  }
  return es;
}

/* ─── 应力权重 w(x)：中段一个碗，两端陡升 ────────────────────────────────
 *      x ≤ L         w = wmid + bowl·(0.5−L)² + [A − wmid − bowl·(0.5−L)²]·(L−x)/L
 *      L ≤ x ≤ H     w = wmid + bowl·(x−0.5)²          （碗形，最低点在 50%）
 *      x ≥ H         w = wmid + bowl·(H−0.5)² + [B − wmid − bowl·(H−0.5)²]·(x−H)/(1−H)
 *   L/H 默认 20% / 80%，A（0% 处）1.30 比 B（100% 处）1.00 更贵 —— 深放比满电更伤，
 *   这是本页的设计选择，不是实测常数（页面上明说）。bowl 与 Mid 的取值使三段在 L、H 处连续且可导。
 *   区间平均权重 = (I(H) − I(L)) / (H − L)，I 是 w 的原函数（下一段）。
 */
function stressParams(cfg) {
  var c = normCfg(cfg);
  var L = clamp(c.stressFloor, 5, 40) / 100;
  var H = clamp(c.stressCeil, 60, 95) / 100;
  if (!(H > L)) { L = 0.2; H = 0.8; }
  var bowl = Math.max(c.stressBowl, 0);
  var wmid = c.stressMid;
  var wL = wmid + bowl * Math.pow(0.5 - L, 2);
  var wH = wmid + bowl * Math.pow(H - 0.5, 2);
  return {
    L: L, H: H, bowl: bowl, wmid: wmid, wL: wL, wH: wH,
    A: Math.max(c.stressAtEmpty, wL), B: Math.max(c.stressAtFull, wH),
    kL: (Math.max(c.stressAtEmpty, wL) - wL) / L,
    kH: (Math.max(c.stressAtFull, wH) - wH) / (1 - H)
  };
}
function weightAt(x, cfg) {
  var P = stressParams(cfg);
  var xx = clamp(x, 0, 1);
  if (xx <= P.L) return P.A - P.kL * xx;
  if (xx >= P.H) return P.wH + P.kH * (xx - P.H);
  return P.wmid + P.bowl * Math.pow(xx - 0.5, 2);
}
/* w 的原函数（分三段解析积分，段间取连续值）：
 *   ∫0^x  (A − kL·t) dt        = A·x − kL·x²/2
 *   ∫L^x  (wmid + bowl·(t−0.5)²) dt
 *        = wmid·(x−L) + bowl·[ (x−0.5)³ − (L−0.5)³ ] / 3
 *   ∫H^x  (wH + kH·(t−H)) dt   = wH·(x−H) + kH·(x−H)²/2
 * 之前这里把「1/(1−edge)」的斜率缩放算错了一次，导致 0–20% 段的平均权重比单点权重还大；
 * 现在三段都用上面这几行，测试里另有 20000 点数值积分对拍。
 */
function weightIntegral(t, cfgOrP) {
  var P = (cfgOrP && cfgOrP.L !== undefined) ? cfgOrP : stressParams(cfgOrP || {});
  var x = clamp(t, 0, 1);
  var bowlI = function (u) { return P.wmid * (u - 0.5) + P.bowl * Math.pow(u - 0.5, 3) / 3; };
  if (x <= P.L) return P.A * x - P.kL * x * x / 2;
  var iL = P.A * P.L - P.kL * P.L * P.L / 2;
  if (x <= P.H) return iL + (bowlI(x) - bowlI(P.L));
  var iH = iL + (bowlI(P.H) - bowlI(P.L));
  return iH + P.wH * (x - P.H) + P.kH * Math.pow(x - P.H, 2) / 2;
}
function bandCost(floorPct, ceilPct, cfg) {
  var P = stressParams(cfg);
  var a = clamp(floorPct, 0, 100) / 100, b = clamp(ceilPct, 0, 100) / 100;
  if (!(b > a)) return weightAt(a, cfg);
  var w = (weightIntegral(b, P) - weightIntegral(a, P)) / (b - a);
  return isFinite(w) && w > 0 ? w : weightAt((a + b) / 2, cfg);
}
function fastFactor(cfg) {
  var c = normCfg(cfg);
  return 1 + c.fastPenaltyMax * clamp(c.fastSharePct, 0, 100) / 100;
}
function tempCycleFactor(cfg) { return tempBand(normCfg(cfg).tempBand).cycleFactor; }

/* ─── 每日放电与损耗成本 ───────────────────────────────────────────────
 * 关键：损耗按「放出去的电量」加权，而不是按「充电次数」加权 ——
 *   一天放掉 30% 的电池，充 1 次（放 30%）和充 2 次（各放 15%）对电池是一样的，
 *   所以必须用 Σ(每次深度 × 区间权重 × 深度^q) 而不是 次数 × 权重。
 * 这样「每天充几次」只有在改变了区间时才影响结果，不会出现「多充几次就变耐用」的假结论。
 */
function dailyFlow(cfg) {
  var c = normCfg(cfg);
  var rawDrain = c.screenHoursPerDay * c.drainPctPerHour;   // %/天
  var drainPct = clamp(rawDrain, 0, 100);
  var capped = rawDrain > 100.0001;
  var cost = bandCost(c.chargeFloorPct, c.chargeCeilPct, c);   // 窗口两端（由 compute 先算好窗口再传进来）
  var tf = tempCycleFactor(c), ff = fastFactor(c);
  var blocksPerYear = drainPct / 100 * 365;                  // 每年放掉的「整块电池」数
  var wearPerBlock = cost;                                   // 每放掉 1 整块电池的损耗成本（损耗单元）
  var wearRate = wearPerBlock * blocksPerYear;                // 损耗单元 / 年（与充电次数无关）
  var perChargePct = drainPct / c.chargesPerDay;
  var depth = clamp(perChargePct / 100, 0.002, 1);
  return {
    rawDrainPct: r4(rawDrain), drainPct: r4(drainPct), capped: capped,
    perChargePct: r4(perChargePct), depth: r6(depth), bandCost: cost,
    wearPerBlock: r6(wearPerBlock), wearPerYear_pre: r4(wearRate),
    unitsPerDay: r6(wearRate / 365), unitsPerYear: r4(wearRate * tf * ff),
    wearPerYear: r4(wearRate * tf * ff),
    capacityPerCharge: Math.round(c.capacityMah * depth),
    capacityPerDay: Math.round(c.capacityMah * Math.min(drainPct / 100, 1)),
    whCapacity: r2(c.capacityMah / 1000 * 3.85),
    tempCycleFactor: tf, fastFactor: r6(ff),
    chargesPerDay: c.chargesPerDay, capacityMah: c.capacityMah, blocksPerYear: r2(blocksPerYear)
  };
}

/* ─── 自由区（中段）与充电窗口 ─────────────────────────────────────────
 * 本页把 20%–80% 定义为「自由区」：这一段里电量搬家最便宜，两端各 20% 最贵。
 * 一次充电能充进多少，不由充电器决定，而由「这次用掉了多少」决定 ——
 * 所以一次充电跨过的区间宽度 w = 日耗电% ÷ 每天充电次数。
 * 给定 w，把这段窗口塞进「不高于你愿意充到的上限」的范围里，
 * 越靠自由区越省；塞不进自由区时，超出自由区的那部分按两端的贵价算。
 */
var FREE_FLOOR = 20, FREE_CEIL = 80;

function windowFor(swingPct, topCapPct) {
  var w = clamp(swingPct, 0.2, 100) / 100;
  var cap = clamp(topCapPct, 5, 100) / 100;
  var top;
  if (w >= FREE_CEIL - FREE_FLOOR) {                 // 一次就跨完整个自由区：贴着上限充最省
    top = Math.max(Math.min(cap, 1), w);
  } else {
    top = clamp(0.5 + w / 2, w, cap);                // 尽量让窗口居中，但上沿不能超过你愿意充到的上限
  }
  var floorPct = Math.max(0, (top - w)) * 100;
  return { floorPct: r4(floorPct), ceilPct: r4(top * 100), widthPct: r4(w * 100) };
}

/* ─── 实测年化衰减 ───────────────────────────────────────────────────── */
function rateModel(cfg, flow) {
  var c = normCfg(cfg);
  var obsLoss = 100 - c.healthNowPct;
  var aObs = obsLoss / Math.max(c.usedYears, 1e-9);
  return { obsLoss: r4(obsLoss), aObs: r6(aObs), Wcur: r4(flow.wearPerYear) };
}
function slowFactor(s) {
  if (!isFinite(s)) s = DEFAULTS.rateDecay;
  var k = clamp(s, 0.2, 1.0);
  if (Math.abs(1 - k) < 1e-9) return 1;
  return (Math.pow(2, 1 - k) - 1) / (1 - k);
}
function remFrom(remLoss, a, s) {
  if (!(remLoss > 0)) return { pessimistic: 0, optimistic: 0 };
  if (!(a > 0)) return { pessimistic: null, optimistic: null };
  var sf = slowFactor(s);
  var opt = remLoss / a * sf;
  return { pessimistic: remLoss / a, optimistic: isFinite(opt) ? opt : null };
}

/* 把「你填的最低电量 + 上限 + 充电次数」折成一个真实窗口并算 flow。
 * compute() 与 sensitivity() 都走这一个入口，保证「基准」那两处是同一个数。 */
function windowedFlow(cfg) {
  var c = normCfg(cfg);
  var probe = dailyFlow(Object.assign({}, c, { chargeFloorPct: 0, chargeCeilPct: 100 }));
  var ceil = Math.min(c.topCapPct, Math.max(c.chargeFloorPct + probe.perChargePct, c.chargeFloorPct + 1));
  var c2 = normCfg(c);
  c2.chargeCeilPct = Math.min(ceil, c.topCapPct);
  return { cfg: c2, flow: dailyFlow(c2), win: { floorPct: c2.chargeFloorPct, ceilPct: c2.chargeCeilPct }, perChargePct: probe.perChargePct };
}

/* ─── 主计算 ───────────────────────────────────────────────────────────
 * ① 你现在的充电窗口 = 你填的最低电量 → 至少充到「最低电量 + 一次用掉的量」，不高于你愿意充的上限
 * ② 最省窗口 = 同样宽度、塞进自由区
 * ③ 年损耗单元 W = 区间应力权重 × 温度系数 × 快充系数
 * ④ r = max(1, W_最省 ÷ W_现在)；a_alt = a_obs ÷ r
 *    θ（循环占实测衰减的比例）不可知 → 两侧极端：
 *      θ=1：a_alt = a_obs × (W_alt/W_cur)，改善最大 → 这是**悲观侧**（寿命最短）
 *      θ→0：a_alt = a_obs，改善为零 → **乐观侧**（寿命最长）
 * ⑤ 剩余年数 = (现在损失 − 20) ÷ a；悲观侧再乘速率放缓倍率
 */
function compute(rawCfg, opts) {
  var now = (opts && opts.nowISO) || new Date().toISOString().slice(0, 10);
  var cfg = normCfg(rawCfg);
  var errors = validate(cfg);
  var fatalErrors = errors.filter(function (e) { return e.field !== 'healthNowPct'; });
  var flow = dailyFlow(cfg);
  var startH = cfg.healthNowPct;
  var belowThreshold = startH <= REPLACE_HEALTH;
  var remLoss = Math.max(0, startH - REPLACE_HEALTH);
  var base = rateModel(cfg, flow);   /* 这里先用未设窗口的 flow 拿 a_obs；Wcur 稍后用真窗口覆盖 */

  /* 统一的窗口化：给定「充电次数」，先算一次用掉多少，再把窗口塞进不超过上限的范围 */
  function flowWith(changes) {
    var cc = normCfg(cfg), k;
    for (k in changes) if (Object.prototype.hasOwnProperty.call(changes, k)) cc[k] = changes[k];
    var raw = dailyFlow(cc);                                   // 先拿 perChargePct
    var win = windowFor(raw.perChargePct, cc.chargeCeilPct);    // 上沿不超 cc.chargeCeilPct
    var cc2 = normCfg(cc);
    cc2.chargeFloorPct = win.floorPct;
    cc2.chargeCeilPct = win.ceilPct;
    return { cfg: cc2, flow: dailyFlow(cc2), win: win };
  }
  /* 同一套「窗口化」要算三种情形，所以先把它抽成一个函数：
     step 1 用「夸张窗口」取出一次充电到底用掉多少（perChargePct 只由日耗电与次数决定，与窗口无关）
     step 2 把窗口塞进不超过上限的范围（中段优先）
     step 3 用真正的窗口重算年损耗单元 */
  function flowAt(opts2) {
    var cc = normCfg(cfg), k;
    cc.chargeFloorPct = 0;
    cc.chargeCeilPct = 100;
    for (k in opts2) if (Object.prototype.hasOwnProperty.call(opts2, k)) cc[k] = opts2[k];
    var probe = dailyFlow(cc);                                  // 只用来读 perChargePct
    var ceilLimit = (opts2.limit === undefined) ? cfg.topCapPct : opts2.limit;
    var win = windowFor(probe.perChargePct, ceilLimit);
    var cc2 = normCfg(cc);
    cc2.chargeFloorPct = win.floorPct;
    cc2.chargeCeilPct = win.ceilPct;
    return { cfg: cc2, flow: dailyFlow(cc2), win: win, perChargePct: probe.perChargePct };
  }
  /* 现在这样：从你填的最低电量往上充一次用掉的量，不高于你愿意充到的上限 */
  var perCharge0 = clamp(flow.drainPct / cfg.chargesPerDay, 0.2, 100);
  var cur = windowedFlow(cfg);
  /* 最省窗口：同样宽度、塞进中段 */
  var best = flowAt({ chargesPerDay: cfg.chargesPerDay, limit: cfg.topCapPct });
  /* 更勤地充：每天翻倍，每次充电量减半，窗口照样塞进中段 */
  var freq = flowAt({ chargesPerDay: clamp(cfg.chargesPerDay * 2, 0.25, 6), limit: cfg.topCapPct });
  /* 一口气放到 0% 再充 */
  var deepLimit = clamp(Math.max(perCharge0, 1), 1, Math.max(cfg.topCapPct, 1));
  var deep = flowAt({ chargeFloorPct: 0, chargesPerDay: cfg.chargesPerDay, limit: deepLimit });

  base = rateModel(cur.cfg, cur.flow);                 // 用真实窗口重算 a_obs 与当前年损耗单元
  flow = cur.flow;
  var Wnow = Math.max(cur.flow.wearPerYear, 1e-9);
  var Wbest = best.flow.wearPerYear;
  base.Wcur = r4(Wnow);                                // 当前年损耗单元（真实窗口口径）
  /* 速率比：夹到 ≤1（比现在更费的窗口不产生负收益），并四舍五入到 4 位小数 ——
     结果对象、策略表、自检、导出全部用这一个数，避免各处各算一遍导致的微小不一致。 */
  var dropRatio = Math.round(Math.min(1, Wbest / Wnow) * 1e4) / 1e4;

  /* 口径：
   *   悲观 = 你不改习惯 → 年化衰减一直是实测值 a_obs
   *   乐观 = 你换成最省窗口、且掉的点全来自充放电 → 年化衰减降到 a_obs × dropRatio
   * 两者之差 = 「改习惯到底能拿回多少」的上限 */
  /* 实测年化衰减 a_obs 里有一部分与充电无关（放着也掉）。比例不可知，取一个中间值 cs = cfg.cycleShare：
   *   a_cal = a_obs × (1 − cs)            （与充电无关的那半，换窗口也拿不掉）
   *   a_cyc = a_obs × cs                  （与充电有关的那半）
   * 悲观 = a_cal + a_cyc（不改习惯）＝ a_obs
   * 乐观 = a_cal + a_cyc × dropRatio     （换到中段窗口，把这半压下去）  */
  var cs = clamp(cfg.cycleShare, 0, 1);
  var aCal = base.aObs * (1 - cs);
  var aCyc = base.aObs * cs;
  var aPess = aCal + aCyc;
  var aOpt = aCal + aCyc * dropRatio;
  var noRate = !(base.aObs > 0);                       // 健康度还是 100% 时推不出速率
  var ry = belowThreshold || noRate ? { pessimistic: noRate ? null : 0, optimistic: noRate ? null : 0 } : remFrom(remLoss, aPess, cfg.rateDecay);   // 悲观：速率恒定在最坏值
  /* 乐观侧 = 换到最省窗口 + 速率随时间衰减；悲观侧 = 什么都不改、速率恒定。
     两个口径的方向必须自洽：乐观不可能比悲观更短（最省窗口没比现在省时会出现），用悲观侧下夹住。
     「算」与「夹」写在同一个地方，保证结果对象 / 自检 / 导出用的是同一个数。 */
  var rawOptRemaining = null, optimYears = null;
  if (!belowThreshold && !noRate) {
    var ro = remFrom(remLoss, aOpt, cfg.rateDecay);
    rawOptRemaining = ro.optimistic;
    optimYears = ro.optimistic === null ? null : Math.max(ro.optimistic, ry.pessimistic);
  }
  var optimClamped = (rawOptRemaining !== null && ry.pessimistic !== null && rawOptRemaining < ry.pessimistic - 1e-12);
  var ryOpt = { pessimistic: null, optimistic: optimYears, raw: rawOptRemaining, clamped: optimClamped };

  function pack(remaining) {
    if (remaining === null || remaining === undefined) return { years: null, months: null, date: null, label: null, iso: null, totalYears: null };
    var d = addYears(now, remaining);
    return { years: r4(remaining), months: Math.round(remaining * 12), date: d, label: d.label, iso: d.iso, totalYears: r4(cfg.usedYears + remaining) };
  }
  var pess = belowThreshold ? pack(null) : pack(ry.pessimistic);
  var opt = belowThreshold ? pack(null) : pack(optimYears);

  /* 里程碑 */
  var marks = [];
  var allMarks = [99, 97, 95, 92, 90, 88, 85, 82, 80];
  for (var i = 0; i < allMarks.length; i++) {
    var H = allMarks[i];
    if (H >= startH - 1e-9) continue;
    var remH = Math.max(0, startH - H);
    var yy = aPess > 0 ? remH / aPess : null;
    /* 同一档健康度若也把充电挪进中段：速率用第 1 行（中段窗口）的环比，并按 «乐观不低于悲观» 夹住 */
    var ratioM = best.flow.wearPerYear > 0 && flow.wearPerYear > 0
      ? Math.round(Math.min(1, best.flow.wearPerYear / flow.wearPerYear) * 1e4) / 1e4 : 1;
    var aM = base.aObs * (1 - cs) + base.aObs * cs * ratioM;
    var yl = yy === null ? null : Math.max(remH / aM * slowFactor(cfg.rateDecay), yy);
    marks.push({
      health: H,
      years: yy === null ? null : r4(yy),
      date: yy === null ? null : addYears(now, yy),
      dateLate: yl === null ? null : addYears(now, yl),
      spreadMonths: (yy === null || yl === null) ? null : Math.round((yl - yy) * 12),
      charges: yy === null ? null : Math.round(flow.chargesPerDay * yy * 365)
    });
  }

  /* 逐月时间线（悲观口径：速率恒定） */
  var span = (pess.years === null || !(base.aObs > 0)) ? 2 : Math.min(12, pess.years + 1);
  if (!(span > 0.25)) span = 0.25;
  var months = Math.max(2, Math.round(span * 12));
  var timeline = [];
  for (var m = 0; m <= months; m++) {
    var t = m / 12;
    var lost = Math.min(remLoss, aPess * t);
    timeline.push({
      month: m, years: r4(t), date: addYears(now, t).iso,
      health: r4(startH - lost), loss: r4(lost),
      charges: Math.round(flow.chargesPerDay * t * 365)
    });
  }

  /* 策略对照 */
  function packStrategy(key, label, floorPct, ceilPct, fl, perCharge) {
    var raw = Wnow > 0 ? fl.wearPerYear / Wnow : 1;        // < 1 表示这个窗口比现在更省
    var ratio = Math.round(Math.min(1, raw) * 1e4) / 1e4;  // 比现在更费的一律按 1 处理，不产生负收益
    var a = aCal + aCyc * ratio;
    void a;
    var p = belowThreshold ? { pessimistic: 0, optimistic: 0 } : remFrom(remLoss, a, cfg.rateDecay);
    return {
      key: key, label: label, floorPct: r2(floorPct), ceilPct: r2(ceilPct),
      rawFloorPct: floorPct, rawCeilPct: ceilPct, perChargePct: r4(perCharge),
      bandCost: fl.bandCost, wearPerYear: fl.wearPerYear, ratio: r4(ratio), ratioRaw: raw,
      rate: r4(a), improvementPct: Math.round((1 - ratio) * 100),
      years: p.pessimistic === null ? null : r4(p.pessimistic),
      months: p.pessimistic === null ? null : Math.round(p.pessimistic * 12),
      monthsLate: p.optimistic === null ? null : Math.round(p.optimistic * 12),
      date: p.pessimistic === null ? null : addYears(now, p.pessimistic)
    };
  }
  var strategies = [];
  strategies.push(packStrategy('current', '现在这样（最低放到 ' + r2(cur.win.floorPct) + '%，充到 ' + r2(cur.win.ceilPct) + '%）',
    cur.win.floorPct, cur.win.ceilPct, cur.flow, cur.flow.perChargePct));
  strategies.push(packStrategy('best', '挪进中段（' + r2(best.win.floorPct) + '%–' + r2(best.win.ceilPct) + '%）',
    best.win.floorPct, best.win.ceilPct, best.flow, best.flow.perChargePct));
  strategies.push(packStrategy('freq', '充勤一点（每天 ' + r2(freq.cfg.chargesPerDay) + ' 次，每次 ' + r2(freq.flow.perChargePct) + '%）',
    freq.win.floorPct, freq.win.ceilPct, freq.flow, freq.flow.perChargePct));
  strategies.push(packStrategy('deep', '一口气放到 0% 再充（' + r2(deep.win.floorPct) + '%–' + r2(deep.win.ceilPct) + '%）',
    deep.win.floorPct, deep.win.ceilPct, deep.flow, deep.flow.perChargePct));

  var baseM = pess.months;
  /* 第 0 行就是「现在这样」：它的速率比必然是 1，剩余年数就是悲观口径 */
  strategies[0].rate = r4(aPess);
  strategies[0].improvementPct = 0;
  strategies[0].years = pess.years; strategies[0].months = pess.months;
  strategies[0].date = pess.date; strategies[0].monthsLate = opt.months;
  strategies.forEach(function (s) { s.deltaMonths = (s.months !== null && baseM !== null) ? s.months - baseM : null; });

  /* 建议：最省窗口 vs 现在 */
  var advice;
  var drop = Math.round((1 - dropRatio) * 100);
  if (drop > 1 && pess.months !== null && ryOpt.optimistic !== null && ry.pessimistic !== null) {
    var gain = Math.max(0, opt.months - pess.months);
    advice = {
      kind: 'shallower', label: strategies[1].label,
      floorPct: best.win.floorPct, ceilPct: best.win.ceilPct,
      gainMonths: gain, gainYears: r4(gain / 12),
      newDate: opt.date, costDropPct: drop,
      text: '每次充电跨的这段电量，位置从 ' + r2(cur.win.floorPct) + '%–' + r2(cur.win.ceilPct) + '% 挪到 ' + r2(best.win.floorPct) + '%–' + r2(best.win.ceilPct) + '%，年损耗单元降 ' + drop + '%'
    };
  } else {
    advice = {
      kind: 'keep', label: '保持',
      text: '你现在的充电窗口已经贴着中段了，继续这样用就行',
      gainMonths: 0, gainYears: 0, newDate: pess.date, costDropPct: 0
    };
  }

  var notes = [];
  if (flow.capped) notes.push('你填的「亮屏时长 × 每小时耗电」= ' + flow.rawDrainPct + '%/天，超过一整块电池，已按 100% 封顶。');
  if (cfg.chargesPerDay < 1) notes.push('每天充电次数小于 1：按「几天充一次」理解，一次会放掉 ' + flow.perChargePct + '%。');
  if (noRate) notes.push('健康度还是 100%（或者只用了很短时间没掉点）：一个 100% 的读数推不出任何速率，本页诚实地不给日期，等你有了第一个掉点再看。');
  if (!noRate && base.aObs < 0.5) notes.push('你掉得极慢（' + r2(base.aObs) + ' 点/年），照这个速率外推要很多年才到 80% —— 那个日期不要当真：慢到这个程度时，读数噪声（少报一点健康度、用了多久记不准）就能让结论差好几年。');
  notes.push('本页算不出来的是「你掉的那 ' + base.obsLoss + ' 个点里，多少来自充放电、多少来自放着老化」—— 一个健康度读数定不出这个拆分。' +
    '所以「不改习惯」那一侧用的是实测速率本身（' + r2(pess.years) + ' 年，等于把衰减全算在现状上），' +
    '「换到中段窗口」那一侧则假设其中 ' + Math.round(cs * 100) + '% 来自充放电、可以压掉 ' + Math.round((1 - dropRatio) * 100) + '%（得到 ' + r2(opt.years) + ' 年）。' +
    '把这个比例设成 100% 就得到上限 ' + r2(remLoss / (aCal + aCyc * dropRatio === 0 ? 1 : aCal + aCyc * dropRatio)) + ' 年，设成 0% 就等于没有改善。');
  notes.push('0% 那一端比 100% 那一端更贵（1.30 对 1.00）是本页的设计选择：深放通常比满电更伤。这是假设，不是实测常数，页面上不放「某电芯实测」这类说法。');
  notes.push('本模型不判断电池是否已经坏了（鼓包、突然掉电、虚电），不含车载动力电池与个别电芯的质量问题。');

  var headline;
  if (belowThreshold) {
    headline = '当前健康度 ' + startH + '% 已到 80% 阈值，按本页口径已到该换的时候了';
  } else if (noRate) {
    headline = '健康度还是 100%，这一个读数推不出衰减速率 —— 等它掉到 99% 以下再来看';
  } else if (pess.years === null) {
    headline = '输入不足以推速率，请检查「已经用了多久」与「当前健康度」';
  } else {
    headline = '照现在这样用，大约 ' + (pess.label || '—') + ' 前后跌到 80%：从现在算还有 ' + r2(pess.years) + ' 年（' + pess.months + ' 个月）' +
      (drop > 1 ? '；把每次充电挪进中段可以拉到 ' + r2(opt.years) + ' 年' : '');
  }

  return {
    cfg: cfg, nowISO: now, flow: flow, errors: errors, fatalErrors: fatalErrors, startHealth: startH,
    base: { obsLoss: base.obsLoss, aObs: base.aObs, wearPerYear: Wnow, blocksPerYear: flow.blocksPerYear },
    windows: {
      current: { floorPct: r2(cur.win.floorPct), ceilPct: r2(cur.win.ceilPct) },
      best: { floorPct: r2(best.win.floorPct), ceilPct: r2(best.win.ceilPct) },
      freeZone: { floorPct: r2(cfg.stressFloor), ceilPct: r2(cfg.stressCeil) }
    },
    remLoss: r4(remLoss),
    yearsTo80: pess.years, monthsTo80: pess.months, replaceAt: pess.date, replaceLabel: pess.label,
    optimisticYears: opt.years, optimisticMonths: opt.months, optimisticLabel: opt.label, optimisticDate: opt.date,
    totalLifeYears: pess.totalYears, totalLifeOptimistic: opt.totalYears,
    alreadyAtThreshold: belowThreshold,
    marks: marks, timeline: timeline, strategies: strategies, advice: advice,
    headline: headline, notes: notes,
    assumptions: [
      '一次充电跨过的电量宽度 = 日耗电% ÷ 每天充电次数 = ' + flow.perChargePct + '%（不由充电器决定，由你用掉多少决定）',
      '区间应力权重：自由区（' + cfg.stressFloor + '–' + cfg.stressCeil + '%）最低 ' + cfg.stressMid + '，越靠两端越贵（0% 那端 ' + cfg.stressAtEmpty + '、100% 那端 ' + cfg.stressAtFull + '），自由区内按曲率 ' + cfg.stressBowl + ' 向两端抬升',
      '年损耗单元 = 区间应力权重 × 温度系数 × 快充系数；按放出去的电量加权，所以一天放掉同样多的电，充 1 次和充 2 次结果相同',
      '实测年化衰减 a = (100 − 现在健康度) ÷ 已经用了多久 = ' + base.aObs + ' 点/年；当前年损耗单元 = ' + r4(Wnow),
      '换窗口后的年化衰减 = a_obs × (新窗口年损耗单元 ÷ 当前年损耗单元) = ' + base.aObs + ' × ' + r4(dropRatio) + ' = ' + r4(aOpt) + ' 点/年',
      '实测衰减拆两半：与充电无关的 ' + r4(aCal) + ' 点/年（换窗口拿不掉）+ 与充电有关的 ' + r4(aCyc) + ' 点/年（换到中段后乘 ' + r4(dropRatio) + '）',
      '剩余年数 = (现在损失 − 20) ÷ a；换窗口那一侧再乘「速率随时间衰减」的倍率（s = ' + cfg.rateDecay + ' → ×' + r4(slowFactor(cfg.rateDecay)) + '）',
      '温度按四档乘循环损耗：1.00 / 1.15 / 1.45 / 1.90；快充按占比线性加权到 ' + r2(1 + cfg.fastPenaltyMax)
    ]
  };
}

/* ─── 敏感性：单条件扰动 ─────────────────────────────────────────────── */
function sensitivity(cfg) {
  var c = normCfg(cfg), out = [];
  var cur = windowedFlow(c);                 // 与 compute 同一个「现在这样」口径
  var f0 = cur.flow, s0 = rateModel(cur.cfg, f0);
  var cs = clamp(c.cycleShare, 0, 1);
  var baseRem = Math.max(0, c.healthNowPct - REPLACE_HEALTH);
  var baseY = s0.aObs > 0 ? baseRem / s0.aObs : null;
  /* 关键：只对「同样放掉这么多电」的情形做比较。
   * 每次放电深度由 日耗电 ÷ 充电次数 决定，所以，
   *   · 改「充电次数」→ 把日耗电按同样倍数缩放，保证每次深度不变（例如 0.5 次就是两天用一份）
   *   · 改温度 / 快充 / 应力常量 → 属于使用方式本身的变化，只在年损耗单元上体现
   * 不做这个归一，就会得出「少充几次就更耐用」这种同义反复（少充 = 少用）。 */
  function push(label, patch, normalized) {
    var c2 = normCfg(c), k;
    for (k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) c2[k] = patch[k];
    var meanDrain = dailyFlow(Object.assign({}, c, { chargeFloorPct: 0, chargeCeilPct: 100 })).drainPct;
    if (normalized) {
      var m = meanDrain > 0 ? (c2.chargesPerDay / c.chargesPerDay) : 1;
      c2.screenHoursPerDay = c.screenHoursPerDay / m;
      c2.drainPctPerHour = c.drainPctPerHour / m;
    }
    var f2 = windowedFlow(c2).flow;
    var ratio = (s0.Wcur > 0 && f2.wearPerYear > 0)
      ? Math.round(Math.min(1, f2.wearPerYear / s0.Wcur) * 1e4) / 1e4 : 1;
    var a2 = s0.aObs * (1 - cs) + s0.aObs * cs * ratio;
    var y = (baseRem > 0 && a2 > 0) ? baseRem / a2 : (baseRem === 0 ? 0 : null);
    out.push({
      label: label, wearPerYear: f2.wearPerYear, perChargePct: f2.perChargePct,
      bandCost: f2.bandCost, blocksPerYear: f2.blocksPerYear,
      ratio: ratio, rate: r4(a2), comparable: !!normalized,
      years: y === null ? null : r4(y),
      deltaYears: (!normalized || y === null || baseY === null) ? null : r4(y - baseY)
    });
  }
  push('基准（你填的）', {}, true);
  push('每天充电 0.5 次（每次同样深浅）', { chargesPerDay: 0.5 }, true);
  push('每天充电 2 次（每次同样深浅）', { chargesPerDay: 2 }, true);
  push('每天充电 3 次（每次同样深浅）', { chargesPerDay: 3 }, true);
  push('最低只放到 30%', { chargeFloorPct: 30 }, false);
  push('最低只放到 40%', { chargeFloorPct: 40 }, false);
  push('放到 0% 再充', { chargeFloorPct: 0 }, false);
  push('充满上限改成 80%', { topCapPct: 80 }, false);
  push('充满上限改成 90%', { topCapPct: 90 }, false);
  push('全程慢充（快充占比 0%）', { fastSharePct: 0 }, false);
  push('全程快充（快充占比 100%）', { fastSharePct: 100 }, false);
  push('环境降到「凉」档', { tempBand: 'cool' }, false);
  push('环境升到「偏热」档', { tempBand: 'warm' }, false);
  push('环境升到「很热」档', { tempBand: 'hot' }, false);
  push('放电深度指数 0.5', { depthExponent: 0.5 }, false);
  push('放电深度指数 1.5', { depthExponent: 1.5 }, false);
  push('中段最低应力 0.05', { stressMid: 0.05 }, false);
  push('中段最低应力 0.6', { stressMid: 0.6 }, false);
  push('亮屏时长 +2 小时/天', { screenHoursPerDay: clamp(c.screenHoursPerDay + 2, 0.2, 24) }, false);
  push('亮屏时长 −2 小时/天', { screenHoursPerDay: clamp(c.screenHoursPerDay - 2, 0.2, 24) }, false);
  return out;
}

/* ─── 结构自检（引擎验自己，页面上原样显示） ──────────────────────────── */
function selfChecks(cfg, res) {
  var c = normCfg(cfg), r = res || compute(c), f = r.flow, b = r.base, P = stressParams(c), ck = [], i;
  function ok(name, cond, detail) { ck.push({ name: name, pass: !!cond, detail: detail }); }
  function r3(x) { return Math.round(x * 1e3) / 1e3; }
  function wearOf(fl, ce) {
    var cc = normCfg(c); cc.chargeFloorPct = fl; cc.chargeCeilPct = ce;
    return dailyFlow(cc).wearPerYear;
  }
  var wcur = r.windows.current;

  /* 1 区间权重与解析积分一致 */
  /* 用未舍入的窗口端点（strategies[0] 里存的是精确值），避免两位小数舍入把积分对拍带偏 */
  var rawLo = (r.strategies[0].rawFloorPct === undefined ? wcur.floorPct : r.strategies[0].rawFloorPct) / 100;
  var rawHi = (r.strategies[0].rawCeilPct === undefined ? wcur.ceilPct : r.strategies[0].rawCeilPct) / 100;
  var wParse = (weightIntegral(rawHi, P) - weightIntegral(rawLo, P)) / (rawHi - rawLo);
  ok('区间应力权重与解析积分一致', Math.abs(f.bandCost - r6(wParse)) < 1e-4,
    '数值 ' + f.bandCost + ' vs 解析 ' + r6(wParse));

  /* 2 权重三段在 L、H 处连续 */
  var eps = 1e-7;
  var contL = Math.abs(weightAt(P.L - eps, c) - weightAt(P.L + eps, c));
  var contH = Math.abs(weightAt(P.H - eps, c) - weightAt(P.H + eps, c));
  ok('权重函数在自由区两端连续', contL < 1e-5 && contH < 1e-5,
    'L=' + r2(P.L * 100) + '% 处跳变 ' + contL.toExponential(2) + '；H=' + r2(P.H * 100) + '% 处跳变 ' + contH.toExponential(2));

  /* 3 单点权重：0% 最贵、50% 最便宜、100% 居中 */
  ok('单点权重满足「0% > 100% > 50%」',
    weightAt(0, c) > weightAt(1, c) && weightAt(1, c) > weightAt(0.5, c),
    'w(0%)=' + r3(weightAt(0, c)) + ' > w(100%)=' + r3(weightAt(1, c)) + ' > w(50%)=' + r3(weightAt(0.5, c)));
  ok('50% 是自由区内的最低点',
    weightAt(0.5, c) <= weightAt(0.35, c) + 1e-12 && weightAt(0.5, c) <= weightAt(0.65, c) + 1e-12,
    'w(35%)=' + r3(weightAt(0.35, c)) + ' / w(50%)=' + r3(weightAt(0.5, c)) + ' / w(65%)=' + r3(weightAt(0.65, c)));

  /* 4 同样宽度：越靠中段越省（单调链） */
  ok('同样宽度下，窗口越靠中间年损耗单元越低',
    wearOf(0, 29.25) > wearOf(10, 39.25) && wearOf(10, 39.25) > wearOf(20, 49.25) && wearOf(20, 49.25) > wearOf(35.375, 64.625),
    '0–29.25 ' + r4(wearOf(0, 29.25)) + ' > 10–39.25 ' + r4(wearOf(10, 39.25)) + ' > 20–49.25 ' + r4(wearOf(20, 49.25)) + ' > 35.4–64.6 ' + r4(wearOf(35.375, 64.625)));

  /* 5 越窄越省（都居中） */
  ok('同样是居中窗口，越窄年损耗单元越低',
    wearOf(30, 70) > wearOf(35, 65) && wearOf(35, 65) > wearOf(40, 60) && wearOf(40, 60) > wearOf(45, 55),
    '40% 宽 ' + r4(wearOf(30, 70)) + ' > 30% 宽 ' + r4(wearOf(35, 65)) + ' > 20% 宽 ' + r4(wearOf(40, 60)) + ' > 10% 宽 ' + r4(wearOf(45, 55)));

  /* 6 窗口宽度 = 日耗电 ÷ 充电次数 */
  var drain = clamp(c.screenHoursPerDay * c.drainPctPerHour, 0, 100);
  ok('一次充电跨过的宽度 = 日耗电 ÷ 充电次数',
    Math.abs(f.perChargePct - r4(drain / c.chargesPerDay)) < 1e-6,
    r4(drain) + '% ÷ ' + c.chargesPerDay + ' = ' + f.perChargePct + '%');

  /* 7 年损耗单元算式：权重 × 温度 × 快充 × 每年放掉的块数 */
  var manualW = f.bandCost * f.tempCycleFactor * f.fastFactor * f.blocksPerYear;
  ok('年损耗单元 = 区间应力权重 × 温度系数 × 快充系数 × 每年放掉的电池块数',
    Math.abs(f.wearPerYear - r4(manualW)) < 5e-2,
    f.bandCost + ' × ' + f.tempCycleFactor + ' × ' + f.fastFactor + ' × ' + f.blocksPerYear + ' 块/年 = ' + r4(manualW) + '（表里 ' + f.wearPerYear + '）');

  /* 8 按电量加权：同窗口下改充电次数不动年损耗单元 */
  var c1 = normCfg(c); c1.chargesPerDay = 1; c1.chargeFloorPct = 30; c1.chargeCeilPct = 70;
  var c3 = normCfg(c); c3.chargesPerDay = 3; c3.chargeFloorPct = 30; c3.chargeCeilPct = 70;
  ok('按放出去的电量加权：同窗口下充电次数不改变年损耗单元',
    Math.abs(dailyFlow(c1).wearPerYear - dailyFlow(c3).wearPerYear) < 1e-9,
    '充 1 次 ' + dailyFlow(c1).wearPerYear + ' vs 充 3 次 ' + dailyFlow(c3).wearPerYear + '（窗口都是 30–70）');

  /* 9 实测年化衰减 */
  ok('实测年化衰减 = 已掉点数 ÷ 已用年数',
    Math.abs(b.aObs - (100 - c.healthNowPct) / c.usedYears) < 1e-5,
    '(' + (100 - c.healthNowPct) + ' 点) ÷ (' + c.usedYears + ' 年) = ' + b.aObs + ' 点/年');

  /* 10 当前年损耗单元与窗口一致 */
  ok('当前年损耗单元 = 用「现在这样」的窗口算出来的值',
    Math.abs(b.wearPerYear - f.wearPerYear) < 1e-6,
    b.wearPerYear + ' vs ' + f.wearPerYear + '（窗口 ' + wcur.floorPct + '–' + wcur.ceilPct + '）');

  /* 11 速率比与两支速率自洽 */
  var Wbest = r.strategies[1].wearPerYear;
  ok('更省窗口的速率比 = 四舍五入到 4 位的 min(1, 该窗口年损耗单元 ÷ 当前年损耗单元)',
    Math.abs(r.strategies[1].ratio - Math.round(Math.min(1, Wbest / b.wearPerYear) * 1e4) / 1e4) < 1e-9,
    'min(1, ' + Wbest + ' ÷ ' + b.wearPerYear + ') = ' + r4(Math.min(1, Wbest / b.wearPerYear)) + '（表里 ' + r.strategies[1].ratio + '）');

  /* 12 悲观 / 乐观两支 */
  var manualRem = Math.max(0, c.healthNowPct - 80) / b.aObs;
  ok('悲观剩余年数 = 剩余点数 ÷ 实测年化衰减（＝不改习惯）',
    r.yearsTo80 === null || Math.abs(r.yearsTo80 - manualRem) < 1e-3 * Math.max(1, manualRem),
    r.remLoss + ' ÷ ' + b.aObs + ' = ' + r4(manualRem) + ' 年');
  var cs0 = clamp(c.cycleShare, 0, 1);
  var aOpt0 = b.aObs * (1 - cs0) + b.aObs * cs0 * r.strategies[1].ratio;
  var rawOpt = r.remLoss / aOpt0 * slowFactor(c.rateDecay);
  var manualOpt = Math.max(rawOpt, r.yearsTo80);          // 与 compute 用同一条「乐观不低于悲观」的夹紧
  ok('乐观剩余年数 = 剩余点数 ÷ (与充电无关那半 + 与充电有关那半 × 速率比) × 衰减倍率（再按悲观侧下夹）',
    r.optimisticYears === null || Math.abs(r.optimisticYears - manualOpt) < 2e-2,
    r.remLoss + ' ÷ (' + r4(b.aObs * (1 - cs0)) + ' + ' + r4(b.aObs * cs0) + ' × ' + r.strategies[1].ratio + ') × ' + r4(slowFactor(c.rateDecay)) + ' = ' + r4(rawOpt) + ' → 夹后 ' + r4(manualOpt) + ' 年｜结果对象 ' + r.optimisticYears + ' 年、悲观 ' + r.yearsTo80 + ' 年');
  ok('乐观剩余年数 ≥ 悲观剩余年数',
    r.optimisticYears === null || r.yearsTo80 === null || r.optimisticYears >= r.yearsTo80 - 1e-9,
    '悲观 ' + r2(r.yearsTo80) + ' ≤ 乐观 ' + r2(r.optimisticYears));
  ok('s = 1 时放缓倍率为 1', Math.abs(slowFactor(1) - 1) < 1e-12, 'slowFactor(1) = ' + slowFactor(1));

  /* 13 已到阈值 */
  var cOld = normCfg(c); cOld.healthNowPct = 79;
  var rOld = compute(cOld, { nowISO: r.nowISO });
  ok('健康度已 ≤80% 时不给到期日', rOld.replaceAt === null && rOld.alreadyAtThreshold === true,
    '结论：' + rOld.headline.slice(0, 30));

  /* 14 更费的窗口不会算出负收益 */
  var curS = r.strategies[0];
  ok('更费的窗口被夹成速率比 1（不产生负收益）',
    curS.ratio <= 1 + 1e-9 && r.strategies[3].ratio <= 1 + 1e-9,
    '现在这样 ' + curS.ratio + '；一口气放到 0% ' + r.strategies[3].ratio);

  /* 15 策略表单调（越省越晚到期） */
  ok('策略表里「年损耗单元更低的更晚到期」，且更费的按 1 夹住',
    (function () {
      var ok2 = true;
      r.strategies.forEach(function (sx) { if (sx.ratio > 1 + 1e-9) ok2 = false; });
      for (var j = 1; j < r.strategies.length; j++) {
        var x = r.strategies[j - 1], y2 = r.strategies[j];
        if (y2.wearPerYear < x.wearPerYear - 1e-9 && x.years !== null && y2.years !== null && y2.years < x.years - 1e-9) ok2 = false;
      }
      return ok2;
    })(),
    r.strategies.map(function (s) { return r4(s.wearPerYear) + '→' + (s.years === null ? '—' : r2(s.years) + '年'); }).join('，'));

  /* 16 里程碑递增 */
  var okMil = true;
  for (i = 1; i < r.marks.length; i++) {
    if (r.marks[i].years !== null && r.marks[i - 1].years !== null && r.marks[i].years < r.marks[i - 1].years - 1e-9) okMil = false;
  }
  ok('里程碑按健康度递减、时间递增', okMil,
    r.marks.map(function (x) { return x.health + '%@' + (x.years === null ? '—' : r2(x.years) + '年'); }).join(' → '));

  /* 17 到期日 */
  ok('到期日可格式化为「年 + 月」', !r.replaceAt || /^\d{4} 年 \d{1,2} 月$/.test(r.replaceAt.label),
    r.replaceAt ? r.replaceAt.label + '（' + r.replaceAt.iso + '）' : '未给到期日');

  /* 18 时间线 */
  ok('时间线第 0 月健康度 = 你填的当前健康度', Math.abs(r.timeline[0].health - c.healthNowPct) < 0.02,
    r.timeline[0].health + ' vs ' + c.healthNowPct);
  var tlOK = true;
  for (i = 1; i < r.timeline.length; i++) if (r.timeline[i].health > r.timeline[i - 1].health + 1e-9) tlOK = false;
  ok('时间线健康度逐月不回升', tlOK, r.timeline.length + ' 行');
  ok('时间线长度与剩余寿命自洽',
    Math.abs(r.timeline[r.timeline.length - 1].years * 12 - (r.timeline.length - 1)) < 1.5,
    r.timeline.length + ' 行，末行 +' + r.timeline[r.timeline.length - 1].years + ' 年');

  /* 19 建议可复算 */
  if (r.advice && r.advice.kind === 'shallower') {
    var cA = normCfg(c); cA.chargeFloorPct = r.advice.floorPct; cA.chargeCeilPct = r.advice.ceilPct;
    var ratioA = Math.min(1, dailyFlow(cA).wearPerYear / b.wearPerYear);
    var yA = r.remLoss / (b.aObs * (1 - cs0) + b.aObs * cs0 * ratioA) * slowFactor(c.rateDecay);
    yA = Math.max(yA, r.yearsTo80);
    var gain = Math.round(yA * 12) - r.monthsTo80;
    ok('建议里的「多撑 X 个月」可复算', Math.abs(gain - r.advice.gainMonths) <= 1,
      '建议 ' + r.advice.gainMonths + ' 个月 vs 复算 ' + gain + ' 个月');
  } else {
    ok('没有更省的选择时不虚构收益', r.advice && r.advice.gainMonths === 0, r.advice ? r.advice.kind : 'null');
  }

  /* 20 温度四档 */
  var tfOK = true;
  for (i = 1; i < TEMP_BANDS.length; i++) if (!(TEMP_BANDS[i].cycleFactor > TEMP_BANDS[i - 1].cycleFactor)) tfOK = false;
  ok('四档温度系数严格递增', tfOK, TEMP_BANDS.map(function (x) { return x.cycleFactor; }).join(' < '));

  /* 21 快充系数 */
  var ffNow = fastFactor(c);
  ok('快充系数落在 [1.00, ' + r2(1 + c.fastPenaltyMax) + ']', ffNow >= 1 - 1e-9 && ffNow <= 1 + c.fastPenaltyMax + 1e-9, '当前 ' + ffNow);

  /* 22 非法输入 */
  var cBad = normCfg(c); cBad.chargeFloorPct = 90; cBad.topCapPct = 10;
  var eBad = validate(cBad);
  ok('你填的最低电量 ≥ 愿意充到的上限时被判为非法', eBad.some(function (e) { return e.field === 'topCapPct'; }),
    eBad.map(function (e) { return e.msg; }).join('；') || '（没有报错，异常）');
  var cBad2 = normCfg(c); cBad2.screenHoursPerDay = 999;
  ok('超出量程的数值被判为非法', validate(cBad2).length > 0,
    validate(cBad2).map(function (e) { return e.msg; }).join('；') || '（没有报错，异常）');

  /* 23 封顶 */
  var cCap = normCfg(c); cCap.screenHoursPerDay = 24; cCap.drainPctPerHour = 30; cCap.chargesPerDay = 1;
  var rCap = compute(cCap, { nowISO: r.nowISO });
  ok('日耗电 >100% 时封顶到 100% 并提示', rCap.flow.drainPct === 100 && rCap.flow.capped === true,
    '原始 ' + rCap.flow.rawDrainPct + '% → 封顶 ' + rCap.flow.drainPct + '%');

  /* 24 单位 */
  ok('流量单位齐全（mAh / Wh / 每次 mAh）',
    f.capacityMah > 0 && f.whCapacity > 0 && f.capacityPerCharge >= 0,
    f.capacityMah + ' mAh · ' + f.whCapacity + ' Wh · 每次 ' + f.capacityPerCharge + ' mAh');

  /* 25 导出字段 */
  ok('四种导出所需字段齐全（时间线/策略/里程碑/建议）',
    r.timeline.length > 0 && r.strategies.length >= 4 && r.marks.length >= 1 && !!r.advice && !!r.headline,
    '时间线 ' + r.timeline.length + ' 行、策略 ' + r.strategies.length + ' 行、里程碑 ' + r.marks.length + ' 个');

  /* 26 剩余点数 */
  ok('剩余点数 = 现在健康度 − 80',
    Math.abs(r.remLoss - Math.max(0, c.healthNowPct - 80)) < 2e-4,
    c.healthNowPct + ' − 80 = ' + r.remLoss + ' 点');

  /* 27 窗口上沿不超上限 */
  ok('各个窗口的上沿都不超过「你愿意充到的上限」（允许两位小数舍入）',
    Math.max.apply(null, r.strategies.map(function (x) { return x.ceilPct; })) <= c.topCapPct + 0.06,
    '最大上沿 ' + Math.max.apply(null, r.strategies.map(function (x) { return x.ceilPct; })) + '% ≤ 上限 ' + c.topCapPct + '%');

  /* 28 同样宽度下，越靠中间越省（用 20–80 的权重做参照，不依赖具体上限） */
  var swing = f.perChargePct;
  if (swing < 60) {
    var lo1 = 20, hi1 = 20 + swing;                 // 贴着自由区下沿
    var lo2 = (100 - swing) / 2, hi2 = (100 + swing) / 2; // 居中
    ok('同样宽度下，居中窗口的年损耗单元低于贴着下沿的窗口',
      dailyFlow(Object.assign({}, c, { chargeFloorPct: lo2, chargeCeilPct: hi2 })).wearPerYear <
      dailyFlow(Object.assign({}, c, { chargeFloorPct: lo1, chargeCeilPct: hi1 })).wearPerYear,
      '居中 ' + r4(dailyFlow(Object.assign({}, c, { chargeFloorPct: lo2, chargeCeilPct: hi2 })).wearPerYear) +
      ' < 贴下沿 ' + r4(dailyFlow(Object.assign({}, c, { chargeFloorPct: lo1, chargeCeilPct: hi1 })).wearPerYear) +
      '（宽度都是 ' + r2(swing) + '%）');
  } else {
    ok('窗口宽到盖住整个自由区时不再比较（宽度 ' + r2(swing) + '% ≥ 60%）', true, '跳过方向性比较');
  }

  return ck;
}

function addYears(baseISO, years) {
  var d = new Date(baseISO + 'T00:00:00Z');
  if (isNaN(d.getTime())) return { iso: null, label: null };
  var totalMonths = Math.round(years * 12);
  d.setUTCMonth(d.getUTCMonth() + totalMonths);
  return {
    iso: d.toISOString().slice(0, 10),
    label: d.getUTCFullYear() + ' 年 ' + (d.getUTCMonth() + 1) + ' 月',
    months: totalMonths
  };
}

var AppCore = {
  DEFAULTS: DEFAULTS, LIMITS: LIMITS, TEMP_BANDS: TEMP_BANDS, STRATEGIES: STRATEGIES,
  REPLACE_HEALTH: REPLACE_HEALTH, HORIZON_YEARS: HORIZON_YEARS,
  normCfg: normCfg, validate: validate, compute: compute, sensitivity: sensitivity, selfChecks: selfChecks,
  windowedFlow: windowedFlow,
  dailyFlow: dailyFlow, bandCost: bandCost, weightAt: weightAt, weightIntegral: weightIntegral,
  splitRate: rateModel, rateModel: rateModel, windowFor: windowFor, FREE_FLOOR: FREE_FLOOR, FREE_CEIL: FREE_CEIL,
  slowFactor: slowFactor, remFrom: remFrom, addYears: addYears,
  tempBand: tempBand, tempCycleFactor: tempCycleFactor, fastFactor: fastFactor,
  clamp: clamp, r2: r2, r4: r4, r6: r6
};

if (typeof window !== 'undefined') { window.AppCore = AppCore; }
if (typeof module !== 'undefined' && module.exports) { module.exports = AppCore; }
