#!/usr/bin/env node
// qwen_ask.mjs — 第二意见(头脑风暴 / 选题讨论 / 会诊卡住的问题)
// 用法: node qwen_ask.mjs "<问题>" [--file <附件路径> ...]
//       [--max-tokens N] [--timeout <秒>] [--budget <秒>]
//   例: node qwen_ask.mjs "从评审角度,这道题选 A 还是 B 更有获奖潜力?" --file problem_a.md problem_b.md
//
// 咨询方自动 = 非驱动方的那个厂商(同 qwen_review);本会话跑 DeepSeek → 问 Qwen,反之亦然。
//
// ── 三个预算参数(2026-10-23 加,起因:一次咨询空转 10 分钟零产出)──
//   --timeout    单次请求的墙钟上限(默认 900s)
//   --budget     整个调用的总上限,含重试(默认 timeout + 120s)
//   --max-tokens 正文长度上限。⚠️ 它**不约束思考量**:推理模型的 reasoning 另算,
//                给太小会变成"思考耗尽预算、正文零字"(实测 deepseek-v4-pro 给 32 就是这样)。
//                想止住空转请用 --budget,不要指望 --max-tokens。
//
// 被预算掐断时**返回已生成的部分结论**(带「[⚠️ 流式被截断…]」尾注)并置退出码 2,不抛错 ——
// 半份意见比"等了十分钟什么都没有"有用。但正文一个字都没生成时仍算失败。
import path from 'node:path';
import { callReviewer, reviewerMeta, readTextCapped, fail, isFatal } from './qwen_common.mjs';

try {
  const argv = process.argv.slice(2);

  // 先摘掉本脚本自己的标志,再按 --file 切分 —— 否则 `--max-tokens` 出现在 --file 之后
  // 就会被当成附件路径。
  function takeOpt(name) {
    const i = argv.indexOf(name);
    if (i < 0) return null;
    const v = argv[i + 1];
    argv.splice(i, 2);
    return v;
  }
  const maxTokRaw = takeOpt('--max-tokens');
  const timeoutRaw = takeOpt('--timeout');
  const budgetRaw = takeOpt('--budget');

  const num = (v, name) => {
    if (v == null) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 1) fail(`${name} 应为 ≥1 的数字,收到: "${v}"`);
    return n;
  };
  const maxTokens = num(maxTokRaw, '--max-tokens');
  const timeoutSec = num(timeoutRaw, '--timeout');
  const budgetSec = num(budgetRaw, '--budget');
  if (budgetSec != null && timeoutSec != null && budgetSec < timeoutSec) {
    fail(`--budget(${budgetSec}s)小于 --timeout(${timeoutSec}s):总预算会把单次超时提前掐掉,没有意义`);
  }

  const qEnd = argv.indexOf('--file');
  const question = (qEnd >= 0 ? argv.slice(0, qEnd) : argv).join(' ');
  const files = qEnd >= 0 ? argv.slice(qEnd + 1) : [];
  if (!question.trim()) {
    fail('用法: node qwen_ask.mjs "<问题>" [--file <附件> ...] [--max-tokens N] [--timeout 秒] [--budget 秒]');
  }
  let text = question;
  if (files.length) {
    text += '\n\n' + files.map((f, i) => {
      const abs = path.resolve(f);
      return `===== 附件${i + 1}: ${path.basename(abs)} =====\n${readTextCapped(abs)}`;
    }).join('\n\n');
  }
  const messages = [{ role: 'user', content: text }];
  const meta = reviewerMeta(messages);
  console.error(`💬 咨询方: ${meta.label} (${meta.model})｜驱动方 ${meta.driverLabel} 不参与`);
  const limits = [
    timeoutSec != null ? `单次超时 ${timeoutSec}s` : '',
    budgetSec != null ? `总预算 ${budgetSec}s` : '',
    maxTokens != null ? `正文上限 ${maxTokens} tok` : '',
  ].filter(Boolean);
  if (limits.length) console.error(`⏱️  ${limits.join('｜')}`);
  if (meta.caveat) console.error(`ℹ️ 存疑: ${meta.caveat}`);
  try {
    const opts = {};
    if (timeoutSec != null) opts.timeoutMs = timeoutSec * 1000;
    if (budgetSec != null) opts.budgetMs = budgetSec * 1000;
    if (maxTokens != null) opts.maxTokens = maxTokens;
    const out = await callReviewer(messages, opts);
    if (/\[⚠️ 流式被截断/.test(out)) {
      console.error('⚠️  本次咨询被预算截断,以上是**部分结论** —— 别当完整答复用。'
        + '要完整结论请加大 --budget 后重跑。');
      process.exitCode = 2;
    }
    console.log(out);
  } catch (e) {
    fail(e.message);
  }
} catch (e) {
  if (!isFatal(e)) {
    console.error(e);
    process.exitCode = 1;
  }
}
