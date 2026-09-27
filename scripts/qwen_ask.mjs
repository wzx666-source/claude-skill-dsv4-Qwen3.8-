#!/usr/bin/env node
// qwen_ask.mjs — 第二意见(头脑风暴 / 选题讨论 / 会诊卡住的问题)
// 用法: node qwen_ask.mjs "<问题>" [--file <附件路径> ...]
//   例: node qwen_ask.mjs "从评审角度,这道题选 A 还是 B 更有获奖潜力?" --file problem_a.md problem_b.md
//
// 咨询方自动 = 非驱动方的那个厂商(同 qwen_review);本会话跑 DeepSeek → 问 Qwen,反之亦然。
import path from 'node:path';
import { callReviewer, reviewerMeta, readTextCapped, fail, isFatal } from './qwen_common.mjs';

try {
  const args = process.argv.slice(2);
  const qEnd = args.indexOf('--file');
  const question = (qEnd >= 0 ? args.slice(0, qEnd) : args).join(' ');
  const files = qEnd >= 0 ? args.slice(qEnd + 1) : [];
  if (!question.trim()) fail('用法: node qwen_ask.mjs "<问题>" [--file <附件> ...]');
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
  try {
    console.log(await callReviewer(messages));
  } catch (e) {
    fail(e.message);
  }
} catch (e) {
  if (!isFatal(e)) {
    console.error(e);
    process.exitCode = 1;
  }
}
