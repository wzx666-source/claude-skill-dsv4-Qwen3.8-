#!/usr/bin/env node
// self_test.mjs — qwen-dual-model 全链路自检(赛前必跑,全部 ✅ 再开始)
// 运行: node self_test.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  callQwen, callModel, loadKey, imageBlock, CC_SWITCH_DB,
  activeProviderName, peerProviderName, reviewerMeta, pickModel, PROVIDERS,
  MODEL_ALIAS_PROBE, resolvedTiers,
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

// 6. 档位选择:按 mode 分档(跑分依据见 qwen_common.mjs 的 PROVIDERS 注释)
const expectTiers = [
  ['deepseek', 'review',    'deepseek-v4-pro', '知识/推理档 GPQA 92.4'],
  ['deepseek', 'challenge', 'deepseek-v4-pro', '知识/推理档 HLE 42.7'],
  ['deepseek', 'recompute', 'deepseek-flash',  'agentic 档 Codeforces 3471'],
  ['deepseek', 'latex',     'deepseek-v4-pro', '知识/推理档'],
  ['bailian',  'recompute', 'qwen3.8-max',     'Qwen 单一档,不细分'],
];
for (const [prov, mode, want, why] of expectTiers) {
  const got = pickModel(prov, { mode });
  check(`档位:${PROVIDERS[prov].label} ${mode} → ${want}`, got === want, `${got}(${why})`);
}
const pImgD = pickModel('deepseek', { hasImages: true, mode: 'review' });
check('档位:DeepSeek 含图 → flash(仅它有原生视觉)', pImgD === 'deepseek-flash', pImgD);
const qImg = pickModel('bailian', { hasImages: true });
check('档位:Qwen 含图 → qwen3.8-max', qImg === 'qwen3.8-max', qImg);
const pNoMode = pickModel('deepseek', {});
check('档位:不传 mode → 回落 textModel', pNoMode === 'deepseek-v4-pro', pNoMode);

// 7. reviewerMeta 端到端(含图/不含图两种消息)
const msgText = [{ role: 'user', content: '纯文本' }];
const metaText = withDriver('deepseek', () => reviewerMeta(msgText, { mode: 'review' }));
check('评审元信息(DeepSeek 驱动 + review → Qwen)', metaText.name === 'bailian' && metaText.model === 'qwen3.8-max',
  `${metaText.label} / ${metaText.model}`);
const metaRe = withDriver('bailian', () => reviewerMeta(msgText, { mode: 'recompute' }));
check('评审元信息(Qwen 驱动 + recompute → DeepSeek flash 档)',
  metaRe.name === 'deepseek' && metaRe.model === 'deepseek-flash',
  `${metaRe.label} / ${metaRe.model}`);
check('存疑提示:字段存在且为字符串(实测未别名时默认静默)',
  typeof withDriver('bailian', () => reviewerMeta(msgText, { mode: 'review' }).caveat) === 'string');
const imgMsg = [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,x' } }] }];
const metaImg = withDriver('bailian', () => reviewerMeta(imgMsg, { mode: 'review' }));
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

// 14. 溯源探针:读响应体回显的 model id,实测 DeepSeek 是否把 v4-pro 重定向到 Flash。
//     2026-09-14 起有厂商口径称 V4-Pro 请求已由 V4.1-Flash 承接(直到 V4.1-Pro 发布);
//     本机访问不了 DeepSeek 官方文档页,所以不采信新闻、只认你自己账号的实测回显。
//     影响:若两档回显相同,modeModels 里 Pro/Flash 的分档当前是空操作。
try {
  const probe = async (model) => {
    const r = await callModel(
      [{ role: 'user', content: '只回复两个字母:OK' }],
      { provider: 'deepseek', model, returnMeta: true });
    return r.model;
  };
  const servedPro = await probe('deepseek-v4-pro');
  const servedFlash = await probe('deepseek-flash');
  check('溯源探针:两档都能取到服务端回显的 model id', !!servedPro && !!servedFlash,
    `v4-pro→${servedPro} / flash→${servedFlash}`);
  const liveVerdict = servedPro === servedFlash ? 'aliased' : 'distinct';
  // 本次实测 vs 代码里记录的结论:不一致说明"实测已变但常量没更新",per-run 提示会失真
  check('溯源探针:实测结果与 MODEL_ALIAS_PROBE 记录一致',
    liveVerdict === MODEL_ALIAS_PROBE.verdict,
    `实测 ${liveVerdict} / 记录 ${MODEL_ALIAS_PROBE.verdict}(记录于 ${MODEL_ALIAS_PROBE.checkedAt})`);
  if (liveVerdict === 'aliased') {
    console.log(`   ⚠️  实测:v4-pro 与 flash 都由 "${servedPro}" 服务 → 重定向属实,`);
    console.log('      分档当前是空操作。把 qwen_common.mjs 的 MODEL_ALIAS_PROBE.verdict 改为 \'aliased\' 以恢复提示。');
  } else {
    console.log(`   ℹ️  实测:v4-pro 与 flash 回显不同 → 分档生效,Pro 的知识优势当前可得。`);
    console.log('      局限:读的是服务端回报值,不是地面真值;网关静默别名会被骗过。');
  }
} catch (e) {
  check('溯源探针', false, `${e.message}(deepseek key 或模型名不可用?)`);
}

// 15. 模型迭代通道:roster 自身的完整性
const ROSTER_FILE = path.join(__dirname, '..', 'model_roster.json');
const TODAY = new Date().toISOString().slice(0, 10);
let roster = null;
try {
  roster = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf8'));
  check('roster:JSON 合法且 schema 受支持', roster.schema === 1, `schema ${roster.schema}`);
} catch (e) {
  check('roster:JSON 合法且 schema 受支持', false, e.message);
}
if (roster) {
  // 视觉档必须在 roster 里真的声明了 vision
  const vBad = [];
  for (const [prov, p] of Object.entries(PROVIDERS)) {
    const m = roster.providers?.[prov]?.models?.[p.visionModel];
    if (!m) vBad.push(`${prov}:${p.visionModel} 不在 roster`);
    else if (!m.vision) vBad.push(`${prov}:${p.visionModel} 未标 vision:true`);
  }
  check('roster:各 provider 的 visionModel 都声明了 vision', vBad.length === 0, vBad.join('; ') || 'ok');

  // 生效档位必须都在 roster 里 —— 抓"模型下线了但配置还指着它"
  const eff = resolvedTiers();
  const missing = [];
  for (const [prov, modes] of Object.entries(eff.providers)) {
    const known = new Set(Object.keys(roster.providers?.[prov]?.models ?? {}));
    for (const [mode, id] of Object.entries(modes.modeModels)) {
      if (id && !known.has(id)) missing.push(`${prov}/${mode}→${id}`);
    }
  }
  check('roster:生效档位都在 roster 中', missing.length === 0,
    missing.join('、') || `档位来源 ${eff.source}`);

  if (roster.recheckBy && TODAY > roster.recheckBy) {
    console.log(`   ⚠️  roster 复核期限已过(${roster.recheckBy})→ 跑 model_audit.mjs 并按 MODEL_UPGRADE.md 重查跑分`);
  }
  if (roster.freezeUntil && TODAY <= roster.freezeUntil) {
    console.log(`   ℹ️  档位冻结中(至 ${roster.freezeUntil}):--apply 会被拒绝,漂移不判失败`);
  }
}

// 16. 迭代通道体检:roster / 生成物 / 文档三者一致
//     直接复用 model_audit 的判定并按退出码取结论,不在这里重复实现推导逻辑
try {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'model_audit.mjs')], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const ok = r.status === 0;
  const detail = ok ? '无漂移'
    : out.split('\n').map(l => l.trim()).filter(l => l.startsWith('- ') || l.startsWith('**')).slice(0, 3).join(' | ');
  check('迭代通道:roster/生成物/文档 一致', ok, detail);
} catch (e) {
  check('迭代通道:roster/生成物/文档 一致', false, e.message);
}

// 汇总
const failed = results.filter(r => !r.ok);
console.log(`\n结果: ${results.length - failed.length}/${results.length} 项通过`);
if (failed.length) {
  console.log('失败项:');
  for (const f of failed) console.log('  - ' + f.name);
  process.exitCode = 1;
}
