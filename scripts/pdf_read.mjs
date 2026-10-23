#!/usr/bin/env node
// pdf_read.mjs — PDF 自动处理:提取文字(主模型直接读)+ 含图页转 PNG 喂 Qwen 视觉外挂
// 用法:
//   node pdf_read.mjs <pdf>                        → 提取全文文字 + 自动看图页
//   node pdf_read.mjs <pdf> --no-images            → 只提取文字(零 API 成本,批量任务的正确起手式)
//   node pdf_read.mjs <pdf> --ocr                  → 逐字提取含图页/扫描页上的**全部文字**(含图内文字)
//   node pdf_read.mjs <pdf> --pages 1-3            → 只处理 1-3 页的图(文字仍全量提取)
//   node pdf_read.mjs <pdf> "检查重点"              → 图页按此问题询问 Qwen
//   node pdf_read.mjs <pdf> --max-img-pages 4      → 最多自动处理 4 个含图页(默认 4,上限 8)
// 输出: <pdf同名>.txt(文字,主模型直接读)+ 每个含图页的视觉描述(stdout)
//
// ── 两条路,成本差三个数量级,别混用 ──
//   正文/批量文本  → 本地文本层(pdftotext / pdfplumber):零 API 成本,快,能覆盖全文
//   图内文字/扫描页 → `--ocr` 或 qwen_vision:按页计费,慢,但能拿到像素里的字
// 默认模式(描述图表)是给"要理解图"用的;**要翻译全文时,正文走文本层、图内文字走 --ocr**,
// 不要整本丢给视觉 —— 那既慢又贵,还会漏掉它没"看"到的正文。
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { callQwen, imageBlock, fail, isFatal } from './qwen_common.mjs';

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) fail('用法: node pdf_read.mjs <pdf> [--pages 1-3] [--no-images] [--ocr] [--max-img-pages N] ["问题"]');
  const pdf = path.resolve(args[0]);
  if (!fs.existsSync(pdf)) fail('文件不存在: ' + pdf);
  if (path.extname(pdf).toLowerCase() !== '.pdf') fail('只支持 .pdf: ' + pdf);

  const pagesIdx = args.indexOf('--pages');
  const pagesSpec = pagesIdx >= 0 ? args[pagesIdx + 1] : '';
  const noImages = args.includes('--no-images');
  const ocr = args.includes('--ocr');
  const maxIdx = args.indexOf('--max-img-pages');
  // 参数校验:原来的 `parseInt(v) || 4` 会把 0/NaN 静默变成默认值,负数则让后面的
  // slice(0, -N) 静默丢掉**最后 N 页**(还打印"超过上限 -3")。宁可报错,不要静默。
  const maxRaw = maxIdx >= 0 ? Number(args[maxIdx + 1]) : 4;
  if (maxIdx >= 0 && (!Number.isInteger(maxRaw) || maxRaw < 1 || maxRaw > 8)) {
    fail(`--max-img-pages 应为 1-8 的整数,收到: "${args[maxIdx + 1] ?? ''}"`);
  }
  const maxImgPages = maxIdx >= 0 ? maxRaw : 4;
  const question = args
    .filter((a, i) => !['--pages', '--no-images', '--ocr', '--max-img-pages'].includes(a)
      && !(pagesIdx >= 0 && i === pagesIdx + 1)
      && !(maxIdx >= 0 && i === maxIdx + 1)
      && i !== 0)
    .join(' ');
  // 防呆:漏写问题时,第二个 PDF 路径会被**静默**当成"问题"发出去(不报错、结果全错)
  if (/\.pdf$/i.test(question.trim()) && fs.existsSync(path.resolve(question.trim()))) {
    fail(`最后一个参数应该是「问题」,但看起来是另一个 PDF: ${question.trim()}\n`
      + '一次只处理一个 PDF;用法: node pdf_read.mjs <pdf> [--pages 1-3] [--no-images] [--ocr] [--max-img-pages N] ["问题"]');
  }
  if (noImages && ocr) fail('--no-images 与 --ocr 互斥:前者只要文本层,后者要逐页读像素');

  const failedPages = [];
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
      // 用 \f(换页符)分隔,与 pdftotext 一致 —— 下面按页统计正文字数依赖这个分隔符。
      // 旧版用 '\n\n' 拼接,分页信息丢失,没法判断"哪一页没有文字层"。
      py(`
import pdfplumber, os
pdf = pdfplumber.open(os.environ['PDFPATH'])
open(os.environ['TXTPATH'], 'w', encoding='utf-8').write(
    '\\f'.join((p.extract_text() or '') for p in pdf.pages))
`);
      textOk = fs.existsSync(txtPath) && fs.statSync(txtPath).size > 50;
    } catch {}
  }

  // 按页统计正文字符数:这是"该走本地文本层还是该走 OCR"的**唯一可靠判据**。
  // 文本层健全的页 → 本地抽取即可,零 API 成本;字符数近 0 的页 → 内容在像素里,必须 OCR。
  //
  // ⚠️ 页数口径的坑:pdftotext 用 \f 分隔,末页之后还有一个 \f,split 会多出一个空元素。
  // 直接按 split 长度数页会凭空多出"最后一页",进而把**不存在的页**报成"疑似扫描页",
  // --ocr 时还会去渲染它(实测:74 页的 PDF 报出"第 75 页无文字层")。
  // 故末尾空段一律丢弃 —— 只有"内容非空却字符极少"才算真的空白页。
  let pageChars = [];
  if (textOk) {
    try {
      const raw = fs.readFileSync(txtPath, 'utf8');
      pageChars = raw.split('\f').map(s => (s.match(/\S/g) || []).length);
      while (pageChars.length && pageChars[pageChars.length - 1] === 0) pageChars.pop();
    } catch {}
  }
  const blankPages = pageChars
    .map((n, i) => ({ page: i + 1, n }))
    .filter(x => x.n < 20)
    .map(x => x.page);
  if (textOk && pageChars.length) {
    const withText = pageChars.filter(n => n >= 20).length;
    console.log(`📄 文字已提取: ${txtPath}(用 Read 读它即可)`);
    console.log(`   正文覆盖率: ${withText}/${pageChars.length} 页有文字层`
      + `(${Math.round(100 * withText / pageChars.length)}%)`
      + (blankPages.length ? `｜无文字层:第 ${blankPages.join(', ')} 页(疑似扫描页,需 OCR)` : ''));
  } else {
    console.log(textOk ? `📄 文字已提取: ${txtPath}(用 Read 读它即可)` : '⚠️ 文字提取失败,该 PDF 可能为扫描件,建议走 Qwen 会话 Read');
  }

  // 路由结论必须打出来:本次任务里"图内英文没进译文"的根因就是这条口径没说清。
  if (noImages) {
    console.log('ℹ️  --no-images:只做本地文本层抽取,零 API 成本。'
      + (blankPages.length
        ? `注意第 ${blankPages.join(', ')} 页没有文字层,那里的内容**不在**这份 txt 里,需要 --ocr 或 qwen_vision。`
        : '全部页面都有文字层,可直接用这份 txt。'));
    return;
  }

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

  // OCR 模式的两条补充:
  //  ① **无文字层的页无条件加入**(不管检测器认不认为它有"图")—— 扫描页往往整页是
  //     一张大位图,检测器可能只看到 p.images 而为空,但它的文字恰恰只在像素里;
  //  ② 顺序调整:无文字层的页优先,再按页码 —— 上限 8 页时,别让"有边框的正文页"
  //     把真正需要 OCR 的扫描页挤出队列。
  if (ocr && blankPages.length) {
    const extra = pageRange
      ? blankPages.filter(p => p >= pageRange.from && p <= pageRange.to)
      : blankPages;
    const set = new Set([...imgPages, ...extra]);
    imgPages = [...set].sort((a, b) => {
      const aBlank = blankPages.includes(a) ? 0 : 1;
      const bBlank = blankPages.includes(b) ? 0 : 1;
      return aBlank - bBlank || a - b;
    });
    if (extra.length) console.log(`🔎 OCR:第 ${extra.join(', ')} 页无文字层,已强制纳入`);
  }

  if (!imgPages.length) {
    console.log('🖼️ 指定范围内未检测到含图页,文字已足够');
    return;
  }
  // 图密集 PDF:脚本只处理前 maxImgPages 页,提醒用户考虑开 Qwen 会话整体读。
  // 比例按**全文**算 —— 用 --pages 过滤后的数量算会被稀释,漏报整篇图密集的 PDF。
  // ⚠️ 检测启发式(images/curves/lines/rects 任一非空)偏保守:正文有边框/分割线的页面
  //    也会被标记为"含图页",学术论文会偏多报 —— 见到"含图页 N 页"时请结合实际判断。
  const ratio = totalPages > 0 ? allImgCount / totalPages : 0;
  if (!ocr && (ratio > 0.5 || allImgCount > 8)) {
    console.log(`⚠️ 图密集 PDF:含图页 ${allImgCount}/${totalPages}(占 ${Math.round(ratio * 100)}%)。逐页视觉描述成本高且无连续性,建议开 Qwen 会话直接 Read 整个 PDF(双开步骤见项目 CLAUDE.md)。本脚本仍处理前 ${maxImgPages} 页:`);
  } else if (ocr && ratio > 0.5) {
    // OCR 模式下这个比例多半是检测器噪声(边框/分割线也算"图"),提示会误导 —— 只报事实,不劝退
    console.log(`ℹ️  检测器报告 ${allImgCount}/${totalPages} 页"含图"(含边框/线条,论文会偏多报)。`
      + `OCR 只按页计费,已按"无文字层优先"排序,只处理前 ${maxImgPages} 页。`);
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
        // OCR 模式提到 200 DPI:150 DPI 下坐标轴标签、图例、脚注这类小字会糊,
        // 而"图内文字没读出来"正是本次要修的那类漏。
        const dpi = ocr ? 200 : 150;
        py(`
import pypdfium2 as pdfium
import os
page = pdfium.PdfDocument(os.environ['PDFPATH'])[${p} - 1]
page.render(scale=${(dpi / 72).toFixed(3)}).to_pil().save(os.environ['PNGPATH'])
`, { PNGPATH: png });
      } catch (e) {
        console.log(`⚠️ 第 ${p} 页转 PNG 失败: ${e.message.slice(0, 120)}(如缺库: pip install pypdfium2)`);
        continue;
      }
      const q = question || (ocr
        ? `这是 PDF 第 ${p} 页。**逐字提取本页所有可见文字**:正文、标题、图内的标签与图例、坐标轴刻度、表格单元格、脚注、代码块、公式旁的文字。
- 保持原文语言,不要翻译、不要总结、不要改写。
- 按版面顺序输出;表格用 Markdown 表格;公式用 LaTeX。
- 只输出页面上真实存在的文字;看不清的地方写 [无法辨认],不要猜测补全。`
        : `这是 PDF 第 ${p} 页。详细描述这一页的全部图和表格:结构、坐标轴含义、数值、趋势、异常点、公式。信息尽量完整准确,供后续推理使用。`);
      try {
        const ans = await callQwen([{ role: 'user', content: [imageBlock(png), { type: 'text', text: q }] }]);
        console.log(`\n===== 第 ${p} 页(${ocr ? 'OCR' : '图'})=====\n${ans}`);
      } catch (e) {
        // 视觉失败**不能静默**:这一页的文字就是没拿到,下游若当成"该页无内容"就会漏。
        console.log(`⚠️ 第 ${p} 页视觉读取失败: ${e.message.slice(0, 150)}`);
        failedPages.push(p);
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  if (failedPages.length) {
    console.log(`\n⚠️ 有 ${failedPages.length} 页视觉读取失败(第 ${failedPages.join(', ')} 页),这些页的内容**未提取**。`);
    process.exitCode = 1;
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
