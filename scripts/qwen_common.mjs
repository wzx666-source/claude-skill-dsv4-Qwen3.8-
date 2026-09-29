// qwen_common.mjs — 共享模块:双 provider(key 读取 / 驱动方识别 / 带重试调用 / 错误分类 / 文件读取)
//
// 设计要点:
//   - **视觉固定走百炼**(callQwen):用户选定读图统一由 Qwen 负责,与配图复核口径一致
//   - **评审自动翻转**(callReviewer):评审方 = 非驱动方的那个厂商,独立性来自厂商差异。
//     本会话跑 DeepSeek 时评审走 Qwen;双开 Qwen 会话时评审走 DeepSeek —— 无论哪边当主模型,
//     都不会退化成"自己审自己"
//   - **档位按 mode 分**(PROVIDERS.modeModels):翻转只决定"哪家厂商",mode 决定"该厂商的哪一档"。
//     依据是跑分:DeepSeek 侧 Flash 赢代码/agent、Pro 赢知识/推理,不该"纯文本一律 pro"
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CC_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME || '.',
  '.cc-switch'
);
export const CC_SWITCH_DB = path.join(CC_DIR, 'cc-switch.db');

/**
 * provider 注册表;id 与 CC Switch 数据库一致,API key 自动同步,无需硬编码。
 *
 * 档位依据跑分(2026-09 数据,复核期限 2026-10-31):
 *   DeepSeek V4.1-Flash 与 V4-Pro 已不是"快慢档"而是两个方向 ——
 *     Flash 赢代码/agent: DeepSWE 74.2 vs 62.7、Codeforces 3471 vs 3348、Terminal-Bench 3.0 30.0 vs 11.8
 *     Pro   赢知识/推理: GPQA 92.4 vs 90.9、HLE 42.7 vs 36.8
 *   故按 mode 分档,而不是"纯文本一律 pro"。仅 Flash 有原生视觉(ViT)。
 *   Qwen3.8-Max 是单一档位,四个 mode 同模型(视觉 MathVision 95.2 仍压过 Flash 的 BabyVision 89.6)。
 */
export const PROVIDERS = {
  bailian: {
    id: 'e303406a-b8e2-477f-b367-88d5aa1bb64b',
    label: 'Qwen(百炼)',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    textModel: 'qwen3.8-max',
    visionModel: 'qwen3.8-max',
    modeModels: {
      review: 'qwen3.8-max',      // PaperBench 93.0 / IFBench 82.8
      challenge: 'qwen3.8-max',
      recompute: 'qwen3.8-max',
      latex: 'qwen3.8-max',
    },
    envModel: 'QWEN_MODEL',
    envKey: 'QWEN_API_KEY',
  },
  deepseek: {
    id: '49e1a8fb-5953-40f0-afe5-f1c5fe5b747c',
    label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    textModel: 'deepseek-v4-pro',      // 默认档 = 知识/推理
    agenticModel: 'deepseek-flash',    // 代码/agent 档
    visionModel: 'deepseek-flash',     // 仅 Flash 有原生视觉
    modeModels: {
      review: 'deepseek-v4-pro',       // GPQA 92.4 / HLE 42.7
      challenge: 'deepseek-v4-pro',
      recompute: 'deepseek-flash',     // Codeforces 3471 / 逐式核算更依赖执行
      latex: 'deepseek-v4-pro',
    },
    envModel: 'DEEPSEEK_MODEL',
    envKey: 'DEEPSEEK_API_KEY',
  },
};

// ───────────────── 生成物档位(模型迭代通道的输出) ─────────────────
// model_roster.json(事实)→ model_audit.mjs(推导)→ tiers.generated.json(生成物)→ 这里读取。
// 下面的硬编码 modeModels 保留两个作用:① 生成物缺失/损坏时的**保底**;
// ② model_audit 推导时的**基线意图**(tie-break 用,避免推荐自我引用)。
const SKILL_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const TIERS_FILE = path.join(SKILL_ROOT, 'tiers.generated.json');

/** 模块级读一次;**缺失/损坏一律静默回落硬编码** —— 生成物坏掉绝不影响主线 */
function loadGeneratedTiers() {
  try {
    const j = JSON.parse(fs.readFileSync(TIERS_FILE, 'utf8'));
    return j?.schema === 1 && j.providers ? j : null;
  } catch { return null; }
}
const GENERATED = loadGeneratedTiers();

/** 当前实际生效的档位与来源(供 model_audit / self_test 体检) */
export function resolvedTiers() {
  const providers = {};
  for (const name of Object.keys(PROVIDERS)) {
    const modeModels = {};
    for (const mode of Object.keys(PROVIDERS[name].modeModels ?? {})) {
      modeModels[mode] = pickModel(name, { mode });
    }
    providers[name] = { modeModels };
  }
  return {
    source: GENERATED ? 'generated' : 'baseline',
    generatedAt: GENERATED?.generatedAt ?? null,
    providers,
  };
}

// 向后兼容:旧调用方引用的常量(均指百炼 = 视觉通道)
export const BAILIAN_PROVIDER_ID = PROVIDERS.bailian.id;
export const ENDPOINT = PROVIDERS.bailian.endpoint;
export const DEFAULT_MODEL = PROVIDERS.bailian.textModel;
export const MAX_IMAGES = 6;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT_BYTES = 200 * 1024;
export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tiff']);

/** 读取指定 provider 的 API key:环境变量优先,否则自动从 CC Switch 数据库读 */
export function loadKey(providerName = 'bailian') {
  const p = PROVIDERS[providerName];
  if (!p) throw new Error(`未知 provider: ${providerName}`);
  if (process.env[p.envKey]) return process.env[p.envKey];
  if (!fs.existsSync(CC_SWITCH_DB)) {
    throw new Error(`找不到 CC Switch 数据库: ${CC_SWITCH_DB}`);
  }
  const db = new DatabaseSync(CC_SWITCH_DB, { readOnly: true });
  const row = db.prepare('SELECT settings_config FROM providers WHERE id = ?').get(p.id);
  if (!row) throw new Error(`CC Switch 中没有 ${p.label} provider`);
  const key = JSON.parse(row.settings_config)?.env?.ANTHROPIC_AUTH_TOKEN;
  if (!key) throw new Error(`${p.label} provider 未配置 API key,请到 CC Switch 检查`);
  return key;
}

/** 判断消息里是否含图片(决定用 textModel 还是 visionModel) */
export function hasImageContent(messages = []) {
  return messages.some(m => Array.isArray(m.content)
    && m.content.some(b => b && (b.type === 'image_url' || b.type === 'image')));
}

/**
 * 选模型,优先级:环境变量 > 含图落视觉档 > 生成物 > 硬编码基线 > textModel。
 * 第二参数是 options 对象(**旧签名是布尔 hasImages,已废弃**)。
 */
export function pickModel(providerName, { hasImages = false, mode = '' } = {}) {
  const p = PROVIDERS[providerName];
  if (process.env[p.envModel]) return process.env[p.envModel];
  if (hasImages) return p.visionModel;
  return GENERATED?.providers?.[providerName]?.modeModels?.[mode]
    || p.modeModels?.[mode] || p.textModel;
}

export function loadModel(providerName = 'bailian', opts = {}) {
  return pickModel(providerName, opts);
}

/**
 * 档位别名探针记录 —— 提示由**实测量**驱动,不由新闻驱动。
 *
 * 背景:有厂商口径称 DeepSeek 自 2026-09-14 起把全部 V4-Pro 请求改由 V4.1-Flash 承接
 * (直到 V4.1-Pro 发布)。若属实则落在 v4-pro 的档位实际由 Flash 服务,其 GPQA/HLE
 * 的知识优势拿不到,modeModels 里 Pro/Flash 的分档就成了空操作。
 *
 * 实测(2026-09-28,self_test.mjs「溯源探针」读响应体回显的 model id):
 *   v4-pro→deepseek-v4-pro / flash→deepseek-flash,两档回显不同 → 该重定向对本账号不成立,
 *   分档实际生效。故 per-run 不再打印提示(避免每次评审都刷噪音)。
 *
 * 已知局限:探针读的是**服务端回报**的 model id,不是地面真值。网关若静默别名却回显
 * 请求名,探针会被骗过。故结论口径是"本账号未观察到重定向",不是"已证伪"。
 *
 * 复核期限 2026-10-31:重跑 self_test.mjs;若届时实测变成 'aliased',
 * 把 verdict 改成 'aliased' 即可让所有评审/咨询脚本重新打出提示。
 */
export const MODEL_ALIAS_PROBE = {
  checkedAt: '2026-09-28',
  verdict: 'distinct',   // 'distinct' = 分档生效 | 'aliased' = Pro 被重定向到 Flash
  note: '2026-09-14 起有口径称 V4-Pro 请求被重定向至 V4.1-Flash;本账号 2026-09-28 实测未观察到',
};

/** 档位存疑提示:仅当实测确认为别名时才返回内容(默认静默) */
export function modelCaveat(model) {
  if (model !== 'deepseek-v4-pro' || MODEL_ALIAS_PROBE.verdict !== 'aliased') return '';
  return `${MODEL_ALIAS_PROBE.note} → 此档知识优势可能不可得,跑 node scripts/self_test.mjs 溯源探针复核`;
}

/**
 * 当前驱动会话的 provider:CC Switch settings.json 的 currentProviderClaude 优先,
 * 数据库 is_current 兜底;识别失败按 DeepSeek(用户默认档)处理。
 */
export function activeProviderName() {
  if (process.env.DRIVER_PROVIDER && PROVIDERS[process.env.DRIVER_PROVIDER]) {
    return process.env.DRIVER_PROVIDER;
  }
  try {
    const s = JSON.parse(fs.readFileSync(path.join(CC_DIR, 'settings.json'), 'utf8'));
    for (const [name, p] of Object.entries(PROVIDERS)) {
      if (p.id === s.currentProviderClaude) return name;
    }
  } catch {}
  try {
    const db = new DatabaseSync(CC_SWITCH_DB, { readOnly: true });
    const row = db.prepare("SELECT id FROM providers WHERE app_type = 'claude' AND is_current = 1").get();
    if (row) {
      for (const [name, p] of Object.entries(PROVIDERS)) {
        if (p.id === row.id) return name;
      }
    }
  } catch {}
  return 'deepseek';
}

/** 评审方 = 非驱动方(独立性来源);驱动方识别不到时,默认 DeepSeek 驱动 → Qwen 评审 */
export function peerProviderName() {
  return activeProviderName() === 'bailian' ? 'deepseek' : 'bailian';
}

/** 已知的纯文本档(依据 model_roster.json 的 vision 字段:DeepSeek 侧只有 flash 有原生视觉) */
const TEXT_ONLY_MODELS = ['deepseek-v4-pro'];

/**
 * 尽力判断**当前驱动会话的主模型**能不能直接读图 —— 决定 hook fail-open 放行原生 Read 有没有意义。
 * 依据是 Claude Code 实际请求的模型名(CC Switch 写进 env)。
 *
 * 局限:只看 env。若实际档位来自别处(如 settings.json 的 model 字段),这里可能判不出来 ——
 * 此时一律按"能读"处理:宁可漏报(退化成本次静默,与改造前等价),也不误报(把能读的情况说成读不了,
 * 反而让模型拒绝读一张它完全读得了的图)。
 */
export function driverVisionCapable() {
  const name = process.env.ANTHROPIC_MODEL
    || process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
    || process.env.ANTHROPIC_DEFAULT_OPUS_MODEL || '';
  if (!name) return true;
  return !TEXT_ONLY_MODELS.some(m => name.includes(m));
}

/** 评审方元信息,供脚本打印「谁在评审」banner(写 stderr,不污染 stdout 的首行结论) */
export function reviewerMeta(messages = [], { mode = '' } = {}) {
  const driver = activeProviderName();
  const name = driver === 'bailian' ? 'deepseek' : 'bailian';
  const hasImages = hasImageContent(messages);
  const model = pickModel(name, { hasImages, mode });
  return {
    name,
    label: PROVIDERS[name].label,
    model,
    hasImages,
    mode,
    caveat: modelCaveat(model),
    driver,
    driverLabel: PROVIDERS[driver].label,
  };
}

/** 把 API 错误翻译成可行动的提示 */
export function classifyError(status, payload, providerName = 'bailian') {
  const p = PROVIDERS[providerName];
  if (status === 401 || status === 403) return `API key 无效或过期 → 到 CC Switch 检查「${p.label}」的 key`;
  if (status === 429) return `${p.label} 限流(429) → 稍后重试`;
  const msg = JSON.stringify(payload?.error || payload || '').toLowerCase();
  if (msg.includes('model')) return `模型不可用 → 检查模型名(当前 ${pickModel(providerName)}),确认账号已开通该模型`;
  if (status >= 500) return `${p.label} 服务端错误(${status}) → 稍后重试`;
  return `未知错误(${status}): ${String(msg).slice(0, 200)}`;
}

/**
 * 调指定 provider:失败自动重试(限流/5xx/网络),仍失败则抛出带修复提示的错误。
 * 超时 240s:百炼视觉接口延迟方差大(实测 10s~70s+),120s 会误杀慢调用
 *
 * mode       评审/咨询的 mode(决定走哪一档),见 PROVIDERS.modeModels
 * returnMeta 返回 { content, model } 而非纯字符串;model 取自响应体回显,
 *            是识别"别名/重定向"的唯一可靠手段(见 self_test.mjs 溯源探针)
 */
export async function callModel(messages, { provider = 'bailian', model, mode = '', timeoutMs = 240000, retries = 2, returnMeta = false } = {}) {
  if (!PROVIDERS[provider]) throw new Error(`未知 provider: ${provider}`);
  const useModel = model || pickModel(provider, { hasImages: hasImageContent(messages), mode });
  const key = loadKey(provider);
  let lastErr = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    // 用 AbortController 而非 AbortSignal.timeout:确保失败退出时定时器已清理
    // (Windows 上 pending 的 timeout handle 会在 process.exit 时触发 libuv 断言崩溃)
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(PROVIDERS[provider].endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: useModel, messages }),
      });
      const j = await res.json().catch(() => ({}));
      if (j.choices && j.choices[0]) {
        const content = j.choices[0].message.content;
        return returnMeta ? { content, model: j.model || useModel } : content;
      }
      lastErr = classifyError(res.status, j, provider);
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      break; // 401/403/model 错误重试无意义
    } catch (e) {
      lastErr = `网络请求失败: ${e.message}`;
      if (attempt < retries) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${PROVIDERS[provider].label} 调用失败(已重试 ${retries} 次): ${lastErr}`);
}

/**
 * 视觉通道:固定走百炼 Qwen。读图/PDF 一律用这个,不受驱动方影响。
 * 语义与改造前完全一致(旧 qwen_* 脚本的 callQwen 就是它)。
 */
export async function callQwen(messages, opts = {}) {
  return callModel(messages, { ...opts, provider: 'bailian' });
}

/**
 * 评审通道:自动走「非驱动方」的厂商,保证是真第二意见而非自己审自己。
 * 驱动方=DeepSeek → 评审走 Qwen;驱动方=Qwen → 评审走 DeepSeek。
 * 档位由 opts.mode 决定(见 PROVIDERS.modeModels);含图一律落到该厂商有视觉的档。
 * opts 会原样透传给 callModel,故 mode / returnMeta 均可用。
 */
export async function callReviewer(messages, opts = {}) {
  const provider = peerProviderName();
  return callModel(messages, { ...opts, provider });
}

/** 读文本文件,超限截断并标注(防止超大文件撑爆请求) */
export function readTextCapped(filePath, maxBytes = MAX_TEXT_BYTES) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error('文件不存在: ' + abs);
  const size = fs.statSync(abs).size;
  const buf = fs.readFileSync(abs);
  if (size > maxBytes) {
    return buf.toString('utf8', 0, maxBytes) + `\n\n[文件过大,已截断:${size} 字节,仅发送前 ${maxBytes} 字节]`;
  }
  return buf.toString('utf8');
}

// ───────────────── 领域自动推断(--context 缺省时的兜底) ─────────────────
// 背景:`--context` 是本 skill 里最影响评审质量的参数 —— 同一个 mode,判据贴不贴领域,
// 出来的意见完全不同。但它没有自然语言入口(见 USAGE.md §三.5),于是绝大多数评审
// 是按通用标准判的。这里补一个**纯文件 I/O** 的推断:不联网、不调模型、不递归扫目录
// (必须便宜到可以默认开)。它只解决"什么都不给"这一档,把"按通用标准判"提升到
// "至少按该语言/领域的规范判";显式给了 --context 时一律以显式为准。
const EXT_DOMAIN = {
  py: 'Python 代码,关注类型与边界条件、异常处理、惯用法',
  ipynb: 'Python/Jupyter 笔记本,关注执行顺序、隐式状态、可复现性',
  m: 'MATLAB 代码,关注矩阵维度匹配、向量化、数值稳定性',
  r: 'R 代码,关注向量化、因子类型、统计假设',
  java: 'Java 代码,关注空值、并发、资源释放、异常传播',
  go: 'Go 代码,关注错误处理、goroutine 泄漏、context 取消',
  rs: 'Rust 代码,关注所有权与借用、Send/Sync 边界、取消安全',
  cpp: 'C++ 代码,关注对象生命周期、内存安全、未定义行为',
  cc: 'C++ 代码,关注对象生命周期、内存安全、未定义行为',
  hpp: 'C++ 头文件,关注包含顺序、ODR、模板实例化',
  c: 'C 代码,关注内存安全、缓冲区边界、未定义行为',
  cs: 'C# 代码,关注空值、async/await 死锁、IDisposable',
  ts: 'TypeScript 代码,关注类型收窄、空值处理、类型逃逸',
  tsx: 'TypeScript/React 组件,关注渲染副作用、依赖数组、key 与状态提升',
  jsx: 'React 组件,关注渲染副作用、依赖数组、key 与状态提升',
  js: 'JavaScript 代码,关注异步时序、this 绑定、隐式类型转换',
  vue: 'Vue 组件,关注响应式丢失、生命周期、props 变更',
  sql: 'SQL,关注注入、索引失效、隐式类型转换、N+1',
  sh: 'Shell 脚本,关注引号与分词、错误传播(set -e 语义)、可移植性',
  tex: 'LaTeX 学术排版,关注宏包冲突、数学符号一致性、xelatex/ctex 排版坑',
  bib: 'BibTeX 参考文献,关注条目字段完整性、重复条目、引用键一致性',
  md: '文档/论文正文,关注论证链条、术语一致性、正文与图表是否互相印证',
  csv: 'CSV 数据,关注列语义、缺失值、异常值、单位',
  json: 'JSON 数据/配置,关注结构一致性、缺省值、与代码契约是否相符',
  yaml: 'YAML 配置,关注缩进与类型歧义、锚点引用',
  yml: 'YAML 配置,关注缩进与类型歧义、锚点引用',
};

/** 读项目根的 CLAUDE.md / README.md 取首个标题,作为一句项目背景(限 2KB;读不到就放弃) */
function projectHeading(cwd) {
  for (const name of ['CLAUDE.md', 'README.md', 'readme.md']) {
    try {
      const p = path.join(cwd, name);
      if (!fs.existsSync(p)) continue;
      const head = fs.readFileSync(p, 'utf8').slice(0, 2048);
      const m = head.match(/^#{1,3}[ \t]+(.+)$/m);
      const line = m ? m[1] : head.split('\n').map(s => s.trim())
        .find(s => s && !s.startsWith('<!--') && !s.startsWith('---'));
      if (line) return line.replace(/[`*_#]/g, '').trim().slice(0, 80);
    } catch { /* 推断失败不该影响评审,静默跳过 */ }
  }
  return '';
}

/**
 * 从待评审文件路径推断领域背景。**纯文件 I/O**:不联网、不调模型、不递归扫目录。
 * @param {string[]} files 待评审文件路径
 * @param {{cwd?: string}} [opts]
 * @returns {string} 领域描述;推断不出时返回空串(调用方据此说明"按通用标准评审")
 */
export function inferDomain(files = [], { cwd = process.cwd() } = {}) {
  const hits = new Map();
  for (const f of files) {
    const ext = path.extname(String(f)).toLowerCase().slice(1);
    if (EXT_DOMAIN[ext]) hits.set(ext, (hits.get(ext) || 0) + 1);
  }
  // 出现次数多的扩展名优先;最多取两种(应对 .py + .md 这类混合提交)
  const parts = [...hits.entries()].sort((a, b) => b[1] - a[1])
    .slice(0, 2).map(([ext]) => EXT_DOMAIN[ext]);
  const heading = projectHeading(cwd);
  if (heading) parts.push(`项目背景: ${heading}`);
  return parts.join('；');
}

/** 图片 → base64 content block(大小检查) */
export function imageBlock(absPath, maxBytes = MAX_IMAGE_BYTES) {
  if (!fs.existsSync(absPath)) throw new Error('图片不存在: ' + absPath);
  const size = fs.statSync(absPath).size;
  if (size > maxBytes) {
    throw new Error(`图片过大(${(size / 1024 / 1024).toFixed(1)}MB),单图限 ${maxBytes / 1024 / 1024}MB`);
  }
  const ext = path.extname(absPath).toLowerCase().slice(1);
  const mime = ext === 'jpg' ? 'jpeg' : ext;
  const b64 = fs.readFileSync(absPath).toString('base64');
  return { type: 'image_url', image_url: { url: `data:image/${mime};base64,${b64}` } };
}

class FatalError extends Error {}

export function isFatal(e) {
  return e instanceof FatalError;
}

/** 报错并终止:置退出码 + 抛 FatalError,由脚本顶层 catch 兜底。
 *  不调用 process.exit —— Windows 上硬杀会撞上 undici 未关闭的 socket,触发
 *  libuv 断言崩溃("UV_HANDLE_CLOSING");自然退出让事件循环走完清理流程。 */
export function fail(msg) {
  console.error('✗ ' + msg);
  process.exitCode = 1;
  throw new FatalError(msg);
}
