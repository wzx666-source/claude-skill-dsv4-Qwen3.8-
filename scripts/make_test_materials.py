#!/usr/bin/env python
# make_test_materials.py — 生成 qwen-dual-model 全部测试素材到 ~/qwen-dual-model-test/
# 用法: python make_test_materials.py
import os
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

OUT = os.path.expanduser('~/qwen-dual-model-test')
os.makedirs(OUT, exist_ok=True)

# T1 纯色图(视觉基础)—— 用 savefig facecolor 保证背景一定上色
fig, ax = plt.subplots(figsize=(2, 2))
ax.set_facecolor('blue'); ax.axis('off')
fig.savefig(f'{OUT}/solid_blue.png', facecolor='blue', bbox_inches='tight'); plt.close(fig)

# T3 带离群点的折线图(第 16 个点人为抬高,x≈5 处)
x = np.linspace(0, 10, 30); y = np.sin(x); y[15] += 5
fig, ax = plt.subplots()
ax.plot(x, y, 'b-o', label='signal')
ax.set_xlabel('time (s)'); ax.set_ylabel('amplitude'); ax.legend()
fig.savefig(f'{OUT}/anomaly_plot.png'); plt.close(fig)

# T2 多图对比:线性 vs 二次
fig, ax = plt.subplots(); ax.plot([0, 1, 2], [0, 1, 2], 'r-o'); ax.set_title('A')
fig.savefig(f'{OUT}/two_a.png'); plt.close(fig)
fig, ax = plt.subplots(); ax.plot([0, 1, 2], [0, 1, 4], 'g-s'); ax.set_title('B')
fig.savefig(f'{OUT}/two_b.png'); plt.close(fig)

# T4 公式图(视觉转 LaTeX)
fig, ax = plt.subplots(figsize=(6, 1.6))
ax.text(0.5, 0.5, r'$y = \frac{a}{b} + \sum_{i=1}^n x_i^2$', fontsize=26, ha='center', va='center')
ax.axis('off')
fig.savefig(f'{OUT}/formula.png', bbox_inches='tight'); plt.close(fig)

# T7/T8 文字页 + 矢量折线图页
from matplotlib.backends.backend_pdf import PdfPages
with PdfPages(f'{OUT}/doc_with_figure.pdf') as pdf:
    fig = plt.figure()
    fig.text(0.1, 0.5, 'Test problem: fit y = ax + b to the data below, find a and b.', fontsize=12)
    pdf.savefig(fig); plt.close(fig)
    fig, ax = plt.subplots()
    ax.plot([0, 1, 2, 3], [1, 3, 5, 7], 'r-o')
    ax.set_xlabel('x'); ax.set_ylabel('y'); ax.set_title('data fit')
    pdf.savefig(fig); plt.close(fig)

# T9 模拟扫描件:整页是一张位图,无文字层
fig, ax = plt.subplots()
img = plt.imread(f'{OUT}/anomaly_plot.png')
ax.imshow(img); ax.axis('off')
with PdfPages(f'{OUT}/scanned_sim.pdf') as pdf:
    pdf.savefig(fig)
plt.close(fig)

# T15/T16 有硬伤的推导(最大值错判)
with open(f'{OUT}/flawed_derivation.md', 'w', encoding='utf-8') as f:
    f.write('''推导:设 f(x)=x^2,求 f(x) 在 [0,2] 上的最大值。
解:对 f 求导得 f'(x)=2x,令 2x=0 得 x=0,因此最大值在 x=0 处取得,最大值为 f(0)=0。
结论:函数在 [0,2] 上最大值为 0。
''')

# T17 recompute:数据 + 公式 + 故意错误的结果
import csv
with open(f'{OUT}/data.csv', 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['x', 'y'])
    for i in range(1, 6):
        w.writerow([i, 2 * i])
with open(f'{OUT}/wrong_result.md', 'w', encoding='utf-8') as f:
    f.write('''模型: y = 2x(由最小二乘拟合 data.csv 得到)
待验证结果:拟合残差平方和 RSS = 100,平均绝对误差 MAE = 8。
''')

# T18 含多处错误的 LaTeX
with open(f'{OUT}/broken_latex.tex', 'w', encoding='utf-8') as f:
    f.write(r'''\documentclass{article}
\usepackage{amsmath}
\begin{document}
\begin{equation}
E = mc^2 + \frac{1}{2
\end{equation}
定义符号:$\gama$(拼写错误,应为 \gamma)
\begin{align}
a &= b \\
c &= d
\end{align
\end{document}
''')

# T31a 大图片(>8MB,纯噪声 PNG 压缩率低)
plt.imsave(f'{OUT}/big_image.png', np.random.rand(2000, 2000))

# T31b 大文本(>200KB)
with open(f'{OUT}/big_text.md', 'w', encoding='utf-8') as f:
    f.write(('这是用于截断测试的重复文本内容。' * 100 + '\n') * 600)

print('素材已生成到', OUT)
for fn in sorted(os.listdir(OUT)):
    size = os.path.getsize(os.path.join(OUT, fn))
    print(f'  {fn}  {size:,} bytes')
