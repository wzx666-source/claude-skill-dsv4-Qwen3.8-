#!/usr/bin/env node
// show_calls.mjs — 查看最近的 API 调用日志(由 callModel 自动追写)
// 用法: node show_calls.mjs [N]   N = 显示最近几条(默认 20,最小 1)
//       node show_calls.mjs --errors  只看失败条目
//
// 列说明:
//   耗时(s)    从发出请求到拿到完整结果的总秒数
//   首字节(s)  响应头到达的时间(非流式下要等整个响应体回来才有下文,故 ≈ 耗时;
//              流式下二者差距大 = 服务端在排队,而不是模型生成得慢)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LOG_FILE = path.join(SKILL_ROOT, 'logs', 'calls.jsonl');

const args = process.argv.slice(2);
const errorsOnly = args.includes('--errors');
// 下限取 1:传 0 时 slice(-0) 等价于 slice(0),会把整个日志打出来 —— 与直觉相反
const N = Math.max(1, parseInt(args.find(a => /^\d+$/.test(a)) ?? '20', 10));

if (!fs.existsSync(LOG_FILE)) {
  console.log('暂无调用日志。日志在首次调用 callModel 后自动生成。');
  console.log(`期望路径: ${LOG_FILE}`);
  process.exit(0);
}

const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').filter(Boolean);
let entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

if (errorsOnly) entries = entries.filter(e => !e.ok);
const slice = entries.slice(-N);

if (slice.length === 0) {
  console.log(errorsOnly ? '最近没有失败记录。' : '日志为空。');
  process.exit(0);
}

// 对齐必须按【显示宽度】算:padEnd 数的是 UTF-16 长度,中文/emoji 只算 1 却占 2 列,
// 表头含「时间/模型/耗时(s)」,直接用 padEnd 会整体错位。
const wcwidth = (s) => [...String(s ?? '')].reduce((w, c) => {
  const cp = c.codePointAt(0);
  const wide = (cp >= 0x1100 && cp <= 0x115F) || (cp >= 0x2E80 && cp <= 0xA4CF)
    || (cp >= 0xAC00 && cp <= 0xD7A3) || (cp >= 0xF900 && cp <= 0xFAFF)
    || (cp >= 0xFE30 && cp <= 0xFE6F) || (cp >= 0xFF00 && cp <= 0xFF60)
    || (cp >= 0xFFE0 && cp <= 0xFFE6)
    || (cp >= 0x1F300 && cp <= 0x1FAFF) || (cp >= 0x20000 && cp <= 0x3FFFD);
  return w + (wide ? 2 : 1);
}, 0);
const clip = (s, n) => {
  const str = String(s ?? '');
  if (wcwidth(str) <= n) return str;
  let out = '', w = 0;
  for (const c of str) {
    const cw = wcwidth(c);
    if (w + cw > n - 1) break;   // 留 1 列给省略号
    out += c; w += cw;
  }
  return out + '…';
};
const pad  = (s, n) => { const t = clip(s, n); return t + ' '.repeat(n - wcwidth(t)); };
const rpad = (s, n) => { const t = clip(s, n); return ' '.repeat(n - wcwidth(t)) + t; };
const secs = (ms) => (ms != null ? (ms / 1000).toFixed(1) : '-');

const COL = { ts: 24, provider: 8, model: 22, mode: 10, dur: 8, fb: 10, ok: 3 };
const WIDTH = COL.ts + COL.provider + COL.model + COL.mode + COL.dur + COL.fb + COL.ok + 12;

console.log(
  pad('时间', COL.ts) + pad('方', COL.provider) + pad('模型', COL.model) +
  pad('mode', COL.mode) + rpad('耗时(s)', COL.dur) + rpad('首字节(s)', COL.fb) +
  ' ' + pad('OK', COL.ok) + '错误'
);
console.log('-'.repeat(WIDTH));

for (const e of slice) {
  const ts   = (e.ts ?? '').slice(0, 23);
  const prov = e.provider === 'bailian' ? 'Qwen' : 'DS';
  const ok   = e.ok ? '✅' : '❌';
  const err  = e.ok ? '' : (e.error ?? '').slice(0, 50);
  console.log(pad(ts, COL.ts) + pad(prov, COL.provider) + pad(e.model, COL.model) +
    pad(e.mode, COL.mode) + rpad(secs(e.durationMs), COL.dur) + rpad(secs(e.firstByteMs), COL.fb) +
    ' ' + pad(ok, COL.ok) + err);
}

// 汇总统计
const total   = slice.length;
const okCount = slice.filter(e => e.ok).length;
const okDur   = slice.filter(e => e.ok && e.durationMs).map(e => e.durationMs);
const avgMs   = okDur.length ? okDur.reduce((s, v) => s + v, 0) / okDur.length : null;
const fbVals  = slice.filter(e => e.ok && e.firstByteMs != null).map(e => e.firstByteMs);
const avgFb   = fbVals.length ? fbVals.reduce((s, v) => s + v, 0) / fbVals.length : null;
console.log('-'.repeat(WIDTH));
console.log(`共 ${total} 条 | 成功 ${okCount} | 失败 ${total - okCount}`
  + ` | 成功平均耗时 ${avgMs != null ? (avgMs / 1000).toFixed(1) + 's' : '-'}`
  + ` | 平均首字节 ${avgFb != null ? (avgFb / 1000).toFixed(1) + 's' : '-'}`);
console.log(`日志文件: ${LOG_FILE}  (共 ${lines.length} 条历史记录)`);
