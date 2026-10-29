#!/usr/bin/env node
'use strict';
/* 開局實驗室：驗證一個「開局體系」到底有沒有用（受控實驗，不是看觀察資料）。
   做法：同一個 AI（預設 super）對打；一方前幾手「強制」照你寫的開局走，之後交回 AI 自由發揮；
   另外跑一組「自由 vs 自由」當對照組，比較同一個顏色的勝率、吃王率、平均手數，並給 95% 信賴區間與顯著性。

   node tools/opening-lab.js --bw "咚 e2→e3; 士 c2→d3; 龍 f2→f3" --games 60 --control
   node tools/opening-lab.js --bb "龍 a8→a7; 鞋 a9→c8" --games 60 --control            （黑方開局）
   node tools/opening-lab.js --bw "…" --bb "…" --games 60                              （兩個開局互打，不需要對照組）

   其他受控實驗（都只套用在「實驗組」的那一方，對照組自由發揮）：
     --no-king-w N / --no-king-b N   前 N 手禁止動王（驗證「王太早出動會輸」是不是因果）
     --esc-w X / --esc-b X           把該方評估裡「敵王出路」的權重改成 X（預設 0.6；0＝關掉，驗證這個特徵是否讓王亂跑）
   開局寫法：「棋子 起點→終點」，用分號隔開；棋子可寫 咚／士／龍／鞋／熨／夜／茶／OL／孩／王（或完整名稱）；座標 a–i、1–9（白方底線是 1）。
   參數：--games 每組局數（預設 40）  --budget 每手毫秒（預設 60）  --cap 單局手數上限（預設 160）  --stale-cut 連續幾手沒吃子就提早收手（預設 0＝不用）
         --open-tol/--open-plies 書後開局的隨機度（預設 1.2／14，與 local-gen 相同，讓每局不一樣）  --jobs 同時幾局（預設＝核心數）  --out 逐局結果 jsonl
   樣本數提醒：每組 40 局時 95% 信賴區間約 ±15 個百分點，要分辨 60% 對 50% 至少要每組 200 局以上。 */
const fs = require('fs'), os = require('os'), {Worker, isMainThread, workerData, parentPort} = require('worker_threads');
const Rules = require('../public/rules.js'), {playGame} = require('./sim.js');
const ALIAS = {'咚': '咚咚咚咚咚將軍', '士': '量產型戰士', '戰士': '量產型戰士', '龍': '龍', '鞋': '鞋子', '熨': '熨斗', '夜': '夜王', '茶': '抹茶小紅豆', '抹茶': '抹茶小紅豆', '孩': '孩子多', '謎': '謎之美少女'};
const FULL = new Set(Object.values(Rules.TYPES).map(d => d.name));
function parseBook(str) {
  if (!str) return null;
  return str.split(/[;；]/).map(s => s.trim()).filter(Boolean).map((tok, i) => {
    const m = tok.match(/^(\S+)\s+([a-i][1-9])\s*(?:→|->|-)\s*([a-i][1-9])$/); if (!m) throw new Error(`開局第 ${i + 1} 手無法解析：「${tok}」（寫法：棋子 起點→終點，例如 咚 e2→e3）`);
    const name = FULL.has(m[1]) ? m[1] : ALIAS[m[1]] || (m[1] === 'OL' || m[1] === 'OTL' || m[1] === '王' ? m[1] : null); if (!name) throw new Error(`不認得的棋子「${m[1]}」`);
    return {name, fx: 'abcdefghi'.indexOf(m[2][0]), fy: 9 - +m[2][1], tx: 'abcdefghi'.indexOf(m[3][0]), ty: 9 - +m[3][1]};
  });
}
if (!isMainThread) {   // ---- 工作執行緒：依序打完分配到的局 ----
  for (const j of workerData.jobs) {
    const g = playGame({seed: j.seed, w: 'super', b: 'super', bw: workerData.budget, bb: workerData.budget, moveCap: workerData.cap, openTol: workerData.openTol, openPlies: workerData.openPlies, staleCut: workerData.staleCut, bookW: j.bookW, bookB: j.bookB, noKingW: j.noKingW, noKingB: j.noKingB, ww: j.ww, wb: j.wb});
    parentPort.postMessage({arm: j.arm, seed: j.seed, over: g.over, reason: g.reason, capped: g.capped, moves: g.moves, book: g.book});
  }
  process.exit(0);
}
// ---- 主程式 ----
const argv = process.argv.slice(2), val = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; }, has = k => argv.includes('--' + k);
if (has('help') || argv.length === 0) { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^[^]*?\/\* /, '')); process.exit(0); }
let bookW, bookB; try { bookW = parseBook(val('bw')); bookB = parseBook(val('bb')); } catch (e) { console.error(e.message); process.exit(1); }
const games = +val('games', 40), jobs = Math.max(1, +val('jobs', os.cpus().length));
const nkW = +val('no-king-w', 0), nkB = +val('no-king-b', 0), escW = val('esc-w'), escB = val('esc-b');
const EV = require('../ai-eval.js'), mkW = x => { if (x === undefined) return undefined; const w = EV.weights().slice(); w[14] = +x; return w; };
if (!bookW && !bookB && !nkW && !nkB && escW === undefined && escB === undefined) { console.error('至少要給一項實驗設定：--bw／--bb 開局，或 --no-king-w／--no-king-b，或 --esc-w／--esc-b'); process.exit(1); }
const exp = {bookW, bookB, noKingW: nkW, noKingB: nkB, ww: mkW(escW), wb: mkW(escB)}, arms = [{name: '實驗組', ...exp}]; if (has('control')) arms.push({name: '對照組（自由 vs 自由）', bookW: null, bookB: null, noKingW: 0, noKingB: 0});
const all = []; arms.forEach((a, ai) => { for (let i = 0; i < games; i++) all.push({arm: ai, seed: 7000 + i, bookW: a.bookW, bookB: a.bookB, noKingW: a.noKingW, noKingB: a.noKingB, ww: a.ww, wb: a.wb}); });
const results = [], buckets = Array.from({length: Math.min(jobs, all.length)}, () => []); all.forEach((j, i) => buckets[i % buckets.length].push(j));
let done = 0, finished = 0; const t0 = Date.now();
const common = {budget: +val('budget', 60), cap: +val('cap', 160), openTol: +val('open-tol', 1.2), openPlies: +val('open-plies', 14), staleCut: +val('stale-cut', 0)};
buckets.forEach(b => { const w = new Worker(__filename, {workerData: {jobs: b, ...common}});
  w.on('message', m => { results.push(m); if (++done % 10 === 0 || done === all.length) process.stderr.write(`\r  已完成 ${done}/${all.length} 局（${Math.round((Date.now() - t0) / 1000)}s）`); });
  w.on('exit', () => { if (++finished === buckets.length) report(); }); });
function wilson(k, n) { if (!n) return [0, 0]; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), a = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - a) / d, (c + a) / d]; }
function report() {
  console.log('\n');
  if (val('out')) fs.writeFileSync(val('out'), results.map(r => JSON.stringify(r)).join('\n') + '\n');
  const sw = !!(bookW || nkW || escW !== undefined), sb = !!(bookB || nkB || escB !== undefined), side = sw && !sb ? 'w' : sb && !sw ? 'b' : null, stat = [];
  arms.forEach((a, ai) => { const rs = results.filter(r => r.arm === ai), n = rs.length, W = rs.filter(r => r.over === 'w').length, B = rs.filter(r => r.over === 'b').length, D = n - W - B, K = rs.filter(r => r.reason === 'king').length;
    const hit = rs.reduce((s, r) => s + r.book.hit.w + r.book.hit.b, 0), miss = rs.reduce((s, r) => s + r.book.miss.w + r.book.miss.b, 0), len = rs.reduce((s, r) => s + r.moves, 0) / (n || 1);
    stat.push({n, W, B, D}); const sc = side ? (side === 'w' ? W : B) + D / 2 : null, [lo, hi] = side ? wilson(sc, n) : [0, 0];
    console.log(`【${a.name}】${n} 局：白勝 ${W}、黑勝 ${B}、和 ${D}｜吃王結束 ${K} 局（${Math.round(100 * K / n)}%）｜平均 ${Math.round(len)} 手` + (a.bookW || a.bookB ? `｜開局照書走 ${hit} 手、當下走不了而放棄 ${miss} 手` : ''));
    if (side) console.log(`   ${side === 'w' ? '白' : '黑'}方得分率 ${(100 * sc / n).toFixed(1)}%（和局算半勝），95% 信賴區間 [${(100 * lo).toFixed(0)}%, ${(100 * hi).toFixed(0)}%]`); });
  if (side && stat.length === 2) { const f = s => ((side === 'w' ? s.W : s.B) + s.D / 2), p1 = f(stat[0]) / stat[0].n, p2 = f(stat[1]) / stat[1].n, p = (f(stat[0]) + f(stat[1])) / (stat[0].n + stat[1].n), se = Math.sqrt(p * (1 - p) * (1 / stat[0].n + 1 / stat[1].n)), z = se ? (p1 - p2) / se : 0;
    console.log(`\n實驗組 − 對照組：${side === 'w' ? '白' : '黑'}方得分率 ${p1 > p2 ? '+' : ''}${(100 * (p1 - p2)).toFixed(1)} 個百分點，z = ${z.toFixed(2)}（|z| ≥ 2 才算有差異；一次只測一個開局才不必校正多重比較）`); }
}
