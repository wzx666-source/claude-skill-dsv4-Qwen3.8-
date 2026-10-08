# 双模型协议(竞赛项目**增量**版)

**这是增量文件,不是超集。** 它只含竞赛专有的内容(桥接目录、Qwen 会话提醒、阶段映射、AI 声明核对);
通用协议(会话路由、视觉协议、评审协议、PDF 处理、降级规则)在 `templates/CLAUDE.md`,**两者必须一起用**。

**使用方式**(拷进竞赛项目根目录的 `CLAUDE.md`,顺序不能反):

```bash
cp <skill>/templates/CLAUDE.md CLAUDE.md && cat <skill>/templates/CLAUDE.competition.md >> CLAUDE.md
```

(别用 `head -n N` 之类按行号定位来合并 —— 通用版一改行号就废。)

---

## 桥接目录(与 Qwen 会话联动用)

- `bridge/to_qwen/` — 本会话写给 Qwen 会话的任务说明
- `bridge/to_ds/` — Qwen 会话的结果落盘处
- 需要双开时:把任务写进 `bridge/to_qwen/<任务>.md`,请用户去 Qwen 会话执行;
  Qwen 结果落到 `bridge/to_ds/` 后,本会话直接读它继续,不重复问

## Qwen 会话提醒规则(遇到以下情况,必须停下来提醒用户,不要硬扛)

触发条件:
1. PDF 文字提取失败(扫描件/图片型 PDF)
2. `pdf_read` 输出"图密集 PDF"警告(含图页 >50% 或 >8 页)
3. 用户把图片直接粘贴到会话 → 提醒存成文件提路径
4. 需要 Qwen 多轮连续讨论(逐页讨论题目、深度对话、连续追问)
5. Qwen API 连续失败 ≥2 次 → 提醒检查 CC Switch 与网络,并说明主线不受影响

提醒话术模板(按模板输出,把 <...> 替换成实际内容):
```
⚠️ 这个任务建议开一个 Qwen 会话(本会话不受影响,继续跑):

1. 不用关本会话
2. 打开 CC Switch → 切到「百炼」
3. 新开一个终端,cd 到本项目目录,运行 claude —— 这就是 Qwen 会话
4. 在 Qwen 会话里:读 <文件> / 讨论 <话题>(任务说明我已写到 bridge/to_qwen/<任务>.md)
5. 让它把结果存到 bridge/to_ds/<名字>.md
6. 回到本会话跟我说「读 bridge/to_ds/<名字>.md」,我接着干
```
> 该 Qwen 会话里的 `qwen_review` / `qwen_ask` 会自动改由 DeepSeek 承担(评审角色翻转),两边都不会自审自。
> **不要为了"随手问一句"开 Qwen 会话**——单次提问用 `qwen_ask`。

## 阶段映射(配合 mathmodel-skill)

> **权威版在 skill 的 `scenarios/contest.md`**(含每阶段可直接复制的命令、stage 9 的关键挂载点)。下表是速查;两处对不上时以 skill 版为准。

| 阶段 | 触发 |
|---|---|
| 1 选题 | `qwen_ask "<粘贴题干>。这道题的获奖潜力与难点?"` 每题各问一次(**`qwen_ask` 没有 `--context` 参数**,背景写进问题文本);含图题先 `qwen_vision` 看图 |
| 2 问题解析 | 题目 PDF 用 `pdf_read.mjs`(文字给主线读,含图页自动走视觉);扫描件/重视觉 PDF 走 Qwen 会话 Read |
| 3 模型选型 | 每个候选定稿前跑 `qwen_review.mjs challenge` |
| 5 每个 Qi | 推导+代码完成后 `review`;每个关键数值 `recompute` 一次;画图后 `qwen_vision` 检查 |
| 6 灵敏度 | 灵敏度曲线图 `qwen_vision` 检查单调性/断点;结论 `review` |
| 8 写作 | 每节写完 `review`;转 LaTeX 后 `latex`;每张插图生成后 `qwen_vision` 配图注 |
| 9 终审 | 摘要双通道:文字 `challenge` + 插图/排版 `qwen_vision`;全文 `latex` |

评审时建议带领域背景,让判据贴合竞赛规范:
`--context "数学建模竞赛论文,关注模型合理性、创新性、灵敏度分析与摘要扣题"`

## ⚠️ AI 使用声明一致性(提交前必查)

竞赛要求提交 AI 使用声明,声明内容**必须与实际工具集相符**:

- 声明里若写"通义千问(百炼)qwen3.8-max 用于题目附件图像识别",而实际某次由
  DeepSeek 原生视觉读了图(hook fail-open 放行,或手动 `Read`),**声明就不准确**
- 同理,**评审/咨询**也跨厂商调用:本会话 DeepSeek 时评审走 Qwen;双开 Qwen 会话时评审走 DeepSeek,
  且 DeepSeek 侧按 mode 分档(具体档位见文末版本戳)。声明若要列"用于评审的模型",按实际用过的那几档写,别只写一个
- 赛前对一遍 `mathmodel-skill/references/2026_ai_regulation.md` 里的工具清单
- 稳妥做法:全程按协议走 Qwen 视觉;若用过原生视觉,把 DeepSeek 一并写进声明

---

<!-- ROSTER:roster-stamp:begin -->
> 档位依据:`model_roster.json` @ 2026-09-28(复核期限 2026-10-31)。若此戳早于 skill 内的 roster 版本,说明本项目这份协议已过期,请重新拷贝模板。
<!-- ROSTER:roster-stamp:end -->
