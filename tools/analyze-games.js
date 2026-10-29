#!/usr/bin/env node
'use strict';
/* 對局資料分析：把 local-gen／online-gen 產生的 games.jsonl 逐局重播，統計能拿去改教學「戰術與規律」的數字。
   node tools/analyze-games.js <games.jsonl> [--json out.json]
   每個比較都附 z 值（|z| ≥ 2 約為 95% 顯著；一次掃很多項時要更嚴，報告裡會標示）。
   注意：reason 不是 king 的局（停滯中止、步數上限）是「提早結算」，勝負不如吃王局可靠，相關段落會註明。 */
const fs = require('fs'), Rules = require('../public/rules.js');
const file = process.argv[2]; if (!file) { console.error('用法：node tools/analyze-games.js <games.jsonl> [--json out.json]'); process.exit(1); }
const rows = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
const NAME = ty => Rules.TYPES[ty].name, rel = (s, y) => s === 'w' ? 8 - y : y, sc = (r, s) => r.over === s ? 1 : r.over === 'draw' ? .5 : 0;
const pct = x => (100 * x).toFixed(1) + '%', mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1), med = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const zt = (a, n1, b, n2) => { const p = (a + b) / (n1 + n2), se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2)); return se ? (a / n1 - b / n2) / se : 0; };
function binomP(k, n) { const lc = i => { let s = 0; for (let j = 2; j <= i; j++) s += Math.log(j); return s; }, pr = i => Math.exp(lc(n) - lc(i) - lc(n - i) - n * Math.LN2); let p = 0; const pk = pr(k); for (let i = 0; i <= n; i++) if (pr(i) <= pk * (1 + 1e-9)) p += pr(i); return Math.min(1, p); }
// ---- 逐局重播 ----
const G = rows.map(g => {
  const S = Rules.create(), notes = [], mat = [], kp = []; let ok = true;
  for (const x of g.actions) { const h0 = S.hist.length; if (Rules.play(S, x.s, x.a, 0).ok === false) { ok = false; break; } notes.push(S.hist.slice(h0)); mat.push(Rules.pts(S, 'w') - Rules.pts(S, 'b')); const k = {}; S.pieces.forEach(p => { if (p.type === 'king') k[p.side] = [p.x, p.y]; }); kp.push(k); }
  if (!ok) return null; const fin = {w: {}, b: {}}; S.pieces.forEach(p => fin[p.side][p.type] = (fin[p.side][p.type] || 0) + 1);
  return {id: g.id, over: g.over, king: g.reason === 'king', moves: g.moves, acts: g.actions, notes, mat, kp, fin, npieces: S.pieces.length};
}).filter(Boolean);
const K = G.filter(g => g.king), out = {n: G.length};
console.log(`# 對局分析：${file}\n讀入 ${rows.length} 局，成功重播 ${G.length} 局；吃王 ${K.length} 局、提早結算 ${G.length - K.length} 局\n`);
// 1. 整體
const cw = (a, s) => a.filter(g => g.over === s).length, ev = rx => g => g.notes.flat().filter(t => rx.test(t)).length;
console.log('## 1. 整體');
[['全部', G], ['吃王局', K], ['提早結算局', G.filter(g => !g.king)]].forEach(([nm, a]) => { if (a.length) console.log(`- ${nm}（${a.length}）：白勝 ${cw(a, 'w')}、黑勝 ${cw(a, 'b')}、和 ${cw(a, 'draw')}；手數中位 ${med(a.map(g => g.moves))}、平均 ${Math.round(mean(a.map(g => g.moves)))}`); });
{ const w = cw(K, 'w'), b = cw(K, 'b'); if (w + b) console.log(`- 吃王局白方勝率 ${pct(w / (w + b))}（${w}/${w + b}，雙尾二項檢定 p=${binomP(w, w + b).toFixed(3)}）`); const w2 = cw(G, 'w'), b2 = cw(G, 'b'); console.log(`- 全部（不含和）白方勝率 ${pct(w2 / (w2 + b2))}（p=${binomP(w2, w2 + b2).toFixed(3)}）`); }
// 2. 事件
console.log('\n## 2. 每局事件（平均；提早結算的局較短，數字偏低）');
[['吃子', / 吃/], ['斬擊', /斬殺/], ['復活', /復活在/], ['龍轉生', /轉生/], ['孩的死亡連鎖（被消滅）', /被消滅於/], ['OL 吃己方龍 → OTL', /轉化為/]].forEach(([nm, rx]) => { const a = G.map(ev(rx)); console.log(`- ${nm}：${mean(a).toFixed(2)}／局（合計 ${a.reduce((x, y) => x + y, 0)}，有發生的局 ${a.filter(x => x).length}）`); });
// 3. 先手動作
console.log('\n## 3. 第一次吃子／斬擊');
{ const fc = [], fcw = [0, 0], fs2 = [0, 0];
  G.forEach(g => { const i = g.notes.findIndex(ns => ns.some(t => / 吃/.test(t))); if (i < 0) return; fc.push(i + 1); if (g.over !== 'draw') { fcw[1]++; fcw[0] += g.acts[i].s === g.over; }
    const j = g.notes.findIndex(ns => ns.some(t => /斬殺/.test(t))); if (j >= 0 && g.over !== 'draw') { fs2[1]++; fs2[0] += g.acts[j].s === g.over; } });
  console.log(`- 第一次吃子：第 ${med(fc)} 手（中位），最早 ${Math.min(...fc)}、最晚 ${Math.max(...fc)}`);
  console.log(`- 先吃到子的一方勝 ${fcw[0]}/${fcw[1]} = ${pct(fcw[0] / fcw[1])}（p=${binomP(fcw[0], fcw[1]).toFixed(3)}）；先完成斬擊的一方勝 ${fs2[0]}/${fs2[1]} = ${pct(fs2[0] / fs2[1])}（p=${binomP(fs2[0], fs2[1]).toFixed(3)}）`); }
// 4. 王怎麼死的
console.log('\n## 4. 王是怎麼被殺的（只看吃王局）');
if (K.length) {
  const kr = K.map(g => { const ln = g.notes[g.notes.length - 1].filter(t => !t.includes('🎉')).pop() || '', slash = ln.includes('斬殺'), chain = ln.includes('被消滅於'), killer = (ln.match(/^(?:白方|黑方)(\S+)/) || [])[1] || '?', sq = (ln.match(/[a-i][1-9]/g) || []).pop() || '?';
    const wd = g.mat.map(d => g.over === 'w' ? d : -d), n = g.acts.length; return {g, slash, chain, killer, sq, edge: sq !== '?' && ('ai'.includes(sq[0]) || '19'.includes(sq[1])), pre: n > 1 ? wd[n - 2] : 0, minwd: Math.min(...wd)}; });
  const cnt = a => { const m = {}; a.forEach(x => m[x] = (m[x] || 0) + 1); return Object.entries(m).sort((x, y) => y[1] - x[1]); };
  console.log('- 死法：' + cnt(kr.map(x => x.slash ? '咚斬擊' : x.chain ? '連鎖誤傷' : '直接吃')).map(([k, v]) => `${k} ${v}`).join('、'));
  console.log('- 殺手：' + cnt(kr.map(x => x.killer)).map(([k, v]) => `${k} ${v}`).join('、'));
  console.log(`- 被殺的王在棋盤邊緣：${kr.filter(x => x.edge).length}/${kr.length}（${pct(kr.filter(x => x.edge).length / kr.length)}；邊緣格占全盤 39.5%）`);
  console.log(`- 吃王前一手，殺王方的子力領先：中位 ${med(kr.map(x => x.pre))} 分；殺王方其實落後的 ${kr.filter(x => x.pre < 0).length} 局、差距 ≤2 分的 ${kr.filter(x => Math.abs(x.pre) <= 2).length} 局；曾落後 ≥5 分仍殺王的 ${kr.filter(x => x.minwd <= -5).length} 局`);
  console.log(`- 殺王時的手數：中位 ${med(K.map(g => g.moves))}（≤50 手 ${K.filter(g => g.moves <= 50).length} 局、>200 手 ${K.filter(g => g.moves > 200).length} 局）；場上剩餘棋子數中位 ${med(K.map(g => g.npieces))}`);
  const zn = d => d <= 1 ? 'A 底線兩排' : d <= 3 ? 'B 後場(2-3排)' : d === 4 ? 'C 中線' : d <= 6 ? 'D 前場(5-6排)' : 'E 敵陣底', tz = {}, dz = {}; let tot = 0;
  G.forEach(g => { g.kp.forEach(k => ['w', 'b'].forEach(s => { if (k[s]) { const z = zn(rel(s, k[s][1])); tz[z] = (tz[z] || 0) + 1; tot++; } })); });
  K.forEach(g => { const loser = g.over === 'w' ? 'b' : 'w', k = g.kp.length > 1 ? g.kp[g.kp.length - 2] : g.kp[0]; if (k[loser]) { const z = zn(rel(loser, k[loser][1])); dz[z] = (dz[z] || 0) + 1; } });
  console.log('- 王所在區域的風險（死亡占比 ÷ 停留時間占比；>1 代表比平均更容易死）：\n' + Object.keys(tz).sort().map(z => `    ${z}：停留 ${pct(tz[z] / tot)}、死亡 ${pct((dz[z] || 0) / K.length)}（${(dz[z] || 0)} 次）→ ${(((dz[z] || 0) / K.length) / (tz[z] / tot)).toFixed(1)}×`).join('\n'));
  out.kingDeaths = kr.length;
}
// 5. 王早出動
console.log('\n## 5. 王太早出動（只看雙方前 40 步）');
{ const md = (g, s) => { let m = 0; g.kp.slice(0, 40).forEach(k => { if (k[s]) m = Math.max(m, rel(s, k[s][1])); }); return m; }, bk = d => d <= 1 ? '留在底線兩排內' : d <= 3 ? '走到第 2-3 排' : '走到第 4 排以上', t = {};
  G.forEach(g => ['w', 'b'].forEach(s => { const b = bk(md(g, s)), x = t[b] = t[b] || [0, 0]; x[0]++; x[1] += sc(g, s); }));
  const keys = Object.keys(t).sort(); keys.forEach(b => console.log(`- 前 40 步王${b}：${t[b][0]} 人次，得分率 ${pct(t[b][1] / t[b][0])}`));
  const a = t['留在底線兩排內'], b = [0, 0]; keys.filter(k => k !== '留在底線兩排內').forEach(k => { b[0] += t[k][0]; b[1] += t[k][1]; });
  if (a && b[0]) console.log(`  → 留在底線 vs 走出去：z = ${zt(a[1], a[0], b[1], b[0]).toFixed(2)}`);
  const tk = {}; K.forEach(g => ['w', 'b'].forEach(s => { const b2 = bk(md(g, s)), x = tk[b2] = tk[b2] || [0, 0]; x[0]++; x[1] += g.over !== s; }));
  console.log('- 吃王局中，這個王最後被殺的比例：' + Object.keys(tk).sort().map(b => `${b} ${pct(tk[b][1] / tk[b][0])}（${tk[b][0]} 人次）`).join('；')); }
// 6. 存活
console.log('\n## 6. 終局時棋子在場／不在場的得分率（每局雙方各一人次；和局算半勝；相關不是因果）');
{ const alive = (g, s, ty) => ty === 'tea' ? (g.fin[s].tea || 0) + (g.fin[s].godness || 0) > 0 : (g.fin[s][ty] || 0) > 0, out2 = [];
  ['dong', 'night', 'tea', 'guard', 'iron', 'kid', 'ol', 'shoe', 't'].forEach(ty => { const a = [0, 0], b = [0, 0]; G.forEach(g => ['w', 'b'].forEach(s => { const x = alive(g, s, ty) ? a : b; x[0]++; x[1] += sc(g, s); }));
    if (a[0] && b[0]) out2.push([ty === 'tea' ? '抹茶(含謎)' : NAME(ty), a, b, zt(a[1], a[0], b[1], b[0])]); });
  out2.sort((x, y) => Math.abs(y[3]) - Math.abs(x[3])).forEach(([nm, a, b, z]) => console.log(`- ${nm}：在場 ${a[0]} 人次 ${pct(a[1] / a[0])}｜不在場 ${b[0]} 人次 ${pct(b[1] / b[0])}｜z=${z.toFixed(1)}`)); }
// 7. 開局
console.log('\n## 7. 開局');
const parse = t => { const m = t.match(/^(白方|黑方)(\S+?) ([a-i][1-9])→([a-i][1-9])/); return m ? [m[2], m[3], m[4]] : null; };
const firstN = (g, s, k) => { const o = []; g.acts.forEach((x, i) => { if (o.length < k && x.s === s && x.a.t === 'move') { let p = null; g.notes[i].forEach(t => p = parse(t) || p); o.push(p); } }); return o; };
['w', 'b'].forEach(s => { const t = {}; G.forEach(g => { const m = firstN(g, s, 1)[0]; if (m) { const k = `${m[0]} ${m[1]}→${m[2]}`, x = t[k] = t[k] || [0, 0]; x[0]++; x[1] += sc(g, s); } });
  const ks = Object.entries(t).sort((x, y) => y[1][0] - x[1][0]); console.log(`- ${s === 'w' ? '白' : '黑'}方第一手（共 ${ks.length} 種；列出 ≥6 局的）：` + ks.filter(([, v]) => v[0] >= 6).map(([k, v]) => `${k} ${v[0]}局 ${pct(v[1] / v[0])}`).join('；')); });
console.log('  ⚠ 每種第一手通常只有十幾局，95% 信賴區間約 ±25 個百分點；不能只靠這個命名開局，要用 tools/opening-lab.js 做受控實驗。');
{ const N = 8, F = {'動過王': m => m.some(x => x[0] === '王'), '動過咚': m => m.some(x => x[0].startsWith('咚')), '動過士': m => m.some(x => x[0] === '量產型戰士'), '動過鞋子': m => m.some(x => x[0] === '鞋子'), '動過抹茶': m => m.some(x => x[0].startsWith('抹茶')), '動過夜王': m => m.some(x => x[0] === '夜王'), '動過OL': m => m.some(x => x[0] === 'OL'), '動過熨斗': m => m.some(x => x[0] === '熨斗'), '動過孩': m => m.some(x => x[0] === '孩子多'), '≥4 手是龍': m => m.filter(x => x[0] === '龍').length >= 4, '≥5 種不同棋子': m => new Set(m.map(x => x[0])).size >= 5, '有來回動同一顆': m => new Set(m.map(x => x[1])).size < m.length}, res = [];
  Object.entries(F).forEach(([nm, f]) => { const a = [0, 0], b = [0, 0]; G.forEach(g => ['w', 'b'].forEach(s => { const m = firstN(g, s, N).filter(Boolean); if (m.length < N) return; const x = f(m) ? a : b; x[0]++; x[1] += sc(g, s); })); if (a[0] >= 20 && b[0] >= 20) res.push([nm, a, b, zt(a[1], a[0], b[1], b[0])]); });
  const thr = res.length > 1 ? 2.0 + 0.35 * Math.log(res.length) : 2; console.log(`- 前 ${N} 手的佈陣特徵 vs 得分率（共測 ${res.length} 項；多重比較後建議 |z| ≥ ${thr.toFixed(1)} 才算可信）：`);
  res.sort((x, y) => Math.abs(y[3]) - Math.abs(x[3])).slice(0, 6).forEach(([nm, a, b, z]) => console.log(`    前${N}手${nm}：有 ${a[0]} 人次 ${pct(a[1] / a[0])}｜無 ${b[0]} 人次 ${pct(b[1] / b[0])}｜z=${z.toFixed(1)}`)); }
const jo = process.argv.indexOf('--json'); if (jo > 0) fs.writeFileSync(process.argv[jo + 1], JSON.stringify(out));
