#!/usr/bin/env node
// chunk_check.mjs — 批量翻译的覆盖检查(只读,不调模型、零成本)
//
// 用法: node chunk_check.mjs <manifest.json> [--min-ratio 0.3] [--json]
//
// 为什么要有这个脚本:只把"记得检查覆盖率"写进文档,最后一定会被跳过 ——
// 166 页翻译任务里图内英文整片没进译文,就是因为没有任何一步会**失败**。
// 这里把四件事变成可执行的闸门:
//   1. manifest 里每块的 out 文件存在
//   2. 每块 status 都是 done
//   3. 术语表哈希与记录一致(不一致 = 有块用了旧术语表)
//   4. 输出字数没有异常偏少(< 原文 × min-ratio = 很可能翻漏)
//
// manifest 格式见 scenarios/translation.md 第 3 步。字段都是可选的 ——
// 缺 src/out 就跳过对应检查并明确说明,而不是当成通过。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const jsonOut = args.includes('--json');
const minRatioIdx = args.indexOf('--min-ratio');
const minRatio = minRatioIdx >= 0 ? Number(args[minRatioIdx + 1]) : 0.3;
if (!Number.isFinite(minRatio) || minRatio <= 0) {
  console.error(`✗ --min-ratio 应为正数,收到: "${args[minRatioIdx + 1] ?? ''}"`);
  process.exit(1);
}
const manifestPath = args.find((a, i) => !a.startsWith('--') && !(minRatioIdx >= 0 && i === minRatioIdx + 1));
if (!manifestPath) {
  console.error('用法: node chunk_check.mjs <manifest.json> [--min-ratio 0.3] [--json]');
  process.exit(1);
}
const abs = path.resolve(manifestPath);
if (!fs.existsSync(abs)) {
  console.error('✗ manifest 不存在: ' + abs);
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(abs, 'utf8'));
} catch (e) {
  console.error('✗ manifest 不是合法 JSON: ' + e.message);
  process.exit(1);
}
const baseDir = path.dirname(abs);
const chunks = Array.isArray(manifest.chunks) ? manifest.chunks : null;
if (!chunks) {
  console.error('✗ manifest 里没有 chunks 数组');
  process.exit(1);
}

const problems = [];
const warnings = [];
const rows = [];

/** 字数口径:去掉空白后的字符数 —— 中英混排下比 bytes 稳 */
function charCount(file) {
  const s = fs.readFileSync(file, 'utf8');
  return (s.match(/\S/g) || []).length;
}

for (const c of chunks) {
  const id = c.id ?? '(无 id)';
  const row = { id, title: c.title ?? '', status: c.status ?? '(缺)', chars: null, ratio: null, problems: [] };
  if (c.status !== 'done') {
    row.problems.push(`状态 ${c.status ?? '缺失'}`);
    problems.push(`块 ${id}:状态为 ${c.status ?? '缺失'}(未完成)`);
  }
  if (c.out) {
    const outAbs = path.resolve(baseDir, c.out);
    if (!fs.existsSync(outAbs)) {
      row.problems.push('输出文件不存在');
      problems.push(`块 ${id}:输出文件不存在 ${c.out}`);
    } else {
      try {
        row.chars = charCount(outAbs);
        if (c.src) {
          const srcAbs = path.resolve(baseDir, c.src);
          if (fs.existsSync(srcAbs)) {
            const srcChars = charCount(srcAbs);
            if (srcChars > 0) {
              row.ratio = row.chars / srcChars;
              // 中译英→中的字数比通常在 0.5~0.8(中文更紧凑);低于 minRatio 基本是翻漏
              if (row.ratio < minRatio) {
                row.problems.push(`疑似漏译(${row.ratio.toFixed(2)}×)`);
                problems.push(`块 ${id}:输出 ${row.chars} 字 / 原文 ${srcChars} 字`
                  + ` = ${row.ratio.toFixed(2)}×,低于 ${minRatio} —— 很可能翻漏了`);
              }
            }
          } else {
            warnings.push(`块 ${id}:src 文件不存在,跳过字数比对(${c.src})`);
          }
        } else {
          warnings.push(`块 ${id}:manifest 没写 src,无法比对字数`);
        }
      } catch (e) {
        row.problems.push('输出不可读');
        problems.push(`块 ${id}:输出文件读不了 —— ${e.message}`);
      }
    }
  } else {
    warnings.push(`块 ${id}:manifest 没写 out,跳过文件检查`);
  }
  rows.push(row);
}

// 术语表哈希:不一致意味着有的块用了旧术语表,术语必然不统一
let glossaryState = 'skipped';
if (manifest.glossary && manifest.glossarySha) {
  const gAbs = path.resolve(baseDir, manifest.glossary);
  if (!fs.existsSync(gAbs)) {
    problems.push(`术语表不存在: ${manifest.glossary}`);
    glossaryState = 'missing';
  } else {
    const sha = createHash('sha1').update(fs.readFileSync(gAbs)).digest('hex').slice(0, 8);
    if (sha !== manifest.glossarySha) {
      problems.push(`术语表已变更(记录 ${manifest.glossarySha} / 现在 ${sha})`
        + ` —— 用旧术语表翻的块需要重跑或统一术语`);
      glossaryState = 'changed';
    } else {
      glossaryState = 'ok';
    }
  }
} else if (manifest.glossary) {
  warnings.push('manifest 有 glossary 但没有 glossarySha,无法校验术语一致性');
}

const ok = problems.length === 0;

if (jsonOut) {
  console.log(JSON.stringify({
    ok, manifest: abs, glossary: glossaryState,
    chunks: rows.map(r => ({ id: r.id, status: r.status, chars: r.chars, ratio: r.ratio, problems: r.problems })),
    problems, warnings,
  }, null, 2));
} else {
  console.log(`📋 覆盖检查: ${path.basename(abs)}`);
  const done = rows.filter(r => r.status === 'done').length;
  console.log(`   块 ${done}/${rows.length} 已完成｜术语表 ${glossaryState === 'ok' ? '✅ 一致'
    : glossaryState === 'changed' ? '❌ 已变更' : glossaryState === 'missing' ? '❌ 缺失' : '— 未校验'}`);
  console.log('');
  for (const r of rows) {
    const mark = r.problems.length ? '❌' : '✅';
    const ratio = r.ratio != null ? `  ${r.ratio.toFixed(2)}×` : '';
    console.log(`${mark} ${String(r.id).padEnd(4)} ${String(r.status).padEnd(9)}${ratio.padEnd(9)} ${r.title}`);
  }
  if (problems.length) {
    console.log('\n问题:');
    for (const p of problems) console.log('  - ' + p);
  }
  if (warnings.length) {
    console.log('\n提示(不算失败):');
    for (const w of warnings) console.log('  - ' + w);
  }
  console.log(ok ? '\n✓ 覆盖检查通过。' : `\n✗ ${problems.length} 个问题 —— 修好再往下走。`);
}

process.exitCode = ok ? 0 : 1;
