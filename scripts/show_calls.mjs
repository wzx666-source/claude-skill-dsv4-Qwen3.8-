#!/usr/bin/env node
// show_calls.mjs — 查看最近的 API 调用日志(由 callModel 自动追写)
// 用法: node show_calls.mjs [N]   N = 显示最近几条(默认 20,最小 1)
//       node show_calls.mjs --errors  只看失败条目
//       node show_calls.mjs --cost    按 厂商/模型 汇总 token 与估算费用
//
// 列说明:
//   耗时(s)    从发出请求到拿到完整结果的总秒数
//   首字节(s)  响应头到达的时间(非流式下要等整个响应体回来才有下文,故 ≈ 耗时;
//              流式下二者差距大 = 服务端在排队,而不是模型生成得慢)
//   输入/输出  usage 里的 prompt_tokens / completion_tokens。
//              **没有就显示 `-`,不显示 0** —— 0 会被读成"这次几乎免费",那是错的信息。
//              2026-10-23 之前的条目都没有这两个字段。
//   ≈$         按 model_roster.json 的 pricePerM 估的费用。`~` 前缀表示**估算**:
//              价目来自 roster(厂商自报或第三方),不是账单。
//   截断       流式被预算掐断但返回了部分正文(partial);这种条目只算了已产出的 token。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LOG_FILE = path.join(SKILL_ROOT, 'logs', 'calls.jsonl');
const ROSTER_FILE = path.join(SKILL_ROOT, 'model_roster.json');

const args = process.argv.slice(2);
const errorsOnly = args.includes('--errors');
const costOnly = args.includes('--cost');
// 下限取 1:传 0 时 slice(-0) 等价于 slice(0),会把整个日志打出来 —— 与直觉相反
const N = Math.max(1, parseInt(args.find(a => /^\d+$/.test(a)) ?? '20', 10));

/** 价目表:model id → {in, out}($/M token)。读不到 roster 就返回空表,费用列降级为 `-` */
function loadPrices() {
  try {
    const roster = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf8'));
    const price = {};
    for (const prov of Object.values(roster.providers ?? {})) {
      for (const [id, m] of Object.entries(prov.models ?? {})) {
        if (m.pricePerM) price[id] = m.pricePerM;
      }
    }
    return price;
  } catch { return {}; }
}
const PRICES = loadPrices();

/** 按 usage 估算费用($)。缺价目或缺 usage 就返回 null,由调用方显示 `-` */
function estCost(e) {
  const p = PRICES[e.model];
  if (!p || e.promptTokens == null || e.completionTokens == null) return null;
  return (e.promptTokens * p.in + e.completionTokens * p.out) / 1e6;
}

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

const COL = { ts: 24, provider: 6, model: 20, mode: 8, dur: 10, fb: 11, tin: 10, tout: 10, cost: 11, ok: 4, part: 4 };
const WIDTH = COL.ts + COL.provider + COL.model + COL.mode + COL.dur + COL.fb + COL.tin + COL.tout + COL.cost + COL.ok + COL.part + 10;
const tok = (v) => (v == null ? '-' : String(v));
const money = (v) => (v == null ? '-' : v < 0.0001 ? '~$<0.0001' : '~$' + v.toFixed(4));

console.log(
  pad('时间', COL.ts) + pad('方', COL.provider) + pad('模型', COL.model) +
  pad('mode', COL.mode) + rpad('耗时(s)', COL.dur) + rpad('首字节(s)', COL.fb) +
  rpad('输入tok', COL.tin) + rpad('输出tok', COL.tout) + rpad('≈$', COL.cost) +
  ' ' + pad('OK', COL.ok) + ' ' + pad('截断', COL.part) + '错误'
);
console.log('-'.repeat(WIDTH));

for (const e of slice) {
  const ts   = (e.ts ?? '').slice(0, 23);
  const prov = e.provider === 'bailian' ? 'Qwen' : 'DS';
  const ok   = e.ok ? '✅' : '❌';
  const err  = e.ok ? '' : (e.error ?? '').slice(0, 50);
  console.log(pad(ts, COL.ts) + pad(prov, COL.provider) + pad(e.model, COL.model) +
    pad(e.mode, COL.mode) + rpad(secs(e.durationMs), COL.dur) + rpad(secs(e.firstByteMs), COL.fb) +
    rpad(tok(e.promptTokens), COL.tin) + rpad(tok(e.completionTokens), COL.tout) + rpad(money(estCost(e)), COL.cost) +
    ' ' + pad(ok, COL.ok) + ' ' + pad(e.partial ? '是' : '', COL.part) + err);
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

// ── 费用汇总:按 厂商/模型 分组 ──
// 覆盖率必须一并打印:老条目没有 usage,如果只说"合计 $x"会让人以为那就是全部花费。
if (costOnly) {
  const groups = new Map();
  let unmetered = 0;
  for (const e of entries) {
    if (e.promptTokens == null && e.completionTokens == null) { unmetered++; continue; }
    const k = `${e.provider === 'bailian' ? 'Qwen' : 'DeepSeek'}/${e.model}`;
    const g = groups.get(k) ?? { calls: 0, in: 0, out: 0, cost: 0, noPrice: false };
    g.calls++;
    g.in  += e.promptTokens ?? 0;
    g.out += e.completionTokens ?? 0;
    const c = estCost(e);
    if (c == null) g.noPrice = true; else g.cost += c;
    groups.set(k, g);
  }
  if (groups.size === 0) {
    console.log('\n没有可计量的条目(2026-10-23 之前的日志没有 usage 字段)。');
  } else {
    console.log('\n费用汇总(全量日志,按 roster 价目估算,非账单)');
    const rows = [...groups.entries()].sort((a, b) => b[1].cost - a[1].cost);
    const w = Math.max(16, ...rows.map(([k]) => wcwidth(k))) + 2;
    console.log(pad('厂商/模型', w) + rpad('调用', 6) + rpad('输入tok', 11) + rpad('输出tok', 11) + rpad('≈$', 12));
    let sumCost = 0;
    for (const [k, g] of rows) {
      sumCost += g.cost;
      console.log(pad(k, w) + rpad(String(g.calls), 6) + rpad(String(g.in), 11) + rpad(String(g.out), 11)
        + rpad(g.noPrice ? '部分缺价目' : money(g.cost), 12));
    }
    console.log('-'.repeat(w + 40));
    console.log(pad('合计', w) + rpad(String(rows.reduce((s, [, g]) => s + g.calls, 0)), 6)
      + rpad('', 11) + rpad('', 11) + rpad(money(sumCost), 12));
  }
  if (unmetered) {
    console.log(`\n⚠️  另有 ${unmetered} 条调用没有 usage 记录(2026-10-23 之前的老条目),未计入上表 ——`
      + ` 上表是"可计量部分"的下限,不是全部花费。`);
  }
}
