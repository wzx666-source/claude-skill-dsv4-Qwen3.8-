#!/usr/bin/env node
// self_test.mjs — qwen-dual-model 全链路自检(赛前必跑,全部 ✅ 再开始)
// 运行: node self_test.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  callQwen, loadKey, imageBlock, CC_SWITCH_DB,
  activeProviderName, peerProviderName, reviewerMeta, pickModel, PROVIDERS,
} from './qwen_common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

/** 在指定驱动方下取值(临时改环境变量,取完还原) */
function withDriver(name, fn) {
  const prev = process.env.DRIVER_PROVIDER;
  process.env.DRIVER_PROVIDER = name;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.DRIVER_PROVIDER;
    else process.env.DRIVER_PROVIDER = prev;
  }
}

// 1. Node 版本(node:sqlite 需要 ≥22.5)
check('Node 版本 ≥ 22.5', parseInt(process.versions.node) >= 22.5, 'v' + process.versions.node);

// 2. CC Switch 数据库存在
check('CC Switch 数据库存在', fs.existsSync(CC_SWITCH_DB), CC_SWITCH_DB);

// 3. 两个 provider 的 key 都可读
for (const name of Object.keys(PROVIDERS)) {
  try {
    const k = loadKey(name);
    check(`${PROVIDERS[name].label} key 可读`, k.length > 10, `id ${PROVIDERS[name].id.slice(0, 8)}…`);
  } catch (e) {
    check(`${PROVIDERS[name].label} key 可读`, false, e.message);
  }
}

// 4. 驱动方识别(报告当前生效值)
const driver = activeProviderName();
check('驱动方识别', !!PROVIDERS[driver], `当前识别为 ${PROVIDERS[driver].label}`);
console.log(`   ℹ️  未设 DRIVER_PROVIDER 时,按 CC Switch 的当前 provider 判定`);

// 5. 评审角色翻转:两个方向都要对
const f1 = withDriver('deepseek', () => peerProviderName());
check('翻转:DeepSeek 驱动 → Qwen 评审', f1 === 'bailian', `实得 ${PROVIDERS[f1]?.label ?? f1}`);
const f2 = withDriver('bailian', () => peerProviderName());
check('翻转:Qwen 驱动 → DeepSeek 评审', f2 === 'deepseek', `实得 ${PROVIDERS[f2]?.label ?? f2}`);

// 6. 档位选择:DeepSeek 的 pro 是纯文本,含图必须落到 flash
const pText = pickModel('deepseek', false);
const pImg = pickModel('deepseek', true);
check('档位:DeepSeek 纯文本 → pro', pText === 'deepseek-v4-pro', pText);
check('档位:DeepSeek 含图 → flash(有视觉)', pImg === 'deepseek-flash', pImg);
const qImg = pickModel('bailian', true);
check('档位:Qwen 含图 → qwen3.8-max', qImg === 'qwen3.8-max', qImg);

// 7. reviewerMeta 端到端(含图/不含图两种消息)
const metaText = withDriver('deepseek', () => reviewerMeta([{ role: 'user', content: '纯文本' }]));
check('评审元信息(纯文本)', metaText.name === 'bailian' && metaText.model === 'qwen3.8-max',
  `${metaText.label} / ${metaText.model}`);
const imgMsg = [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,x' } }] }];
const metaImg = withDriver('bailian', () => reviewerMeta(imgMsg));
check('评审元信息(Qwen 驱动 + 含图 → DeepSeek flash)',
  metaImg.name === 'deepseek' && metaImg.model === 'deepseek-flash',
  `${metaImg.label} / ${metaImg.model}`);

// 8. 生成测试图片
const testPng = path.join(os.tmpdir(), 'qwen_dual_test.png');
let madePng = false;
try {
  spawnSync('powershell', ['-NoProfile', '-Command',
    `Add-Type -AssemblyName System.Drawing; $b=New-Object System.Drawing.Bitmap 120,120; $g=[System.Drawing.Graphics]::FromImage($b); $g.Clear([System.Drawing.Color]::Red); $b.Save('${testPng.replace(/'/g, "''")}',[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $b.Dispose()`]);
  madePng = fs.existsSync(testPng);
} catch {}
check('生成测试图片', madePng, testPng);

// 9. Qwen 文本调用
try {
  const t = await callQwen([{ role: 'user', content: '只回复两个字母:OK' }]);
  check('Qwen 文本调用', /ok/i.test(t), JSON.stringify(t).slice(0, 60));
} catch (e) {
  check('Qwen 文本调用', false, e.message);
}

// 10. Qwen 视觉调用
if (madePng) {
  try {
    const v = await callQwen([{ role: 'user', content: [
      imageBlock(testPng),
      { type: 'text', text: '这张图是什么颜色?只回答颜色' },
    ] }]);
    check('Qwen 视觉调用', /红|red/i.test(v), JSON.stringify(v).slice(0, 60));
  } catch (e) {
    check('Qwen 视觉调用', false, e.message);
  }
} else {
  check('Qwen 视觉调用', false, '测试图片生成失败,跳过');
}

// 11. hook:DeepSeek 驱动时图片应被拦截并转 Qwen
function runHook(env, toolInput) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'qwen_read_hook.mjs')], {
    input: JSON.stringify({ tool_name: 'Read', tool_input: toolInput }),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  try { return { json: JSON.parse(r.stdout.trim()), raw: r.stdout.trim() }; }
  catch { return { json: null, raw: (r.stdout || r.stderr || '').trim() }; }
}

const hookPlain = runHook({}, { file_path: 'nonexistent.txt' });
check('hook:非图片文件放行', hookPlain.json && !hookPlain.json.hookSpecificOutput, hookPlain.raw.slice(0, 50));

if (madePng) {
  const hBailian = runHook({ DRIVER_PROVIDER: 'bailian' }, { file_path: testPng });
  check('hook:Qwen 驱动时整体让行(不绕回自己)',
    hBailian.json && !hBailian.json.hookSpecificOutput, hBailian.raw.slice(0, 50));

  const hDeepseek = runHook({ DRIVER_PROVIDER: 'deepseek' }, { file_path: testPng });
  const denied = hDeepseek.json?.hookSpecificOutput?.permissionDecision === 'deny';
  check('hook:DeepSeek 驱动时图片转 Qwen 读图', denied,
    denied ? '已拦截并注入视觉结果' : hDeepseek.raw.slice(0, 80));
} else {
  check('hook:Qwen 驱动时整体让行(不绕回自己)', false, '测试图片生成失败,跳过');
  check('hook:DeepSeek 驱动时图片转 Qwen 读图', false, '测试图片生成失败,跳过');
}

// 12. 评审脚本 mode 校验(不耗 token,只验参数处理)
try {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'qwen_review.mjs')], { encoding: 'utf8' });
  check('qwen_review.mjs 可执行(缺参报错正常)', r.status !== 0 && /用法|mode/.test(r.stderr + r.stdout), (r.stderr || r.stdout).slice(0, 60));
} catch (e) {
  check('qwen_review.mjs 可执行', false, e.message);
}

// 13. 评审方 banner 走 stderr、stdout 首行仍是结论(用不存在文件触发错误路径,不耗 token)
try {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'qwen_review.mjs'), 'review', 'no_such_file.md'], { encoding: 'utf8' });
  const leaked = /评审方/.test(r.stdout);
  check('评审方 banner 不污染 stdout', !leaked, leaked ? 'banner 泄漏到 stdout' : '仅走 stderr');
} catch (e) {
  check('评审方 banner 不污染 stdout', false, e.message);
}

// 汇总
const failed = results.filter(r => !r.ok);
console.log(`\n结果: ${results.length - failed.length}/${results.length} 项通过`);
if (failed.length) {
  console.log('失败项:');
  for (const f of failed) console.log('  - ' + f.name);
  process.exitCode = 1;
}
