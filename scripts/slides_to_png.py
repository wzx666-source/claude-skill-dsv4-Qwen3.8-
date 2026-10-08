#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""slides_to_png.py — pptx → 每页一张 PNG(喂给 qwen_vision 逐张检查排版)

用法:
    python slides_to_png.py <pptx路径> [输出目录] [--scale 2.0]

为什么不用 office-skills 文档里的 thumbnail.py / soffice / pdftoppm:
    本机没装 LibreOffice 与 poppler(soffice / pdftoppm 都不在 PATH),
    而且 thumbnail.py 产出的是**拼图**不是单页 —— 喂给视觉模型逐张检查不对路。
本脚本走另一条已实测的链路:
    PowerPoint COM(pywin32)→ PDF → pypdfium2 渲染每页 PNG(不需要 poppler)。

产出: <输出目录>/slide-1.png, slide-2.png …
      输出目录默认 <pptx 同目录>/png/
"""
import argparse
import os
import sys

try:  # 让中文/emoji 在 Git Bash 下正常输出(否则按控制台代码页编码会乱码)
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass


def pptx_to_pdf(pptx_path, pdf_path):
    """用 PowerPoint COM 另存为 PDF(替代 soffice)。"""
    try:
        import win32com.client  # pywin32
    except ImportError:
        sys.exit('缺少 pywin32 → 先 pip install pywin32;或改用装了 LibreOffice 的机器')
    app = win32com.client.Dispatch('PowerPoint.Application')
    pres = None
    try:
        pres = app.Presentations.Open(os.path.abspath(pptx_path), WithWindow=False)
        pres.SaveAs(os.path.abspath(pdf_path), 32)  # 32 = ppSaveAsPDF
    finally:
        if pres is not None:
            pres.Close()
        app.Quit()


def pdf_to_pngs(pdf_path, out_dir, scale=2.0, prefix='slide'):
    """pypdfium2 逐页渲染(不需要 poppler)。"""
    try:
        import pypdfium2 as pdfium
    except ImportError:
        sys.exit('缺少 pypdfium2 → 先 pip install pypdfium2')
    pdf = pdfium.PdfDocument(pdf_path)
    paths = []
    for i, page in enumerate(pdf):
        p = os.path.join(out_dir, '%s-%d.png' % (prefix, i + 1))
        page.render(scale=scale).to_pil().save(p)
        paths.append(p)
    return paths


def main():
    ap = argparse.ArgumentParser(description='pptx → 每页 PNG')
    ap.add_argument('pptx', help='pptx 文件路径')
    ap.add_argument('outdir', nargs='?', help='输出目录(默认 <pptx同目录>/png)')
    ap.add_argument('--scale', type=float, default=2.0, help='渲染倍率,默认 2.0')
    a = ap.parse_args()

    if not os.path.isfile(a.pptx):
        sys.exit('找不到文件: %s' % a.pptx)

    out = a.outdir or os.path.join(os.path.dirname(os.path.abspath(a.pptx)), 'png')
    os.makedirs(out, exist_ok=True)
    pdf = os.path.splitext(os.path.abspath(a.pptx))[0] + '.pdf'

    print('→ PowerPoint COM 导出 PDF: %s' % pdf)
    pptx_to_pdf(a.pptx, pdf)
    print('→ pypdfium2 渲染每页 PNG(scale=%s)' % a.scale)
    paths = pdf_to_pngs(pdf, out, a.scale)
    print('✅ 完成 %d 页 → %s' % (len(paths), out))
    for p in paths:
        print('   ' + p)


if __name__ == '__main__':
    main()
