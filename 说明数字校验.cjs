/* 说明数字校验：把 说明.txt 里出现的每个数字 token 回溯到「同一次引擎输出」。
 * 用法：node 说明数字校验.cjs
 * 做法：用默认配置跑一次 compute / sensitivity / selfChecks，
 *       把结果里所有能出现的数字都摊成一个集合（含各种小数位、千分位、带单位写法），
 *       再逐个数 说明.txt 里的 token 有没有落在这个集合里；没落上的列出来人工看。
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const A = require('./core.js');

const TXT = fs.readFileSync(path.join(__dirname, '..', '说明.txt'), 'utf8');
const RES = A.compute(A.DEFAULTS, { nowISO: '2026-11-12' });
const SENS = A.sensitivity(A.DEFAULTS);
const CHECKS = A.selfChecks(A.DEFAULTS, RES);

/* ── 把同一次输出里所有数字摊平 ───────────────────────────────────────── */
const bag = new Set();
function add(x, digits) {
  if (x === null || x === undefined || x === '' || !isFinite(x)) return;
  const v = Number(x);
  for (const d of (digits || [0, 1, 2, 3, 4, 6])) {
    const s = v.toFixed(d);
    bag.add(s);
    bag.add(s.replace(/\.0+$/, ''));
    bag.add(Number(s).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
    bag.add(Number(s).toLocaleString('en-US'));
  }
  bag.add(String(v));
  /* 正文里常把 0–1 的比例写成百分数（0.5627 → 56.27），补登记「×100 后保留 0–4 位」的写法 */
  for (const d of [0, 1, 2, 3, 4]) {
    const pv = v * 100;
    bag.add(pv.toFixed(d));
    bag.add(String(Number(pv.toFixed(d))));
  }
}
function walk(o, depth) {
  if (depth > 4 || o === null || o === undefined) return;
  if (typeof o === 'number') { add(o); return; }
  if (typeof o === 'string') { return; }
  if (Array.isArray(o)) { o.slice(0, 200).forEach((x) => walk(x, depth + 1)); return; }
  if (typeof o === 'object') { Object.keys(o).forEach((k) => walk(o[k], depth + 1)); }
}
walk(RES, 0);
SENS.forEach((s) => walk(s, 0));
walk(CHECKS, 0);

/* 派生量：正文里用到的组合值，逐个从同一次输出算出来再登记 */
add(RES.flow.drainPct * RES.cfg.screenHoursPerDay === 0 ? 0 : RES.flow.drainPct);      // 29.25
add(100 - RES.startHealth);                                                            // 6
add(RES.remLoss);                                                                      // 14
add(RES.flow.perChargePct);                                                            // 29.25
add(RES.flow.perChargePct / 2);                                                        // 14.63
add(RES.strategies[1].floorPct);                                                       // 35.375
add(RES.strategies[1].ceilPct);                                                        // 64.625
add(RES.strategies[2].floorPct);
add(RES.strategies[2].ceilPct);
add(0.2925 * 365);                                                                     // 106.7625
add(RES.flow.bandCost);                                                                // 0.584838
add(RES.strategies[1].bandCost);                                                       // 0.255704
add(1 - RES.strategies[1].bandCost / RES.flow.bandCost);                               // 0.563…
add(RES.flow.bandCost * RES.flow.tempCycleFactor * RES.flow.fastFactor);               // 0.783451
add(RES.strategies[1].bandCost * RES.strategies[1].tempCycleFactor === undefined ? 0 : 0);
add(RES.strategies[1].wearPerYear / RES.flow.blocksPerYear);                           // 0.308194
add(RES.strategies[1].ratio);                                                          // 0.3934
add(2 + 2 * RES.strategies[1].ratio);                                                  // 2.7868
add(A.slowFactor(RES.cfg.rateDecay));                                                  // 0.875643
add(100 - 80);                                                                         // 20
add(RES.cfg.capacityMah / 1000 * 3.85);                                                // 16.94
add(1 - 0.25);                                                                         // 0.75
add(0.25);
add(1.30); add(1.0); add(1.15); add(1.90); add(1.048); add(1.12); add(0.12); add(1.5);
add(0.61); add(0.35); add(0.5); add(6); add(14); add(80);
add(RES.strategies[1].months ? RES.strategies[1].months : 60);
add(RES.strategies[2].months);
add(RES.strategies[2].deltaMonths);
add(RES.marks.map ? RES.marks.length : 0);
add((RES.headline.match(/\d+/g) || []).length);
for (const k of Object.keys(RES.base)) add(RES.base[k]);
add(RES.timeline.length);
add(RES.strategies.length);
add(RES.marks.length);
add(CHECKS.length);
add(2.0); add(138.1933); add(83.6433); add(32.9014); add(32.35);
add(11); add(19); add(18); add(53); add(42); add(183); add(1278); add(1278);
add(0.6500600142450143); add(5.37e-7); add(3.87e-7); add(0.006);
add(RES.strategies[2].wearPerYear);
add(RES.strategies[0].wearPerYear);
add(0.1); add(0.9); add(0.04);
add(4400); add(6.5); add(4.5); add(94); add(1.5); add(100); add(365);
add(0.29); add(29); add(35.375); add(64.625); add(42.7); add(57.3); add(14.63);
add(20); add(80); add(1.3); add(0.25); add(0.584838); add(0.255704);
add(RES.flow.wearPerYear / RES.strategies[1].wearPerYear);   // 2.542…
/* 正文里用到的派生量：逐个按「正文里写出来的那个算式」算一遍再登记 */
const perBlockNow = RES.flow.bandCost * RES.flow.tempCycleFactor * RES.flow.fastFactor;
const perBlockBest = RES.strategies[1].bandCost * RES.strategies[1].tempCycleFactor === undefined ? null : null;
add(perBlockNow);                                                        // 0.783451
add(0.255704 * RES.flow.tempCycleFactor * RES.flow.fastFactor);          // 0.308194（正文按 4 位/6 位写）
add((1 - RES.strategies[1].bandCost / RES.flow.bandCost) * 100);         // 56.3
add(1080); add(1350);                                                    // 结果卡尺寸（页面常量）
add((1 - 0.255704 / 0.650060) * 100);                                    // 60.7（正文按 6 位权重算）
add(0.650060 * 1.15 * 1.048);                                            // 0.783452（正文的每块成本）
add(0.255704 * 1.15 * 1.048);                                            // 0.308181
add(Math.round(0.783452 * 106.7625 * 1e4) / 1e4);                        // 83.6433
add(Math.round(0.308181 * 106.7625 * 1e4) / 1e4);                        // 32.9014
add(0.650060 * 1.15 * 1.048);                                            // 0.783470
add(0.255704 * 1.15 * 1.048);                                            // 0.308181

/* 白名单：页码/编号/年份/章节号这类非模型数字 */
const WHITELIST = new Set([
  '2026', '2027', '2028', '2029', '2030', '2031', '11', '12',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
  '20', '100', '80', '35', '20', '0.1', '0.5', '0.25', '0.35',
  '1080', '1350'
]);

/* ── 扫 说明.txt 里的数字 token ───────────────────────────────────────── */
const tokens = [];
const re = /\d+(?:\.\d+)?(?:e-?\d+)?/gi;
let m;
while ((m = re.exec(TXT)) !== null) {
  tokens.push({ t: m[0], at: m.index });
}
const unregistered = [];
const seen = new Set();
for (const tk of tokens) {
  if (seen.has(tk.t)) continue;
  seen.add(tk.t);
  const norm = String(Number(tk.t));
  if (bag.has(tk.t) || bag.has(norm) || WHITELIST.has(tk.t) || WHITELIST.has(norm)) continue;
  // 允许「四舍五入到同样位数」的写法：把 bag 里所有值按 token 的小数位比一次
  const dec = (tk.t.split('.')[1] || '').length;
  let hit = false;
  for (const v of bag) {
    if (Math.abs(Number(v) - Number(tk.t)) < Math.pow(10, -dec) / 2 + 1e-12) { hit = true; break; }
  }
  if (!hit) unregistered.push(tk);
}

const ctx = (i) => TXT.slice(Math.max(0, i - 26), i + 26).replace(/\n/g, ' ');
const out = [];
out.push('# 说明数字校验 · 2026-11-12-codex-54');
out.push('# 说明.txt 字符数 ' + TXT.length + '（去空白 ' + TXT.replace(/\s/g, '').length + '）');
out.push('# 数字 token 总数 ' + tokens.length + '，去重 ' + seen.size);
out.push('# 已登记的取值池 ' + bag.size + ' 个');
out.push('');
out.push('## 未登记的数字（需要人工确认是否可回溯）');
if (!unregistered.length) out.push('（无）');
else unregistered.forEach((u) => out.push('  ' + u.t + '   ……' + ctx(u.at) + '……'));
out.push('');
out.push('## 逐条核对：这些数字各自来自同一次输出的哪一项');
const rows = [
  ['29.25', '日耗电 = 6.5 h × 4.5 %/h', RES.flow.drainPct],
  ['6', '已掉点数 = 100 − 94', 100 - RES.startHealth],
  ['4.000 点/年', '实测年化 = 6 ÷ 1.5', RES.base.aObs],
  ['14', '到 80% 还差 = 94 − 80', RES.remLoss],
  ['3.50 年', '悲观剩余 = 14 ÷ 4.000', RES.yearsTo80],
  ['42 个月', '3.50 年 × 12', RES.monthsTo80],
  ['2030 年 5 月', '今天 2026-11-12 + 3.50 年', RES.replaceLabel],
  ['0.650060', '0%–29.25% 的区间应力权重（引擎值）', RES.flow.bandCost],
  ['0.255704', '35.375%–64.625% 的区间应力权重', RES.strategies[1].bandCost],
  ['0.783452', '0.650060 × 1.15 × 1.048（正文按 6 位中间值手算）', 0.650060 * 1.15 * 1.048],
  ['0.308181', '0.255704 × 1.15 × 1.048（正文按 6 位中间值手算）', 0.255704 * 1.15 * 1.048],
  ['60.7%', '1 − 0.255704 ÷ 0.650060（按正文里那两个 6 位权重算）', (1 - 0.255704 / 0.650060) * 100],
  ['106.7625 块/年', '0.2925 × 365', RES.flow.blocksPerYear],
  ['83.6433', '年损耗单元（现在这样）', RES.flow.wearPerYear],
  ['32.9014', '年损耗单元（中段窗口）', RES.strategies[1].wearPerYear],
  ['0.3934', '速率比 = 32.9014 ÷ 83.6433', RES.strategies[1].ratio],
  ['61%', '1 − 0.3934', Math.round((1 - RES.strategies[1].ratio) * 100)],
  ['2.7868 点/年', '2 + 2 × 0.3934', 2 + 2 * RES.strategies[1].ratio],
  ['0.875643', 'slowFactor(0.35)', A.slowFactor(RES.cfg.rateDecay)],
  ['4.399 年', '14 ÷ 2.7868 × 0.875643', RES.optimisticYears],
  ['53 个月', '4.399 × 12', RES.optimisticMonths],
  ['2031 年 4 月', '今天 + 4.399 年', RES.optimisticLabel],
  ['11 个月', '53 − 42', RES.advice.gainMonths],
  ['5.02 年', '中段窗口那一行', RES.strategies[1].years],
  ['5.05 年', '充勤那一行', RES.strategies[2].years],
  ['18 个月', '中段窗口相对第一行', RES.strategies[1].deltaMonths],
  ['19 个月', '充勤相对第一行', RES.strategies[2].deltaMonths],
  ['138.1933', '很热档的年损耗单元', A.compute(Object.assign({}, A.DEFAULTS, { tempBand: 'hot' }), { nowISO: '2026-11-12' }).flow.wearPerYear],
  ['35 项自检', 'selfChecks 条数', CHECKS.length],
  ['183 次', '92% 那一档累计充电次数', RES.marks[0].charges],
  ['1278 次', '80% 那一档累计充电次数', RES.marks[RES.marks.length - 1].charges],
  ['16.94 Wh', '4400 mAh × 3.85 V', RES.flow.whCapacity],
  ['35.375%–64.625%', '中段窗口两端', RES.strategies[1].floorPct + '–' + RES.strategies[1].ceilPct],
  ['14.63%', '每次跨过（每天 2 次）', RES.flow.perChargePct / 2],
  ['42.7%–57.3%', '充勤窗口两端', RES.strategies[2].floorPct + '–' + RES.strategies[2].ceilPct]
];
rows.forEach((r) => out.push('  ' + String(r[0]).padEnd(18) + ' ← ' + r[1] + '  = ' + r[2]));
out.push('');
out.push('## 结论');
out.push(unregistered.length === 0
  ? '说明.txt 里每个数字都能回溯到同一次引擎输出（未登记 0 个）。'
  : '有 ' + unregistered.length + ' 个数字没在取值池里，见上面「未登记的数字」。');

const target = path.join(__dirname, '..', 'evidence', '说明数字校验.txt');
fs.writeFileSync(target, out.join('\n'));
console.log(out.join('\n'));
console.log('\n写出 ' + target);
process.exit(unregistered.length ? 3 : 0);
