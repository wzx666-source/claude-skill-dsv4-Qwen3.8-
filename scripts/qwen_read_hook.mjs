#!/usr/bin/env node
// qwen_read_hook.mjs — PreToolUse(Read)自动路由,让"输入含图自动切 Qwen"在工具层硬生效:
//   - 图片文件 → 自动调 Qwen 读图,deny 本次 Read 并把图的内容注入上下文(无视觉主模型的透明替换)
//   - PDF 文件  → deny 并给出三条替代路径(Qwen 会话 / pdftotext / 转 PNG 走视觉外挂)
//   - 其他文件  → 放行
// 可靠性设计(吸取 CCR 教训):
//   - fail-open:Qwen API 失败时放行原 Read,绝不因外挂故障卡住主会话
//   - 输出格式与 protect-secrets.js 一致(本机验证过):deny 用 hookSpecificOutput,放行输出 {}
//   - 每次路由写入 hooks-logs,可事后排查
import path from 'node:path';
import fs from 'node:fs';
import { callQwen, imageBlock, IMAGE_EXTS } from './qwen_common.mjs';

const VISION_PROMPT = '详细描述这张图片的全部信息:文字内容、数值、图表结构、坐标轴含义、数据趋势、异常点、公式。信息尽量完整准确,供后续数学建模推理直接使用。';

function log(entry) {
  try {
    const dir = path.join(process.env.HOME, '.claude', 'hooks-logs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, `${new Date().toISOString().slice(0, 10)}.jsonl`),
      JSON.stringify({ ts: new Date().toISOString(), hook: 'qwen-read-hook', ...entry }) + '\n'
    );
  } catch {}
}

function deny(reason) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  let data;
  try { data = JSON.parse(input); } catch { return console.log('{}'); }
  const { tool_name, tool_input } = data;
  if (tool_name !== 'Read' || !tool_input?.file_path) return console.log('{}');
  const abs = path.resolve(tool_input.file_path);
  if (!fs.existsSync(abs)) return console.log('{}'); // 文件不存在时放行,让 Read 正常报错
  const ext = path.extname(abs).toLowerCase().slice(1);

  if (ext === 'pdf') {
    log({ level: 'ROUTED', kind: 'pdf', target: abs });
    return deny('PDF 页面是图像,当前主模型无视觉,不能直接 Read。改用以下方式之一:\n'
      + '1) 优先: node C:/Users/王子轩/.claude/skills/qwen-dual-model/scripts/pdf_read.mjs <pdf> — 自动提取文字+含图页走 Qwen 视觉;\n'
      + '2) 扫描件/通篇图表的 PDF:在 Qwen 会话(CC Switch 切百炼)里读;\n'
      + '3) 只要文字: pdftotext -layout <pdf> <输出.txt>。');
  }
  if (!IMAGE_EXTS.has(ext)) return console.log('{}');

  try {
    const content = [imageBlock(abs), { type: 'text', text: VISION_PROMPT }];
    const result = await callQwen([{ role: 'user', content }]);
    log({ level: 'ROUTED', kind: 'image', target: abs, bytes: fs.statSync(abs).size });
    deny(`🖼️ 图片已由 Qwen 自动读取,内容如下(无需再 Read 该图片):\n\n${result}`);
  } catch (e) {
    // fail-open:外挂故障时放行 Read,绝不卡住主会话
    log({ level: 'FALLBACK', kind: 'image', target: abs, error: e.message });
    console.log('{}');
  }
}

main();
