#!/usr/bin/env node
// qwen_read_hook.mjs — PreToolUse(Read)自动路由,让"读图统一走 Qwen"在工具层硬生效:
//   - 图片文件 → 自动调 Qwen 读图,deny 本次 Read 并把图的内容注入上下文
//   - PDF 文件  → deny 并给出三条替代路径(Qwen 会话 / pdftotext / 转 PNG 走视觉外挂)
//   - 其他文件  → 放行
//   - 驱动方是 Qwen(百炼)时整体让行:Qwen 有原生视觉,再拦截只会绕回自己
// 可靠性设计(吸取 CCR 教训):
//   - fail-open:Qwen API 失败时放行原 Read,绝不因外挂故障卡住主会话
//     (注:DeepSeek-V4.1-Flash 已有原生视觉,放行后主模型确实能读,不再等于"读不了")
//   - **fail-open 不静默**:放行时用 additionalContext 把"本次未走 Qwen"送进模型上下文,
//     让"在回复里说明"这条协议真正可执行;若驱动档是纯文本档,明确说是死路而非假装成功。
//     只给 additionalContext、不给 permissionDecision —— 权限流程与原来的 `{}` 等价。
//   - 输出格式与 protect-secrets.js 一致(本机验证过):deny 用 hookSpecificOutput,放行输出 {}
//   - 每次路由写入 hooks-logs,可事后排查
import path from 'node:path';
import fs from 'node:fs';
import { callQwen, imageBlock, IMAGE_EXTS, activeProviderName, driverVisionCapable, TIMEOUTS, visionCacheGet, visionCacheSet } from './qwen_common.mjs';

// hook 专用精简 prompt —— 与手动 qwen_vision.mjs 的完整版分开:
// 旧 prompt 要求"图表结构、坐标轴、数据趋势、异常点、公式",对幻灯片大半是空话("无坐标轴"),
// 每页仍生成 1-2k 字,是这次(10-19~21 PPT 任务)上下文被压缩的直接推手。hook 跑在 PreToolUse 里,
// 只给主模型一个"能据此判断"的摘要即可;要完整描述走手动 qwen_vision.mjs。
// 按图片类型分档:幻灯片预览(preview/slide 命名)只报排版四项;其他图(图/表/手写)给精简通用描述。
const SLIDE_HINT = /preview|slide|s\d{2,3}\b/i;
const HOOK_PROMPT_SLIDE = '这是一张幻灯片预览。只报告:① 文字内容(逐字)② 文字是否溢出或被遮挡 ③ 元素对齐 ④ 配图占比与留白。不要描述"坐标轴/数据趋势/异常点/公式"这类幻灯片通常没有的项;简明扼要,不要空话。';
const HOOK_PROMPT_GENERIC = '简要描述这张图片:文字内容(逐字)、数值、若为图表则说明结构与坐标轴。只报实际存在的内容,不要为缺失项写空话。简明扼要。';
const HOOK_MAX_TOKENS = 500;   // 配合精简 prompt,从无上限的 1-2k 字压到 ~500 token,既省上下文又省时

function hookPrompt(abs) {
  return SLIDE_HINT.test(abs) ? HOOK_PROMPT_SLIDE : HOOK_PROMPT_GENERIC;
}

// 同目录幻灯片张数 ≥4 时,提示改用 qwen_vision 批量(逐张 Read 走的是最慢的那条路)。
// 纯文件系统判断,无状态、无跨进程记录,够用且零成本。
function batchHint(abs) {
  if (!SLIDE_HINT.test(abs)) return '';
  const dir = path.dirname(abs);
  try {
    const sibs = fs.readdirSync(dir).filter(f => /\.(png|jpe?g|webp|bmp)$/i.test(f));
    if (sibs.length >= 4) {
      return `\n\n💡 这批幻灯片预览共 ${sibs.length} 张,逐张 Read 走的是最慢的路。改用一次性批量更省时(每批 ≤6 张):\n  node C:/Users/王子轩/.claude/skills/qwen-dual-model/scripts/qwen_vision.mjs <图1> <图2> … "逐张检查:文字溢出/遮挡、对齐、配图占比"`;
    }
  } catch {}
  return '';
}

function log(entry) {
  try {
    // USERPROFILE 优先(Windows):只认 HOME 的话,没设 HOME 的环境里
    // 每次日志都会抛异常并被下面的 catch 吞掉 —— 偏偏 fail-open 的诊断全靠这条日志
    const home = process.env.USERPROFILE || process.env.HOME;
    if (!home) return;
    const dir = path.join(home, '.claude', 'hooks-logs');
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

  // 驱动方是 Qwen 时整体让行:协议里"扫描件/图密集 PDF 就在 Qwen 会话里直接 Read"依赖这条路,
  // 此处再拦截会拦掉自己的工作流(Qwen 读图还得再调一次 Qwen,纯属绕圈)
  if (activeProviderName() === 'bailian') {
    log({ level: 'PASSTHROUGH', kind: 'driver-is-qwen', target: abs });
    return console.log('{}');
  }

  if (ext === 'pdf') {
    log({ level: 'ROUTED', kind: 'pdf', target: abs });
    return deny('PDF 页面是图像,按项目协议统一走 Qwen 视觉。改用以下方式之一:\n'
      + '1) 优先: node C:/Users/王子轩/.claude/skills/qwen-dual-model/scripts/pdf_read.mjs <pdf> — 自动提取文字+含图页走 Qwen 视觉;\n'
      + '2) 扫描件/通篇图表的 PDF:在 Qwen 会话(CC Switch 切百炼)里读;\n'
      + '3) 只要文字: pdftotext -layout <pdf> <输出.txt>。');
  }
  if (!IMAGE_EXTS.has(ext)) return console.log('{}');

  const t0 = Date.now();
  try {
    const prompt = hookPrompt(abs);
    const hint = batchHint(abs);

    // 缓存命中:相同文件内容 + 相同 prompt → 直接复用,省一次 Qwen 调用(节省 ~40s)
    const cached = visionCacheGet(abs, prompt);
    if (cached) {
      log({ level: 'CACHE_HIT', kind: 'image', target: abs });
      return deny(`🖼️ 图片已由 Qwen 自动读取(缓存)，内容如下(无需再 Read 该图片):${hint}\n\n${cached}`);
    }

    const stat = fs.statSync(abs);
    const content = [imageBlock(abs), { type: 'text', text: prompt }];

    // hook 内超时与超时策略:
    //   旧版 90s 单次 → 切在实测 p90=61s 的尾部(本批 45 次里失败 2 次均 90.01s 超时)。
    //   新版 120s 单次 + 1 次仅超时重试:给尾部 ~10% 的慢调用留足余量;重试只对 AbortError
    //   触发,不对 API 错误触发(以免两倍惩罚已限流的情况)。
    //   max_tokens 500:配合精简 prompt 把生成量从旧 1-2k 字压到 ~500 token,既省上下文又省时延。
    let result;
    for (let i = 0; i <= 1; i++) {
      try {
        result = await callQwen([{ role: 'user', content }], {
          timeoutMs: TIMEOUTS.hook,   // 120s(见 qwen_common.mjs TIMEOUTS.hook)
          retries: 0,                  // 重试由此循环控制,避免双重重试逻辑
          maxTokens: HOOK_MAX_TOKENS,  // 500 token 上限
        });
        break;
      } catch (retryErr) {
        if (i === 0 && /超时|AbortError|timeout/i.test(retryErr.message)) {
          log({ level: 'HOOK_RETRY', kind: 'image', target: abs, attempt: 1, error: retryErr.message.slice(0, 80) });
          continue;
        }
        throw retryErr;
      }
    }
    const durationMs = Date.now() - t0;
    visionCacheSet(abs, prompt, result);
    log({ level: 'ROUTED', kind: 'image', target: abs, bytes: stat.size, durationMs });
    deny(`🖼️ 图片已由 Qwen 自动读取，内容如下(无需再 Read 该图片):${hint}\n\n${result}`);
  } catch (e) {
    // fail-open:外挂故障时放行 Read,绝不卡住主会话。但**不能静默** ——
    // 协议要求主模型"在回复里说明本次未走 Qwen",而在此之前它根本不知道发生过 fail-open,
    // 那条规则因此从来没有真正执行过(要求做一件没告诉它要做的事)。
    //
    // 做法:`additionalContext` 是 hookSpecificOutput 里**独立于 permissionDecision** 的字段
    // (本机 CLI 的消费代码里两者分开处理),所以这里**只给上下文、不给 permissionDecision** ——
    // 权限流程与原来的 `{}` 逐字等价,而模型这次会知道。
    const capable = driverVisionCapable();
    const why = String(e.message).slice(0, 120);
    const note = capable
      ? `⚠️ Qwen 视觉外挂本次调用失败,已 fail-open 放行原生 Read。`
        + `本次读图**未走 Qwen**,请在回复中明确说明;若涉及竞赛 AI 使用声明,需据实登记。`
        + `失败原因:${why}`
      : `⚠️ Qwen 视觉外挂本次调用失败,且当前驱动档是纯文本档 —— 放行原生 Read 也读不了图。`
        + `本次视觉**未执行**:不要假装看到了图,请明确告知用户,`
        + `并建议重跑 qwen_vision,或用 DEEPSEEK_MODEL=deepseek-flash 换到有原生视觉的档。`
        + `失败原因:${why}`;
    // P2:补 bytes/durationMs — 方便事后区分"是不是图太大/太慢导致的失败"
    const fallbackStat = (() => { try { return fs.statSync(abs); } catch { return null; } })();
    log({
      level: 'FALLBACK', kind: 'image', target: abs,
      bytes: fallbackStat?.size ?? null,
      durationMs: Date.now() - t0,
      error: e.message,
      driverVisionCapable: capable,
    });
    console.error(note);   // 用户侧可见
    console.log(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: note },
    }));
  }
}

main();
