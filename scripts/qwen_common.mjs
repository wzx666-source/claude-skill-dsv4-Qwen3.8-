// qwen_common.mjs — 共享模块:API key 读取、带重试的调用、错误分类、文件读取
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const CC_SWITCH_DB = path.join(
  process.env.USERPROFILE || process.env.HOME || '.',
  '.cc-switch', 'cc-switch.db'
);
export const BAILIAN_PROVIDER_ID = 'e303406a-b8e2-477f-b367-88d5aa1bb64b';
export const ENDPOINT = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
export const DEFAULT_MODEL = 'qwen3.8-max';
export const MAX_IMAGES = 6;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT_BYTES = 200 * 1024;
export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tiff']);

/** 读取百炼 API key:环境变量优先,否则自动从 CC Switch 数据库读(与 CC Switch 同步,无需重复维护) */
export function loadKey() {
  if (process.env.QWEN_API_KEY) return process.env.QWEN_API_KEY;
  if (!fs.existsSync(CC_SWITCH_DB)) {
    throw new Error(`找不到 CC Switch 数据库: ${CC_SWITCH_DB}`);
  }
  const db = new DatabaseSync(CC_SWITCH_DB, { readOnly: true });
  const row = db.prepare('SELECT settings_config FROM providers WHERE id = ?').get(BAILIAN_PROVIDER_ID);
  if (!row) throw new Error('CC Switch 中没有百炼(Bailian) provider');
  const key = JSON.parse(row.settings_config)?.env?.ANTHROPIC_AUTH_TOKEN;
  if (!key) throw new Error('百炼 provider 未配置 API key,请到 CC Switch 检查');
  return key;
}

export function loadModel() {
  return process.env.QWEN_MODEL || DEFAULT_MODEL;
}

/** 把 API 错误翻译成可行动的提示 */
export function classifyError(status, payload) {
  if (status === 401 || status === 403) return 'API key 无效或过期 → 到 CC Switch 检查百炼(Bailian)的 key';
  if (status === 429) return '百炼限流(429) → 稍后重试';
  const msg = JSON.stringify(payload?.error || payload || '').toLowerCase();
  if (msg.includes('model')) return `模型不可用 → 检查模型名(当前 ${loadModel()}),确认百炼账号已开通该模型`;
  if (status >= 500) return `百炼服务端错误(${status}) → 稍后重试`;
  return `未知错误(${status}): ${String(msg).slice(0, 200)}`;
}

/** 调 Qwen:失败自动重试(限流/5xx/网络),仍失败则抛出带修复提示的错误。
 *  超时 240s:百炼视觉接口延迟方差大(实测 10s~70s+),120s 会误杀慢调用 */
export async function callQwen(messages, { model = loadModel(), timeoutMs = 240000, retries = 2 } = {}) {
  const key = loadKey();
  let lastErr = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    // 用 AbortController 而非 AbortSignal.timeout:确保失败退出时定时器已清理
    // (Windows 上 pending 的 timeout handle 会在 process.exit 时触发 libuv 断言崩溃)
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages }),
      });
      const j = await res.json().catch(() => ({}));
      if (j.choices && j.choices[0]) return j.choices[0].message.content;
      lastErr = classifyError(res.status, j);
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
  throw new Error(`Qwen 调用失败(已重试 ${retries} 次): ${lastErr}`);
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
