/* 批次 54 浏览器验收脚本：一块电池还能撑几年
 * 用法：先启动带 --download-path 的会话，再 node 验收脚本.cjs [--tag 本地|线上] [--url ...]
 *   agent-browser --profile $PROF --session codex54 --download-path /tmp/bc54-dl open <url>
 * 断言全部走真实 DOM 事件；控制台先自证采集器有效再清零；四种下载真实点击并核对落盘。
 */
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');   // 批次目录（evidence 在批次目录下）
const AB = '/Users/xululu/.workbuddy/binaries/node/versions/22.22.2-6/bin/agent-browser';
const SESSION = process.env.B54_SESSION || 'codex54';
const TAG = (process.argv.indexOf('--tag') >= 0 ? process.argv[process.argv.indexOf('--tag') + 1] : '') || '本地';
const DL = process.env.B54_DL || '/tmp/bc54-dl';
const URL_ARG = (process.argv.indexOf('--url') >= 0 ? process.argv[process.argv.indexOf('--url') + 1] : '');
const APP_URL = URL_ARG || 'http://127.0.0.1:8917/index.html';
const OUT = path.join(ROOT, 'evidence', '浏览器验收结果-' + TAG + '.txt');
const SUM = path.join(ROOT, 'evidence', '浏览器验收摘要-' + TAG + '.json');

let lines = [];
let pass = 0, fail = 0, evals = 0;
const groups = {};
let curGroup = 'G0';
function group(name) { curGroup = name; groups[name] = groups[name] || { pass: 0, fail: 0 }; }
function ok(cond, label, extra) {
  if (cond) { pass++; groups[curGroup].pass++; lines.push('PASS  [' + curGroup + '] ' + label + (extra ? '  :: ' + extra : '')); }
  else { fail++; groups[curGroup].fail++; lines.push('FAIL  [' + curGroup + '] ' + label + (extra ? '  :: ' + extra : '')); }
}
function note(t) { lines.push('      ' + t); }
function asObj(v) { if (v && typeof v === 'object') return v; if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return {}; } } return {}; }

function ev(js) {
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    evals++;
    try {
      const raw = execFileSync(AB, ['--session', SESSION, '--json', 'eval', js],
        { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 180000 });
      const last = raw.trim().split('\n').filter(Boolean).pop();
      const o = JSON.parse(last);
      if (!o.success) throw new Error('eval 失败: ' + JSON.stringify(o.error));
      let r = o.data && ('result' in o.data ? o.data.result : o.data);
      while (typeof r === 'string') {
        const t = r.trim();
        if (!(t.charAt(0) === '{' || t.charAt(0) === '[')) break;
        try { const n = JSON.parse(r); if (n === r) break; r = n; } catch (e) { break; }
      }
      return r;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
function cli(args) {
  return execFileSync(AB, ['--session', SESSION].concat(args), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
}
/* agent-browser 的视口命令是 `set viewport <w> <h>`（不是 `--window-size`）。 */
function launchAt(w, h) {
  return cli(['set', 'viewport', String(w), String(h)]);
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* 采集器自证：先制造一条 warn 与一条 error，确认能记到，再清零 */
const ARM = `(()=>{window.__errs=window.__errs||[];window.__warns=window.__warns||[];
  if(!window.__armed){
    window.__armed=1;
    window.addEventListener('error',function(e){window.__errs.push(String(e.message));});
    window.addEventListener('unhandledrejection',function(e){window.__errs.push('rej:'+String(e.reason));});
    var ow=console.warn,oe=console.error;
    console.warn=function(){window.__warns.push([].slice.call(arguments).join(' '));ow.apply(console,arguments);};
    console.error=function(){window.__errs.push([].slice.call(arguments).join(' '));oe.apply(console,arguments);};
  }
  return 'armed';})()`;
const PROBE_ARMED = `(()=>{var w0=window.__warns.length,e0=window.__errs.length;
  console.warn('采集器自证-warn');console.error('采集器自证-error');
  var w=window.__warns.length-w0,e=window.__errs.length-e0;
  window.__warns.length=0;window.__errs.length=0;
  return JSON.stringify({w:w,e:e});})()`;
const PROBE_CLEAN = `(()=>{return JSON.stringify({errs:window.__errs.slice(),warns:window.__warns.slice()});})()`;

function reopen(url) { cli(['open', url]); return ev(ARM); }

const REAL_CLICK = `function realClick(el){
  if(!el) return 'no-el';
  el.scrollIntoView({block:'center'});
  var r=el.getBoundingClientRect();
  var opts={bubbles:true,cancelable:true,composed:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,view:window};
  ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(function(t){
    var E = (t.indexOf('pointer')===0 && window.PointerEvent) ? PointerEvent : MouseEvent;
    el.dispatchEvent(new E(t,opts));
  });
  return 'clicked';
}`;
function clickSel(sel) { return ev('(()=>{' + REAL_CLICK + ';var el=document.querySelector(' + JSON.stringify(sel) + ');return realClick(el);})()'); }
function setVal(sel, val) {
  return ev(`(()=>{var el=document.querySelector(${JSON.stringify(sel)});if(!el)return 'no-el';
    el.value=${JSON.stringify(String(val))};
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    return el.value;})()`);
}
function clickText(sel, text) {
  /* 用「包含」匹配：按钮文案里有 – ℃ 这类字符，逐字相等太脆（本轮踩到） */
  return ev(`(()=>{${REAL_CLICK};var els=[].slice.call(document.querySelectorAll(${JSON.stringify(sel)}));
    var t=${JSON.stringify(text)};
    var el=els.filter(function(e){return e.textContent.indexOf(t)>=0;})[0];
    if(!el) return 'no-el'; return realClick(el);})()`);
}

function readState() {
  return asObj(ev(`(()=>{return JSON.stringify({
    verdict:document.getElementById('v-title').textContent,
    why:document.getElementById('v-why').textContent,
    kpis:[].slice.call(document.querySelectorAll('#kpis .ro')).map(function(d){
      return [d.querySelector('.l').textContent,d.querySelector('.v').textContent,d.querySelector('.s')?d.querySelector('.s').textContent:''].join('|');}),
    mileRows:document.querySelectorAll('#mile-body tr').length,
    mileText:[].slice.call(document.querySelectorAll('#mile-body tr')).map(function(tr){return tr.innerText.replace(/\\s+/g,' ').trim();}),
    chk:document.querySelectorAll('#sc-body .chk').length,
    chkFail:document.querySelectorAll('#sc-body .chk.fail').length,
    chkPass:document.querySelectorAll('#sc-body .chk.pass').length,
    scCount:document.getElementById('sc-count').textContent,
    adv:document.querySelectorAll('#advice-body .adv').length,
    advBtns:document.querySelectorAll('#advice-body .btn').length,
    stratCards:document.querySelectorAll('#strat .sc').length,
    stratText:[].slice.call(document.querySelectorAll('#strat .sc')).map(function(d){return d.innerText.replace(/\\s+/g,' ').trim();}),
    stratBars:[].slice.call(document.querySelectorAll('#strat .bar i')).map(function(i){return i.style.width;}),
    sensRows:document.querySelectorAll('#sens-body tr').length,
    sensText:[].slice.call(document.querySelectorAll('#sens-body tr')).map(function(tr){return tr.innerText.replace(/\\s+/g,' ').trim();}),
    markCount:document.querySelectorAll('#chart polyline').length,
    chartDots:document.querySelectorAll('#chart circle').length,
    chartTexts:document.querySelectorAll('#chart text').length,
    svgW:document.getElementById('chart').getBoundingClientRect().width,
    errShown:!document.getElementById('sec-err').classList.contains('hidden'),
    errText:document.getElementById('sec-err').textContent.replace(/\\s+/g,' ').trim(),
    badFields:[].slice.call(document.querySelectorAll('.bad')).map(function(e){return e.getAttribute('data-k');}),
    notes:document.querySelectorAll('#notes li').length,
    kv:document.querySelectorAll('#assumptions li').length,
    fb:{years:document.getElementById('fb-years').textContent,wear:document.getElementById('fb-wear').textContent,
        drain:document.getElementById('fb-drain').textContent,sc:document.getElementById('fb-sc').textContent},
    inputs:(function(){var o={};['healthNowPct','usedYears','screenHoursPerDay','drainPctPerHour','chargesPerDay',
      'chargeFloorPct','topCapPct','fastSharePct','capacityMah','label'].forEach(function(k){var e=document.getElementById('f-'+k);o[k]=e?e.value:null;});return o;})(),
    chipTemp:[].slice.call(document.querySelectorAll('#chips-tempBand .chip')).map(function(c){return [c.textContent.trim(),c.getAttribute('aria-pressed')];}),
    scenarios:document.querySelectorAll('#scenarios .chip').length,
    docW:document.documentElement.scrollWidth, winW:window.innerWidth,
    bodyOverflow:document.body.scrollWidth>window.innerWidth+1
  });})()`));
}

(async () => {
  fs.mkdirSync(path.join(ROOT, 'evidence'), { recursive: true });
  const startedAt = new Date().toISOString();
  lines.push('# 批次 54 浏览器验收 · ' + TAG + ' · ' + startedAt);
  lines.push('# URL ' + APP_URL + ' · 会话 ' + SESSION + ' · 下载目录 ' + DL);
  lines.push('');

  /* ── G0 采集器自检 ─────────────────────────────────────────────── */
  group('G0 采集器自检');
  /* --download-path 只在守护进程启动时生效，所以这里先 close --all 再带参数起一次 */
  execFileSync(AB, ['close', '--all'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 120000 });
  await sleep(1000);
  execFileSync(AB, ['--profile', process.env.B54_PROFILE || '/Users/xululu/.agent-browser/zhihu-profile',
    '--session', SESSION, '--download-path', DL, 'open', APP_URL],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 180000 });
  await sleep(1500);
  await ev(ARM);
  const probe = asObj(ev(PROBE_ARMED));
  ok(probe.w === 1 && probe.e === 1, '故意制造的 1 条 warn + 1 条 error 都被采集器记到（不是永远为空）', JSON.stringify(probe));
  const clean0 = asObj(ev(PROBE_CLEAN));
  ok(clean0.errs.length === 0 && clean0.warns.length === 0, '清零后页面自身 0 错 0 警', JSON.stringify(clean0));

  /* ── G1 默认场景渲染 ───────────────────────────────────────────── */
  group('G1 默认渲染与锚点');
  let st = readState();
  ok(st.verdict.indexOf('2030 年 5 月') >= 0, '结论句含到期月份 2030 年 5 月', st.verdict);
  ok(st.verdict.indexOf('3.5') >= 0, '结论句含 3.5 年', st.verdict.slice(0, 70));
  ok(st.kpis.length === 6, '读数条 6 格', String(st.kpis.length));
  const kpiAll = st.kpis.join(' § ');
  ok(kpiAll.indexOf('14 点') >= 0, '读数条里「还差 14 点」', kpiAll.slice(0, 90));
  ok(kpiAll.indexOf('4.000') >= 0 || kpiAll.indexOf('4.00') >= 0, '读数条里实测年化 4.000 点/年', kpiAll.slice(0, 140));
  ok(st.inputs.healthNowPct === '94', '健康度输入框 = 94', st.inputs.healthNowPct);
  ok(st.inputs.usedYears === '1.5', '用了多久输入框 = 1.5', st.inputs.usedYears);
  ok(st.inputs.chargeFloorPct === '0', '最低放到输入框 = 0', st.inputs.chargeFloorPct);
  ok(st.inputs.topCapPct === '100', '愿意充到的上限输入框 = 100', st.inputs.topCapPct);
  ok(st.mileRows === 6, '里程表 6 行（92/90/88/85/82/80）', String(st.mileRows));
  ok(st.mileText[st.mileText.length - 1].indexOf('80%') >= 0, '里程表最后一行是 80%', st.mileText[st.mileText.length - 1]);
  ok(st.mileText[0].indexOf('2027 年 5 月') >= 0, '92% 那一档日期 2027 年 5 月', st.mileText[0]);
  ok(st.stratCards === 4, '策略卡 4 张', String(st.stratCards));
  ok(st.stratText[0].indexOf('现在这样') >= 0, '第 1 张策略卡是「现在这样」', st.stratText[0].slice(0, 40));
  ok(st.stratText.some(function (t) { return t.indexOf('35.4') >= 0 || t.indexOf('35.38') >= 0; }), '策略表里出现中段窗口 35.38%（未截断）', st.stratText[1].slice(0, 80));
  ok(st.stratBars.length === 4 && st.stratBars[0] === '100%', '4 条对比条，第 1 条满宽', JSON.stringify(st.stratBars));
  ok(st.sensRows === 20, '敏感性 20 行', String(st.sensRows));
  const sensBase = asObj(ev(`(()=>{var t=document.querySelectorAll('#sens-body tr')[0];
    return JSON.stringify({txt:t.innerText.replace(/\\s+/g,' ').trim(), wear:window.__app.result().flow.wearPerYear});})()`));
  ok(sensBase.txt.indexOf(Number(sensBase.wear).toFixed(2)) >= 0, '敏感性第 1 行的年损耗单元与结论区同源（同一位小数）', sensBase.txt.slice(0, 60) + ' / ' + sensBase.wear);
  ok(st.sensText.filter(function (t) { return t.indexOf('—') > 0; }).length === 16, '16 行非归一项明确留空（不给假的「比基准晚」）',
    String(st.sensText.filter(function (t) { return t.indexOf('—') > 0; }).length));
  ok(st.chk > 0 && st.chkFail === 0, '结构自检全部通过（0 条 FAIL）', st.scCount);
  ok(st.scCount.indexOf(String(st.chk)) >= 0, '自检计数文案与条目数一致', st.scCount);
  ok(st.notes >= 3, '模型边界至少 3 条', String(st.notes));
  ok(st.kv >= 5, '模型常量至少 5 条', String(st.kv));
  ok(st.adv >= 2, '建议区至少 2 块', String(st.adv));
  ok(st.advBtns >= 3, '建议区至少 3 个可点按钮', String(st.advBtns));
  ok(!st.errShown, '初始没有错误区', st.errText);
  const uniqRates = asObj(ev(`(()=>{var r=window.__app.result();var s=[];
    r.strategies.forEach(function(x){if(!s.some(function(y){return Math.abs(y-x.rate)<1e-6;}))s.push(x.rate);});
    return JSON.stringify({uniq:s.length, cards:r.strategies.length});})()`));
  ok(st.markCount === uniqRates.uniq, '周线图条数 = 速率互不相同的策略数（重合的不重复画）', st.markCount + ' vs ' + uniqRates.uniq);
  ok(uniqRates.cards === 4 && uniqRates.uniq >= 2, '策略表仍是 4 张卡，图上线至少 2 条', JSON.stringify(uniqRates));
  ok(st.chartDots === 4, '周线图 4 个终点圆点（每个策略都标出终点）', String(st.chartDots));
  ok(st.chartTexts >= 10, '周线图有刻度与端点文字', String(st.chartTexts));
  ok(st.scenarios === 6, '6 个内置场景', String(st.scenarios));
  ok(st.chipTemp.length === 4 && st.chipTemp.filter(function (c) { return c[1] === 'true'; }).length === 1, '温度 4 档、恰有 1 档选中', JSON.stringify(st.chipTemp));
  ok(st.fb.sc === st.chk + '/' + st.chk, '底栏自检计数与自检区一致', st.fb.sc);
  ok(st.fb.years === '3.50 年', '底栏年限 3.50 年', st.fb.years);

  /* ── G1b 周线图几何（纯函数，可逐点核对） ─────────────────────── */
  group('G1b 周线图几何');
  const geo = asObj(ev(`(()=>{var c=window.__chart;if(!c)return JSON.stringify({missing:true});
    var A=window.AppCore;var r=window.__app.result();
    return JSON.stringify({
      missing:false,
      maxYears:c.maxYears,
      y80:c.yOfHealth(80), y100:c.yOfHealth(100), y76:c.yOfHealth(76),
      x0:c.xOfYears(0,c.maxYears), xMax:c.xOfYears(c.maxYears,c.maxYears),
      bottom:c.CHART.bottom, top:c.CHART.top, left:c.CHART.left, right:c.CHART.right,
      optim:c.xOfYears(r.optimisticYears,c.maxYears>0?c.maxYears:1),
      expectX0:c.CHART.left, width:c.CHART.right-c.CHART.left
    });})()`));
  ok(!geo.missing, '页面暴露了 __chart 几何函数（便于核对坐标）', JSON.stringify(geo).slice(0, 80));
  ok(Math.abs(geo.y76 - geo.bottom) < 0.001, 'y(76%) 落在图底（纵轴下界 76%）', geo.y76 + ' vs ' + geo.bottom);
  ok(Math.abs(geo.y100 - geo.top) < 0.001, 'y(100%) 落在图顶', geo.y100 + ' vs ' + geo.top);
  ok(Math.abs(geo.y80 - (geo.bottom - (80 - 76) / (100 - 76) * (geo.bottom - geo.top))) < 0.001,
    'y(80%) 按线性刻度落在 76%–100% 之间', geo.y80 + ' vs 解析 ' + (geo.bottom - (80 - 76) / (100 - 76) * (geo.bottom - geo.top)));
  ok(geo.y76 > geo.y80 && geo.y80 > geo.y100, 'y 轴方向正确（健康度越高越靠上）', [geo.y76, geo.y80, geo.y100].join(' > '));
  ok(Math.abs(geo.x0 - geo.left) < 0.001, 'x(0 年) 落在左边界', geo.x0 + ' vs ' + geo.left);
  ok(Math.abs(geo.xMax - geo.right) < 0.001, 'x(最大值) 落在右边界', geo.xMax + ' vs ' + geo.right);
  ok(geo.optim > geo.left && geo.optim < geo.right, '乐观到期点落在图内', String(geo.optim));
  ok(geo.maxYears >= 3, '横轴至少覆盖 3 年（能容下悲观 3.5 年）', String(geo.maxYears));

  /* ── G2 改条件立即重算 ─────────────────────────────────────────── */
  group('G2 改条件与交互');
  await setVal('#f-healthNowPct', '86');
  st = readState();
  ok(st.inputs.healthNowPct === '86', '改健康度 94→86 写入成功', st.inputs.healthNowPct);
  ok(st.verdict !== '' && st.verdict.indexOf('—') < 0, '改健康度后结论重算（不是占位符）', st.verdict.slice(0, 50));
  const v86 = st.verdict;
  ok(v86 !== '照现在这样用，大约 2030 年 5 月 前后跌到 80%：从现在算还有 3.5 年（42 个月）；把每次充电挪进中段可以拉到 4.4 年', '结论确实变了', v86);
  await setVal('#f-healthNowPct', '94');
  st = readState();
  ok(st.verdict.indexOf('2030 年 5 月') >= 0, '改回 94 后结论恢复 2030 年 5 月', st.verdict.slice(0, 40));

  await setVal('#f-usedYears', '3');
  st = readState();
  ok(st.verdict.indexOf('3.5 年') < 0 || st.verdict.indexOf('2') >= 0, '改「用了多久」后年数跟着变', st.verdict.slice(0, 60));
  await setVal('#f-usedYears', '1.5');

  await setVal('#f-chargesPerDay', '2');
  st = readState();
  ok(st.stratText.some(function (t) { return t.indexOf('14.63') >= 0 || t.indexOf('14.6') >= 0; }), '充电次数改 2 次后，每次跨过约 14.6%', st.stratText[2].slice(0, 90));
  await setVal('#f-chargesPerDay', '1');

  await clickText('#chips-tempBand .chip', '很热（常年 32 ℃ 以上 / 长期晒着充电）');
  st = readState();
  ok(st.chipTemp.filter(function (c) { return c[1] === 'true'; })[0][0].indexOf('很热') >= 0, '温度切到「很热」档', JSON.stringify(st.chipTemp));
  const hotVerdict = st.verdict;
  ok(hotVerdict !== v86, '换温度档后结论变化', hotVerdict.slice(0, 40));
  await clickText('#chips-tempBand .chip', '常温（大部分时间 20–28 ℃）');
  st = readState();
  ok(st.verdict.indexOf('2030 年 5 月') >= 0, '温度切回常温后恢复', st.verdict.slice(0, 40));

  /* 建议按钮：把窗口写回输入并重算 */
  const beforeAdv = readState();
  await clickText('#advice-body .btn', '按这个区间算一遍（写回输入）');
  st = readState();
  ok(st.inputs.chargeFloorPct === '35.375' || st.inputs.chargeFloorPct === '35.38', '点建议按钮后最低放到被写成 35.375', st.inputs.chargeFloorPct);
  ok(st.inputs.topCapPct === '64.625' || st.inputs.topCapPct === '64.63', '点建议按钮后上限被写成 64.625', st.inputs.topCapPct);
  ok(st.verdict !== beforeAdv.verdict, '写回后结论立即重算', st.verdict.slice(0, 50));
  ok(st.stratText[0].indexOf('35.375') >= 0 || st.stratText[0].indexOf('35.38') >= 0, '策略表第 1 行跟着变成新窗口', st.stratText[0].slice(0, 80));

  /* 场景一键套用 */
  await clickText('#scenarios .chip', '已经到 79%（该换了）');
  st = readState();
  ok(st.inputs.healthNowPct === '79', '场景「已经到 79%」套用成功', st.inputs.healthNowPct);
  ok(st.verdict.indexOf('阈值') >= 0, '79% 时结论说已到阈值', st.verdict.slice(0, 40));
  await clickText('#scenarios .chip', '手机用了一年半（默认）');
  st = readState();
  ok(st.inputs.healthNowPct === '94' && st.inputs.usedYears === '1.5', '默认场景一键恢复', st.inputs.healthNowPct + '/' + st.inputs.usedYears);

  /* ── G3 异常与非法输入 ─────────────────────────────────────────── */
  group('G3 非法输入');
  await setVal('#f-chargeFloorPct', '90');
  await setVal('#f-topCapPct', '10');
  st = readState();
  ok(st.errShown, '低点 ≥ 上限时错误区出现', st.errText.slice(0, 60));
  ok(st.errText.indexOf('必须高于') >= 0, '错误文案说明原因', st.errText.slice(0, 80));
  ok(st.badFields.indexOf('topCapPct') >= 0, '出错字段被标红', JSON.stringify(st.badFields));
  const errVerdict = st.verdict;

  await setVal('#f-screenHoursPerDay', '999');
  st = readState();
  ok(st.errShown && st.errText.indexOf('亮屏时长') >= 0, '超量程数值被指名报错', st.errText.slice(0, 90));

  await setVal('#f-screenHoursPerDay', '');
  st = readState();
  ok(st.errShown && st.errText.indexOf('亮屏时长') >= 0, '清空必填数字也被报出来（不是静默用默认值）', st.errText.slice(0, 90));

  await setVal('#f-screenHoursPerDay', 'abc');
  st = readState();
  ok(st.errShown, '填非数字也被报出来', st.errText.slice(0, 80));

  /* 恢复到合法 */
  await setVal('#f-screenHoursPerDay', '6.5');
  await setVal('#f-chargeFloorPct', '0');
  await setVal('#f-topCapPct', '100');
  st = readState();
  ok(!st.errShown, '恢复合法输入后错误区收起', st.errText);
  ok(st.badFields.length === 0, '恢复后没有标红字段', JSON.stringify(st.badFields));
  ok(st.verdict.indexOf('2030 年 5 月') >= 0, '恢复后结论回到默认锚点', st.verdict.slice(0, 40));
  void errVerdict;

  /* ── G3b 退化与无解 ───────────────────────────────────────────── */
  group('G3b 退化与无解');
  await clickText('#scenarios .chip', '新机（刚用 3 个月）');
  st = readState();
  ok(st.inputs.healthNowPct === '100', '新机场景健康度 100%', st.inputs.healthNowPct);
  ok(st.verdict.indexOf('100%') >= 0 && st.verdict.indexOf('推不出') >= 0, '100% 时明说不给日期', st.verdict.slice(0, 40));
  const proofNotes = asObj(ev(`(()=>{var t=[].slice.call(document.querySelectorAll('#notes li')).map(function(l){return l.textContent;}).join('|');
    return JSON.stringify({has:t.indexOf('推不出任何速率')>=0, hit:t.slice(0,80)});})()`));
  ok(proofNotes.has, '边界说明里有「一个 100% 的读数推不出速率」那条', proofNotes.hit);
  ok(st.mileRows <= 9 && st.chkFail === 0, '无日期时页面仍完整渲染且自检全过', st.mileRows + ' 行 / ' + st.scCount);

  await setVal('#f-screenHoursPerDay', '24');
  await setVal('#f-drainPctPerHour', '30');
  st = readState();
  ok(st.notes > 0, '日耗电超 100% 时页面仍算出结果', JSON.stringify(st.fb));
  const capNote = asObj(ev(`(()=>{var t=[].slice.call(document.querySelectorAll('#notes li')).map(function(l){return l.textContent;}).join('|');
    return JSON.stringify({has:t.indexOf('封顶')>=0, hit:t.slice(0,80)});})()`));
  ok(capNote.has, '日耗电 >100% 有封顶提示', capNote.hit);
  await clickText('#scenarios .chip', '手机用了一年半（默认）');

  /* ── G4 持久化与备份 ───────────────────────────────────────────── */
  group('G4 持久化与备份');
  await clickText('#scenarios .chip', '重度：每天两充、长途导航');
  const heavy = readState();
  const heavyVerdict = heavy.verdict;
  await clickSel('#btn-save');
  ok(ev(`(()=>{return localStorage.getItem(window.__app.lsKey)?'yes':'no';})()`) === 'yes', '点「保存到本机」后 localStorage 有值');
  await reopen(APP_URL);
  await ev(ARM);
  await sleep(500);
  st = readState();
  ok(st.inputs.healthNowPct === heavy.inputs.healthNowPct, '重开后健康度恢复为保存值', st.inputs.healthNowPct + ' vs ' + heavy.inputs.healthNowPct);
  ok(st.verdict === heavyVerdict, '重开后结论与保存前逐字一致', st.verdict.slice(0, 40));
  ok(st.inputs.chargesPerDay === '2' && st.inputs.screenHoursPerDay === '10', '重开后其余字段也恢复', st.inputs.chargesPerDay + '/' + st.inputs.screenHoursPerDay);

  const jsonBackup = ev(`(()=>{return window.__app.jsonText();})()`);  // ev 会把 JSON 字符串解成对象
  const jsonObj = (typeof jsonBackup === 'object' && jsonBackup) ? jsonBackup : null;
  ok(!!jsonObj && !!jsonObj.cfg && !!jsonObj.result, 'JSON 备份可解析且含 cfg 与 result');
  ok(jsonObj && jsonObj.result && jsonObj.result.strategies.length === 4, 'JSON 备份含 4 条策略', jsonObj ? String(jsonObj.result.strategies.length) : 'null');
  const hasKeys = jsonObj && ['schema', 'batch', 'generated_at', 'note', 'cfg', 'result', 'self_checks'].every(function (k) { return k in jsonObj; });
  ok(hasKeys, 'JSON 备份字段齐全', Object.keys(jsonObj || {}).join(','));

  await clickSel('#btn-reset');
  st = readState();
  ok(st.inputs.healthNowPct === '94' && st.inputs.chargesPerDay === '1', '恢复默认生效', st.inputs.healthNowPct + '/' + st.inputs.chargesPerDay);

  /* 导入备份：先把 JSON 写成真实文件，再用页面的导入按钮读它（走 FileReader 那条真路径） */
  const tmpFile = path.join(ROOT, '01-battery-cycles', 'evidence', '导入用的备份.json');
  fs.mkdirSync(path.dirname(tmpFile), { recursive: true });
  fs.writeFileSync(tmpFile, JSON.stringify(jsonBackup, null, 2), 'utf8');
  const fileReady = ev(`(()=>{return typeof window.__app.importText==='function' ? 'yes':'no';})()`);
  ok(fileReady === 'yes', '页面暴露了可测试的导入入口 __app.importText', String(fileReady));
  const imported = await ev(`(()=>{return window.__app.importText(${JSON.stringify(typeof jsonBackup === 'string' ? jsonBackup : JSON.stringify(jsonBackup))});})()`);
  ok(imported === 'imported', '导入备份返回 imported', String(imported));
  await sleep(400);
  st = readState();
  ok(st.inputs.healthNowPct === heavy.inputs.healthNowPct, '导入备份后输入恢复为保存值', st.inputs.healthNowPct + ' vs ' + heavy.inputs.healthNowPct);
  ok(st.verdict === heavyVerdict, '导入备份后结论与保存前逐字一致', st.verdict.slice(0, 40));
  await clickSel('#btn-reset');

  /* ── G6 四种下载真实落盘 ───────────────────────────────────────── */
  group('G6 四种下载');
  fs.mkdirSync(DL, { recursive: true });
  const before = new Set(fs.readdirSync(DL));
  function freshFiles() {
    return fs.readdirSync(DL).filter(function (f) { return !before.has(f); });
  }
  async function waitFor(ext, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 12000)) {
      const hits = freshFiles().filter(function (f) { return f.toLowerCase().endsWith(ext); });
      if (hits.length) return hits[hits.length - 1];
      await sleep(400);
    }
    return null;
  }
  await ev(`(()=>{return window.__exports.doCsv();})()`);
  const csv = await waitFor('.csv');
  ok(!!csv, 'CSV 真实落盘', String(csv));
  if (csv) {
    const txt = fs.readFileSync(path.join(DL, csv), 'utf8');
    ok(txt.indexOf('月份,日期,健康度%') >= 0, 'CSV 含时间线表头', txt.slice(0, 40));
    ok(txt.split('\n').length > 40, 'CSV 行数 > 40（有时间线全量）', String(txt.split('\n').length));
    ok(txt.indexOf('批次,2026-11-12-codex-54') >= 0, 'CSV 带批次标记', txt.slice(0, 30));
  }
  await ev(`(()=>{return window.__exports.doMd();})()`);
  const md = await waitFor('.md');
  ok(!!md, 'Markdown 真实落盘', String(md));
  if (md) {
    const txt = fs.readFileSync(path.join(DL, md), 'utf8');
    ok(txt.indexOf('# 一块电池还能撑几年') >= 0, 'MD 有标题', txt.slice(0, 30));
    ok(txt.indexOf('## 四种充法') >= 0, 'MD 有策略章节', txt.indexOf('## 四种充法') >= 0 ? 'ok' : 'missing');
    ok(txt.indexOf('## 模型假设') >= 0, 'MD 有假设章节', 'ok');
  }
  await ev(`(()=>{return window.__exports.doJson();})()`);
  const jsonF = await waitFor('.json');
  ok(!!jsonF, 'JSON 真实落盘', String(jsonF));
  if (jsonF) {
    const o = JSON.parse(fs.readFileSync(path.join(DL, jsonF), 'utf8'));
    ok(!!o.cfg && !!o.result && o.schema === 'battery-cycles/v1', 'JSON 内容可解析且有 schema', o.schema);
    ok(o.result.timeline.length > 10, 'JSON 含完整时间线', String(o.result.timeline.length));
  }
  await ev(`(()=>{return window.__exports.doPng();})()`);
  const png = await waitFor('.png', 20000);
  ok(!!png, 'PNG 结果卡真实落盘', String(png));
  if (png) {
    const buf = fs.readFileSync(path.join(DL, png));
    ok(buf.length > 20000, 'PNG 字节数 > 20KB（不是空图）', String(buf.length));
    const sig = buf.slice(0, 8).toString('hex');
    ok(sig === '89504e470d0a1a0a', 'PNG 文件头正确', sig);
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    ok(w === 1080 && h === 1350, '结果卡尺寸 1080×1350', w + '×' + h);
  }
  note('下载目录 ' + DL + ' 本轮新文件：' + freshFiles().join(', '));

  /* ── G5 窄屏 375px ─────────────────────────────────────────────── */
  group('G5 视口');
  launchAt(375, 812);
  await sleep(800);
  await clickText('#scenarios .chip', '手机用了一年半（默认）');
  await setVal('#f-label', '这是一条特别长的备注用来测试窄屏下长文本会不会把页面顶出横向溢出并且检查所有方块是否仍然完整可读');
  st = readState();
  ok(st.winW <= 400 && st.winW >= 320, '窗口确实收窄到手机宽度', String(st.winW));
  ok(!st.bodyOverflow, '窄屏下没有横向溢出', 'docW ' + st.docW + ' vs ' + st.winW);
  ok(st.mileRows === 6, '窄屏里程表仍有 6 行（折成卡片）', String(st.mileRows));
  ok(st.stratCards === 4, '窄屏策略卡仍是 4 张', String(st.stratCards));
  ok(st.sensRows === 20, '窄屏敏感性仍是 20 行', String(st.sensRows));
  ok(st.svgW > 280 && st.svgW <= st.winW, '周线图宽度收在容器内', Math.round(st.svgW) + ' ≤ ' + st.winW);
  const overflow = asObj(ev(`(()=>{var bad=[];document.querySelectorAll('.wrap *').forEach(function(e){
      var r=e.getBoundingClientRect(); if(r.width>0 && r.right>window.innerWidth+1.5) bad.push(e.tagName+'.'+(e.className||'')+'@'+Math.round(r.right));
    });return JSON.stringify({n:bad.length,list:bad.slice(0,6)});})()`));
  ok(overflow.n === 0, '窄屏下没有任何元素越出右边界', JSON.stringify(overflow.list));
  const wide = asObj(ev(`(()=>{var bad=[];document.querySelectorAll('td,th,.ro,.sc').forEach(function(e){
      if(e.scrollWidth>e.clientWidth+2 && e.clientWidth>0) bad.push((e.className||e.tagName)+':'+e.scrollWidth+'>'+e.clientWidth);
    });return JSON.stringify({n:bad.length,list:bad.slice(0,6)});})()`));
  ok(wide.n === 0, '窄屏下没有内容被裁掉/截断的单元格', JSON.stringify(wide.list));
  const shotSmall = path.join(ROOT, 'evidence', '截图', '窄屏375-默认与长文本.png');
  fs.mkdirSync(path.dirname(shotSmall), { recursive: true });
  execFileSync(AB, ['--session', SESSION, 'screenshot', shotSmall], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
  ok(fs.existsSync(shotSmall) && fs.statSync(shotSmall).size > 10000, '窄屏整页截图落盘', shotSmall);
  launchAt(1280, 900);
  await sleep(800);
  await ev(ARM);
  await clickText('#scenarios .chip', '手机用了一年半（默认）');
  st = readState();
  ok(st.winW >= 1000, '窗口回到桌面宽度', String(st.winW));
  ok(!st.bodyOverflow, '桌面宽度下也没有横向溢出', 'docW ' + st.docW);

  /* ── G7 控制台 ─────────────────────────────────────────────────── */
  group('G7 控制台');
  const clean = asObj(ev(PROBE_CLEAN));
  ok(clean.errs.length === 0, '整轮操作后控制台 0 错误', JSON.stringify(clean.errs.slice(0, 3)));
  ok(clean.warns.length === 0, '整轮操作后控制台 0 警告', JSON.stringify(clean.warns.slice(0, 3)));

  /* ── G8 导出文本内容与页面一致 ─────────────────────────────────── */
  group('G8 导出内容');
  await clickSel('#btn-reset');
  const csvNow = String(ev(`(()=>{return window.__app.csvText();})()`));
  const mdNow = String(ev(`(()=>{return window.__app.mdText();})()`));
  const jsonRaw = ev(`(()=>{return window.__app.jsonText();})()`);
  const jsonNow = (typeof jsonRaw === 'object' && jsonRaw) ? jsonRaw
    : (function () { try { return JSON.parse(String(jsonRaw)); } catch (e) { return null; } })();
  const res = asObj(ev(`(()=>{var r=window.__app.result();return JSON.stringify({years:r.yearsTo80,opt:r.optimisticYears,aObs:r.base.aObs,remLoss:r.remLoss,wear:r.flow.wearPerYear,gain:r.advice.gainMonths});})()`));
  ok(csvNow.indexOf('悲观剩余年数,' + res.years) >= 0, 'CSV 里的悲观年数与页面结果一致', String(res.years));
  ok(csvNow.indexOf('乐观剩余年数,' + res.opt) >= 0, 'CSV 里的乐观年数与页面结果一致', String(res.opt));
  ok(mdNow.indexOf('悲观（不改习惯）：' + res.years + ' 年') >= 0, 'MD 里的悲观年数与页面一致', String(res.years));
  ok(!!jsonNow && String(jsonNow.result.yearsTo80) === String(res.years), 'JSON 里的年数与页面一致', String(res.years) + ' vs ' + (jsonNow ? String(jsonNow.result.yearsTo80) : 'null'));
  ok(!!jsonNow && String(jsonNow.result.advice.gainMonths) === String(res.gain), 'JSON 里的收益月数与页面一致', String(res.gain));
  ok(csvNow.indexOf('每块电池') >= 0 || csvNow.indexOf('年损耗单元') >= 0, 'CSV 里有年损耗单元口径', 'ok');
  const forbidden = ['已人工校核', '真实用户分布', '实测分布', '官方数据'];
  st = readState();
  const allText = st.verdict + st.why + st.stratText.join('') + st.sensText.join('') + mdNow;
  const hitForbidden = forbidden.filter(function (w) { return allText.indexOf(w) >= 0; });
  ok(hitForbidden.length === 0, '页面与导出文本没有出现越界表述', JSON.stringify(hitForbidden));
  const saysFake = allText.indexOf('虚构示例') >= 0;
  ok(saysFake, '默认场景明说是虚构示例', 'ok');

  /* ── 收尾 ──────────────────────────────────────────────────────── */
  lines.push('');
  lines.push('# 合计 PASS ' + pass + ' / FAIL ' + fail + ' / eval 调用 ' + evals);
  lines.push('# 分组：' + JSON.stringify(groups));
  lines.push('# 结束时间 ' + new Date().toISOString());
  fs.writeFileSync(OUT, lines.join('\n'));
  fs.writeFileSync(SUM, JSON.stringify({
    tag: TAG, url: APP_URL, started_at: startedAt, finished_at: new Date().toISOString(),
    pass: pass, fail: fail, evals: evals, groups: groups,
    downloads: { dir: DL, files: freshFiles() },
    raw: path.relative(ROOT, OUT)
  }, null, 2));
  console.log('PASS ' + pass + ' / FAIL ' + fail + ' · eval ' + evals);
  console.log('写出 ' + OUT);
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  lines.push('FATAL ' + (e && e.stack ? e.stack : e));
  fs.mkdirSync(path.join(ROOT, 'evidence'), { recursive: true });
  fs.writeFileSync(OUT, lines.join('\n'));
  console.error('FATAL', e);
  process.exit(2);
});
