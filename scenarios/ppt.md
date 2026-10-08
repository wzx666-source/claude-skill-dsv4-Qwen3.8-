# 剧本:PPT(课程作业汇报 / 答辩)

> **先说清楚:本剧本不做 PPT 本体。** 它只管三件事:
> ① 讲稿/大纲的**文字评审** ② 页面排版的**逐张视觉检查** ③ 配图核对。
>
> | 你要的是 | 去哪 |
> |---|---|
> | **生成** .pptx(HTML→PPTX) | `office-skills`(本剧本第 2 步给了完整路径) |
> | Beamer / 文本源出稿 | `latex-document-skill` |
> | 配色 / 模板 / 品牌 | `branding` |

---

## 什么时候读这份

| | |
|---|---|
| ✅ | 讲稿/大纲写完了,想让人挑内容毛病(逻辑链、结论支撑) |
| ✅ | 幻灯片做好了,想逐张检查排版(文字溢出/遮挡/对齐/配图占比) |
| ✅ | 页里的数据图要核对 |
| ❌ | 「帮我做一份 PPT」→ 先去 `office-skills` 生成,回来再查 |

## 开口就说

| 你说 | 走到哪 |
|---|---|
| 「评审一下这份讲稿:<文件>」 | `qwen_review review` |
| 「challenge 一下这份答辩稿:<文件>」 | 对抗评审 |
| 「这几页排版检查一下:<图1> <图2> …」 | `qwen_vision` 逐张 |
| 「这份 pptx 导出成图逐页检查」 | 走下面第 3-4 步 |

## 流程

```bash
S=~/.claude/skills/qwen-dual-model/scripts
```

### 第 1 步 内容评审(定稿前)

```bash
node $S/qwen_review.mjs challenge 讲稿.md --context "课程汇报/答辩,关注逻辑链、结论支撑、可能被问到的问题"
```

### 第 2 步 生成 pptx(在 office-skills,不在本 skill)

一次性前置(**只跑一次**;本机 2026-10-08 已装好,无需重跑):

```bash
cd ~/.claude/skills/office-skills && npm install    # 拉 playwright + chromium,约 150MB
```

生成路径:Claude 手写每页 HTML(16:9 = `720pt × 405pt`)→ 写一个驱动脚本 `require('../../html2pptx-local.cjs')`(该仓库里没有现成驱动,每次要写一个)→ `node` 跑出 `.pptx`,产物放 `outputs/<名字>/`。

> 手工在 PowerPoint/WPS 里排的,跳过本步 —— 第 3 步照样能用(直接对 pptx 跑)。

### 第 3 步 导出每页 PNG

```bash
python $S/slides_to_png.py outputs/my-deck/presentation.pptx
# → outputs/my-deck/png/slide-1.png、slide-2.png …
```

- 一条命令搞定,**已实测跑通**(2026-10-08,2 页样张跑完 HTML→PPTX→PNG→视觉检查全链路)
- 它绕开了 office-skills 自带校验路径的坑:那条路依赖 soffice / pdftoppm(本机没装 LibreOffice 与 poppler),而且产出的是**拼图**不是单页
- 依赖:PowerPoint + `pywin32` + `pypdfium2`(本机均已就位);渲染倍率用 `--scale` 调(默认 2.0)

### 第 4 步 逐张检查(每批 ≤6 张)

```bash
node $S/qwen_vision.mjs slide-1.png slide-2.png slide-3.png "逐张检查:文字是否溢出/遮挡、元素对齐、配图占比、留白"
```

超过 6 张分批跑。

### 第 5 步 回改 → 重转 → 重查(改了几页就只重查那几页)

> **`qwen_vision` 逐张 vs 开 Qwen 会话,怎么选:**
> - 一次性的「挑毛病」,页数十几页以内 → `qwen_vision` 分批(便宜、快)
> - 要连续多轮逐页改、来回讨论排版 → 开 Qwen 会话(CC Switch 切百炼 + 新终端)

## 最小路径(只有 3 分钟)

讲稿送一次 `challenge` + 封面页/结论页截图送 `qwen_vision` 看一眼。

## 做完的标志

- [ ] 讲稿过过至少一轮 `review`/`challenge`,【高】级问题已复评清零
- [ ] 每一页都过过 `qwen_vision`(或明确说明为什么不用)
- [ ] 发现的排版问题都已回改,并**重新导出复查过**

## 本场景的坑

1. **文字必须放进 `<p>/<h1>` 等文本标签** —— 裸 `<div>文字</div>` 会**静默丢失**(不进 pptx、也不报错)
2. **CSS 渐变一律不支持** → 先栅格化成 PNG 再引用
3. **样式只能挂 `<div>`**;pptxgenjs 的颜色**不能带 `#`**(写 `FF0000`);字体只用 web-safe 名单
4. **正文离底边 ≥0.5 英寸**,溢出会直接抛错
5. 不要直接 `Read` PPT 导出的图 —— **存文件后走 `qwen_vision`**(与作业场景同一条口径)

## 引用了谁

- `office-skills`(`~/.claude/skills/office-skills/`):负责生成 pptx。它文档里说的 `venv/bin/python` 在本机**不成立**,用 `python`
- 本机依赖实测:PowerPoint ✅ / pywin32 ✅ / pypdfium2 ✅ / office-skills 的 npm 依赖(playwright + chromium)✅ / LibreOffice ❌ / poppler ❌
