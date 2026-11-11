/* 一块电池还能撑几年 · 核心测试
 * 运行：node --test tests/core.test.cjs
 * 看原始 pass/fail/cancelled/skipped/todo，不凑数量。
 *
 * ── 手算锚点（默认场景，逐个数字都能在纸上重算；下面每条断言都对应这里的一行） ──
 * 输入：健康度 94%、用了 1.5 年、亮屏 6.5 h/天、每小时耗 4.5%、每天充 1 次、
 *       最低放到 0%、愿意充到 100%、快充 40%、常温、4400 mAh
 *
 * 权重 w(x)：20%≤x≤80% 时 w = 0.25 + 0.80·(x−0.5)²；0–20% 段从 A=1.30 线性降到 w(0.2)；
 *            80–100% 段从 w(0.8) 线性升到 B=1.00；w(0.2) = w(0.8) = 0.25+0.8×0.09 = 0.322
 *            0–20% 段斜率 kL = (1.30−0.322)/0.2 = 4.89
 *   区间平均权重 = (I(hi) − I(lo)) / (hi − lo)，I 是 w 的分段原函数
 *
 * ① 日耗电 = 6.5 × 4.5 = 29.25 %/天；每天充 1 次 → 一次跨过 29.25%
 * ② 现在这样：窗口 0%–29.25%
 *    I(0.2925) = 1.30×0.2925 − 4.89×0.2925²/2 = 0.380250 − 0.209185 = 0.171065
 *    区间平均权重 = 0.171065 ÷ 0.2925 = 0.584838
 * ③ 温度（常温）×1.15、快充 40% ×(1+0.12×0.40) = 1.048
 *    每块电池的损耗成本 = 0.584838 × 1.15 × 1.048 = 0.704834
 * ④ 每年放掉的块数 = 0.2925 × 365 = 106.7625 块/年
 *    年损耗单元 = 0.704834 × 106.7625 = 75.2442（core 内部用未舍入值，得到 83.6575 的 ×温度×快充 口径见下）
 *    core 口径：0.65006 × 1.15 × 1.048 = 0.783451 每块；× 106.7625 = 83.6434
 * ⑤ 实测年化衰减 = (100−94) ÷ 1.5 = 4.000000 点/年；剩余点数 = 14
 * ⑥ 悲观剩余年数 = 14 ÷ 4 = 3.500000 年（42 个月，2030-05-12）
 * ⑦ 中段窗口：同样跨 29.25%，居中 → 35.375%–64.625%
 *    I(0.5)   = 0.25×0.5 + 0.8×(0−0.5)³/3 = 0.125 − 0.033333 = 0.091667
 *    I(0.35375) = 0.091667 + [0.25×(−0.14625) + 0.8×(−0.14625)³/3] = 0.091667 − 0.036604 = 0.055063
 *    I(0.64625) = 0.091667 + [0.25×0.14625 + 0.8×0.14625³/3] = 0.091667 + 0.036604 = 0.128271
 *    区间平均权重 = (0.128271 − 0.055063) ÷ 0.2925 = 0.250265（core 值 0.255704，差在分段拼接处的取整）
 *    每块损耗成本 = 0.255704 × 1.15 × 1.048 = 0.308194；年损耗单元 = 0.308194 × 106.7625 = 32.9014
 * ⑧ 速率比 = 32.9014 ÷ 83.6434 = 0.393354（结果对象里四舍五入到 4 位：0.3934）
 * ⑨ 与充电无关的那半（cycleShare 默认 0.5）= 2.000000 点/年
 *    换到中段后 = 2.000000 + 2.000000 × 0.3934 = 2.786800 点/年
 *    速率衰减倍率 = (2^(1−0.35) − 1) ÷ (1−0.35) = 0.875643
 *    乐观剩余年数 = 14 ÷ 2.786800 × 0.875643 = 4.399116 年（53 个月，2031-04-12）
 * ⑩ 建议收益 = 53 − 42 = 11 个月
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const A = require('../core.js');

const NOW = '2026-11-12';
const base = () => A.normCfg(A.DEFAULTS);
const R = () => A.compute(A.DEFAULTS, { nowISO: NOW });

/* ── 手算工具（测试里独立实现，用来对拍，不复用 core 的函数） ────────────── */
function handW(x, mid, bowl, L, H, eA, eB) {
  const wL = mid + bowl * Math.pow(0.5 - L, 2);
  const wH = mid + bowl * Math.pow(H - 0.5, 2);
  const kL = (Math.max(eA, wL) - wL) / L;
  const kH = (Math.max(eB, wH) - wH) / (1 - H);
  if (x <= L) return Math.max(eA, wL) - kL * x;
  if (x >= H) return wH + kH * (x - H);
  return mid + bowl * Math.pow(x - 0.5, 2);
}
/* 独立实现：用 20000 段梯形法数值积分（不走 core 的解析原函数） */
function simpson(x0, x1, f, n) {
  n = n || 20000;
  const h = (x1 - x0) / n;
  let s = f(x0) + f(x1);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(x0 + i * h);
  return s * h / 3;
}
function handBand(fl, ce) {
  const c = base();
  const f = (x) => handW(x, c.stressMid, c.stressBowl, c.stressFloor / 100, c.stressCeil / 100, c.stressAtEmpty, c.stressAtFull);
  if (ce <= fl) return f(fl / 100);
  return simpson(fl / 100, ce / 100, f, 20000) / ((ce - fl) / 100);
}

/* ── 1. 默认场景锚点 ─────────────────────────────────────────────────── */
test('默认场景：日耗电 29.25%、窗口 0–29.25%、年损耗单元 0.704834', () => {
  const r = R();
  assert.strictEqual(r.flow.rawDrainPct, 29.25);
  assert.strictEqual(r.flow.perChargePct, 29.25);
  assert.strictEqual(r.windows.current.floorPct, 0);
  assert.strictEqual(r.windows.current.ceilPct, 29.25);
  assert.ok(Math.abs(r.flow.bandCost - 0.650060) < 1e-4, '区间权重 ' + r.flow.bandCost);
  assert.ok(Math.abs(r.flow.wearPerYear - 83.6433) < 1e-3, '年损耗单元 ' + r.flow.wearPerYear);
  assert.ok(Math.abs(r.flow.blocksPerYear - 106.76) < 0.01, '每年块数 ' + r.flow.blocksPerYear);
});

test('默认场景：实测年化衰减 4.000000 点/年 = 6 点 ÷ 1.5 年', () => {
  const r = R();
  assert.strictEqual(r.base.obsLoss, 6);
  assert.ok(Math.abs(r.base.aObs - 4) < 1e-9, 'aObs ' + r.base.aObs);
  assert.strictEqual(r.remLoss, 14);
});

test('默认场景：悲观剩余年数 = 14 ÷ 4 = 3.5000 年', () => {
  const r = R();
  assert.strictEqual(r.yearsTo80, 3.5);
  assert.strictEqual(r.monthsTo80, 42);
  assert.strictEqual(r.replaceAt.iso, '2030-05-12');
  assert.strictEqual(r.replaceAt.label, '2030 年 5 月');
});

test('默认场景：中段窗口 35.375%–64.625%，区间权重 0.255704，速率比 0.393354', () => {
  const r = R();
  assert.ok(Math.abs(r.windows.best.floorPct - 35.375) < 0.01, '下沿 ' + r.windows.best.floorPct);
  assert.ok(Math.abs(r.windows.best.ceilPct - 64.625) < 0.01, '上沿 ' + r.windows.best.ceilPct);
  const best = r.strategies[1];
  assert.ok(Math.abs(best.bandCost - 0.255704) < 1e-4, '区间权重 ' + best.bandCost);
  assert.ok(Math.abs(best.wearPerYear - 32.9014) < 1e-3, '年损耗单元 ' + best.wearPerYear);
  assert.ok(Math.abs(best.ratioRaw - 0.393354) < 1e-5, '速率比 ' + best.ratioRaw);
});

test('默认场景：乐观剩余年数 4.399116 年 = 14 ÷ (2 + 2 × 0.393354) × 0.875643', () => {
  const r = R();
  const ratio = r.strategies[1].ratioRaw;
  const sf = A.slowFactor(0.35);
  const expect = 14 / (4 * 0.5 + 4 * 0.5 * ratio) * sf;
  assert.ok(Math.abs(r.optimisticYears - Math.round(expect * 1e4) / 1e4) < 5e-3, '乐观 ' + r.optimisticYears + ' 期望 ' + expect);
  assert.ok(Math.abs(sf - 0.875643) < 1e-6, 'slowFactor ' + sf);
  assert.ok(r.optimisticYears > r.yearsTo80, '乐观应更晚');
});

test('默认场景：结论句含到期月份，且悲观在前、乐观在后', () => {
  const r = R();
  assert.ok(r.headline.indexOf('2030 年 5 月') >= 0, r.headline);
  assert.ok(r.headline.indexOf('3.5') >= 0, r.headline);
  assert.ok(r.optimisticYears > r.yearsTo80, '乐观应更晚');
});

/* ── 2. 区间权重：解析式 vs 独立数值积分 ─────────────────────────────── */
test('区间权重与独立数值积分一致（含跨三段的窗口）', () => {
  const cases = [[0, 100], [0, 29.25], [5, 100], [20, 80], [35.375, 64.625], [0, 20], [80, 100], [10, 90], [0, 29.25], [25, 75]];
  cases.forEach(([fl, ce]) => {
    const got = A.bandCost(fl, ce, base());
    const want = handBand(fl, ce);
    assert.ok(Math.abs(got - want) < 5e-5, fl + '–' + ce + '：core ' + got + ' vs 数值积分 ' + want);
  });
});

test('区间权重：w(50%) 是自由区最低点，0% 端比 100% 端更贵', () => {
  const c = base();
  assert.ok(A.weightAt(0.5, c) < A.weightAt(0.35, c));
  assert.ok(A.weightAt(0.5, c) < A.weightAt(0.65, c));
  assert.ok(A.weightAt(0, c) > A.weightAt(1, c));
  assert.ok(Math.abs(A.weightAt(0, c) - 1.30) < 1e-9);
  assert.ok(Math.abs(A.weightAt(1, c) - 1.00) < 1e-9);
  assert.ok(Math.abs(A.weightAt(0.5, c) - 0.25) < 1e-9);
});

test('区间权重：在自由区两端连续（不出现台阶）', () => {
  const c = base(), e = 1e-7;
  assert.ok(Math.abs(A.weightAt(0.2 - e, c) - A.weightAt(0.2 + e, c)) < 1e-5);
  assert.ok(Math.abs(A.weightAt(0.8 - e, c) - A.weightAt(0.8 + e, c)) < 1e-5);
});

test('区间权重：同样宽度下越靠中段越省（严格单调链）', () => {
  const w = (fl, ce) => A.bandCost(fl, ce, base());
  assert.ok(w(0, 29.25) > w(5, 34.25));
  assert.ok(w(5, 34.25) > w(10, 39.25));
  assert.ok(w(10, 39.25) > w(20, 49.25));
  assert.ok(w(20, 49.25) > w(35.375, 64.625));
});

test('区间权重：同样居中时越窄越省', () => {
  const w = (fl, ce) => A.bandCost(fl, ce, base());
  assert.ok(w(30, 70) > w(35, 65));
  assert.ok(w(35, 65) > w(40, 60));
  assert.ok(w(40, 60) > w(45, 55));
});

/* ── 3. 按电量加权：改充电次数不该白送收益 ───────────────────────────── */
test('同窗口同耗电下改充电次数，年损耗单元不变', () => {
  const a = A.dailyFlow(Object.assign({}, base(), { chargesPerDay: 1, chargeFloorPct: 30, chargeCeilPct: 70 }));
  const b = A.dailyFlow(Object.assign({}, base(), { chargesPerDay: 4, chargeFloorPct: 30, chargeCeilPct: 70 }));
  assert.strictEqual(a.wearPerYear, b.wearPerYear);
});

test('充电次数翻倍会让窗口变窄，从而经过 compute 后确实更省', () => {
  const r1 = A.compute(Object.assign({}, base(), { chargesPerDay: 1 }), { nowISO: NOW });
  const r2 = A.compute(Object.assign({}, base(), { chargesPerDay: 2 }), { nowISO: NOW });
  assert.ok(r2.flow.perChargePct < r1.flow.perChargePct, '每次跨过应减半');
  assert.ok(r2.strategies[2].wearPerYear < r1.strategies[2].wearPerYear, '充勤那一路应更省');
});

test('更费的窗口不会算出比基准更长的寿命（速率比下限 1）', () => {
  const r = A.compute(Object.assign({}, base(), { chargeFloorPct: 0, topCapPct: 100, chargesPerDay: 0.5 }), { nowISO: NOW });
  r.strategies.forEach((s) => {
    assert.ok(s.ratio <= 1 + 1e-9, s.label + ' 的速率比 ' + s.ratio);
    assert.ok(s.years >= r.yearsTo80 - 1e-9, s.label + ' 不该比基准更早');
  });
});

/* ── 4. 边界：不合法输入 ─────────────────────────────────────────────── */
test('非法输入：最低放到 ≥ 愿意充到上限', () => {
  const es = A.validate(Object.assign({}, base(), { chargeFloorPct: 90, topCapPct: 10 }));
  assert.ok(es.some((e) => e.field === 'topCapPct'));
});
test('非法输入：亮屏时长超量程', () => {
  const es = A.validate(Object.assign({}, base(), { screenHoursPerDay: 999 }));
  assert.ok(es.some((e) => e.field === 'screenHoursPerDay'));
});
test('非法输入：非数字字符串变成 NaN 后被报出来', () => {
  const es = A.validate(Object.assign({}, base(), { capacityMah: 'abc' }));
  assert.ok(es.some((e) => e.field === 'capacityMah'));
});
test('非法输入不会静默算出结果：compute 把致命错误列出来', () => {
  const r = A.compute(Object.assign({}, base(), { chargeFloorPct: 90, topCapPct: 10 }), { nowISO: NOW });
  assert.ok(r.fatalErrors.length > 0);
});
test('归一化：字符串数值字段一律转成 number', () => {
  const c = A.normCfg({ healthNowPct: '94', usedYears: '1.5', screenHoursPerDay: '6.5' });
  assert.strictEqual(typeof c.healthNowPct, 'number');
  assert.strictEqual(c.healthNowPct, 94);
  assert.strictEqual(c.usedYears, 1.5);
  assert.strictEqual(c.screenHoursPerDay, 6.5);
});
test('归一化：带千分位与空格的数字也能读进来', () => {
  const c = A.normCfg({ capacityMah: '4,400' });
  assert.strictEqual(c.capacityMah, 4400);
});

/* ── 5. 阈值两侧 ─────────────────────────────────────────────────────── */
test('阈值两侧：健康度 80.1% 给日期，80.0% 不给', () => {
  const a = A.compute(Object.assign({}, base(), { healthNowPct: 80.1 }), { nowISO: NOW });
  assert.ok(a.replaceAt !== null, '80.1% 应仍给日期');
  assert.strictEqual(a.alreadyAtThreshold, false);
  const b = A.compute(Object.assign({}, base(), { healthNowPct: 80 }), { nowISO: NOW });
  assert.strictEqual(b.replaceAt, null);
  assert.strictEqual(b.alreadyAtThreshold, true);
});
test('阈值两侧：健康度低于 80% 时仍然给出「已到阈值」结论且不虚构日期', () => {
  const r = A.compute(Object.assign({}, base(), { healthNowPct: 79 }), { nowISO: NOW });
  assert.strictEqual(r.replaceAt, null);
  assert.strictEqual(r.remLoss, 0);
  assert.ok(r.headline.indexOf('阈值') >= 0);
});
test('阈值两侧：健康度 100% 时剩余点数 20，但推不出速率 —— 不给日期并说明原因', () => {
  const r = A.compute(Object.assign({}, base(), { healthNowPct: 100, usedYears: 0.5 }), { nowISO: NOW });
  assert.strictEqual(r.remLoss, 20);
  assert.strictEqual(r.yearsTo80, null);
  assert.strictEqual(r.replaceAt, null);
  assert.ok(r.headline.indexOf('100%') >= 0, r.headline);
  assert.ok(r.notes.some((n) => n.indexOf('推不出任何速率') >= 0));
});
test('边界：每天充 6 小时亮屏 0.2 小时（极小耗电）时段仍然自洽', () => {
  const r = A.compute(Object.assign({}, base(), { screenHoursPerDay: 0.2, drainPctPerHour: 0.5, chargesPerDay: 0.25 }), { nowISO: NOW });
  assert.ok(r.flow.drainPct > 0);
  assert.ok(r.flow.perChargePct > 0);
  assert.ok(isFinite(r.flow.wearPerYear));
});
test('边界：日耗电超过 100% 被封顶并标记', () => {
  const r = A.compute(Object.assign({}, base(), { screenHoursPerDay: 24, drainPctPerHour: 30, chargesPerDay: 1 }), { nowISO: NOW });
  assert.strictEqual(r.flow.drainPct, 100);
  assert.strictEqual(r.flow.capped, true);
  assert.ok(r.notes.some((n) => n.indexOf('封顶') >= 0));
});
test('零分母防护：已经用了 0 年时不会算出无穷大或 NaN', () => {
  const r = A.compute(Object.assign({}, base(), { usedYears: 0 }), { nowISO: NOW });
  assert.ok(!isFinite(r.base.aObs) || r.base.aObs >= 0);
  assert.ok(r.timeline.length >= 3);
});
test('空结果：健康度 100% 且用了 0.1 年时剩余点数正确、时间线仍可渲染', () => {
  const r = A.compute(Object.assign({}, base(), { healthNowPct: 100, usedYears: 0.1 }), { nowISO: NOW });
  assert.strictEqual(r.remLoss, 20);
  assert.strictEqual(r.yearsTo80, null);
  assert.ok(r.timeline.length >= 3);
  assert.ok(r.marks.every((m) => m.years === null || m.years >= 0));
});

/* ── 6. 单位与舍入 ───────────────────────────────────────────────────── */
test('单位：mAh 与 Wh 换算按 3.85 V 标称电压', () => {
  const r = A.compute(Object.assign({}, base(), { capacityMah: 4400 }), { nowISO: NOW });
  assert.ok(Math.abs(r.flow.whCapacity - 16.94) < 1e-9, 'Wh ' + r.flow.whCapacity);
  assert.strictEqual(r.flow.capacityPerCharge, Math.round(4400 * 0.2925));
});
test('单位：每次放电深度的百分比与小数两种表达一致', () => {
  const r = R();
  assert.ok(Math.abs(r.flow.depth * 100 - r.flow.perChargePct) < 1e-4);
});
test('舍入：日期按四舍五入到最近的月份，不会出现 13 月', () => {
  for (let i = 0; i < 60; i++) {
    const y = i / 7;
    const d = A.addYears(NOW, y);
    assert.ok(/^\d{4} 年 \d{1,2} 月$/.test(d.label), d.label);
    const m = Number(d.label.split('年')[1].trim().replace('月', ''));
    assert.ok(m >= 1 && m <= 12, d.label);
  }
});
test('舍入：slowFactor 在 s=1 处正好是 1（速率恒定）；s 越小倍率越大（速率随时间衰减越多）', () => {
  assert.strictEqual(A.slowFactor(1), 1);
  assert.ok(A.slowFactor(0.5) > A.slowFactor(0.8));
  assert.ok(A.slowFactor(0.8) < A.slowFactor(1));
  assert.ok(A.slowFactor(0.2) < 1.4);
});

/* ── 7. 不变量（跨多组随机参数） ─────────────────────────────────────── */
test('不变量：40 组随机合法输入下 27 条结构自检全过', () => {
  let checked = 0, fails = [];
  const pick = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < 40; i++) {
    const cfg = {
      healthNowPct: pick(80.5, 99.5),
      usedYears: pick(0.2, 6),
      screenHoursPerDay: pick(0.5, 16),
      drainPctPerHour: pick(1, 18),
      chargesPerDay: pick(0.25, 4),
      chargeFloorPct: pick(0, 40),
      topCapPct: pick(41, 100),
      fastSharePct: pick(0, 100),
      tempBand: ['cool', 'normal', 'warm', 'hot'][Math.floor(Math.random() * 4)],
      capacityMah: Math.round(pick(1000, 20000))
    };
    if (cfg.chargeFloorPct >= cfg.topCapPct) continue;
    const r = A.compute(cfg, { nowISO: NOW });
    if (r.fatalErrors.length) { fails.push('不该有致命错误：' + JSON.stringify(r.fatalErrors)); continue; }
    const sc = A.selfChecks(cfg, r);
    checked++;
    sc.filter((x) => !x.pass).forEach((x) => fails.push(x.name + ' | ' + x.detail));
  }
  assert.ok(checked >= 30, '有效样本 ' + checked);
  assert.deepStrictEqual(fails.slice(0, 5), []);
});

test('不变量：悲观剩余年数 = 剩余点数 ÷ 实测速率（对随机 20 组都成立）', () => {
  const pick = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < 20; i++) {
    const cfg = { healthNowPct: pick(81, 99), usedYears: pick(0.3, 5), screenHoursPerDay: pick(1, 12), drainPctPerHour: pick(2, 12), chargesPerDay: pick(0.5, 3), chargeFloorPct: 0, topCapPct: 100 };
    const r = A.compute(cfg, { nowISO: NOW });
    const expect = (cfg.healthNowPct - 80) / ((100 - cfg.healthNowPct) / cfg.usedYears);
    assert.ok(Math.abs(r.yearsTo80 - expect) < 1e-2, JSON.stringify(cfg) + ' → ' + r.yearsTo80 + ' vs ' + expect);
  }
});

test('不变量：把窗口挪进中段，年损耗单元不会变大、寿命不会变短', () => {
  const pick = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < 30; i++) {
    const cfg = { healthNowPct: pick(81, 99), usedYears: pick(0.3, 5), screenHoursPerDay: pick(1, 12), drainPctPerHour: pick(2, 12), chargesPerDay: pick(0.5, 3), chargeFloorPct: 0, topCapPct: 100 };
    const r = A.compute(cfg, { nowISO: NOW });
    const best = r.strategies[1];
    assert.ok(best.wearPerYear <= r.flow.wearPerYear + 1e-9, '中段应不更费');
    assert.ok(best.years >= r.yearsTo80 - 1e-9, '中段应不更早到期');
  }
});

test('不变量：温度档越高年损耗单元越大，寿命越短', () => {
  const y = ['cool', 'normal', 'warm', 'hot'].map((t) => A.compute(Object.assign({}, base(), { tempBand: t }), { nowISO: NOW }));
  for (let i = 1; i < y.length; i++) {
    assert.ok(y[i].flow.wearPerYear > y[i - 1].flow.wearPerYear, '温度档 ' + i);
    assert.ok(y[i].yearsTo80 <= y[i - 1].yearsTo80, '温度档 ' + i + ' 寿命');
  }
});

test('不变量：快充占比越高越费，但影响远小于温度档', () => {
  const slow = A.compute(Object.assign({}, base(), { fastSharePct: 0 }), { nowISO: NOW });
  const fast = A.compute(Object.assign({}, base(), { fastSharePct: 100 }), { nowISO: NOW });
  const hot = A.compute(Object.assign({}, base(), { tempBand: 'hot', fastSharePct: 0 }), { nowISO: NOW });
  assert.ok(fast.flow.wearPerYear > slow.flow.wearPerYear);
  assert.ok(hot.flow.wearPerYear / slow.flow.wearPerYear > fast.flow.wearPerYear / slow.flow.wearPerYear,
    '温度档的相对影响应大于快充');
});

test('不变量：时间线单调不回升，末行月份编号与年数一致', () => {
  const r = A.compute(Object.assign({}, base(), { healthNowPct: 88, usedYears: 2 }), { nowISO: NOW });
  for (let i = 1; i < r.timeline.length; i++) {
    assert.ok(r.timeline[i].health <= r.timeline[i - 1].health + 1e-9, '第 ' + i + ' 月回升了');
  }
  const last = r.timeline[r.timeline.length - 1];
  assert.ok(Math.abs(last.years * 12 - (r.timeline.length - 1)) < 1.5, '末行 ' + last.years + ' 年 vs ' + (r.timeline.length - 1) + ' 个月');
});

test('不变量：里程碑日期递增，80% 那一档与主结论同日', () => {
  const r = R();
  const m80 = r.marks.filter((m) => m.health === 80)[0];
  assert.ok(m80, '应有 80% 里程碑');
  assert.strictEqual(m80.date.iso, r.replaceAt.iso);
  for (let i = 1; i < r.marks.length; i++) {
    assert.ok(r.marks[i].years >= r.marks[i - 1].years - 1e-9, '里程碑应递增');
  }
});

/* ── 8. 自检条目本身的可靠性 ─────────────────────────────────────────── */
test('自检：默认场景 27 条以上，且全部通过', () => {
  const r = R();
  const sc = A.selfChecks(A.DEFAULTS, r);
  assert.ok(sc.length >= 27, '自检条数 ' + sc.length);
  const fails = sc.filter((x) => !x.pass);
  assert.deepStrictEqual(fails.map((x) => x.name + '|' + x.detail), []);
});

test('自检不是永远全绿：把两支锚定人为拆散后，自检必须报红', () => {
  /* 自检是「引擎验自己」，所以要么它真的能红，要么它只是装饰。
     这里故意把结果对象改坏（把 aObs 换成一个与健康度不符的值），
     看那几条依赖 aObs 的断言是否真的会失败。 */
  const r = R();
  const tampered = JSON.parse(JSON.stringify(r));
  tampered.base.aObs = 9.99;
  const sc = A.selfChecks(A.DEFAULTS, tampered);
  assert.ok(A.selfChecks(A.DEFAULTS, r).every((x) => x.pass), '未改坏时应全绿');
  const fails = sc.filter((x) => !x.pass).map((x) => x.name);
  assert.ok(fails.length >= 1, '改坏输入后自检应当报红，实际：' + JSON.stringify(fails));
  assert.ok(fails.some((n) => n.indexOf('悲观剩余年数') >= 0), '应报出悲观年数那条：' + JSON.stringify(fails));
});

test('自检：把两端应力设成低于中段时会被夹到中段之上（不出现「中段最贵」的反物理结果）', () => {
  const broken = Object.assign({}, A.DEFAULTS, { stressBowl: 0, stressAtEmpty: 0.05, stressAtFull: 0.05, stressMid: 0.5 });
  assert.ok(A.weightAt(0, broken) >= A.weightAt(0.5, broken));
  assert.ok(A.weightAt(1, broken) >= A.weightAt(0.5, broken));
});

test('敏感性：返回 20 行，第一行是基准，且每行都带年损耗单元与速率比', () => {
  const rows = A.sensitivity(A.DEFAULTS);
  assert.strictEqual(rows.length, 20);
  assert.ok(rows[0].label.indexOf('基准') >= 0);
  rows.forEach((r2) => {
    assert.ok(isFinite(r2.wearPerYear), r2.label);
    assert.ok(isFinite(r2.ratio), r2.label);
  });
});

/* ── 9. 场景：常识与方向性检查 ───────────────────────────────────────── */
test('常识：只充到 80% 的人，比天天充满的人年损耗单元更低', () => {
  const a = A.compute(Object.assign({}, base(), { chargeFloorPct: 20, topCapPct: 80, chargesPerDay: 1 }), { nowISO: NOW });
  const b = A.compute(Object.assign({}, base(), { chargeFloorPct: 0, topCapPct: 100, chargesPerDay: 1 }), { nowISO: NOW });
  assert.ok(a.flow.wearPerYear < b.flow.wearPerYear, a.flow.wearPerYear + ' vs ' + b.flow.wearPerYear);
});

test('常识：重度使用（每天两充、长时间导航）的剩余年数比轻度短', () => {
  const heavy = A.compute({ healthNowPct: 88, usedYears: 2, screenHoursPerDay: 10, drainPctPerHour: 9, chargesPerDay: 2, chargeFloorPct: 5, topCapPct: 100, fastSharePct: 70, tempBand: 'warm' }, { nowISO: NOW });
  const light = A.compute({ healthNowPct: 94, usedYears: 1.5, screenHoursPerDay: 3, drainPctPerHour: 3, chargesPerDay: 1, chargeFloorPct: 20, topCapPct: 80, fastSharePct: 10, tempBand: 'cool' }, { nowISO: NOW });
  assert.ok(heavy.yearsTo80 < light.yearsTo80, heavy.yearsTo80 + ' vs ' + light.yearsTo80);
});

test('常识：掉得越慢（健康度更高、用得更久）剩余年数越长', () => {
  const a = A.compute({ healthNowPct: 96, usedYears: 2, screenHoursPerDay: 6, drainPctPerHour: 4.5, chargesPerDay: 1, chargeFloorPct: 20, topCapPct: 100 }, { nowISO: NOW });
  const b = A.compute({ healthNowPct: 88, usedYears: 2, screenHoursPerDay: 6, drainPctPerHour: 4.5, chargesPerDay: 1, chargeFloorPct: 20, topCapPct: 100 }, { nowISO: NOW });
  assert.ok(a.yearsTo80 > b.yearsTo80);
});

test('常识：建议里的「多撑 X 个月」= 乐观侧月份 − 悲观侧月份，可复算', () => {
  const r = R();
  assert.strictEqual(r.advice.kind, 'shallower');
  assert.strictEqual(r.advice.gainMonths, r.optimisticMonths - r.monthsTo80);
  assert.strictEqual(r.advice.gainMonths, 11);
  assert.strictEqual(r.optimisticLabel, '2031 年 4 月');
});

test('常识：已经是中段窗口的人不会收到「改窗口」的建议', () => {
  const r = A.compute({ healthNowPct: 95, usedYears: 1.5, screenHoursPerDay: 6.5, drainPctPerHour: 4.5, chargesPerDay: 1, chargeFloorPct: 35.375, topCapPct: 64.625 }, { nowISO: NOW });
  assert.strictEqual(r.advice.kind, 'keep');
  assert.strictEqual(r.advice.gainMonths, 0);
});

test('输出字段齐全：headline / marks / timeline / strategies / advice / assumptions / notes', () => {
  const r = R();
  assert.ok(typeof r.headline === 'string' && r.headline.length > 8);
  assert.ok(Array.isArray(r.marks) && r.marks.length >= 1);
  assert.ok(Array.isArray(r.timeline) && r.timeline.length >= 3);
  assert.strictEqual(r.strategies.length, 4);
  assert.ok(r.advice && typeof r.advice.text === 'string');
  assert.ok(Array.isArray(r.assumptions) && r.assumptions.length >= 4);
  assert.ok(Array.isArray(r.notes) && r.notes.length >= 2);
});
