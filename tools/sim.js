'use strict';
// 自我對弈工具：兩個 AI 下一整局，記錄每一步與棋譜註解
const Rules = require('../public/rules.js'), AI = require('../ai.js');
function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// 強制開局：bookW／bookB 是 [{name, fx, fy, tx, ty}, …]（棋子名稱、起點、終點；座標是 x=0..8、y=0..8，y=0 是黑方底線）。
// 該方前 N 手（只算「移動」）優先照書走；某一步在當下不合法（棋子被吃了、走不到）就放棄這一步，交回 AI。
function bookAction(G, side, spec){
  const p = G.pieces.find(q => q.side === side && q.x === spec.fx && q.y === spec.fy && Rules.TYPES[q.type].name === spec.name);
  if (!p || Rules.frozen(G, p.id)) return null;
  return Rules.moves(G, p.id).some(m => m.x === spec.tx && m.y === spec.ty) ? {t: 'move', pid: p.id, x: spec.tx, y: spec.ty} : null;
}
function playGame(o){
  const rnd = mulberry32(o.seed || 1), G = Rules.create(), actions = [], notes = [], cap = o.moveCap || 160;
  let moves = 0, plies = 0;
  // 停滯中止：連續 staleCut 手都沒有任何吃子就提早收手，用來省生成時間。
  // 注意這是「速度換保真度」，不是免費的：安靜一段之後仍然可能再爆發吃子，
  // 實測 staleCut=40 會把平均手數從 200 砍到 69（快 3 倍），但等於提早判定了一些還沒死的局面；
  // staleCut=80 只省約 7%。要大量產資料可以調小，要資料忠實就調大或不用。
  const bookHit = {w: 0, b: 0}, bookMiss = {w: 0, b: 0};
  const staleCut = o.staleCut || 0; let lastCap = 0, nPieces = G.pieces.length;
  while (!G.over && moves < cap) {
    if (staleCut && moves - lastCap >= staleCut) { break; }
    const side = G.phase ? G.phase.side : G.turn, lv = side === 'w' ? o.w : o.b, budget = side === 'w' ? o.bw : o.bb;
    const tol = o.openTol && moves < (o.openPlies || 12) ? o.openTol : 0.05;
    let forced = null;
    if (!G.phase) { const book = side === 'w' ? o.bookW : o.bookB;
      if (book) { const own = actions.filter(x => x.s === side && x.a.t === 'move').length; if (own < book.length) forced = bookAction(G, side, book[own]); if (own < book.length && !forced) bookMiss[side]++; } }
    let list = []; try { list = AI.chooseActions(G, side, lv, {budgetMs: budget, rnd, tol, weights: side === 'w' ? o.ww : o.wb}); } catch (e) { console.error(e); }
    let ok = false;
    // 前 N 手禁止動王（實驗用：驗證「王早出動」是不是因果）；過濾後沒有候選就保留原本的，避免卡死
    const nk = side === 'w' ? o.noKingW : o.noKingB;
    if (nk && !G.phase && actions.filter(x => x.s === side && x.a.t === 'move').length < nk) {
      const f = list.filter(a => { if (a.t !== 'move') return true; const p = G.pieces.find(q => q.id === a.pid); return !(p && p.type === 'king'); }); if (f.length) list = f; }
    if (forced) list = [forced, ...list];
    for (const a of list) { const h0 = G.hist.length, r = Rules.play(G, side, a, 0); if (r.ok) { actions.push({s: side, a}); notes.push(G.hist.slice(h0)); ok = true; if (a === forced) bookHit[side]++; break; } }
    if (!ok && !G.phase) for (const p of G.pieces.filter(q => q.side === side)) { const m = Rules.moves(G, p.id)[0];
      if (m) { const a = {t:'move', pid:p.id, x:m.x, y:m.y}, h0 = G.hist.length; if (Rules.play(G, side, a, 0).ok) { actions.push({s: side, a}); notes.push(G.hist.slice(h0)); ok = true; break; } } }
    if (!ok) break;
    if (G.pieces.length !== nPieces) { nPieces = G.pieces.length; lastCap = moves; }   // 子數有變＝有吃子或復活
    plies++; if (!G.phase || true) moves = actions.filter(x => x.a.t === 'move').length;
    if (o.onPly) o.onPly(G, actions.length);
  }
  const capped = !G.over; if (capped) Rules.adjudicate(G);
  return {seed: o.seed, w: o.w, b: o.b, stale: staleCut ? moves - lastCap >= staleCut : false, over: G.over, reason: G.result ? G.result.reason : 'king', result: G.result || null, capped, moves, actions, notes, hist: G.hist, book: {hit: bookHit, miss: bookMiss}};
}
module.exports = {playGame, mulberry32};
