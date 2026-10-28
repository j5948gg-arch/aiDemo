<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>九路棋盤・本機測試版</title>
<style>
:root{box-sizing:border-box;--bg:#e9eeee;--ink:#1d2b2e;--sq1:#c9d8d6;--sq2:#8fa9a6;--panel:#f6f9f9;--line:#b5c5c3;--sel:#e0a526}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#10181a;--ink:#dbe6e5;--sq1:#41585a;--sq2:#2c4042;--panel:#182527;--line:#32484a}}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;display:flex;flex-wrap:wrap;gap:16px;justify-content:center;padding:16px}
#board{--cell:min(10.2vw,64px);display:grid;grid-template-columns:repeat(9,var(--cell));grid-auto-rows:var(--cell);width:max-content;height:max-content;flex:none;border:2px solid var(--ink)}
.sq{width:var(--cell);height:var(--cell);box-sizing:border-box;position:relative;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden}
.sq.d{background:var(--sq2)}.sq.l{background:var(--sq1)}
.sq.sel{outline:3px solid var(--sel);outline-offset:-3px}
.sq.mv::after{content:"";position:absolute;width:26%;height:26%;border-radius:50%;background:var(--sel)}
.sq.ban::after{background:#c0392b!important;border-radius:2px!important;width:34%!important;height:34%!important}
.sq.last{box-shadow:inset 0 0 0 3px #3a7bd5}
.sq .c{position:absolute;left:3px;top:1px;font-size:10px;opacity:.55}
.sq img{width:88%;height:88%;object-fit:contain;display:block;pointer-events:none}
aside{width:min(92vw,320px);background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:14px;font-size:15px;line-height:1.7;align-self:flex-start}
button{margin:4px 6px 0 0;padding:4px 12px;border:1px solid var(--ink);background:none;color:inherit;border-radius:6px;cursor:pointer;font:inherit}
button:disabled{opacity:.4;cursor:default}
select{padding:4px 8px;border:1px solid var(--ink);background:var(--bg);color:var(--ink);border-radius:6px;font:inherit;margin:2px 0}
label{display:block;font-size:13px;margin-top:6px;opacity:.8}
.tag{display:inline-block;border:1px solid var(--ink);border-radius:10px;padding:0 8px;margin:2px 4px 2px 0;font-size:12px}
.banner{background:var(--ink);color:var(--bg);font-size:19px;font-weight:700;padding:10px 12px;border-radius:6px;margin:6px 0;line-height:1.4}
.banner.me{background:var(--sel);color:#1d2b2e}
.banner .warn{background:#c0392b;color:#fff;padding:2px 8px;border-radius:4px;margin-top:6px;font-size:15px;display:inline-block}
#panel{min-height:1.7em;margin:4px 0}
#info{min-height:3em;font-size:14px}
#hist{max-height:200px;overflow:auto;font-size:13px;border-top:1px solid var(--line);margin-top:8px;padding-top:6px;white-space:pre-wrap}
code{font-size:12px}
.sm{font-size:12px;opacity:.7;margin:6px 0 0}
hr{border:none;border-top:1px solid var(--line);margin:10px 0}
.score{display:flex;justify-content:space-between;font-size:14px}
#fatal{flex-basis:100%;background:#c0392b;color:#fff;padding:14px 16px;border-radius:6px;font-size:15px;line-height:1.6;white-space:pre-wrap}
#fatal b{font-size:17px}
</style>
</head>
<body>
<div id="fatal" hidden></div>
<div id="board"></div>
<aside>
  <div id="turn" class="banner"></div>
  <div id="panel"></div>
  <div class="score"><span id="sw"></span><span id="sb"></span></div>
  <hr>
  <label>對戰模式</label>
  <select id="mode">
    <option value="hh">人 vs 人（同一台電腦輪流下）</option>
    <option value="ha" selected>人 vs AI</option>
    <option value="aa">AI vs AI（觀戰）</option>
  </select>
  <div id="haOpt">
    <label>你執</label>
    <select id="myside"><option value="w" selected>白方（先手）</option><option value="b">黑方</option></select>
    <label>AI 等級</label>
    <select id="lv"><option value="beginner">初階</option><option value="medium" selected>中等</option><option value="advanced">進階</option><option value="super">超高階</option></select>
  </div>
  <div id="aaOpt" hidden>
    <label>白方 AI</label>
    <select id="lvw"><option value="beginner">初階</option><option value="medium" selected>中等</option><option value="advanced">進階</option><option value="super">超高階</option></select>
    <label>黑方 AI</label>
    <select id="lvb"><option value="beginner">初階</option><option value="medium">中等</option><option value="advanced" selected>進階</option><option value="super">超高階</option></select>
  </div>
  <div>
    <button id="newg">新對局</button>
    <button id="undo">悔棋</button>
    <button id="resign">投降</button>
  </div>
  <div id="info"></div>
  <div id="hist"></div>
  <p class="sm">本機測試版：規則與 AI 全部在瀏覽器內執行，不連伺服器、沒有棋鐘。<span id="ver"></span></p>
</aside>
<script>
//__BUNDLE__
</script>
<script>
function __fatal(title, detail){
  var el = document.getElementById('fatal'); if(!el) return;
  el.hidden = false; el.innerHTML = '';
  var b = document.createElement('b'); b.textContent = title; el.appendChild(b);
  if(detail){ el.appendChild(document.createElement('br')); el.appendChild(document.createTextNode(detail)); }
}
window.addEventListener('error', function(e){   // 任何沒接住的錯誤都顯示在畫面上，不要只是靜靜地壞掉
  __fatal('網頁發生錯誤，棋盤無法啟動', (e.message || e.error) + (e.lineno ? '（第 ' + e.lineno + ' 行）' : ''));
});
if(typeof require !== 'function'){
  __fatal('這個檔案還沒有打包，無法使用',
    '你開到的是版型檔 tools/local-ui.html，裡面還沒有規則與 AI。\n請先執行 npm run build-local，然後改開專案根目錄的 local-test.html。');
}
</script>
<script>
(function(){
'use strict';
if(typeof require !== 'function') return;   // 上面已經顯示錯誤訊息了
var Rules = require('./public/rules.js'), AI = require('./ai.js');
var TYPES = Rules.TYPES, SIZE = Rules.SIZE, N = Rules.N;
var $ = function(id){ return document.getElementById(id); }, files = 'abcdefghi';
var S = function(s){ return s==='w' ? '白方' : '黑方'; };
var sq = function(o){ return files[o.x] + (SIZE-o.y); };
var esc = function(s){ return String(s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); };

var G = null, selected = null, moves = [], banned = [], hiLast = null, thinking = false, stack = [];
var phc = {};
function placeholder(label, side){
  var f = side==='w' ? '#f3efe4' : '#27363a', k = side==='w' ? '#27363a' : '#f3efe4', n = label.length;
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="'+f+'" stroke="'+k+'" stroke-width="4"/><circle cx="50" cy="50" r="38" fill="none" stroke="'+k+'" stroke-width="1.5"/><text x="50" y="'+(n>1?60:66)+'" font-size="'+(n>2?26:n>1?34:48)+'" text-anchor="middle" font-family="serif" fill="'+k+'">'+label+'</text></svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
var img = function(p){ var t = TYPES[p.type]; return t.image || phc[t.label+p.side] || (phc[t.label+p.side] = placeholder(t.label, p.side)); };
var pieceAt = function(x,y){ return G.pieces.find(function(p){ return p.x===x && p.y===y; }); };
var actor = function(){ return G.phase ? G.phase.side : G.turn; };

// 對手設定：回傳該方的 AI 等級，人類則 null
function levelOf(side){
  var m = $('mode').value;
  if(m==='hh') return null;
  if(m==='aa') return side==='w' ? $('lvw').value : $('lvb').value;
  return side===$('myside').value ? null : $('lv').value;
}
var isHuman = function(side){ return levelOf(side)===null; };
// 瀏覽器單執行緒，思考時間放小一點，畫面才不會卡太久
var BUDGET = {beginner:120, medium:300, advanced:800, super:1500};

function newGame(){
  G = Rules.create(); selected = null; moves = []; banned = []; hiLast = null; stack = []; thinking = false;
  $('info').textContent = ''; render();
}
var snap = function(){ stack.push(JSON.stringify(G)); if(stack.length>200) stack.shift(); };
function undo(){
  if(thinking || !stack.length) return;
  // 退回到最近一個「輪到人類」的局面，單機才有意義
  for(var i=0;i<40 && stack.length;i++){
    G = JSON.parse(stack.pop()); selected = null; moves = []; banned = []; hiLast = null;
    if($('mode').value==='aa' || isHuman(actor()) || G.over) break;
  }
  render();
}
function doAct(side, a){
  var r = Rules.play(G, side, a, Date.now());
  if(r && r.ok===false && r.error) $('info').textContent = r.error;
  if(a.t==='move'){ var p = G.pieces.find(function(q){ return q.id===a.pid; }); hiLast = {x:a.x, y:a.y}; }
  return r;
}
function step(){   // 若輪到 AI 就思考一手（setTimeout 讓畫面先更新）
  if(!G || G.over || thinking) return;
  var side = actor(), lv = levelOf(side);
  if(lv===null) return;
  thinking = true; render();
  setTimeout(function(){
    try{
      var list = AI.chooseActions(G, side, lv, {budgetMs:BUDGET[lv]||400, rnd:Math.random, tol:0.05});
      snap();
      var done = false;
      for(var i=0;i<list.length;i++){ var r = doAct(side, list[i]); if(r && (r.ok || r.ended)){ done = true; break; } }
      if(!done){ stack.pop(); $('info').textContent = 'AI 找不到可走的動作'; }
    }catch(e){ $('info').textContent = 'AI 錯誤：' + e.message; }
    thinking = false; render();
  }, 20);
}
var tagsOf = function(p){ return [S(p.side)].concat(TYPES[p.type].tags, p.fresh ? ['剛復活'] : []); };
function showInfo(p){
  $('info').innerHTML = '<div><b>'+esc(N(p))+'</b> <code>'+esc(p.id)+'</code></div><div>位置：'+sq(p)+'</div><div>'+
    tagsOf(p).map(function(t){ return '<span class="tag">'+esc(t)+'</span>'; }).join('')+'</div>';
}
function click(x,y){
  if(thinking || !G || G.over) return;
  var q = pieceAt(x,y), side = actor();
  if(!isHuman(side)){ if(q) showInfo(q); return; }
  if(G.phase){ if(G.phase.kind==='place' && !q){ snap(); doAct(side, {t:'place', x:x, y:y}); render(); } return; }
  if(selected && moves.some(function(m){ return m.x===x && m.y===y; })){
    var s = selected; selected = null; moves = []; banned = [];
    snap(); doAct(side, {t:'move', pid:s.id, x:x, y:y}); return render();
  }
  if(q && q===selected){ selected = null; moves = []; banned = []; }
  else if(q && q.side===side){
    if(Rules.frozen(G, q.id)){ selected = null; moves = []; banned = []; $('info').textContent = '該棋子被冰凍，無法移動！'; }
    else {
      selected = q; moves = Rules.moves(G, q.id); banned = [];
      try{ banned = moves.filter(function(m){ return Rules.wouldLoseByRepeat(G, side, {t:'move', pid:q.id, x:m.x, y:m.y}); }); }catch(e){}
      showInfo(q);
      if(banned.length) $('info').innerHTML += '<div style="color:#c0392b">⚠ 紅色標記：走了會因重複局面（長將／長殺／長捉）判負</div>';
    }
  }
  else { selected = null; moves = []; banned = []; if(q) showInfo(q); }
  render();
}
function banner(){
  var el = $('turn');
  if(G.over){ el.className = 'banner'; el.innerHTML = '<div>'+(G.over==='draw' ? '和局' : S(G.over)+'獲勝')+(G.result&&G.result.reason ? '（'+esc(G.result.reason)+'）' : '')+'</div>'; return; }
  var ph = G.phase, who = actor(), human = isHuman(who), chk = !ph && Rules.check(G, G.turn);
  var act = ph ? {slash:'斬擊確認', pick:'選擇復活的棋子', place:'放置復活的棋子'}[ph.kind] : '下棋';
  el.className = 'banner' + (human ? ' me' : '');
  el.innerHTML = '<div>'+(thinking ? S(who)+' AI 思考中…' : (human ? '輪到你：' : '輪到 ')+S(who)+'・'+act)+'</div>' +
    (chk ? '<div class="warn">⚠ '+S(G.turn)+'的王受威脅（不強制解除）</div>' : '');
}
function panelUI(){
  var p = $('panel'); p.innerHTML = ''; var ph = G.phase;
  var add = function(t,f){ var b = document.createElement('button'); b.textContent = t; b.onclick = f; p.appendChild(b); };
  if(G.over || !ph) return;
  var side = ph.side;
  if(!isHuman(side)){ p.textContent = S(side)+' AI 處理中…'; return; }
  if(ph.kind==='slash'){
    var t = G.pieces.find(function(o){ return o.id===ph.tid; });
    p.append('是否發動斬擊？目標：'+(t ? S(t.side)+N(t)+'（'+sq(t)+'）' : ''));
    add('斬擊', function(){ snap(); doAct(side,{t:'slash',yes:true}); render(); });
    add('不斬擊', function(){ snap(); doAct(side,{t:'slash',yes:false}); render(); });
  } else if(ph.kind==='pick'){
    p.append('選擇復活的棋子');
    ph.cands.forEach(function(ty){ add(TYPES[ty].name, function(){ snap(); doAct(side,{t:'pick',ty:ty}); render(); }); });
  } else p.textContent = '請點選空格，放置 ' + TYPES[ph.ty].name;
}
function render(){
  if(!G) return;
  var b = $('board'); b.innerHTML = '';
  for(var y=0;y<SIZE;y++) for(var x=0;x<SIZE;x++){
    var d = document.createElement('div');
    d.className = 'sq ' + ((x+y)%2 ? 'd' : 'l');
    if(selected && selected.x===x && selected.y===y) d.className += ' sel';
    if(moves.some(function(m){ return m.x===x && m.y===y; })) d.className += ' mv';
    if(banned.some(function(m){ return m.x===x && m.y===y; })) d.className += ' ban';
    if(hiLast && hiLast.x===x && hiLast.y===y) d.className += ' last';
    if(x===0 || y===SIZE-1){ var c = document.createElement('span'); c.className='c'; c.textContent = sq({x:x,y:y}); d.appendChild(c); }
    var q = pieceAt(x,y);
    if(q){ var im = document.createElement('img'); im.src = img(q); im.alt = N(q); d.appendChild(im); }
    (function(xx,yy){ d.onclick = function(){ click(xx,yy); }; })(x,y);
    b.appendChild(d);
  }
  banner(); panelUI();
  $('sw').textContent = '白 ' + Rules.pts(G,'w') + ' 分（' + G.pieces.filter(function(p){return p.side==='w';}).length + ' 顆）';
  $('sb').textContent = '黑 ' + Rules.pts(G,'b') + ' 分（' + G.pieces.filter(function(p){return p.side==='b';}).length + ' 顆）';
  var h = $('hist'); h.textContent = G.hist.map(function(l,i){ return (i+1)+'. '+l; }).join('\n'); h.scrollTop = h.scrollHeight;
  $('undo').disabled = thinking || !stack.length;
  $('resign').disabled = thinking || G.over || $('mode').value==='aa';
  step();
}
$('mode').onchange = function(){
  var m = $('mode').value;
  $('haOpt').hidden = m!=='ha'; $('aaOpt').hidden = m!=='aa';
  newGame();
};
$('myside').onchange = newGame; $('lv').onchange = newGame;
$('lvw').onchange = newGame; $('lvb').onchange = newGame;
$('newg').onclick = newGame;
$('undo').onclick = undo;
$('resign').onclick = function(){
  if(thinking || G.over) return;
  var me = $('mode').value==='hh' ? actor() : $('myside').value;
  snap(); doAct(me, {t:'resign'}); render();
};
$('ver').textContent = '建置：__BUILT__';
newGame();
})();
</script>
</body>
</html>
