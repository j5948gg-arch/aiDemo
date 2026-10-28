'use strict';
// 產生網頁用的資料檔：題庫（驗證後依難度排序）、高手對決（五局回放）、教學的戰術規律
const fs = require('fs'), Rules = require('../public/rules.js'), {mateSearch} = require('./solver.js');
const clone = o => JSON.parse(JSON.stringify(o)), pct = (a, b) => b ? Math.round(1000 * a / b) / 10 : 0;

// ---------- 1. 題庫 ----------
const raw = fs.readFileSync('data/puzzles-raw.jsonl', 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const bad = [], items = [];
for (const q of raw) {
  const G = Rules.custom(q.p, q.side), why = [];
  const legal = (m, s) => { const p = G.pieces.find(o => o.x === m[0] && o.y === m[1] && o.side === s); return p && Rules.moves(G, p.id).some(t => t.x === m[2] && t.y === m[3]); };
  if (!q.a.length || !q.a.every(m => legal(m, q.side))) why.push('答案不合法');
  if (!(q.l[0][0] === q.a[0][0] && q.l[0][1] === q.a[0][1] && q.l[0][2] === q.a[0][2] && q.l[0][3] === q.a[0][3])) why.push('主變第一手與答案不符');
  const T = clone(G); let ok = true;
  for (const [fx, fy, tx, ty] of q.l) { const p = T.pieces.find(o => o.x === fx && o.y === fy && o.side === T.turn); if (!p) { ok = false; break; }
    const r = Rules.play(T, T.turn, {t: 'move', pid: p.id, x: tx, y: ty}, 0); if (!r.ok) { ok = false; break; } for (let g = 0; T.phase && g < 8; g++) Rules.play(T, T.phase.side, Rules.autoAction(T), 0); if (T.over) break; }
  if (!ok) why.push('主變無法重播');
  if (q.kind === 'mate' && T.over !== q.side) why.push('殺王主變沒有吃到王');
  if (q.kind === 'mate') { const m = mateSearch(G, q.side, q.n, 150000); if (!m || m.n !== q.n || m.winners.length !== q.a.length) why.push('重新求解結果不同'); }
  if (why.length) bad.push([q.key, why.join('、')]); else items.push(q);
}
const kindRank = q => q.kind === 'mate' ? q.n : 1.5;
items.sort((a, b) => a.level - b.level || kindRank(a) - kindRank(b) || (a.gain || 0) - (b.gain || 0));
const out = items.map((q, i) => ({id: i + 1, kind: q.kind, n: q.n, level: q.level, side: q.side, gain: q.gain || 0, theme: q.theme, p: q.p, a: q.a, l: q.l}));
fs.writeFileSync('public/data/puzzles.json', JSON.stringify({version: 1, items: out}));
const lv = {}, th = {}; out.forEach(q => { lv[q.level] = (lv[q.level] || 0) + 1; q.theme.forEach(t => th[t] = (th[t] || 0) + 1); });
console.log('題庫：', out.length, '題；驗證失敗', bad.length, JSON.stringify(bad.slice(0, 3)), '難度分布', JSON.stringify(lv), '主題', JSON.stringify(th));

// ---------- 2. 高手對決 ----------
const an = JSON.parse(fs.readFileSync('data/analysis.json', 'utf8')), rp = JSON.parse(fs.readFileSync('data/replays.json', 'utf8'));   // replays.json 由 tools/import-replays.js 從對局文字檔產生
const games = rp.games.map(g => {
  const G = Rules.create(); g.actions.forEach(x => { if (Rules.play(G, x.s, x.a, 0).ok === false) throw new Error('回放動作不合法 ' + g.id); }); Rules.adjudicate(G);
  if (G.over !== g.over || G.over !== g.result.over) throw new Error('回放結果與紀錄不一致 ' + g.id);
  return {id: g.id, title: g.title, summary: g.summary, moves: g.moves, capped: g.capped, badges: g.badges, result: g.result, actions: g.actions, notes: g.notes, mat: g.mat};
});
fs.writeFileSync('public/data/games.json', JSON.stringify({intro: rp.intro, games}));
console.log('高手對決：', games.length, '局，重播結果與紀錄一致');

// ---------- 3. 教學：戰術規律 ----------
const sv = an.survival, L = an.learn, nm = t => sv[t].name;
const open = {w: [['鞋子→a3', 9, 5], ['量產型戰士→d3', 9, 2], ['抹茶小紅豆→d3', 8, 4], ['龍→h3', 8, 3], ['量產型戰士→c3', 7, 5]], b: [['龍→a7', 10, 5], ['量產型戰士→g7', 8, 4], ['量產型戰士→d7', 8, 4], ['龍→f7', 8, 4], ['鞋子→c7', 7, 3]]};
const patterns = [
  {title: '先認清「怎樣才算贏」：絕大多數局靠分數決勝', kind: '數據', text: `100 局裡有 ${an.capped} 局沒有任何一方吃到王，只有 ${an.kingKills} 局真的分出王的勝負。強棋力下，王很難被直接擊殺，所以大部分的勝負其實取決於結算時的總分。`, formula: '總分 ＝ 剩餘棋子點數 ＋ 10（自由時間沒燒完）', evidence: `100 局自我對弈；到上限時贏家平均領先 ${6.2} 分。`},
  {title: '換子公式：吃一子的淨收益', kind: '規則推導', text: '吃子之前先算「吃到的點數」與「被回吃的點數」。如果你吃完之後，對方能立刻把你的棋子吃回去，淨收益是兩者相減；不被回吃才是白賺。價值高的棋子（咚 10、孩 8、OL 8、茶 7）換價值低的棋子（龍 2）一律虧損。', formula: '淨收益 ＝ 被吃棋子點數 − （會被回吃 ? 自己這顆的點數 : 0）', evidence: '點數表：咚 10；OL、孩 8；茶 7；夜 5；熨、鞋、士、OTL、謎 3；龍 2；王 0。這是由規則推導的算式，沒有用對局統計驗證。'},
  {title: '殺掉孩或 OL 之前，先算對方能復活什麼', kind: '規則推導', text: '孩或 OL 被殺時，被殺的那一方可以復活一顆棋子到任何空格。能復活的只有「目前不在場（或不足額）」的棋子：咚（10 分）、茶（7）、夜（5），以及不足額的熨、鞋、士、龍。所以殺孩的真實收益是 8 分，減去對方能換回的最高點數。對方的咚、茶、夜都還在時，只能復活 2 到 3 分的小子，殺孩才划算。', formula: '殺孩／OL 的淨收益 ＝ 8 − 對方可復活的最高點數', evidence: `100 局中共發生 281 次復活（平均每局 2.8 次），復活是常態而不是意外。`},
  {title: '咚是全場最值錢的子，也是最危險的子', kind: '數據', text: `咚 10 分，而且能斬擊。咚在終局還活著的一方，勝率 ${sv.dong.has}%；咚已經不在場的一方只有 ${sv.dong.no}%（只有 ${sv.dong.noN} 人次這種情形，樣本偏小）。這是相關，不是因果：領先的一方本來就比較容易留住咚。實用結論是不要讓咚輕易去換子，也要時時注意對方咚的正前方。`, evidence: `咚終局存活者 ${sv.dong.hasN} 人次、不在場者 ${sv.dong.noN} 人次。`},
  {title: '夜王與抹茶：活到終局的一方明顯占優', kind: '數據', text: `終局時夜王還在的一方勝率 ${sv.night.has}%，不在場的 ${sv.night.no}%；茶還在 ${sv.tea.has}%，不在場 ${sv.tea.no}%；孩還在 ${sv.kid.has}%（只有 ${sv.kid.hasN} 人次，樣本很小）。同樣是相關而非因果，但這幾顆棋子的價值高、復活條件也嚴格，保住它們比多吃一顆小子更重要。`, evidence: '100 局，每局雙方各算一人次。'},
  {title: '先吃到子的一方稍占優勢，但不是定律', kind: '數據', text: `第一次吃子發生在第 ${an.firstCaptureAvgPly} 手左右（中位數 30 手，最早 11 手、最晚 62 手）。先吃到子的一方最後贏的比例是 ${an.firstCapture.winRate}%；先完成第一次斬擊的一方是 ${an.firstSlash.winRate}%。樣本只有 100 局，誤差大約 ±5 個百分點，所以只能說「略有優勢」，不要為了搶先吃子而冒險。`, evidence: `先吃子 ${an.firstCapture.n} 局、先斬擊 ${an.firstSlash.n} 局。`},
  {title: '先手優勢很小', kind: '數據', text: `白方（先手）勝 ${an.wins.w} 局、黑方勝 ${an.wins.b} 局、和局 ${an.wins.d} 局（${an.whiteRate}% / ${an.blackRate}% / ${an.drawRate}%）。差距在統計誤差之內，先手並沒有決定性的優勢，所以不需要為了搶先手去走勉強的開局。`, evidence: '100 局，雙方同一個 AI。'},
  {title: '開局：目前沒有明顯優越的定式', kind: '數據', text: `每個第一手最多只出現 10 局，勝率都落在隨機波動的範圍內，所以我不能宣稱哪一個開局比較好。白方最常見的是鞋子到 a3（9 局 5 勝）、量產型戰士到 d3（9 局 2 勝）；黑方最常見的是龍到 a7（10 局 5 勝）。可以確定的只有：第一次吃子的中位數在第 30 手，前面這段時間雙方都在佈陣。`, evidence: '見下方「開局第一手」表；樣本不足以命名定式。'},
  {title: '龍轉生與復活，是中盤補強的主要手段', kind: '數據', text: `100 局平均每局有 ${an.avgPromote} 次龍轉生成士、${an.avgRevive} 次復活、${an.avgSlash} 次斬擊；孩的死亡連鎖只發生了 7 次（平均每局 0.07 次）。連鎖威力很大但很少真的觸發。我沒有統計它為什麼少，可能是 AI 搜尋時看得到後果、不輕易去殺孩，這只是推測；但規則上，把士放在孩的旁邊，確實會讓對方殺孩的代價變高。`, evidence: `OTL 在 100 局中從未出現：OL 吃己方的龍會白白損失 2 分，AI 沒有理由這麼做。`},
  {title: '評估權重的學習：資料裡的線索，但沒能變強', kind: '嘗試未證實', text: `我用 ${L.samples} 個局面的資料，做了一次「由局面特徵預測終局勝負」的學習。學到的權重在資料上擬合得更好（損失 ${L.nllPrior} 降到 ${L.nllLearned}），例如孩的價值被估到約 ${L.learned[2]} 分（原本 8）、中心控制的權重變大。但拿去對戰時，學到的版本對原本的版本只拿到 39.6%（24 局 8 勝 13 負 3 和），折衷版是 52.1%（11 勝 10 負 3 和）。結論：沒有證據顯示它更強，所以超高階 AI 仍使用原本的點數表。這些數字當作「值得再研究的線索」就好，不要當成公式。`, evidence: '對戰驗證每手 0.06 秒、100 手上限，局數太少，無法排除是隨機誤差。'},
  {title: '時間管理：每手在 8 秒內走完，自由時間就不會減少', kind: '規則推導', text: '每手 8 秒內走完，自由時間（301 秒）一毫秒都不會扣；只有超過 8 秒才開始消耗。結算時自由時間沒燒完的一方加 10 分，約等於一顆咚，往往就足以決定勝負（100 局裡贏家平均只領先 6.2 分）。殘局雙方都剩 7 顆以下時每手縮為 3 秒，要提早做好準備。', formula: '每手 ≤ 8 秒 → 自由時間不減 → 結算 +10', evidence: '依規則計算，不是對局統計。'}
];
const f1 = x => (Math.round(x * 100) / 100).toString();
const tables = [
  {title: '100 局超高階自我對弈：整體統計', head: ['項目', '數值'], rows: [['對局數', '100'], ['白方勝 / 黑方勝 / 和局', `${an.wins.w} / ${an.wins.b} / ${an.wins.d}`], ['走到步數上限、依分數判定', `${an.capped} 局`], ['真的吃到王', `${an.kingKills} 局`], ['平均每局吃子次數', f1(an.avgCapture)], ['平均每局斬擊 / 復活 / 龍轉生', `${an.avgSlash} / ${an.avgRevive} / ${an.avgPromote}`], ['孩的死亡連鎖（100 局合計）', '7 次']], note: '自我對弈設定：每手 0.09 秒，步數上限 180 手。真實對局有棋鐘，時間更長。'},
  {title: '終局時棋子還在 / 不在場的勝率（和局算半勝）', head: ['棋子', '還在場', '勝率', '不在場', '勝率'], rows: ['dong', 'night', 'tea', 'guard', 'iron', 'kid', 'ol', 'shoe', 't'].map(t => [sv[t].name, sv[t].hasN, sv[t].has + '%', sv[t].noN, sv[t].no + '%']), note: '單位是「人次」（每局雙方各算一次）。人次少的格子（孩、咚不在場）參考價值低；相關不等於因果。'},
  {title: '開局第一手（出現次數最多的五種）', head: ['方', '第一手', '局數', '勝'], rows: [...open.w.map(r => ['白', ...r]), ...open.b.map(r => ['黑', ...r])], note: '每種最多 10 局，勝率差異都在隨機波動內，不能當作定式。'},
  {title: '評估權重：原本 vs 學到的（僅供參考）', head: ['特徵', '原本', '學到'], rows: L.names.map((n, i) => [n, L.prior[i], L.learned[i]]), note: '學到的權重對戰驗證沒有勝過原本的（39.6%，折衷版 52.1%），超高階 AI 仍用「原本」那一欄。'}
];
fs.writeFileSync('public/data/learn.json', JSON.stringify({intro: '以下規律來自 100 局「超高階 vs 超高階」自我對弈的統計，以及由規則推導的算式。每一條都標示了依據（數據／規則推導／嘗試未證實）與樣本大小；樣本只有 100 局，請把它當成參考，而不是定理。', patterns, tables}));
console.log('教學資料已產生：', patterns.length, '條規律，', tables.length, '張表');
