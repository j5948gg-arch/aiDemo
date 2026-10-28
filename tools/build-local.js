#!/usr/bin/env node
'use strict';
/* 產生單一檔案的「本機測試版」網頁：把 rules.js 與 AI 打包進一個可直接開的 HTML，
   用瀏覽器直接開就能下棋，不需要 node server.js、不連任何伺服器。

   node tools/build-local.js [輸出檔名]      預設輸出 local-test.html

   規則與 AI 都是直接讀專案裡的原始檔打包，所以改了 rules.js／ai.js 之後重跑這個腳本即可同步。 */
const fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'local-test.html'));
const TPL = path.join(__dirname, 'local-ui.html.tpl');

// 打包順序＝相依順序；key 是 require() 解析後的名字
const MODULES = [
  ['rules.js', 'public/rules.js'],
  ['ai-eval.js', 'ai-eval.js'],
  ['ai-super.js', 'ai-super.js'],
  ['ai.js', 'ai.js']
];

// 極小的 CommonJS 外殼：把 require('./ai-super.js')、require('./public/rules.js') 導到打包好的模組
const SHIM = `var __mods = {};
function __def(name, fn){ __mods[name] = {fn: fn, ex: null, done: false}; }
function require(n){
  var k = String(n).replace(/^\\.\\//, '').replace(/^public\\//, '');
  var m = __mods[k];
  if(!m) throw new Error("Cannot find module '" + n + "'");   // ai-weights.json 走這裡，ai-eval.js 自己 try/catch 接住
  if(!m.done){ m.done = true; var module = {exports: {}}; m.fn(module, module.exports); m.ex = module.exports; }
  return m.ex;
}`;

function wrap(key, file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return `__def(${JSON.stringify(key)}, function(module, exports){\n${src}\n});`;
}

const missing = MODULES.filter(([, f]) => !fs.existsSync(path.join(ROOT, f)));
if (missing.length) { console.error('找不到來源檔：' + missing.map(m => m[1]).join(', ')); process.exit(1); }
if (!fs.existsSync(TPL)) { console.error('找不到版型：' + TPL); process.exit(1); }

const bundle = [SHIM, ...MODULES.map(([k, f]) => wrap(k, f))].join('\n');
let html = fs.readFileSync(TPL, 'utf8');
if (!html.includes('//__BUNDLE__')) { console.error('版型缺少 //__BUNDLE__ 標記'); process.exit(1); }
html = html.replace('//__BUNDLE__', () => bundle).replace('__BUILT__', new Date().toISOString().slice(0, 16).replace('T', ' '));

fs.writeFileSync(OUT, html);
const kb = Math.round(fs.statSync(OUT).size / 1024);
console.log(`已輸出 ${path.relative(process.cwd(), OUT) || OUT}（${kb} KB，含 ${MODULES.length} 個模組）`);
console.log('用瀏覽器直接開這個檔案即可，不需要啟動伺服器。');
