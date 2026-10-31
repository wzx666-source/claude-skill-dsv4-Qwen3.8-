#!/usr/bin/env node
// qwen_vision.mjs — Qwen 视觉外挂:读图 → 文字
// 用法: node qwen_vision.mjs <图片路径...> "<问题>"
//   单图: node qwen_vision.mjs figures/fit.png "检查曲线是否有断点或异常"
//   多图: node qwen_vision.mjs fig1.png fig2.png fig3.png "对比三张图,哪张趋势异常?"
//   手写: node qwen_vision.mjs photos/note.jpg "把手写推导逐行转成 LaTeX"
// 多图一次传入(最多 6 张),Qwen 按顺序编号为图1..图N。
// 选项:
//   --think           开启思考链(默认**关闭**;qwen3.8-max 思考模式下视觉调用会多花 60–240s)
//   --max-tokens N    输出上限,默认 4096
//   --no-cache        跳过视觉缓存(默认按"图片内容+问题"命中缓存)
import path from 'node:path';
import fs from 'node:fs';
import { callQwen, imageBlock, IMAGE_EXTS, MAX_IMAGES, fail, isFatal, visionCacheGetMany, visionCacheSetMany } from './qwen_common.mjs';

try {
  const raw = process.argv.slice(2);
  const think = raw.includes('--think');
  const noCache = raw.includes('--no-cache');
  let maxTokens = 4096;
  const mtIdx = raw.indexOf('--max-tokens');
  if (mtIdx >= 0) {
    const v = Number(raw[mtIdx + 1]);
    if (!Number.isInteger(v) || v <= 0) fail('--max-tokens 需要一个正整数,例如 --max-tokens 2048');
    maxTokens = v;
  }
  const args = raw.filter((a, i) => {
    if (a === '--think' || a === '--no-cache' || a === '--max-tokens') return false;
    if (mtIdx >= 0 && i === mtIdx + 1) return false;
    return true;
  });
  if (args.length < 2) {
    fail('用法: node qwen_vision.mjs [--think] [--max-tokens N] [--no-cache] <图片路径...> "<问题>"\n示例: node qwen_vision.mjs figures/fit.png "检查曲线是否有断点或异常"');
  }
  const question = args[args.length - 1];
  // 防呆:最后一个参数是「问题」。漏写问题时,最后一个图片路径会被**静默**当成问题发出去
  // (只发出前 N-1 张图 + 一句 "b.png",不报错、结果全错)。挡在发请求之前。
  if (IMAGE_EXTS.has(path.extname(question).toLowerCase().slice(1)) || fs.existsSync(question)) {
    fail(`最后一个参数应该是「问题」,但看起来是文件路径: ${question}\n`
      + '用法: node qwen_vision.mjs <图片路径...> "<问题>"   ← 问题别漏');
  }
  const imagePaths = args.slice(0, -1).map(p => path.resolve(p));
  if (imagePaths.length > MAX_IMAGES) {
    fail(`一次最多 ${MAX_IMAGES} 张图,收到 ${imagePaths.length} 张,请分批`);
  }
  for (const p of imagePaths) {
    const ext = path.extname(p).toLowerCase().slice(1);
    if (!IMAGE_EXTS.has(ext)) fail(`不支持的文件类型: ${p}(支持: ${[...IMAGE_EXTS].join(', ')})`);
  }
  const content = [
    ...imagePaths.map((p) => imageBlock(p)),
    { type: 'text', text: `图片共 ${imagePaths.length} 张,已按顺序编号(图1..图${imagePaths.length})。\n\n${question}` },
  ];

  // 缓存:相同图片内容 + 相同问题 → 直接复用。单图时与 qwen_read_hook 的旧缓存同键。
  // 思考开关影响答案,缓存键须区分;用前缀,因为键只取问题前 200 字
  const cacheQ = think ? `[think]\n${question}` : question;
  const cached = noCache ? null : visionCacheGetMany(imagePaths, cacheQ);
  if (cached) {
    console.log(cached);
  } else {
    try {
      const answer = await callQwen([{ role: 'user', content }], {
        // 关键:视觉任务默认关闭思考链。qwen3.8-max 思考模式下单次 60–240s,
        // 关闭后同一张图约 2s —— 实测差异来自 3000–9500 个 reasoning token。
        enableThinking: think,
        maxTokens,
      });
      if (!noCache) visionCacheSetMany(imagePaths, cacheQ, answer);
      console.log(answer);
    } catch (e) {
      fail(e.message);
    }
  }
} catch (e) {
  if (!isFatal(e)) {
    console.error(e);
    process.exitCode = 1;
  }
}
