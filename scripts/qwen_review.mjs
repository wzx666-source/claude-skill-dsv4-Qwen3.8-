#!/usr/bin/env node
// qwen_review.mjs — 独立评审(评审方自动 = 非驱动方的那个厂商,提供真实第二意见)
// 用法: node qwen_review.mjs <mode> <文件...> [--focus "<关注点>"] [--context "<领域背景>"]
//   review    同行评审:逻辑/数值/符号/表达,分级报告
//   challenge 对抗评审:假设结论错误,全力找反例与致命质疑(架构选型、结论定稿、终稿提交前)
//   recompute 独立复算:对照数据/公式/代码与结果,核验关键数值
//   latex     LaTeX 与公式检查:语法、数学正确性、符号一致性
//
// 评审方自动翻转:本会话跑 DeepSeek → 评审走 Qwen;双开 Qwen 会话 → 评审走 DeepSeek。
// 这样无论哪边当主模型,都不会退化成"自己审自己"。评审方打印在 stderr,stdout 首行仍是「总体结论:…」。
// **档位由 mode 决定**(见 qwen_common.mjs 的 PROVIDERS.modeModels):翻转只决定"哪家厂商",
// mode 决定"该厂商的哪一档"—— 例:DeepSeek 侧 review/challenge 走 v4-pro(GPQA 92.4)、
// recompute 走 flash(Codeforces 3471)。
//
// --focus   指定本轮关注点(如 "--focus \"并发安全\"")
// --context 补充领域背景,让评审按该领域的规范来判(如 "--context \"Rust 异步运行时,关注 Send/Sync 边界\""、
//           "--context \"数学建模竞赛论文,关注模型创新性与摘要扣题\"");不给则按通用标准
import path from 'node:path';
import { callReviewer, reviewerMeta, readTextCapped, inferDomain, fail, isFatal } from './qwen_common.mjs';

const MODES = {
  review: `你是资深评审,独立评审以下产物(代码/推导/文档/论文片段均可)。
第一行必须输出:总体结论:通过 | 需修改 | 有硬伤
然后列出问题,每条格式:
【高/中/低】<位置引用> <问题描述> → <修改建议>
【高】= 会导致错误结论或明显缺陷,必须修;【中】= 建议修;【低】= 可选。
硬约束(防止流畅但无依据的判断流到人手里):
- 每条问题必须能指到材料中的具体行号/位置;指不出位置的判断,降级为【低】或标注「无法定位」
- 只基于材料本身判断,不要脑补材料中没有的内容
不要客套。若确实问题很少,说明理由后给出最值得改进的 1-2 点。`,
  challenge: `你是对抗评审员。你的任务:假设以下工作的结论是错的、方案不是最优的,全力推翻它。
第一行必须输出:总体结论:站得住 | 可被质疑 | 有硬伤
然后给出:
1. 最致命的三个质疑(按杀伤力排序,每个说明攻击点与可能的后果)
2. 反例或反证尝试(数据/逻辑层面)
3. 你作为评审会推荐的更优替代方案(若有)
硬约束(对抗模式最容易产出流畅的假质疑 —— "全力推翻"这个指令本身就是幻觉的温床,必须自己给证据):
- 每条质疑必须能指到材料中的具体行号/位置;指不出位置的质疑,降级为【低】或标注「无法定位」
- 只基于材料本身,不要脑补材料中没有的内容;不要为了凑够三条而编造质疑
- 反例必须给出构造过程或数据来源;给不出就明说「未能构造出反例」,不许拿看着像反例的东西充数
- 若材料确实站得住,就如实说站得住,并列出你试过且失败了的攻击面 —— 这比凑三条假质疑有用
不许客套。`,
  recompute: `你是独立复算员。对照给出的数据、公式/代码和"待验证结果",独立核算关键数值是否吻合。
第一行必须输出:总体结论:吻合 | 有出入 | 无法验证
然后逐项列出,每项三项都要有:
- 【核算过程】从原始数据出发的逐式演算步骤,写出代入的数值与中间结果(不许只给结论数字)
- 【出处】该数值取自材料的哪一行/哪一节(给可核对的位置引用)
- 【判定】与待验证结果一致 / 不一致(不一致时给出你认为正确的值)
硬约束(复算是"流畅的错误答案不被察觉"的高危场景,必须自己给证据):
- 无核算过程支撑的判断,一律判为「无法验证」并显式标注,不许给"看起来对"
- 每一条结论都必须能指到材料中的具体位置;指不到就说明材料缺什么
- 不要沿用材料里的中间步骤,必须自己从头算`,
  latex: `你是 LaTeX 与数学公式的审校员。检查以下材料:
1. LaTeX 语法错误(命令拼写、环境配对、转义)
2. 公式的数学正确性与符号前后一致性
3. 中文排版(xelatex/ctex 场景)的常见坑
第一行必须输出:总体结论:通过 | 需修改 | 有硬伤
然后按位置列出问题与修改建议,【高/中/低】分级。
硬约束(符号一致性与命令正确性最容易凭空断言):
- 每条问题必须能指到材料中的具体行号/位置;指不出位置的降级为【低】或标注「无法定位」
- 判定「符号不一致」时,必须同时给出该符号冲突的两处出处,只给一处不算数
- 不要凭记忆断言某条 LaTeX 命令不存在或写法有误;不确定就标注「需实际编译验证」,交给 xelatex 定夺
- 只基于材料本身,不要脑补材料里没有的宏包或宏定义`,
};

try {
  const args = process.argv.slice(2);
  // 取出 --focus / --context 及其值,剩下的按位置参数解析
  function takeOpt(name) {
    const i = args.indexOf(name);
    if (i < 0) return '';
    const v = args[i + 1] ?? '';
    args.splice(i, 2);
    return v;
  }
  const focus = takeOpt('--focus');
  const context = takeOpt('--context');
  const mode = args[0];
  const files = args.slice(1);
  if (!MODES[mode]) {
    fail(`mode 必须是 ${Object.keys(MODES).join(' | ')},收到: ${mode}`
      + '\n用法: node qwen_review.mjs <mode> <文件...> [--focus "..."] [--context "..."]');
  }
  if (files.length === 0) {
    fail('至少给一个文件: node qwen_review.mjs <mode> <文件...> [--focus "..."] [--context "..."]');
  }

  const sections = files.map((f, i) => {
    const abs = path.resolve(f);
    return `===== 文件${i + 1}: ${path.basename(abs)} =====\n${readTextCapped(abs)}`;
  }).join('\n\n');
  const userText = sections + (focus ? `\n\n【评审关注点】\n${focus}` : '');
  // --context 缺省时自动推断领域(纯文件 I/O)。放在参数校验之后 —— 零参数/报错路径
  // 在上面的 fail() 就终止了,走不到这里,不会拖慢 self_test 的用法检查。
  const effectiveContext = context || inferDomain(files);
  // 领域背景并入 system,让评审按该领域的规范判,而不是泛泛而谈
  const systemPrompt = MODES[mode] + (effectiveContext ? `\n\n【领域背景(按此领域的规范评审)】\n${effectiveContext}` : '');

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userText },
  ];
  const meta = reviewerMeta(messages, { mode });
  console.error(`🔍 评审方: ${meta.label} (${meta.model})｜按 ${mode} 档选模型`
    + `｜驱动方 ${meta.driverLabel} 不参与本次评审`);
  // 领域来源必须让用户看得见:自动推断的东西不能悄悄生效,否则判据从哪来就说不清了
  if (context) {
    console.error(`🧭 领域(手动指定): ${context.slice(0, 60)}`);
  } else if (effectiveContext) {
    console.error(`🧭 未给 --context,自动推断领域: ${effectiveContext}(用 --context 覆盖)`);
  } else {
    console.error('🧭 未给 --context,也未推断出领域 → 按通用标准评审(建议显式给 --context)');
  }
  if (meta.caveat) console.error(`ℹ️ 存疑: ${meta.caveat}`);
  try {
    console.log(await callReviewer(messages, { mode }));
  } catch (e) {
    fail(e.message);
  }
} catch (e) {
  if (!isFatal(e)) {
    console.error(e);
    process.exitCode = 1;
  }
}
