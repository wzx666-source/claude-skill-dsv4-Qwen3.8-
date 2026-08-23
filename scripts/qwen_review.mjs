#!/usr/bin/env node
// qwen_review.mjs — Qwen 独立评审(与主模型不同厂商,提供真实第二意见)
// 用法: node qwen_review.mjs <mode> <文件...> [--focus "<关注点>"]
//   review    同行评审:逻辑/数值/符号/表达,分级报告(阶段 5/6/7/8 产物)
//   challenge 对抗评审:假设结论错误,全力找反例与致命质疑(阶段 3 选型、阶段 9 终审)
//   recompute 独立复算:对照数据/公式/代码与结果,核验关键数值(数值铁律)
//   latex     LaTeX 与公式检查:语法、数学正确性、符号一致性(阶段 8/9)
import path from 'node:path';
import { callQwen, readTextCapped, fail, isFatal } from './qwen_common.mjs';

const MODES = {
  review: `你是数学建模竞赛的资深评委,独立评审以下产物(推导/代码/论文片段)。
第一行必须输出:总体结论:通过 | 需修改 | 有硬伤
然后列出问题,每条格式:
【高/中/低】<位置引用> <问题描述> → <修改建议>
【高】= 会导致错误结论或明显扣分,必须修;【中】= 建议修;【低】= 可选。
不要客套;只基于材料本身判断,不要脑补材料中没有的内容。若确实问题很少,说明理由后给出最值得改进的 1-2 点。`,
  challenge: `你是数学建模竞赛的对抗评审员。你的任务:假设以下工作的结论是错的、模型选择不是最优的,全力推翻它。
第一行必须输出:总体结论:站得住 | 可被质疑 | 有硬伤
然后给出:
1. 最致命的三个质疑(按杀伤力排序,每个说明攻击点与可能的后果)
2. 反例或反证尝试(数据/逻辑层面)
3. 你作为评审会推荐的更优替代方案(若有)
只基于材料本身,不许客套。`,
  recompute: `你是数学建模竞赛的独立复算员。对照给出的数据、公式/代码和"待验证结果",独立核算关键数值是否吻合。
第一行必须输出:总体结论:吻合 | 有出入 | 无法验证
然后:逐项列出你独立核算的过程与数值,标注与待验证结果的一致/不一致处;
不一致时给出你认为正确的值或明确的复核建议。若材料不足以复算,明确说缺什么。`,
  latex: `你是 LaTeX 与数学公式的审校员。检查以下材料:
1. LaTeX 语法错误(命令拼写、环境配对、转义)
2. 公式的数学正确性与符号前后一致性
3. 中文排版(xelatex/ctex 场景)的常见坑
第一行必须输出:总体结论:通过 | 需修改 | 有硬伤
然后按位置列出问题与修改建议,【高/中/低】分级。`,
};

try {
  const args = process.argv.slice(2);
  const focusIdx = args.indexOf('--focus');
  const focus = focusIdx >= 0 ? args[focusIdx + 1] : '';
  const rest = focusIdx >= 0 ? [...args.slice(0, focusIdx), ...args.slice(focusIdx + 2)] : args;
  const mode = rest[0];
  const files = rest.slice(1);
  if (!MODES[mode]) fail(`mode 必须是 ${Object.keys(MODES).join(' | ')},收到: ${mode}`);
  if (files.length === 0) fail('至少给一个文件: node qwen_review.mjs <mode> <文件...> [--focus "..."]');

  const sections = files.map((f, i) => {
    const abs = path.resolve(f);
    return `===== 文件${i + 1}: ${path.basename(abs)} =====\n${readTextCapped(abs)}`;
  }).join('\n\n');
  const userText = sections + (focus ? `\n\n【评审关注点】\n${focus}` : '');
  try {
    console.log(await callQwen([
      { role: 'system', content: MODES[mode] },
      { role: 'user', content: userText },
    ]));
  } catch (e) {
    fail(e.message);
  }
} catch (e) {
  if (!isFatal(e)) {
    console.error(e);
    process.exitCode = 1;
  }
}
