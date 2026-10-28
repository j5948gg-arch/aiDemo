#!/usr/bin/env node
'use strict';
/* 把「對局紀錄文字檔」匯入成網站「高手對決」的回放資料。
   用法：node tools/import-replays.js <對局.txt>     → 產生 data/replays.json
         再執行 npm run build-data                    → 寫入 public/data/games.json
   文字檔格式：每局一段，第一行是「=== 對局 <id>｜… ===」，之後每行「N. 棋譜」（就是 tools/local-gen.js 輸出的 .txt）。
   文字檔只有棋譜、沒有棋子編號，所以這裡用規則引擎逐行還原成動作（移動用「起點格＋棋子名稱」找棋子；咚移動後沒接「斬殺」＝選擇不斬；
   「復活在」＝選角色＋選位置），還原後把引擎產生的紀錄和文字檔逐行比對，完全一致才算成功。 */
const fs = require('fs'), Rules = require('../public/rules.js');
const file = process.argv[2]; if (!file) { console.error('用法：node tools/import-replays.js <對局.txt>'); process.exit(1); }
const TEXTS = require('./replay-texts.js');   // 每局的標題與說明（人工撰寫）
const NAME = {}; Object.entries(Rules.TYPES).forEach(([ty, d]) => NAME[d.name] = ty); NAME['謎之美少女'] = 'tea';   // 復活選「茶」會變成謎
const S = s => s === 'w' ? '白方' : '黑方', side = n => n === '白方' ? 'w' : 'b';
const xy = s => ({x: 'abcdefghi'.indexOf(s[0]), y: 9 - +s[1]});
const blocks = []; for (const l of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  if (l.startsWith('===')) blocks.push({head: l, lines: []}); else { const m = l.match(/^\d+\. (.*)$/); if (m && blocks.length) blocks[blocks.length - 1].lines.push(m[1]); } }
function rebuild(b) {
  if (!b.lines.length) throw new Error('這一局讀不到任何棋譜行：' + b.head);
  const G = Rules.create(), acts = [], notes = [], mat = [], L = b.lines; let i = 0;
  const push = (s, a) => { const h0 = G.hist.length, r = Rules.play(G, s, a, 0); if (r.ok === false) throw new Error(`第 ${i + 1} 行「${L[i]}」動作被規則拒絕：${r.error}`);
    acts.push({s, a}); notes.push(G.hist.slice(h0)); mat.push(Rules.pts(G, 'w') - Rules.pts(G, 'b')); };
  while (i < L.length && !G.over) {
    const mv = L[i].match(/^(白方|黑方)(.+?) ([a-i][1-9])→([a-i][1-9])/); if (!mv) throw new Error(`第 ${i + 1} 行無法解析：${L[i]}`);
    const sd = side(mv[1]), f = xy(mv[3]), t = xy(mv[4]), p = G.pieces.find(q => q.side === sd && q.x === f.x && q.y === f.y && Rules.TYPES[q.type].name === mv[2]);
    if (!p) throw new Error(`第 ${i + 1} 行找不到棋子：${L[i]}`);
    push(sd, {t: 'move', pid: p.id, x: t.x, y: t.y});
    // 連鎖發生的後續行（轉化、轉生、被消滅、無可復活…）由引擎自己產生，這裡只決定「玩家選擇」
    i = G.hist.length > 0 ? matched(G, L, b) : i;
    while (G.phase && !G.over) {
      const ph = G.phase;
      if (ph.kind === 'slash') { const nx = L[i] || ''; push(ph.side, {t: 'slash', yes: nx.startsWith(S(ph.side)) && nx.includes('斬殺')}); i = matched(G, L, b); }
      else if (ph.kind === 'pick') { const m = (L[i] || '').match(/^(白方|黑方)(.+?) 復活在 ([a-i][1-9])$/); if (!m || side(m[1]) !== ph.side) throw new Error(`第 ${i + 1} 行應為復活：${L[i]}`);
        push(ph.side, {t: 'pick', ty: NAME[m[2]]}); const c = xy(m[3]); push(ph.side, {t: 'place', x: c.x, y: c.y}); i = matched(G, L, b); }
      else throw new Error('未知階段 ' + ph.kind);
    }
  }
  if (G.hist.length !== L.length || G.hist.some((h, k) => h !== L[k])) { const k = G.hist.findIndex((h, k) => h !== L[k]); throw new Error(`還原後的紀錄與文字檔不一致（第 ${k + 1} 行：引擎「${G.hist[k]}」vs 文字檔「${L[k]}」）`); }
  return {G, acts, notes, mat};
}
function matched(G, L, b) { for (let k = 0; k < G.hist.length; k++) if (G.hist[k] !== L[k]) throw new Error(`第 ${k + 1} 行與引擎不一致：引擎「${G.hist[k]}」vs 文字檔「${L[k]}」`); return G.hist.length; }
const games = [], facts = !!process.env.FACTS;
for (const b of blocks) {
  const h = b.head.match(/對局 (\S+?)｜.*?(白|黑)勝（(\w+)）｜(\d+) 手/), id = h && h[1]; if (!h) throw new Error('標題行無法解析：' + b.head);
  const {G, acts, notes, mat} = rebuild(b), over = G.over, moves = acts.filter(x => x.a.t === 'move').length;
  if (over !== (h[2] === '白' ? 'w' : 'b') || h[3] !== 'king') throw new Error(`${id} 結果與標題不符（引擎 over=${over}，標題 ${h[2]}勝/${h[3]}）`);
  if (moves !== +h[4]) throw new Error(`${id} 手數不符：還原 ${moves}，標題 ${h[4]}`);
  const wd = mat.map(d => over === 'w' ? d : -d); let lead = 0, changes = 0; wd.forEach(d => { const s = Math.sign(d); if (s && lead && s !== lead) changes++; if (s) lead = s; });
  const cnt = rx => notes.flat().filter(t => rx.test(t)).length, pw = Rules.pts(G, 'w'), pb = Rules.pts(G, 'b'), tx = TEXTS[id];
  if (facts) { const f = notes.findIndex(ns => ns.some(t => / 吃/.test(t))); const last = notes.slice(-3).flat().filter(t => !t.includes('🎉')).join(' → ');
    console.log(`${id} 勝${over} ${moves}手 易主${changes} 贏家最低${Math.min(...wd)} 最高${Math.max(...wd)} 斬${cnt(/斬殺/)} 復活${cnt(/復活在/)} 轉生${cnt(/轉生/)} 連鎖${cnt(/被消滅於/)} 吃${cnt(/ 吃/)} 首吃第${f + 1}步 終分${pw}:${pb} 剩${G.pieces.length} | ${last}`); continue; }
  if (!tx) throw new Error('replay-texts.js 缺少 ' + id + ' 的標題與說明');
  games.push({id, title: tx.title, summary: tx.summary, over, moves, capped: false,
    badges: [tx.how, `領先易主 ${changes} 次`, `斬擊 ${cnt(/斬殺/)} 次`, `復活 ${cnt(/復活在/)} 次`, `最大逆轉 ${Math.max(0, -Math.min(...wd))} 分`],
    result: {over, reason: 'king', text: `${S(over)}獲勝（${tx.how}，吃王時比分　白 ${pw}：黑 ${pb}）`}, actions: acts, notes, mat});
}
if (!facts) { fs.writeFileSync('data/replays.json', JSON.stringify({intro: TEXTS.intro, games})); console.log('已匯入', games.length, '局，逐行驗證通過 → data/replays.json'); games.forEach(g => console.log(' ', g.id, g.badges.join('｜'), g.moves, '手')); }
