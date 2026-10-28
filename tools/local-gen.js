#!/usr/bin/env node
'use strict';
/* 本機版的對局生成器：自己啟動 node server.js、跑完對局、印出統計，然後把伺服器關掉。
   是 tools/online-gen.js 的本機對應版本 —— 連線與對弈的邏輯仍然由 online-gen.js 負責，
   這支只處理「起伺服器 → 跑 → 收統計 → 關掉」，所以兩邊不會有兩份 WebSocket 客戶端。
   需要 Node 22+。不需要 npm install。

   最簡單的用法（起一台乾淨的伺服器，跑 10 局，印統計）：
     node tools/local-gen.js

   ===== 最常要調的三件事：局數、白方強度、黑方強度 =====
     --games <數字>   要跑幾局。預設 10。
     --w <等級>       白方用哪一款 AI。預設 medium。
     --b <等級>       黑方用哪一款 AI。預設 medium。
   等級由弱到強：beginner（初階）→ medium（中等）→ advanced（進階）→ super（超高階）
   另外 random（純亂走）只在不加 --direct 時可用，常用來當對照組。

     node tools/local-gen.js --games 50 --w super --b beginner      # 50 局，超高階執白打初階
     node tools/local-gen.js --games 20 --w advanced --b advanced   # 20 局，進階互打

   想一次比較多種組合，用逗號分隔，每局會從清單裡各抽一個：
     node tools/local-gen.js --games 40 --w medium,advanced --b beginner,medium
   統計會自動把每一種組合分開列出成績。

   其他常調的：
     --cap <數字>     單局步數上限，超過就算未分勝負。預設 250（--direct 預設 180）。
     --budget <毫秒>  AI 每一手的思考時間。調大＝棋力強但慢。預設 300（--direct 預設 90）。
     --out <檔名>     輸出檔位置。預設 local-runs/games.jsonl。
     --fresh          先清掉舊的輸出檔，不要接在後面。
   註：上面那份「全部都是 medium vs medium、250 手、10 局」的結果，就是完全沒加參數跑出來的預設值。

   大量模擬請加 --direct：完全跳過伺服器與 WebSocket，直接用 tools/sim.js 在多條執行緒上對弈，
   快上一個數量級。代價是測不到伺服器那一層（房間、走法驗證、斷線重連、棋鐘），所以：
     要壓測規則與 AI、要大量對局資料 → --direct
     要測伺服器本身是否正常          → 不要加 --direct
     node tools/local-gen.js --direct --games 200 --w super --b advanced
     node tools/local-gen.js --direct --games 500 --jobs 8 --budget 60 --cap 160
   --direct 只支援 beginner/medium/advanced/super（random 與 +harvest 需要經過伺服器那條路徑）。
   --seed 決定每局的開局亂數與雙方策略的抽選，但「不保證重現同一局」：AI 是以時間為上限做迭代加深，
   機器當下的忙碌程度會改變它算到第幾層，所以同一個 seed 的同一局可能走出不同結果（selfplay.js 也一樣）。
   要讓結果穩定一點，就把 --budget 調大、--jobs 調小，減少執行緒之間互搶 CPU。

   常用：
     node tools/local-gen.js --games 30 --w medium,advanced --b random,medium
     node tools/local-gen.js --mode bot --games 8 --bots beginner,medium --me medium
     node tools/local-gen.js --test                 # 先跑 npm test，通過才生成對局
     node tools/local-gen.js --reuse --port 3000    # 用已經在跑的伺服器，不自己起
     node tools/local-gen.js --report-only          # 不跑對局，只對既有的 jsonl 重新印統計

   和 online-gen.js 的差別：
   - 伺服器跑在隨機的空閒埠（預設自動挑），不會卡到你正在用的 3000。
   - 伺服器的 DATA_DIR 指到暫存資料夾，所以測試帳號不會寫進 repo 裡的 data/players.json。
   - AI 房的出手停頓預設設成 0（CHESS_BOT_DELAY_MS），跑得快很多。
   - 跑完會印出勝負分布、各策略對戰成績、平均手數、結束原因等統計。
   其餘參數原封不動轉給 online-gen.js，用 --help 可以看它支援哪些。 */
const {spawn} = require('child_process'), fs = require('fs'), path = require('path'), net = require('net'), os = require('os');
const {Worker, isMainThread, workerData, parentPort} = require('worker_threads');

const ROOT = path.join(__dirname, '..');

// ---------- --direct 的 worker：不經過伺服器，直接用 sim.js 把整局在這條執行緒上下完 ----------
if (!isMainThread && workerData && workerData.direct) {
  const Rules = require('../public/rules.js'), {playGame} = require('./sim.js');
  const {seeds, w, b, budget, cap, openTol, openPlies} = workerData;
  const pick = (a, r) => a[Math.floor(r * a.length) % a.length];
  for (const seed of seeds) {
    // 策略與開局亂數由 seed 決定；但 AI 以時間為搜尋上限，所以同一個 seed 不保證走出同一局
    const r0 = ((seed * 2654435761) % 4294967296) / 4294967296, r1 = ((seed * 1597334677) % 4294967296) / 4294967296;
    const sw = pick(w, r0), sb = pick(b, r1), t0 = Date.now();
    let pts = {w: 0, b: 0}, left = {w: 0, b: 0};
    const g = playGame({seed, w: sw, b: sb, bw: budget, bb: budget, moveCap: cap, openTol, openPlies,
      onPly: G => { pts = {w: Rules.pts(G, 'w'), b: Rules.pts(G, 'b')};
        left = {w: G.pieces.filter(p => p.side === 'w').length, b: G.pieces.filter(p => p.side === 'b').length}; }});
    parentPort.postMessage({          // 欄位對齊 online-gen.js 的紀錄格式，統計與 --report-only 才能共用
      id: 'd' + seed, run: 'direct', mode: 'direct', seed, t: new Date(t0).toISOString(), ms: Date.now() - t0,
      white: {id: 'sim-' + sw, strat: sw}, black: {id: 'sim-' + sb, strat: sb}, room: 'direct',
      over: g.over || null, reason: g.capped ? '步數上限' : (g.reason || 'king'), result: g.result || null,
      capped: g.capped, moves: g.moves, pts, left, actions: g.actions, log: g.hist});
  }
  parentPort.postMessage({done: true});
  return;
}
// 自己手動掃 argv：這支認得的參數吃掉，其餘「原封不動」轉給 online-gen.js。
// （不能用 parseArgs 的 strict:false 來做，它會把不認得的 --w medium 當成布林旗標＋位置參數，順序就亂了。）
const TAKES_VALUE = new Set(['port', 'games', 'out', 'bot-delay', 'jobs', 'seed']);
const FLAGS = new Set(['test', 'reuse', 'keep-server', 'report-only', 'fresh', 'quiet', 'help', 'direct']);
const O = {games: '10', out: 'local-runs/games.jsonl', 'bot-delay': '0'}, REST = [];
for (const argv = process.argv.slice(2), it = argv[Symbol.iterator](); ; ) {
  const n = it.next(); if (n.done) break;
  const a = n.value, m = /^--([^=]+)(?:=([\s\S]*))?$/.exec(a);
  if (!m) { REST.push(a); continue; }
  const [, k, inline] = m;
  if (TAKES_VALUE.has(k)) { O[k] = inline !== undefined ? inline : (it.next().value ?? ''); continue; }
  if (FLAGS.has(k)) { O[k] = inline === undefined ? true : inline !== 'false'; continue; }
  REST.push(a); if (inline === undefined && !/^(no-stall|no-lone-settle|boards|help)$/.test(k)) {
    // online-gen.js 的布林旗標後面沒有值，其餘的要把下一個 token 一起帶過去
    const peek = it.next(); if (!peek.done) REST.push(peek.value);
  }
}
if (O.help) { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^[\s\S]*?\/\* /, '')); process.exit(0); }

const OUT = path.resolve(ROOT, O.out);
const TXT = OUT.replace(/\.jsonl$/, '') + '.txt';   // 給人看的棋譜摘要，和 .jsonl 同名
const sleep = ms => new Promise(r => setTimeout(r, ms));
const say = s => console.log(s);

const freePort = () => new Promise((res, rej) => {       // 讓作業系統挑一個沒人用的埠
  const s = net.createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});
async function waitHttp(url, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url, {signal: AbortSignal.timeout(2000)}); if (r.ok) return true; } catch (e) {}
    await sleep(250);
  }
  return false;
}
function run(cmd, args, opt = {}) {       // 跑一個子行程，回傳 exit code
  return new Promise(res => {
    const c = spawn(cmd, args, {cwd: ROOT, stdio: opt.quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit', env: {...process.env, ...(opt.env || {})}});
    let buf = '';
    if (opt.quiet) { c.stdout.on('data', d => buf += d); c.stderr.on('data', d => buf += d); }
    c.on('close', code => res({code, out: buf}));
    c.on('error', e => res({code: 1, out: String(e.message)}));
  });
}

// ---------- 統計 ----------
const pct = (n, d) => d ? (100 * n / d).toFixed(1) + '%' : '—';
function report(file) {
  if (!fs.existsSync(file)) { say(`\n（找不到 ${path.relative(ROOT, file)}，沒有可統計的對局）`); return null; }
  const games = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  if (!games.length) { say('\n（輸出檔是空的）'); return null; }

  const tot = {n: games.length, w: 0, b: 0, draw: 0, unfinished: 0, moves: 0, ms: 0};
  const byPair = {}, byReason = {};
  for (const g of games) {
    tot.moves += g.moves || 0; tot.ms += g.ms || 0;
    const done = g.over && !g.capped;
    if (!done) tot.unfinished++; else tot[g.over] = (tot[g.over] || 0) + 1;
    const reason = g.capped ? '步數上限' : (g.reason || '中斷');
    byReason[reason] = (byReason[reason] || 0) + 1;
    const key = `${g.white.strat} vs ${g.black.strat}`;
    const p = byPair[key] = byPair[key] || {n: 0, w: 0, b: 0, draw: 0, unfinished: 0, moves: 0};
    p.n++; p.moves += g.moves || 0;
    if (!done) p.unfinished++; else p[g.over] = (p[g.over] || 0) + 1;
  }
  const line = '─'.repeat(64);
  say('\n' + line + '\n對局統計：' + path.relative(ROOT, file) + '\n' + line);
  say(`局數 ${tot.n}｜白勝 ${tot.w}（${pct(tot.w, tot.n)}）・黑勝 ${tot.b}（${pct(tot.b, tot.n)}）・和局 ${tot.draw}・未分勝負 ${tot.unfinished}`);
  say(`平均 ${Math.round(tot.moves / tot.n)} 手｜平均每局 ${(tot.ms / tot.n / 1000).toFixed(1)} 秒｜總耗時 ${(tot.ms / 1000).toFixed(0)} 秒`);

  say('\n結束原因：');
  Object.entries(byReason).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => say(`  ${k.padEnd(14)} ${String(v).padStart(4)} 局（${pct(v, tot.n)}）`));

  say('\n各組合成績（以白方視角）：');
  const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length));
  say('  ' + pad('對戰組合', 34) + pad('局數', 6) + pad('白勝', 6) + pad('黑勝', 6) + pad('和', 5) + pad('未分', 6) + '平均手數');
  Object.entries(byPair).sort((a, b) => b[1].n - a[1].n).forEach(([k, p]) =>
    say('  ' + pad(k, 34) + pad(p.n, 6) + pad(p.w, 6) + pad(p.b, 6) + pad(p.draw, 5) + pad(p.unfinished, 6) + Math.round(p.moves / p.n)));

  const longest = games.reduce((a, g) => (g.moves || 0) > (a.moves || 0) ? g : a, games[0]);
  const shortest = games.reduce((a, g) => (g.moves || 1e9) < (a.moves || 1e9) ? g : a, games[0]);
  say(`\n最長 ${longest.moves} 手（${longest.white.strat} vs ${longest.black.strat}）｜最短 ${shortest.moves} 手（${shortest.white.strat} vs ${shortest.black.strat}）`);
  const txt = file.replace(/\.jsonl$/, '') + '.txt';
  say(`\n棋譜摘要：${fs.existsSync(txt) ? path.relative(ROOT, txt) : '（無）'}`);
  say(line);
  return tot;
}

// ---------- --direct：不起伺服器，直接在多條執行緒上跑 sim.js ----------
const DIRECT_LEVELS = ['beginner', 'medium', 'advanced', 'super'];
function restVal(flag, dflt) { const i = REST.indexOf('--' + flag); return i >= 0 && REST[i + 1] !== undefined ? REST[i + 1] : dflt; }
async function runDirect() {
  const w = String(restVal('w', 'super')).split(','), b = String(restVal('b', 'super')).split(',');
  const bad = [...w, ...b].filter(s => !DIRECT_LEVELS.includes(s));
  if (bad.length) { console.error(`--direct 只支援 ${DIRECT_LEVELS.join(' / ')}（不支援 ${[...new Set(bad)].join(', ')}，那些要經過伺服器，請拿掉 --direct）`); process.exit(1); }

  const games = +O.games, cap = +restVal('cap', 180), budget = +restVal('budget', 90);
  const openTol = +restVal('open-tol', 1.2), openPlies = +restVal('open-plies', 14);
  const seed0 = +(O.seed || 1);
  const jobs = Math.max(1, Math.min(+O.jobs || os.cpus().length, games));
  say(`直接模式：${games} 局、${jobs} 條執行緒、每手 ${budget}ms、步數上限 ${cap}（不起伺服器、不經過 WebSocket）`);
  say(`白 ${w.join('/')} vs 黑 ${b.join('/')}｜seed ${seed0}…${seed0 + games - 1}\n`);

  const seeds = Array.from({length: games}, (_, i) => seed0 + i);
  const buckets = Array.from({length: jobs}, () => []);
  seeds.forEach((s, i) => buckets[i % jobs].push(s));   // 輪流分配，每條執行緒的工作量差不多

  const t0 = Date.now(); let done = 0;
  const fd = fs.openSync(OUT, 'a'), fdTxt = fs.openSync(TXT, 'a');
  // 棋譜摘要的格式和 online-gen.js 的 save() 一致，兩種模式產出的 .txt 才能互相比對
  const txtBlock = m => {
    const res = m.capped ? `步數上限（比分 白${m.pts.w}:黑${m.pts.b}）` : m.over === 'draw' ? '和局'
      : m.over ? (m.over === 'w' ? '白勝' : '黑勝') + '（' + m.reason + '）' : '中斷';
    return `=== 對局 ${m.id}｜白：${m.white.strat}（${m.white.id}） vs 黑：${m.black.strat}（${m.black.id}）｜${res}｜${m.moves} 手｜${m.t} ===\n`
      + (m.log || []).map((l, i) => `${i + 1}. ${l}`).join('\n') + '\n\n';
  };
  await Promise.all(buckets.map(bucket => new Promise((res, rej) => {
    const wk = new Worker(__filename, {workerData: {direct: true, seeds: bucket, w, b, budget, cap, openTol, openPlies}});
    wk.on('message', m => {
      if (m.done) return;
      fs.writeSync(fd, JSON.stringify(m) + '\n');
      fs.writeSync(fdTxt, txtBlock(m));
      done++;
      if (!O.quiet) {
        const res2 = m.capped ? `步數上限（白${m.pts.w}:黑${m.pts.b}）` : m.over === 'draw' ? '和局' : (m.over === 'w' ? '白勝' : '黑勝');
        const rate = done / ((Date.now() - t0) / 1000);
        say(`[${done}/${games}] ${m.white.strat} vs ${m.black.strat}：${res2}，${m.moves} 手，${(m.ms / 1000).toFixed(1)}s｜${rate.toFixed(2)} 局/秒`);
      }
    });
    wk.on('error', rej);
    wk.on('exit', c => c === 0 ? res() : rej(new Error('worker 結束碼 ' + c)));
  })));
  fs.closeSync(fd); fs.closeSync(fdTxt);
  const secs = (Date.now() - t0) / 1000;
  say(`\n直接模式完成：${done} 局，${secs.toFixed(1)} 秒（${(done / secs).toFixed(2)} 局/秒，平均每局 ${(secs / done).toFixed(2)} 秒）`);
}

// ---------- 主流程 ----------
(async () => {
  if (O['report-only']) { report(OUT); return; }

  if (O.test) {
    say('先跑 npm test …');
    const r = await run('npm', ['test'], {quiet: O.quiet});
    if (r.code !== 0) { if (O.quiet) console.error(r.out.slice(-2000)); console.error('\n測試沒有通過，停在這裡（要跳過測試就拿掉 --test）'); process.exit(1); }
    say('測試通過。\n');
  }

  if (O.fresh) for (const f of [OUT, OUT.replace(/\.jsonl$/, '') + '.txt']) if (fs.existsSync(f)) fs.unlinkSync(f);
  fs.mkdirSync(path.dirname(OUT), {recursive: true});

  if (O.direct) { await runDirect(); report(OUT); return; }

  const port = O.port ? +O.port : await freePort();
  const url = `http://localhost:${port}`;
  let srv = null;

  if (O.reuse) {
    say(`使用既有的伺服器 ${url}`);
    if (!await waitHttp(url + '/', 5000)) { console.error(`連不上 ${url}，請先啟動 node server.js，或拿掉 --reuse 讓這支自己起`); process.exit(1); }
  } else {
    // 測試帳號寫到暫存資料夾，不要弄髒 repo 的 data/players.json
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-local-'));
    say(`啟動本機伺服器 ${url}（資料寫到暫存目錄，不影響 repo）`);
    srv = spawn(process.execPath, ['server.js'], {cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
      env: {...process.env, PORT: String(port), DATA_DIR: dataDir, CHESS_BOT_DELAY_MS: String(+O['bot-delay'] || 0)}});
    let log = '';
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    srv.on('exit', c => { if (c && c !== 0 && !srv.killed) console.error('伺服器結束，代碼 ' + c + '\n' + log.slice(-800)); });
    if (!await waitHttp(url + '/')) { console.error('伺服器沒有在時間內起來：\n' + log.slice(-800)); try { srv.kill(); } catch (e) {} process.exit(1); }
    say('伺服器就緒。\n');
  }

  const stop = () => { if (srv && !O['keep-server']) { try { srv.kill(); } catch (e) {} srv = null; } };
  process.on('SIGINT', () => { stop(); process.exit(130); });

  const args = ['tools/online-gen.js', '--url', url, '--games', String(O.games), '--out', OUT, ...REST];
  say(`生成對局：node ${args.join(' ')}\n`);
  const t0 = Date.now();
  const r = await run(process.execPath, args, {quiet: O.quiet});
  const secs = ((Date.now() - t0) / 1000).toFixed(0);

  if (O.quiet && r.code !== 0) console.error(r.out.slice(-2000));
  say(`\n生成結束（${secs} 秒，代碼 ${r.code}）`);
  report(OUT);

  if (srv && O['keep-server']) say(`\n伺服器還開著：${url}（PID ${srv.pid}），用完請自行關閉。`);
  stop();
  process.exit(r.code);
})().catch(e => { console.error(e.message); process.exit(1); });
