# 剧本:数学建模竞赛(CUMCM / MCM·ICM / 电工杯)

> **本剧本是 `mathmodel-skill` 的配件,不是它的替代。** 竞赛主流程(10 阶段、问答式、rubric 自评、L1-L4 反馈层)全在那边跑;
> 本剧本只回答一个问题:**在它的哪一步,挂哪个双模型外挂。**
>
> ⚠️ 阶段号与挂载点以本文件为**权威**;若与 `mathmodel-skill` 的版本对不上,以那边实际的阶段为准,并回报修正本文件。

## 什么时候读这份

竞赛全程。每进入一个新阶段前扫一眼对应行即可,不用通读。

## 挂载点总表

```bash
S=~/.claude/skills/qwen-dual-model/scripts
```

| 阶段 | 挂什么 | 敲什么 |
|---|---|---|
| 0 团队启动 + 资料预扫 | — | (无) |
| 1 选题 | 含图题先看图;每题各问一次 | `node $S/qwen_vision.mjs 题图.png "逐行转录并转 LaTeX"`<br>`node $S/qwen_ask.mjs "【数学建模竞赛选题】题目:<粘贴题干>。这道题的获奖潜力与难点在哪?"` |
| 2 问题深度解析与分解 | 题目 PDF 走 `pdf_read` | `node $S/pdf_read.mjs 题目.pdf --pages 1-8 "重点看第 3 节的约束条件"` |
| 3 模型选型 | **每个候选定稿前**对抗一次 | `node $S/qwen_review.mjs challenge 候选模型.md --context "数学建模,关注假设合理性、可解性、创新性"` |
| 4 Foundation(假设/符号/术语) | — | (无) |
| 5 递归子问题循环(每个 Qi) | 推导+代码后评审;关键数值复算;出图后检查 | `node $S/qwen_review.mjs review results/Q1_model.tex`<br>`node $S/qwen_review.mjs recompute results/Q1_结果.csv 结论.md`<br>`node $S/qwen_vision.mjs figures/Q1_results.png "检查曲线趋势与异常点"` |
| 6 全局灵敏度·稳健性 | 灵敏度曲线看图;结论评审 | `node $S/qwen_vision.mjs figures/sensitivity_pairs.png "检查单调性/断点/异常"` |
| 7 模型评价 + 推广 | — | (无) |
| 8 论文写作 | 每节写完评审;转 LaTeX 后检查;每张插图配图注 | `node $S/qwen_review.mjs review 第三章.md`<br>`node $S/qwen_review.mjs latex paper.tex` |
| 9 终稿审核 + Panel | **关键挂载点见下** | — |

> `qwen_ask` **没有** `--context` 参数 —— 领域背景直接写进问题文本(上表就是这么写的)。
> `qwen_vision` 一次最多 6 张;`recompute` 必须能指到材料里的具体位置,否则它会判「无法验证」。

## 阶段 9 的关键挂载点(最重要的一条)

mathmodel-skill 的 L3 Panel 是**同一模型的 5 个内部 persona**(数学严谨 / 创新 / 代码 / 写作 / 评委视角)——**跨厂商为零**。

**把 `challenge` 插在 stage 9 的 Step 2(视觉化润色)之后、Step 3(L3 Panel)之前:**

```bash
node $S/qwen_review.mjs challenge paper.tex --context "数学建模竞赛论文,关注模型合理性、创新性、灵敏度分析与摘要扣题"
```

- 它充当**独立的第 6 视角**,其 must_fix 并入 Step 4 定向重跑
- **不要挂在每阶段(L1 层)** —— 会与每阶段的 rubric 自评重复劳动
- 终稿摘要双通道:文字走 `challenge`;插图/排版走 `qwen_vision` 逐张

## 双开 Qwen 会话(bridge 信箱)

需要连续多轮视觉精读(扫描件、通篇图表的 PDF)时,开 Qwen 会话;两个会话用 `bridge/` 目录通信,协议见 `../templates/CLAUDE.competition.md`。

## ⚠️ AI 使用声明一致性(提交前必查)

- 合规细节以 `mathmodel-skill/references/2026_ai_regulation.md` 为准;固定交付物是 **《AI工具使用详情.pdf》**,**声明内容必须与详情一致**
- **如实列**:本 skill 用到的是**两家** —— 读图固定走 Qwen(百炼 qwen3.8-max);评审/咨询走「非驱动方」的厂商,DeepSeek 侧还按 mode 分档
- ⚠️ 若某次由 DeepSeek 原生视觉读了图(hook fail-open 放行,或手动 `Read`),声明里就不能只写 Qwen
- stage 5 起累积的 `cwd/state/ai_usage_log.md` 是声明的事实来源,别等交稿再回忆

## 本场景的坑

1. **第 1 步别写 `qwen_ask --context`** —— 该参数不存在,会被静默并进问题文本
2. **`qwen_vision` 的最后一个参数永远是「问题」** —— 漏写会把文件名当成问题发出去
3. **`latex` mode 是编译的补充不是替代** —— 先 `xelatex` 真编译(编译器零幻觉),模型只判编译器抓不到的数学正确性与符号一致性
4. **评审报告要自己落盘** —— 用 Write 存到 `results/reviews/`,`qwen_vision` 的重要结论存到 `results/fig_notes/`。这是协议要求,**脚本不会自动写**

## 引用了谁

- `mathmodel-skill`(主流程;本剧本只挂载,不改它一个字)
- `mathmodel-skill/references/2026_ai_regulation.md`(AI 声明合规)
- `../templates/CLAUDE.competition.md`(项目级协议 + bridge 信箱)
