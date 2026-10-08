# 剧本:科研(文献 / 实验 / 论文)

> **先圈地**:本剧本只认领三格 ——
> ① **PDF 图页精读**(Qwen 视觉) ② **插图复核** ③ **终稿跨厂商评审**。
>
> 写作去 `academic-paper` / `latex-document-skill`,画图去 `scipilot-figure-skill`,文献综述去 `deep-research`。

## 什么时候读这份

| | |
|---|---|
| ✅ | 有 PDF/扫描件要读,**尤其含图页**(公式、曲线、示意图) |
| ✅ | 图做完了,投稿前要过一道独立的视觉关口 |
| ✅ | 论文/章节定稿前,想要一次跨厂商的第二意见 |
| ❌ | 要写初稿、改文风 → `academic-paper` |
| ❌ | 要画图、选图型 → `scipilot-figure-skill` |

## 开口就说

| 你说 | 走到哪 |
|---|---|
| 「读一下这篇 PDF:<路径>」 | `pdf_read` |
| 「这几张图检查一下:<图…>」 | `qwen_vision` 逐张 |
| 「评审一下这章:<文件>」 | `qwen_review review` |
| 「challenge 一下我的结论:<文件>」 | 对抗评审 |
| 「复算一下这个数值」 | `qwen_review recompute` |

## 流程

```bash
S=~/.claude/skills/qwen-dual-model/scripts
```

| 阶段 | 做什么 | 怎么走 |
|---|---|---|
| 文献泛读 | 批量摘要/初筛 | 本会话直接读(文字密集,便宜) |
| 文献精读 | 顶会论文 / 扫描件 / 通篇图表 | `node $S/pdf_read.mjs 论文.pdf --pages 1-8 "重点看第 3 节的收敛性图"`;扫描件直接开 **Qwen 会话** `Read` |
| 选题 / 方法设计 | 拿第二意见、对抗 | `node $S/qwen_ask.mjs "【研究方向】……" --file notes.md`<br>`node $S/qwen_review.mjs challenge 方案.md --context "机器学习,关注消融实验是否充分"` |
| 实验代码 | 模块完成后评审 | `node $S/qwen_review.mjs review train.py --context "PyTorch 训练循环,关注数值稳定与随机性"` |
| 关键数值 | 独立复算 | `node $S/qwen_review.mjs recompute results.csv 结论.md` |
| 数据出图 | 先走画图 skill,再回来复核 | `scipilot-figure-skill` 出图 → 它的第 6 步「视觉自检闭环」第 3 层**替换**为 `node $S/qwen_vision.mjs figs/_preview.png "按 visual_review.md 的 8 项清单检查"`(替换而非叠加,别查两遍) |
| 写作 | 写作 skill 负责写,本 skill 负责审 | `academic-paper` / `latex-document-skill` 写 → `node $S/qwen_review.mjs review 章节.md`;转 LaTeX 后 `node $S/qwen_review.mjs latex paper.tex` |
| 投稿前 | 快审 vs 深审 | 见下表 |

### 投稿前:快审 vs 深审(选择判据)

| 要什么 | 用哪个 | 成本 |
|---|---|---|
| 换个厂商快速看一眼(几十秒) | `qwen_review review`/`challenge`(**本 skill**) | 一次调用 |
| 多智能体对抗辩论、每个角度都要覆盖 | `agent-review-panel` | 高 |
| 同行评审模拟(EIC + 3 审稿人) | `academic-paper-reviewer` | 中高 |
| 全流程学术 pipeline | `academic-pipeline` | 最高 |

> `latex` mode 插在 `latex-document-skill` 的 **Step 9(内容清单)之后、Step 10(编译)之前** —— 它那里内容层评审为零,不重叠。

## 最小路径(只有 3 分钟)

最关键的插图送一次 `qwen_vision` + 摘要送一次 `challenge`。

## 做完的标志

- [ ] 含图页都过过视觉检查(或说明为何不需要)
- [ ] 要写进论文的关键数值有过 `recompute`
- [ ] 终稿过过一轮跨厂商评审,【高】级问题复评清零

## 本场景的坑

1. **`qwen_vision` 把图转成文字回灌主线** —— 图从未进入主线的推理循环。**看图是为了做判断**(不是复核)时这一步有损 → 该开 Qwen 会话,或按全局 `CLAUDE.md` 的判据切 Claude
2. **终稿润色在同一模型走完**(初稿换模型会丢文风),润色**之后**再送 `qwen_review` —— 顺序别反
3. `latex` mode 永远在**实际编译之后**(编译器零幻觉,模型只判数学正确性与符号一致性)
4. **零侵入的自动对齐**:`scipilot-figure-skill` 第 6 步写的是「用 `Read` 读 PNG」—— 本机全局 hook 会把 DeepSeek 会话里对图片的 `Read` 自动路由给 Qwen,两边已天然接上。但 **AI 声明要如实体现**这一层

## 引用了谁

- `scipilot-figure-skill`(画图;其 `references/visual_review.md` 8 项清单是 `qwen_vision` 提示词的底本)
- `latex-document-skill`(LaTeX 写作与编译)
- `academic-paper` / `deep-research` / `agent-review-panel` / `academic-paper-reviewer`(写作与深审)
- ⚠️ `scipilot-review-skill` 尚在规划中(未实现),别依赖它
