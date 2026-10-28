/* 九路棋盤 AI（伺服器端使用）。
   chooseAction(G, side, level, opt) → 回傳一個可直接丟給 Rules.play / Rules.apply 的動作，或 null（還沒輪到 AI）。
   level：'medium' 中等（2 手深度＋適度失誤）、'advanced' 進階（迭代加深到 6 手，限時內盡量算深）。
   opt.budgetMs：思考時間上限（預設 medium 400ms／advanced 1500ms）；opt.rnd：亂數函式。
   會自動避開「照走就因長將／長殺／長捉而判負」的著法。 */
const Rules = require('./public/rules.js');
const {superRank} = require('./ai-super.js');
const VAL = {king:1000, dong:10, ol:8, kid:8, tea:7, night:5, t:2};
const v = p => p.type in VAL ? VAL[p.type] : 3;
const opp = s => s==='w' ? 'b' : 'w';
const TIMEOUT = {};

/* 逼王相關的三個權重（實測結果見下，預設只開 NOREPEAT）

   問題：雙方同級對打幾乎都打到步數上限。實測 medium 互打 40 局只有 8% 分出勝負，
   advanced 互打 24 局是 0%。把上限從 200 放寬到 600 更糟（0% 分出勝負、每局都走滿 600 手），
   所以這是真的僵局，不是「再多給幾手就會結束」。
   原因有二：evaluate() 只算子力，雙方換到平手後評估值變得很平，AI 就原地來回走
   （殘局棋譜常見 龍 b6→b7→b6、鞋子 g5→i3→g1→i3）；而且沒有任何一項會把棋子帶向敵王。

   TROPISM（靠近敵王）／KINGBOX（堵死敵王出路）確實能讓 AI 去抓王，但代價很大。
   以 medium 對 medium、新舊評估各執黑白 40 局實測（trop=0.8, box=0.25，未設子力門檻）：
     吃王獲勝        新 6 : 舊 4   ← 抓王確實變強
     打到上限比分數  新 2 : 舊 27  ← 但送子送到分數慘輸
     整體勝率        20.5%
   加上「子力領先才開啟」的門檻後勝率回到 47.5%，但分出勝負率也掉回 3%，
   因為勢均力敵時門檻根本不會開啟。
   結論：在「打到上限依子力分數判定勝負」的規則下，為了抓王而送子在數學上就是虧的，
   這不是調參數能解決的取捨。因此 TROPISM／KINGBOX 預設為 0，要實驗再自行開啟：
     CHESS_TROPISM=0.8 CHESS_KINGBOX=0.25 node tools/local-gen.js --direct --games 40
   或呼叫 chooseActions 時傳 {tropism, kingbox}。想要「更多吃王結局、可以接受棋力變弱」就開它。

   NOREPEAT（反空轉）預設開啟：它只在根節點對「走回已出現過的局面」扣分，不碰子力評分，
   實測勝率 50.0%（等於沒變強也沒變弱），但可以消掉上面那種來回空轉的難看棋譜。 */
let TROPISM = process.env.CHESS_TROPISM !== undefined ? +process.env.CHESS_TROPISM : 0;
let KINGBOX = process.env.CHESS_KINGBOX !== undefined ? +process.env.CHESS_KINGBOX : 0;
let NOREPEAT = process.env.CHESS_NOREPEAT !== undefined ? +process.env.CHESS_NOREPEAT : 0.5;
function kingBox(k, K){            // 王周圍還能走的格子數（空格或可吃的敵子），0..8
  if(!K) return 0;
  let n = 0;
  for(let dy=-1; dy<=1; dy++) for(let dx=-1; dx<=1; dx++){
    if(!dx && !dy) continue;
    const x = K.x+dx, y = K.y+dy;
    if(x<0 || y<0 || x>=Rules.SIZE || y>=Rules.SIZE) continue;
    const q = k.pieceAt(x,y);
    if(!q || q.side!==K.side) n++;
  }
  return n;
}
function evaluate(k, side){
  let s = 0;
  const ps = k.pieces(), en = opp(side);
  let myK = null, enK = null;
  for(const p of ps){ if(p.type!=='king') continue; if(p.side===side) myK = p; else enK = p; }
  let mat = 0;
  for(const p of ps){
    let x = v(p);
    if(p.type==='t') x += (p.side==='w' ? Rules.SIZE-1-p.y : p.y) * 0.08;        // 龍越接近底線越好（可轉生）
    else if(p.type!=='king') x += (4 - Math.abs(p.x-4)) * 0.02;                   // 略偏好中路
    s += p.side===side ? x : -x;
    if(p.type!=='king') mat += p.side===side ? v(p) : -v(p);
  }
  // 逼王只在「子力領先」時才開啟，而且領先越多壓得越兇。
  // 不設這個條件的話，AI 會為了靠近敵王而送子：實測固定開啟時吃王數雖然變多（6:4），
  // 但打到上限的局面幾乎全輸（2:27），整體勝率只剩兩成。
  const push = Math.max(0, Math.min(1, mat / 12));
  if(push > 0 && (TROPISM || KINGBOX)){
    let trop = 0;
    for(const p of ps){
      if(p.type==='king') continue;
      const K = p.side===side ? enK : myK;
      if(!K) continue;
      const near = Rules.SIZE - 1 - Math.max(Math.abs(p.x-K.x), Math.abs(p.y-K.y));
      trop += p.side===side ? near : -near;
    }
    s += push * (TROPISM * trop + KINGBOX * (kingBox(k, myK) - kingBox(k, enK)));
  }
  return s;
}
function ordered(k, side){
  const list = k.moves(side);
  for(const o of list){ const q = k.pieceAt(o.m.x,o.m.y); o.o = q && q.side!==side ? v(q)*10 - v(o.p) : 0; }
  return list.sort((a,b) => b.o - a.o);
}
function search(k, side, depth, alpha, beta, deadline){
  const ov = k.over();
  if(ov) return ov==='draw' ? 0 : ov===side ? 5000+depth : -(5000+depth);
  if(depth===0) return evaluate(k, side);
  if(Date.now() > deadline) throw TIMEOUT;
  const list = ordered(k, side);
  if(!list.length) return search(k, opp(side), depth-1, -beta, -alpha, deadline) * -1;   // 無棋可走＝跳過
  let best = -Infinity;
  for(const {p,m} of list){
    const sc = k.trial(() => { k.play(p,m); return -search(k, opp(side), depth-1, -beta, -alpha, deadline); });
    if(sc > best) best = sc;
    if(best > alpha) alpha = best;
    if(alpha >= beta) break;
  }
  return best;
}
// 回傳依偏好排序的候選著法 [{pid,x,y,v}]
// 初階：一半的時候亂走，其餘只看一步（吃得到就吃）；偶爾連王被威脅都沒發現
function rankBeginner(k, side, rnd){
  const root = k.moves(side); if(!root.length) return [];
  const scored = root.map(({p,m}) => ({p, m, v: k.trial(() => { k.play(p,m); return evaluate(k, side) + rnd()*1.5; })})).sort((a,b) => b.v - a.v);
  const first = rnd() < 0.5 ? root.map(({p,m}) => ({p,m,v:0}))[Math.floor(rnd()*root.length)] : scored[Math.floor(rnd()*Math.min(3, scored.length))];
  return [first, ...scored.filter(s => !(s.p===first.p && s.m===first.m))].map(s => ({pid:s.p.id, x:s.m.x, y:s.m.y, v:s.v}));
}
function rank(k, side, level, budget, rnd){
  if(level==='beginner') return rankBeginner(k, side, rnd);
  if(level==='super'){
    const sc = superRank(k, side, budget, rnd, {tol: opt0.tol, maxDepth: opt0.maxDepth, weights: opt0.weights});
    if(!sc.length) return [];
    const pool = sc.filter(s => s.v >= sc[0].v - (opt0.tol !== undefined ? opt0.tol : 0.05));
    const first = pool[Math.floor(rnd()*pool.length)];
    return [first, ...sc.filter(s => s!==first)].map(s => ({pid:s.p.id, x:s.m.x, y:s.m.y, v:s.v}));
  }
  const deadline = Date.now() + budget, root = ordered(k, side);
  const maxDepth = level==='advanced' ? 6 : 2;
  let scored = null;
  for(let d=2; d<=maxDepth; d+=2){
    const cur = []; let alpha = -Infinity;
    try {
      for(const {p,m} of root){
        // 根節點每一步都用完整視窗搜尋：原本用 -alpha 當視窗時，進階 AI 的所有根著法分數會變成一樣，等於隨機亂走
        const sc = k.trial(() => { k.play(p,m); return -search(k, opp(side), d-1, -Infinity, Infinity, deadline); });
        cur.push({p,m,v:sc});
      }
    } catch(e){ if(e!==TIMEOUT) throw e; break; }
    scored = cur.sort((a,b) => b.v - a.v);
    root.splice(0, root.length, ...scored);   // 下一層用上一層結果排序
  }
  if(!scored) scored = root.map(({p,m}) => ({p,m,v:0}));
  if(!scored.length) return [];
  if(NOREPEAT){        // 反空轉：回到舊局面的著法扣分（只在根節點做，不影響 evaluate 的子力評分）
    const seen = new Set((k.rec() || []).map(r => r.k));
    for(const sc of scored){
      const h = k.trial(() => { k.play(sc.p, sc.m); return k.hash(); });
      if(seen.has(h)) sc.v -= NOREPEAT;
    }
    scored.sort((a,b) => b.v - a.v);
  }
  const best = scored[0].v;
  const pool = scored.filter(s => s.v >= best - (level==='advanced' ? 0.05 : 0.6));
  let first = pool[Math.floor(rnd()*pool.length)];
  if(level==='medium' && rnd() < 0.15) first = scored[Math.floor(rnd()*Math.min(4, scored.length))];   // 中等：偶爾失誤
  return [first, ...scored.filter(s => s!==first)].map(s => ({pid:s.p.id, x:s.m.x, y:s.m.y, v:s.v}));
}
// 回傳依偏好排序的候選動作陣列（伺服器依序嘗試，第一個被接受的就用；用來應付「禁止著法」等額外限制）
let opt0 = {};
function chooseActions(G, side, level='medium', opt={}){
  if(typeof Rules.kit!=='function') throw new Error('rules.js 缺少 Rules.kit（AI 需要）');
  opt0 = opt;
  if(opt.tropism !== undefined) TROPISM = +opt.tropism;      // 每次呼叫可覆寫，方便對照測試
  if(opt.kingbox !== undefined) KINGBOX = +opt.kingbox;
  if(opt.norepeat !== undefined) NOREPEAT = +opt.norepeat;
  const rnd = opt.rnd || Math.random, budget = opt.budgetMs || ({beginner:120, advanced:1500, super:3000}[level] || 400);
  const r = Rules.kit(G, k => {
    const ph = k.phase();
    if(ph){
      if(ph.side!==side) return null;
      if(ph.kind==='slash') return {act:{t:'slash', yes:true}};
      if(ph.kind==='pick') return {act:{t:'pick', ty:k.bestPick()}};
      const c = k.bestCell(side); return {act:{t:'place', x:c.x, y:c.y}};
    }
    if(k.over() || k.turn()!==side) return null;
    return {cands: rank(k, side, level, budget, rnd)};
  });
  if(!r) return [];
  if(r.act) return [r.act];
  const acts = r.cands.map(c => ({t:'move', pid:c.pid, x:c.x, y:c.y}));
  if(typeof Rules.wouldLoseByRepeat==='function'){   // 必須變著：會因重複判負的排到最後
    const safe = [], risky = [];
    acts.forEach((a,i) => (i<6 && Rules.wouldLoseByRepeat(G, side, a) ? risky : safe).push(a));
    return [...safe, ...risky];
  }
  return acts;
}
const chooseAction = (G, side, level, opt) => chooseActions(G, side, level, opt)[0] || null;
module.exports = {chooseAction, chooseActions};
