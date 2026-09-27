---
name: qwen-dual-model
description: 双模型联动——Qwen 负责视觉(读图/PDF),评审与第二意见自动落到「非驱动方」的厂商(跨厂商真第二意见,一次调用,区别于 agent-review-panel 的多智能体深审)。含会话路由规则:默认 DeepSeek 会话,只在「连续多轮视觉精读」或「开题即知的硬骨头」时才开 Qwen 会话;中途难题不切会话。触发词——轻量档:看图、读图、识图、检查图、这张图、手写公式、第二意见、双模型、用 Qwen、视觉;重流程档:评审、评审一下、challenge、对抗评审、复算、复核数值、LaTeX 检查、该用哪个模型、开哪个会话。
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion
---

# qwen-dual-model — 双模型协作(视觉 + 跨厂商第二意见)

主会话跑在 **DeepSeek** 上;Qwen(百炼 qwen3.8-max)提供两个外挂能力:**视觉**与**独立评审**。**主链路直连不动,外挂失败不影响主线**——这是与代理式路由(如 CCR)的本质区别。

## 分工总表

| 能力 | 走哪边 | 脚本 |
|---|---|---|
| 长文本推理/推导/代码 | DeepSeek(主线) | — |
| 读图(截图/数据图/手写公式/扫描件/论文插图) | **固定 Qwen** | `qwen_vision.mjs` |
| 读 PDF | 文字→主模型;含图页→**固定 Qwen** | `pdf_read.mjs` |
| 独立评审/对抗/复算 | **自动翻转**(非驱动方) | `qwen_review.mjs` |
| 第二意见/会诊/头脑风暴 | **自动翻转**(非驱动方) | `qwen_ask.mjs` |

> 视觉**固定**走 Qwen(口径统一,便于配图复核);评审/咨询**自动翻转**——理由见「评审角色翻转」。

## 与其他评审类 skill 的分工(避免打架)

| 要什么 | 用哪个 |
|---|---|
| 多智能体对抗辩论、要覆盖每个角度 | `agent-review-panel` |
| 学术论文同行评审模拟(EIC + 3 审稿人) | `academic-paper-reviewer` |
| 代码改动的 bug/简化审查(走 diff) | `/code-review` |
| 全流程学术pipeline 的评审环节 | `academic-pipeline` |
| **换个厂商看一眼、几十秒出结果** | **`qwen_review`(本 skill)** |

本 skill 的差异化是两条:**跨厂商**(不同模型家族 → 真第二意见,不是同一模型的自我批评)+ **一次调用**(快、便宜、可脚本化、可嵌进任何流程)。要深审用上面那些;要"换双眼睛快速过一遍"用这个。两者不冲突,常配合使用。

## 会话路由规则(决定开哪种会话)

判据不是"任务难不难",而是两条:**要不要长时间反复看像素**、**是不是开题就知道要连续多轮啃**。

1. **默认开 DeepSeek 会话。** 例外只有第 2 条。
2. **只在这两种情况开 Qwen 会话**:
   - 核心工作是连续多轮的视觉/PDF 精读(顶会论文精读、扫描件、通篇图表的 PDF)
   - 开题时就知道要连续多轮啃的硬骨头(而不是"做到一半才发现难")
3. **中途遇到难题 → 不切会话。** 切会话会丢掉已建立的全部上下文,代价远大于收益;
   改用 `qwen_ask`(会诊)或 `qwen_review challenge`(对抗)。
   **注意这是"两个模型都要",比切过去只用一个更强。**
4. **误判触发器**(判断错了怎么办):
   - **升级**:同一个 bug 修 2 轮不过 / 算法题卡 20 分钟无思路 / 读了 3 个文件还没定位 → 送 `qwen_ask` 会诊
   - **降级**:Qwen 会话里连续两次评审结论都是"改个参数就行" → 回 DeepSeek

### 场景速查

| 场景 | 怎么走 | 为什么 |
|---|---|---|
| **编程** 日常作业/简单脚本/中等及以下算法题/单模块开发/简单 bug | DeepSeek 会话 | 便宜档足够,秒出 |
| **编程** 全栈架构/复杂系统设计/课程设计/毕设/比赛项目 | DeepSeek 会话 + 架构定稿前 `challenge` | 长时间读仓库,切会话=丢上下文;质量靠 plan 纪律,不靠换模型 |
| **编程** 深层 bug 排查/性能优化 | DeepSeek 会话 + `qwen_ask` 会诊 | 走到一半才发现难,切换成本最高;且更依赖 profiling 工具输出 |
| **编程** 竞赛难题/复杂算法推导 | DeepSeek 主推 + `qwen_review challenge` | 两个模型都要,而不是二选一 |
| **科研** 文献批量泛读/综述初稿/基础实验复现/写作初稿 | DeepSeek 会话 | 文字密集、便宜、迭代快 |
| **科研** 顶会论文精读 / 含扫描件 | **Qwen 会话** | 连续多轮视觉判读 |
| **科研** 实验改进 | DeepSeek 主推 + `challenge` | 同上,改的是代码与数据 |
| **科研** 学术终稿润色 | **同一模型走完** + `qwen_review` | 初稿换模型润色会丢文风,终稿就不再是"你写的" |
| **文档** PPT 草稿/大纲/逐字稿/日常文档 | DeepSeek 会话 | 文字工作 |
| **文档** 正式项目文档/重要报告 | DeepSeek 会话 + `challenge` | 定稿前对抗一次 |
| **文档** 答辩 PPT 终稿 | **Qwen 会话**,或 `qwen_vision` 逐张检 | 要看排版/配图的像素 |
| **文档** 论文插图复核 | `qwen_vision` 逐张 | 独立视觉复核关口 |
| **学习** 日常答疑/习题讲解/技术入门 | 直接在本会话说 | 单次提问,不为一道题切整场会话 |
| **学习** 深层原理/系统学习路线/工程化进阶 | 直接问 + 必要时 `qwen_ask` | 同上,要第二意见时才调脚本 |

## 评审角色翻转

**评审方 = 非驱动方的那个厂商**,脚本自动判定,无需手动指定:

| 驱动会话 | 评审/咨询方 | 用的档 |
|---|---|---|
| DeepSeek | Qwen(百炼) | `qwen3.8-max` |
| Qwen(百炼) | DeepSeek | `deepseek-v4-pro`(纯文本评审);**含图时自动落 `deepseek-flash`** |

- 判定依据:CC Switch 的 `settings.json → currentProviderClaude`(数据库 `is_current` 兜底);识别失败按 DeepSeek 驱动处理
- 可用环境变量 `DRIVER_PROVIDER=bailian|deepseek` 强制覆盖(测试用)
- 判定依据是"当前驱动方",所以**双开 Qwen 会话时不会退化成 Qwen 审自己**——无论哪边当主模型,拿到的都是真第二意见
- 评审方信息打印在 **stderr**,`stdout` 首行仍是「总体结论:…」,落盘/解析脚本不受影响

## 脚本用法(scripts/)

```bash
# 视觉:多图 + 一个问题,图按顺序编号(固定走 Qwen)
node <skill>/scripts/qwen_vision.mjs <图片路径...> "<问题>"

# PDF:自动提取文字 + 含图页转 PNG 喂视觉(优先用这个,不用开 Qwen 会话)
node <skill>/scripts/pdf_read.mjs <pdf> [--pages 1-3] [--no-images] [--max-img-pages 4] ["图页检查重点"]

# 评审:四模式,评审方自动翻转
node <skill>/scripts/qwen_review.mjs review|challenge|recompute|latex <文件...> \
     [--focus "本轮关注点"] [--context "领域背景"]

# 自由咨询:会诊/头脑风暴/第二意见,咨询方自动翻转
node <skill>/scripts/qwen_ask.mjs "<问题>" [--file <附件>...]
```

- **`--context` 很关键**:不给则按通用标准评审;给了就按该领域的规范判。
  例:`--context "Rust 异步运行时,关注 Send/Sync 边界与取消安全"`、
  `--context "机器学习论文,关注消融实验是否充分"`、
  `--context "数学建模竞赛论文,关注模型创新性与摘要扣题"`
- 评审输出第一行固定为「总体结论:…」,据此判定:【高】级问题必须修复后才进下一阶段
- 评审报告落盘 `results/reviews/`,重要图的结论落盘 `results/fig_notes/`
- 所有脚本自动从 CC Switch 数据库读对应厂商的 key(与 CC Switch 同步);`QWEN_API_KEY`/`QWEN_MODEL`/`DEEPSEEK_API_KEY`/`DEEPSEEK_MODEL` 可覆盖

## 降级与错误处理(必须遵守)

1. 脚本报错 → 重试 1 次 → 仍失败:改用代码输出/数据交叉核对,并明确告知用户"本次视觉/评审未执行"
2. **视觉故障的新退路**:hook 是 fail-open 的,Qwen 挂掉时原 `Read` 会被放行。
   **实测:`deepseek-flash`(V4.1-Flash)已有原生视觉**——能读折线图异常点、能把排版公式准确转成 LaTeX。
   放行后主模型确实读得了图,这条路比"放弃视觉"强得多。
   (注意 `deepseek-v4-pro` 是**纯文本**档,只有 `flash` 能看图。)
   需要主动使用原生视觉时,直接 `Read` 并说明"本次不走 Qwen"即可,不要绕脚本。
3. 图片结论与代码输出矛盾时,以代码实际输出为准,让 Qwen 再确认一次
4. 绝不因为外挂故障停止主线推理;绝不编造"Qwen 说…"的内容——没跑成功的调用,结果不存在

## 初始化(init)

**默认轻量:什么都不用做。** 脚本自动从 CC Switch 读 key,不需要在项目里装任何东西;
图片按协议存文件后提路径即可。

**可选:项目级协议**(某项目要长期用双模型时)
1. 拷贝 `templates/CLAUDE.md` 为项目根 `CLAUDE.md`
2. 可选:把 `templates/hooks.settings.json` 合并进项目 `.claude/settings.json`
   (装后:DeepSeek 会话里 Read 图片自动转 Qwen;Qwen 会话里让行)
3. 跑自检:`node <skill>/scripts/self_test.mjs`

**竞赛项目**:用 `templates/CLAUDE.competition.md`,额外含 bridge 双开信箱与阶段映射(见文末附录)。

## Qwen 会话提醒规则(主线会话必须遵守)

遇到以下情况,**停下当前任务,按模板提醒用户开 Qwen 会话**(不硬扛):
1. 核心工作是连续多轮的视觉/PDF 精读(顶会论文精读、扫描件、通篇图表 PDF)
2. 开题即知要连续多轮啃的硬骨头
3. `pdf_read` 报"图密集 PDF"(含图页 >50% 或 >8 页)
4. 用户把图片直接粘贴到会话
5. Qwen API 连续失败 ≥2 次

提醒模板(替换 <...>):
```
⚠️ 这个任务建议开一个 Qwen 会话(本会话不受影响):
1. 不用关本会话
2. CC Switch → 切到「百炼」
3. 新开终端,cd 到本项目目录,运行 claude —— 即 Qwen 会话
4. 在 Qwen 会话里:读 <文件> / 讨论 <话题>(任务说明已写到 bridge/to_qwen/<任务>.md)
5. 让它把结果存到 bridge/to_ds/<名字>.md
6. 回本会话说「读 bridge/to_ds/<名字>.md」,我接着干
```
> 翻转后,该 Qwen 会话里的 `qwen_review` 会自动改由 DeepSeek 评审;主会话这边则仍由 Qwen 评审。
> **不要为了"随手问一句"开 Qwen 会话**——单次提问用 `qwen_ask`。

## 用户习惯提示

- 图片一律**存文件后提路径**(按协议统一走 Qwen 视觉,口径一致)
- CC Switch 切换只影响新开的会话;双开 Qwen 会话与主会话并存互不影响
- 本机 `TEMP=D:\Temp`(即 Git Bash 的 `/tmp`)

---

# 附录:数学建模竞赛(CUMCM / MCM / 电工杯)阶段映射

配合 `mathmodel-skill` 使用。竞赛项目的完整协议见 `templates/CLAUDE.competition.md`。

| 阶段 | 触发 |
|---|---|
| 1 选题 | `qwen_ask --context "数学建模竞赛选题"` 每题各问一次"该题的获奖潜力与难点";含图题先 `qwen_vision` 看图 |
| 2 问题解析 | 题目 PDF 用 `pdf_read.mjs`(文字给我读,含图页自动走视觉);扫描件/重视觉 PDF 走 Qwen 会话 Read;图的结论落盘后喂主线 |
| 3 模型选型 | 每个候选定稿前跑 `qwen_review.mjs challenge` |
| 5 每个 Qi | 推导+代码完成后 `review`;每个关键数值 `recompute` 一次;画图后 `qwen_vision` 检查 |
| 6 灵敏度 | 灵敏度曲线图 `qwen_vision` 检查单调性/断点;结论 `review` |
| 8 写作 | 每节写完 `review`;转 LaTeX 后 `latex`;每张插图生成后 `qwen_vision` 配图注 |
| 9 终审 | 摘要双通道:文字 `challenge` + 插图/排版 `qwen_vision`;全文 `latex` |

> ⚠️ **AI 使用声明一致性**:参赛提交的 AI 声明需与实际工具集相符。
> 若某次实际由 DeepSeek 原生视觉读了图(hook fail-open 放行),声明里就不能只写"Qwen 用于图像识别"。
> 赛前对一遍 `mathmodel-skill/references/2026_ai_regulation.md`。
