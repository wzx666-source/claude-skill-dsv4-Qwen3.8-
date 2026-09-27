// qwen_common.mjs — 共享模块:双 provider(key 读取 / 驱动方识别 / 带重试调用 / 错误分类 / 文件读取)
//
// 设计要点:
//   - **视觉固定走百炼**(callQwen):用户选定读图统一由 Qwen 负责,与配图复核口径一致
//   - **评审自动翻转**(callReviewer):评审方 = 非驱动方的那个厂商,独立性来自厂商差异。
//     本会话跑 DeepSeek 时评审走 Qwen;双开 Qwen 会话时评审走 DeepSeek —— 无论哪边当主模型,
//     都不会退化成"自己审自己"
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const CC_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME || '.',
  '.cc-switch'
);
export const CC_SWITCH_DB = path.join(CC_DIR, 'cc-switch.db');

/**
 * provider 注册表;id 与 CC Switch 数据库一致,API key 自动同步,无需硬编码。
 * textModel / visionModel 分开:DeepSeek 的 pro 档是纯文本,视觉要落在有原生视觉的 flash 上。
 */
export const PROVIDERS = {
  bailian: {
    id: 'e303406a-b8e2-477f-b367-88d5aa1bb64b',
    label: 'Qwen(百炼)',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    textModel: 'qwen3.8-max',
    visionModel: 'qwen3.8-max',
    envModel: 'QWEN_MODEL',
    envKey: 'QWEN_API_KEY',
  },
  deepseek: {
    id: '49e1a8fb-5953-40f0-afe5-f1c5fe5b747c',
    label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    textModel: 'deepseek-v4-pro',
    visionModel: 'deepseek-flash',
    envModel: 'DEEPSEEK_MODEL',
    envKey: 'DEEPSEEK_API_KEY',
  },
};

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

/** 选模型:环境变量 > 按是否含图选档 */
export function pickModel(providerName, hasImages = false) {
  const p = PROVIDERS[providerName];
  if (process.env[p.envModel]) return process.env[p.envModel];
  return hasImages ? p.visionModel : p.textModel;
}

export function loadModel(providerName = 'bailian', hasImages = false) {
  return pickModel(providerName, hasImages);
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

/** 评审方元信息,供脚本打印「谁在评审」banner(写 stderr,不污染 stdout 的首行结论) */
export function reviewerMeta(messages = []) {
  const driver = activeProviderName();
  const name = driver === 'bailian' ? 'deepseek' : 'bailian';
  const hasImages = hasImageContent(messages);
  return {
    name,
    label: PROVIDERS[name].label,
    model: pickModel(name, hasImages),
    hasImages,
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
 */
export async function callModel(messages, { provider = 'bailian', model, timeoutMs = 240000, retries = 2 } = {}) {
  if (!PROVIDERS[provider]) throw new Error(`未知 provider: ${provider}`);
  const useModel = model || pickModel(provider, hasImageContent(messages));
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
      if (j.choices && j.choices[0]) return j.choices[0].message.content;
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
 * 含图时自动落到该厂商有视觉的档(DeepSeek→flash / Qwen→qwen3.8-max)。
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
