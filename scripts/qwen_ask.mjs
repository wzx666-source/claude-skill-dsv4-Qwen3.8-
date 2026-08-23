#!/usr/bin/env node
// qwen_ask.mjs — Qwen 自由咨询(头脑风暴 / 第二意见 / 选题讨论)
// 用法: node qwen_ask.mjs "<问题>" [--file <附件路径> ...]
//   例: node qwen_ask.mjs "从评审角度,这道题选 A 还是 B 更有获奖潜力?" --file problem_a.md problem_b.md
import path from 'node:path';
import { callQwen, readTextCapped, fail, isFatal } from './qwen_common.mjs';

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
  try {
    console.log(await callQwen([{ role: 'user', content: text }]));
  } catch (e) {
    fail(e.message);
  }
} catch (e) {
  if (!isFatal(e)) {
    console.error(e);
    process.exitCode = 1;
  }
}
