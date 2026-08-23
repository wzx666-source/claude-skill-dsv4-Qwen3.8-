#!/usr/bin/env node
// self_test.mjs — qwen-dual-model 全链路自检(赛前必跑,全部 ✅ 再开始)
// 运行: node self_test.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callQwen, loadKey, imageBlock, CC_SWITCH_DB } from './qwen_common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

// 1. Node 版本(node:sqlite 需要 ≥22.5)
check('Node 版本 ≥ 22.5', parseInt(process.versions.node) >= 22.5, 'v' + process.versions.node);

// 2. CC Switch 数据库与百炼 key
try {
  const k = loadKey();
  check('CC Switch 百炼 key 可读', k.length > 10, `数据库 ${CC_SWITCH_DB}`);
} catch (e) {
  check('CC Switch 百炼 key 可读', false, e.message);
}

// 3. 生成测试图片
const testPng = path.join(os.tmpdir(), 'qwen_dual_test.png');
let madePng = false;
try {
  const gen = spawnSync('powershell', ['-NoProfile', '-Command',
    `Add-Type -AssemblyName System.Drawing; $b=New-Object System.Drawing.Bitmap 120,120; $g=[System.Drawing.Graphics]::FromImage($b); $g.Clear([System.Drawing.Color]::Red); $b.Save('${testPng.replace(/'/g, "''")}',[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $b.Dispose()`]);
  madePng = fs.existsSync(testPng);
} catch {}
check('生成测试图片', madePng, testPng);

// 4. Qwen 文本调用
try {
  const t = await callQwen([{ role: 'user', content: '只回复两个字母:OK' }]);
  check('Qwen 文本调用', /ok/i.test(t), JSON.stringify(t).slice(0, 60));
} catch (e) {
  check('Qwen 文本调用', false, e.message);
}

// 5. Qwen 视觉调用
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

// 6. hook 脚本输出合法 JSON(模拟 Read 工具输入)
try {
  const hook = spawnSync(process.execPath, [path.join(__dirname, 'qwen_read_hook.mjs')], {
    input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'nonexistent.txt' } }),
    encoding: 'utf8',
  });
  let ok = false;
  try { JSON.parse(hook.stdout.trim()); ok = true; } catch {}
  check('hook 脚本 JSON 输出合法', ok, hook.stdout.trim().slice(0, 50));
} catch (e) {
  check('hook 脚本 JSON 输出合法', false, e.message);
}

// 7. 评审脚本 mode 校验(不耗 token,只验参数处理)
try {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'qwen_review.mjs')], { encoding: 'utf8' });
  check('qwen_review.mjs 可执行(缺参报错正常)', r.status !== 0 && /用法|mode/.test(r.stderr + r.stdout), (r.stderr || r.stdout).slice(0, 60));
} catch (e) {
  check('qwen_review.mjs 可执行', false, e.message);
}

// 汇总
const failed = results.filter(r => !r.ok);
console.log(`\n结果: ${results.length - failed.length}/${results.length} 项通过`);
if (failed.length) {
  console.log('失败项:');
  for (const f of failed) console.log('  - ' + f.name);
  process.exitCode = 1;
}
