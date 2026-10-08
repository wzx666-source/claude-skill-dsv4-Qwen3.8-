#!/usr/bin/env node
// pdf_read.mjs — PDF 自动处理:提取文字(主模型直接读)+ 含图页转 PNG 喂 Qwen 视觉外挂
// 用法:
//   node pdf_read.mjs <pdf>                        → 提取全文文字 + 自动看图页
//   node pdf_read.mjs <pdf> --pages 1-3            → 只处理 1-3 页的图(文字仍全量提取)
//   node pdf_read.mjs <pdf> "检查重点"              → 图页按此问题询问 Qwen
//   node pdf_read.mjs <pdf> --no-images            → 只提取文字
//   node pdf_read.mjs <pdf> --max-img-pages 4      → 最多自动处理 4 个含图页(默认 4,上限 8)
// 输出: <pdf同名>.txt(文字,主模型直接读)+ 每个含图页的视觉描述(stdout)
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { callQwen, imageBlock, fail, isFatal } from './qwen_common.mjs';

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) fail('用法: node pdf_read.mjs <pdf> [--pages 1-3] [--no-images] [--max-img-pages N] ["问题"]');
  const pdf = path.resolve(args[0]);
  if (!fs.existsSync(pdf)) fail('文件不存在: ' + pdf);
  if (path.extname(pdf).toLowerCase() !== '.pdf') fail('只支持 .pdf: ' + pdf);

  const pagesIdx = args.indexOf('--pages');
  const pagesSpec = pagesIdx >= 0 ? args[pagesIdx + 1] : '';
  const noImages = args.includes('--no-images');
  const maxIdx = args.indexOf('--max-img-pages');
  // 参数校验:原来的 `parseInt(v) || 4` 会把 0/NaN 静默变成默认值,负数则让后面的
  // slice(0, -N) 静默丢掉**最后 N 页**(还打印"超过上限 -3")。宁可报错,不要静默。
  const maxRaw = maxIdx >= 0 ? Number(args[maxIdx + 1]) : 4;
  if (maxIdx >= 0 && (!Number.isInteger(maxRaw) || maxRaw < 1 || maxRaw > 8)) {
    fail(`--max-img-pages 应为 1-8 的整数,收到: "${args[maxIdx + 1] ?? ''}"`);
  }
  const maxImgPages = maxIdx >= 0 ? maxRaw : 4;
  const question = args
    .filter((a, i) => !['--pages', '--no-images', '--max-img-pages'].includes(a)
      && !(pagesIdx >= 0 && i === pagesIdx + 1)
      && !(maxIdx >= 0 && i === maxIdx + 1)
      && i !== 0)
    .join(' ');
  // 防呆:漏写问题时,第二个 PDF 路径会被**静默**当成"问题"发出去(不报错、结果全错)
  if (/\.pdf$/i.test(question.trim()) && fs.existsSync(path.resolve(question.trim()))) {
    fail(`最后一个参数应该是「问题」,但看起来是另一个 PDF: ${question.trim()}\n`
      + '一次只处理一个 PDF;用法: node pdf_read.mjs <pdf> [--pages 1-3] [--no-images] [--max-img-pages N] ["问题"]');
  }

  const base = pdf.replace(/\.pdf$/i, '');
  const txtPath = base + '.txt';

  /** 跑 python,PDF 路径经环境变量传递,避免转义问题 */
  function py(code, extraEnv = {}) {
    const r = spawnSync('python', ['-c', code], {
      encoding: 'utf8',
      timeout: 180000,
      env: { ...process.env, PDFPATH: pdf, TXTPATH: txtPath, ...extraEnv },
    });
    if (r.error) throw new Error('python 不可用: ' + r.error.message);
    if (r.status !== 0) throw new Error((r.stderr || '').slice(0, 300) || 'python 执行失败');
    return r.stdout;
  }

  /** 解析 --pages 1-3 / 3 */
  function parsePages(spec) {
    if (!spec) return null;
    const m = spec.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) fail(`--pages 格式错误: "${spec}",应为 1-3 或单页 3`);
    const a = parseInt(m[1]), b = m[2] ? parseInt(m[2]) : a;
    if (b < a) fail(`--pages 范围无效: ${spec}`);
    return { from: a, to: b };
  }
  const pageRange = parsePages(pagesSpec);

  // 1) 提取文字(pdftotext 优先,pdfplumber 兜底)
  let textOk = false;
  try {
    const r = spawnSync('pdftotext', ['-layout', pdf, txtPath], { encoding: 'utf8', timeout: 60000 });
    textOk = r.status === 0 && fs.existsSync(txtPath) && fs.statSync(txtPath).size > 50;
  } catch {}
  if (!textOk) {
    try {
      py(`
import pdfplumber, os
pdf = pdfplumber.open(os.environ['PDFPATH'])
open(os.environ['TXTPATH'], 'w', encoding='utf-8').write(
    '\\n\\n'.join((p.extract_text() or '') for p in pdf.pages))
`);
      textOk = fs.existsSync(txtPath) && fs.statSync(txtPath).size > 50;
    } catch {}
  }
  console.log(textOk ? `📄 文字已提取: ${txtPath}(用 Read 读它即可)` : '⚠️ 文字提取失败,该 PDF 可能为扫描件,建议走 Qwen 会话 Read');

  if (noImages) return;

  // 2) 含图页检测(注意:题目/论文 PDF 的图多为矢量,不能只看 p.images)
  let imgPages = [];
  let totalPages = 0;
  try {
    const out = py(`
import pdfplumber, os, json
pdf = pdfplumber.open(os.environ['PDFPATH'])
def has_drawing(p):
    return bool(p.images or p.curves or p.lines or p.rects)
print(json.dumps({'total': len(pdf.pages), 'pages': [i + 1 for i, p in enumerate(pdf.pages) if has_drawing(p)]}))
`);
    const info = JSON.parse(out.trim() || '{}');
    totalPages = info.total || 0;
    imgPages = info.pages || [];
  } catch (e) {
    console.log('⚠️ 含图页检测失败: ' + e.message.slice(0, 150));
    return;
  }
  const allImgCount = imgPages.length;   // 过滤前(全文)的含图页数,供"图密集"判断
  if (pageRange) imgPages = imgPages.filter(p => p >= pageRange.from && p <= pageRange.to);
  if (!imgPages.length) {
    console.log('🖼️ 指定范围内未检测到含图页,文字已足够');
    return;
  }
  // 图密集 PDF:脚本只处理前 maxImgPages 页,提醒用户考虑开 Qwen 会话整体读。
  // 比例按**全文**算 —— 用 --pages 过滤后的数量算会被稀释,漏报整篇图密集的 PDF。
  const ratio = totalPages > 0 ? allImgCount / totalPages : 0;
  if (ratio > 0.5 || allImgCount > 8) {
    console.log(`⚠️ 图密集 PDF:含图页 ${allImgCount}/${totalPages}(占 ${Math.round(ratio * 100)}%)。逐页视觉描述成本高且无连续性,建议开 Qwen 会话直接 Read 整个 PDF(双开步骤见项目 CLAUDE.md)。本脚本仍处理前 ${maxImgPages} 页:`);
  }
  if (imgPages.length > maxImgPages) {
    console.log(`🖼️ 共 ${imgPages.length} 个含图页(第 ${imgPages.join(', ')} 页),超过上限 ${maxImgPages},仅处理前 ${maxImgPages} 页;其余可用 --pages 单独指定`);
    imgPages = imgPages.slice(0, maxImgPages);
  }
  console.log(`🖼️ 处理含图页: ${imgPages.join(', ')}`);

  // 3) 逐页转 PNG → 视觉外挂
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfimg-'));
  try {
    for (const p of imgPages) {
      const png = path.join(tmpDir, `page${p}.png`);
      try {
        py(`
import pypdfium2 as pdfium
import os
page = pdfium.PdfDocument(os.environ['PDFPATH'])[${p} - 1]
page.render(scale=${(150 / 72).toFixed(3)}).to_pil().save(os.environ['PNGPATH'])
`, { PNGPATH: png });
      } catch (e) {
        console.log(`⚠️ 第 ${p} 页转 PNG 失败: ${e.message.slice(0, 120)}(如缺库: pip install pypdfium2)`);
        continue;
      }
      const q = question
        || `这是 PDF 第 ${p} 页。详细描述这一页的全部图和表格:结构、坐标轴含义、数值、趋势、异常点、公式。信息尽量完整准确,供后续推理使用。`;
      try {
        const ans = await callQwen([{ role: 'user', content: [imageBlock(png), { type: 'text', text: q }] }]);
        console.log(`\n===== 第 ${p} 页(图)=====\n${ans}`);
      } catch (e) {
        console.log(`⚠️ 第 ${p} 页视觉读取失败: ${e.message.slice(0, 150)}`);
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (e) {
  if (!isFatal(e)) {
    console.error(e);
    process.exitCode = 1;
  }
}
