---
name: qwen-dual-model
description: DeepSeek 主会话的双模型外挂——Qwen 管视觉(读图/PDF),评审与第二意见自动落到非驱动方的另一厂商(跨厂商真第二意见、一次调用,区别于 agent-review-panel 的多智能体深审);评审按 mode 分档(代码/agent 走 flash,知识推理走 pro)。任务剧本在 scenarios/ 下:作业复核、答辩 PPT 终稿检查、数模竞赛插图与数值复核、论文插图与终稿评审。会话路由:默认 DeepSeek,只在连续多轮视觉精读/开题即知的硬骨头时开 Qwen 会话,中途难题不切会话。触发词——看图、读图、识图、检查图、这张图、手写公式、第二意见、双模型、用 Qwen、视觉;评审、评审一下、challenge、对抗评审、复算、复核数值、LaTeX 检查、该用哪个模型、开哪个会话、答辩 PPT 排版检查、竞赛插图复核、论文插图复核;模型升级、换模型、跑分更新、重新分档、迭代通道、新模型、model_roster;GPT 档:生图、生成图片、海报、信息图、改图、修图、用 GPT。
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion
---

# qwen-dual-model — 双模型协作(视觉 + 跨厂商第二意见)

主会话跑在 **DeepSeek** 上;Qwen(百炼 qwen3.8-max)提供两个外挂能力:**视觉**与**独立评审**。**主链路直连不动,外挂失败不影响主线**——这是与代理式路由(如 CCR)的本质区别。

## 用户现在在做什么?(先看这张表)

**任务剧本层**在 `scenarios/`(与本文件同目录;安装后即 `~/.claude/skills/qwen-dual-model/scenarios/`)。按用户当下在做的事挑一份读:

| 用户在做 | 读哪份剧本 | 一句话 |
|---|---|---|
| 日常作业(题目照片 / 手写推导 / 数值答案 / 代码作业) | `scenarios/homework.md` | 只做「看得见」和「算得对」 |
| PPT(课程汇报 / 答辩) | `scenarios/ppt.md` | 不做 PPT 本体:讲稿评审 + 逐张排版检查 |
| 数学建模竞赛(CUMCM / MCM / 电工杯) | `scenarios/contest.md` | mathmodel-skill 的配件:各阶段挂载点 + AI 声明 |
| 科研(文献 / 实验 / 论文) | `scenarios/research.md` | 只认领三格:PDF 图页精读、插图复核、终稿跨厂商评审 |

> 用户问「这个 skill 怎么用」→ 读 `README.md` 首屏念给他。剧本里用 `$S` 指 scripts 目录(`~/.claude/skills/qwen-dual-model/scripts`)。
> 下面各节是**机制参考**,日常按剧本走即可,不必通读。

## 分工总表

| 能力 | 走哪边 | 脚本 |
|---|---|---|
| 长文本推理/推导/代码 | DeepSeek(主线) | — |
| 读图(截图/数据图/手写公式/扫描件/论文插图) | **固定 Qwen** | `qwen_vision.mjs` |
| 读 PDF | 文字→主模型;含图页→**固定 Qwen** | `pdf_read.mjs` |
| 独立评审/对抗/复算 | **自动翻转**(非驱动方) | `qwen_review.mjs` |
| 第二意见/会诊/头脑风暴 | **自动翻转**(非驱动方) | `qwen_ask.mjs` |

> 视觉**固定**走 Qwen(口径统一,便于配图复核);评审/咨询**自动翻转**——理由见「评审角色翻转」。

## 档位依据(跑分速查)

**下表由 `model_roster.json` 推导生成,不要手改**——要改档位请走 [`MODEL_UPGRADE.md`](MODEL_UPGRADE.md) 的流程(填跑分 → `model_audit.mjs` → 生效 → 同步文档)。

<!-- ROSTER:bench-tables:begin -->
### DeepSeek:两档是两个方向,不是快慢档

| 维度(基准) | V4-Pro | V4.1-Flash | 胜方 |
|---|---|---|---|
| 知识广度与深度 (GPQA Diamond) | **92.4** | 90.9 | V4-Pro |
| 长尾硬推理 (HLE) | **42.7** | 36.8 | V4-Pro |
| agent/仓库级编码 (DeepSWE v1.1) | 62.7 | **74.2** | V4.1-Flash |
| 竞赛级算法 (Codeforces rating) | 3348 | **3471** | V4.1-Flash |
| 视觉 (BabyVision) | — | 89.6 | V4.1-Flash |
| 输出价 $/M | 1.98 | **0.60** | 便宜:V4.1-Flash |

### Qwen(百炼)(单一候选,档位无需推导)

| 维度(基准) | Qwen3.8-Max |
|---|---|
| 长尾硬推理 (HLE) | 43.6 |
| agent/仓库级编码 (SWE-bench Pro) | 67.7 |
| 指令遵循/格式 (IFBench) | 82.8 |
| 论文级复现与评审 (PaperBench) | 93.0 |
| 视觉 (MathVision) | 95.2 |
| 输出价 $/M | 6.00 |

> 数据来源:vendor=厂商自报(无独立复现)。
> **复核期限 2026-10-31** —— 到期跑 `node scripts/model_audit.mjs` 并按 `MODEL_UPGRADE.md` 重分档。
<!-- ROSTER:bench-tables:end -->

→ **结论**:代码/agent 走 Flash,知识/推理走 Pro。故 `recompute` 落 Flash,`review`/`challenge`/`latex` 落 Pro。
→ Qwen 在视觉维度领先(见上表 MathVision 95.2),故**「视觉固定走 Qwen」的结论不变**——现在是有数可依,不再只是"口径统一"。
Flash 的 BabyVision 89.6 也够用,这正是"Qwen 挂了就放行原生 Read"这条退路成立的量化理由。

### 背景细节(不参与路由推导,2026-09 快照)

以下跑分**不进 roster、不影响档位推导**,只作背景参考——所以过期了也不影响正确性:

- **Qwen3.8-Max**:LogicVista 91.9、Vision Arena 1301 Elo(第 2)、BabyVision 93.8、ERQA 78.3、
  OSWorld-Verified 86.1、TerminalBench-2.1 86.6、QwenSWEBench V2 70.0、CoWorkBench 76.1、
  JobBench 64.0、GDPval-AA 1739 Elo、`CodeArena(WebDev) 1691 号称全球第一`
  ⚠️ 最后这条是**单一榜单口径,证据最弱** —— 原先据此把「纯前端长程项目」列为开 Qwen 会话的情形,**现已废弃**(改按全局 `CLAUDE.md` 判据切 Claude)
- **DeepSeek V4.1-Flash**:Terminal-Bench 2.1 90.6、Terminal-Bench 3.0/4.0 30.0/31.2、NL2Repo 65.4、
  CyberGym 88.1、MathArena Apex 65.6、Chartography 78.9、ZeroBench-main 49.0
- **第三方独立可比**(Artificial Analysis):V4.1-Flash 指数 40 / 约 $0.27 每任务;Qwen3.8-Max 指数 53→56 / 约 $1.14 每任务

> **别名存疑(已实测)**:有厂商口径称 2026-09-14 起 V4-Pro 请求被重定向至 V4.1-Flash。
> 本机 2026-09-28 用 `self_test.mjs` 的「溯源探针」读响应体回显的 model id 实测:
> `v4-pro→deepseek-v4-pro` / `flash→deepseek-flash`,**两档回显不同,本账号未观察到重定向**,分档实际生效。
> 局限:探针读的是服务端回报值,不是地面真值,静默别名会被骗过——所以口径是"未观察到",不是"已证伪"。复核期限同上。

## 模型迭代通道(跑分更新后重分档)

档位不是手挑的,是从 `model_roster.json` **推导**出来的。完整 SOP 见 [`MODEL_UPGRADE.md`](MODEL_UPGRADE.md):

```bash
SK=~/.claude/skills/qwen-dual-model/scripts
# 1. 查跑分,填进 model_roster.json —— 唯一的人工步骤
node $SK/model_audit.mjs                       # 2. 体检:推荐档位变没变 / 漂移 / 期限 / 冻结
node $SK/model_audit.mjs --apply               # 3. 生效(冻结期会被拒绝)
node $SK/model_audit.mjs --sync-docs --write   # 4. 同步文档标记块
node $SK/self_test.mjs                         # 5. 全 ✅ 才算完成
```

- **档位表推不出来手改**:本文、`README.md`、`USAGE.md`、`templates/*.md`、全局 `CLAUDE.md` 里的档位表都在 `<!-- ROSTER:... -->` 标记块内,由 `--sync-docs` 重写,手改会被下次同步覆盖
- **推荐 = 该 mode 主维度的 argmax**(见 roster 的 `policy`),并列看副维度,**刻意不做加权评分**——权重会是拍脑袋的数字
- **护栏**:`freezeUntil` 冻结档位(比赛/deadline 期间拒绝 `--apply`,且漂移不判失败);`recheckBy` 复核期限到期告警
- **失效安全**:`tiers.generated.json` 缺失或损坏 → 运行时**静默回落**硬编码基线,主线不受影响
- 临时想换档位试:用 `DEEPSEEK_MODEL` / `QWEN_MODEL` 环境变量覆盖(优先级最高),**别改 roster**
  —— 注意它只影响**脚本进程**调用的模型,**不改会话主模型**

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
2. **只在以下两种情况开 Qwen 会话**:
   - 核心工作是连续多轮的视觉/PDF 精读(顶会论文精读、扫描件、通篇图表的 PDF)
   - 开题时就知道要连续多轮啃的硬骨头(而不是"做到一半才发现难")

   > **纯前端长程项目不在此列** —— 组件库 / 设计系统 / SPA 按全局 `CLAUDE.md` 的判据**切 Claude**。
   > 原先「开 Qwen 会话」的依据是单一榜单(CodeArena WebDev),证据最弱,已废弃。
   > 另见「成本与轮次」:Qwen 输出价是 Flash 的 10 倍,长程任务开 Qwen 会话要先掂量。
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
| **编程** 纯前端/UI 重头项目(组件库/设计系统/SPA) | **切 Claude** —— 见全局 `CLAUDE.md` 判据 | 原先"开 Qwen 会话"的依据是单一榜单,证据最弱 |
| **科研** 文献批量泛读/综述初稿/基础实验复现/写作初稿 | DeepSeek 会话 | 文字密集、便宜、迭代快 |
| **科研** 顶会论文精读 / 含扫描件 | **Qwen 会话** | 连续多轮视觉判读 |
| **科研** 实验改进 | DeepSeek 主推 + `challenge` | 同上,改的是代码与数据 |
| **科研** 学术终稿润色 | **同一模型走完** + `qwen_review` | 初稿换模型润色会丢文风,终稿就不再是"你写的" |
| **文档** PPT 草稿/大纲/逐字稿/日常文档 | DeepSeek 会话 | 文字工作 |
| **文档** 正式项目文档/重要报告 | DeepSeek 会话 + `challenge` | 定稿前对抗一次 |
| **文档** 答辩 PPT 终稿 | **Qwen 会话**,或 `qwen_vision` 逐张检(`scenarios/ppt.md` 给了选择判据) | 要看排版/配图的像素 |
| **文档** 论文插图复核 | `qwen_vision` 逐张 | 独立视觉复核关口 |
| **学习** 日常答疑/习题讲解/技术入门 | 直接在本会话说 | 单次提问,不为一道题切整场会话 |
| **学习** 深层原理/系统学习路线/工程化进阶 | 直接问 + 必要时 `qwen_ask` | 同上,要第二意见时才调脚本 |
| **图像** 生成海报/信息图/带中文文字的配图、改图 | **GPT(手动)**——见下「什么时候上 GPT」 | 你三家生成侧全为 0,只有 GPT 能做 |
| **图像** 读图/配图复核/插图审阅 | `qwen_vision` 逐张 | 读图归 Qwen;与生成是两条轴,互不替代 |

## 什么时候上 Claude(手动切换,本 skill 之外)

本 skill 只覆盖 DeepSeek + Qwen 两家。第三家(Claude 全家桶)走 CC Switch 的另一个 provider,
**纯手动切换,不做任何自动路由** —— 要用时自己切 provider + 新终端,与开 Qwen 会话同一机制。
完整判据表在全局 `~/.claude/CLAUDE.md` 的「什么时候上 Claude」一节;这里只记与 skill 直接相关的三条。

**判据一句话:双模型买的是「多样性」,Claude 买的是「天花板」。**
需要换双眼睛看同一个高度 → 本 skill 就够;需要够到双模型够不着的高度 → 才值得付切换成本。

| 与本 skill 相关的升级信号 | 为什么该切 |
|---|---|
| **`qwen_ask` 两轮后仍给不出可行思路**(是"给不出来",不是"不够好") | 误判触发器原本只有一级(→ `qwen_ask`),这一级是"要多样性"。两轮无解说明是**能力**问题,再加一个中档模型没用 —— 需要更高的天花板 |
| **产物是押上大代价的结论**(模型选型 / 架构定稿 / 论文摘要) | 本 skill 的评审是**对等评审**:两边都不知道的东西,互审发现不了 |
| **看图是为了做判断**,不是复核 | `qwen_vision` 把图**转成文字**回灌主线,图从未进入推理循环 —— 这一环是有损的 |

> 注意区分:`review`/`challenge` 的 `policy` 主维度就是 `hard_reasoning`,
> 说明本 skill 自己判定"评审最需要硬推理";而 Claude 恰在这个维度上把两家拉开两个档位。
> 所以"高代价结论加一道 Claude 终审"不是重复劳动,是补对等评审的盲区。

**在 Claude 会话里跑本 skill 的注意事项**:评审翻转只认 `deepseek` / `bailian` 两家，
识别不到时**按 DeepSeek 驱动处理** → 评审方落到 Qwen。那种场合的第二意见要手动指定。

## 什么时候上 GPT(手动切换,可选第四家)

GPT-5.6 走 CC Switch 的第三个 provider。与 Claude 那节同一机制:**纯手动、不做自动路由**,
要用时自己切 provider + 新终端。本节只列**你结构上做不了、只有 GPT 能做的事**。

> 与 Claude 那节的分工:**Claude 买「够不着的高度」(推理天花板),GPT 买「你根本做不了的事」(生成)。**
> 强弱之差要看价格,有无之差没什么可权衡——这是两节唯一的区别。

**档位前提**:用户固定用 **GPT-5.6 Sol**(2026-09-30 确认;6 太贵不切)。
本节列的是**能力有无**,与跑分档位无关,故不进 roster、不走 `MODEL_UPGRADE.md` 流程。

### ✅ 只有 GPT 能做

| 场景 | 你现有三家 | GPT 这边 |
|---|---|---|
| **生成带文字的图片**<br>海报 / 信息图 / 带中文标注的示意图 | Claude **生成侧为 0**;DeepSeek **为 0**;Qwen 侧有(万相 / Qwen-Image),但**无对比数据** | `gpt-image-2`:中文文字渲染 **>99%**(不再乱码)、Image Arena 第一(1512 分,**领先 Nano Banana 2 达 242 分**)、带 reasoning 可自查改错 [Sol] |
| **图像编辑**<br>自然语言改图 / 消除路人 / 换背景 / 多图融合 | 同上 | 同一模型:`inpainting` / `outpainting`、多图输入融合主体与风格、角色一致性最多 8 张 |

- **别拿这个跟 `qwen_vision` 比**:那是**读**图,这是**生成**图。两条轴,不冲突也不互相替代。
- **按张算钱,不按 token**:1024² 约 **$0.006 低 / $0.053 中 / $0.211 高**;4K 高质约 $0.40。
- 两个坑:`gpt-image-2` **不支持透明背景**(要透明退回 `gpt-image-1.5`);参数堆多了**过度锐化出伪影**。

### ❌ 别切的(已核实,不要重新论证)

| 场景 | 为什么不切 |
|---|---|
| **生成 PPT / 演示文稿** | **不是 GPT 单方面强**。Claude 赢在**模板感知编辑** + 把 bullet 转成**原生可编辑图表** + 演讲者备注写进 pptx,实测对比里也赢设计质量与信息密度;GPT 赢的是视觉冲击力与集成面。**要可编辑 .pptx → 本地 Claude Code + `python-pptx`,零切换成本** |
| **computer use / 桌面操控** | **口径不可比**:你 roster 里 Qwen3.8-Max 是 `OSWorld-Verified 86.1`,GPT-5.6 是 `OSWorld 2.0 62.6`——**不同基准**。不要按这个切 |
| **日常编码 / agent** | 价差 50 倍(Flash 输出 $0.60 vs Sol $30),且见下「待核」 |

### ⚠️ 待核(记着,但别急着切)

- **前沿编码跑分冲突**:GPT-5.6 Sol 自称在 `Terminal-Bench 2.1` 与 `DeepSWE` 上是 SOTA,
  而你 roster 里 `V4.1-Flash` 的 DeepSWE **74.2** / Terminal-Bench 2.1 **90.6** 是**厂商自报、无独立复现**——
  **两者不能同时成立**。下次跑分更新走 `MODEL_UPGRADE.md` 流程时一并核。
  即便 Sol 真的领先,50 倍价差也意味着它属于「**高代价结论单点升级**」,不是日常切换。
- **语音 / 实时对话**:GPT 有,你三家都没有。**未验证**——真要用先自己跑一次,再把结论补进本表。

### 切之前先想的三件事

1. **打破视觉口径统一**:本 skill 的视觉口径是"一律走 Qwen"(配图复核 + 竞赛 AI 声明一致性)。
   引入 GPT 生图就是引入第三家 → **生成的图若进竞赛/正式材料,声明规则要同步改**
   (对照 `mathmodel-skill/references/2026_ai_regulation.md`)。
2. **生图 ≠ 免检**:GPT 生成的图,复核仍走 `qwen_vision`。别因为"是 GPT 做的"就跳过。
3. **不进 roster**:GPT 与 Claude 一样是**手动第四家**,不写进 `model_roster.json`、不走档位推导。
   本节可手改(不在 `<!-- ROSTER:... -->` 标记块内)。

## 评审角色翻转

**评审方 = 非驱动方的那个厂商**,脚本自动判定,无需手动指定。**翻转只决定"哪家厂商",`mode` 决定"该厂商的哪一档"**:

| 驱动会话 | 评审/咨询方 | 用的档 |
|---|---|---|
| DeepSeek | Qwen(百炼) | `qwen3.8-max`(四个 mode 同一档) |
| Qwen(百炼) | DeepSeek | **按 mode 分档**(见下表);**含图一律落 `deepseek-flash`** |

mode 分档(两家的档位都由 `model_roster.json` 推导,别手改):

<!-- ROSTER:mode-tiers:begin -->
| mode | 档位(DeepSeek / Qwen) | 主维度 → 副维度 |
|---|---|---|
| `review` | `deepseek-v4-pro` / `qwen3.8-max` | hard_reasoning → knowledge |
| `challenge` | `deepseek-v4-pro` / `qwen3.8-max` | hard_reasoning → knowledge |
| `recompute` | `deepseek-flash` / `qwen3.8-max` | algo → code_agent |
| `latex` | `deepseek-v4-pro` / `qwen3.8-max` | knowledge → instruction |

> 由 `model_roster.json` 推导(roster@2026-09-28,复核期限 2026-10-31)。改档位请走 `MODEL_UPGRADE.md` 的流程,不要直接编辑本表。
<!-- ROSTER:mode-tiers:end -->

- **任意 mode + 含图 → `deepseek-flash`**:这是硬约束(仅 Flash 有原生视觉 ViT),不参与维度推导
- **咨询(`qwen_ask`)不按 mode 分档**:它恒用该厂商的 textModel(DeepSeek 侧即 `deepseek-v4-pro`);上表只对 `qwen_review` 的四个 mode 生效

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

# PPT 排版检查的取图步:pptx → 每页 PNG(配合 scenarios/ppt.md;不需要 LibreOffice/poppler)
python <skill>/scripts/slides_to_png.py <pptx> [输出目录] [--scale 2.0]

# 模型迭代通道:体检 / 生成配置 / 同步文档(仅模型升级时用,不耗 token;--probe 除外)
node <skill>/scripts/model_audit.mjs [--render | --apply | --sync-docs [--write] | --probe]
```

- **`--context` 很关键**:不给则按通用标准评审;给了就按该领域的规范判。
  **2026-09-29 起缺省会自动推断**(`inferDomain`,纯文件 I/O:扩展名 → 语言/领域关注点,
  外加项目 `CLAUDE.md`/`README.md` 的首个标题当背景)。推断结果打印在 **stderr**,
  形如 `🧭 未给 --context,自动推断领域: …(用 --context 覆盖)`;显式给了 `--context` 一律以显式为准。
  这一步只把"什么都不给"从"按通用标准判"提到"至少按该语言规范判",**不替代**认真写 `--context`。
  例:`--context "Rust 异步运行时,关注 Send/Sync 边界与取消安全"`、
  `--context "机器学习论文,关注消融实验是否充分"`、
  `--context "数学建模竞赛论文,关注模型创新性与摘要扣题"`
- 评审输出第一行为「总体结论:…」(提示词约定,**非代码强制**——解析时留个容错),据此判定:【高】级问题必须修复后才进下一阶段
- **`latex` mode 是编译的补充,不是替代**:确定性语法错误交给 `xelatex` 实际编译(编译器零幻觉),
  模型只判编译器抓不到的**数学正确性与符号一致性**。两者都做,别只做模型检查
- **评审报告要自己落盘**:每次评审后用 Write 把报告写到 `results/reviews/<名字>.md`,`qwen_vision` 的重要结论写到 `results/fig_notes/<名字>.md`
  —— 这是**协议要求**(脚本不会自动写),目录不存在时先建;采用该协议的项目建议把 `results/` 写进 `.gitignore`
- 所有脚本自动从 CC Switch 数据库读对应厂商的 key(与 CC Switch 同步);`QWEN_API_KEY`/`QWEN_MODEL`/`DEEPSEEK_API_KEY`/`DEEPSEEK_MODEL` 可覆盖

## 降级与错误处理(必须遵守)

1. 脚本报错 → 重试 1 次 → 仍失败:改用代码输出/数据交叉核对,并明确告知用户"本次视觉/评审未执行"
2. **视觉故障的新退路**:hook 是 fail-open 的,Qwen 挂掉时原 `Read` 会被放行。
   **实测:`deepseek-flash`(V4.1-Flash)已有原生视觉**——能读折线图异常点、能把排版公式准确转成 LaTeX。
   放行后主模型确实读得了图,这条路比"放弃视觉"强得多。
   (注意 `deepseek-v4-pro` 是**纯文本**档,只有 `flash` 能看图。)
   需要主动使用原生视觉时,直接 `Read` 并说明"本次不走 Qwen"即可,不要绕脚本。
   **fail-open 不再静默**(2026-09-29 起):放行时 hook 会用 `hookSpecificOutput.additionalContext`
   把"本次读图未走 Qwen,请在回复中说明"送进模型上下文 —— 在此之前主模型根本不知道发生过 fail-open,
   所以"在回复里说明"这条协议从来没真正执行过。若驱动档是纯文本档,hook 会改口明说
   "本次视觉未执行,不要假装看到了图"。日志仍记 `FALLBACK`,并加 `driverVisionCapable` 字段标明当次判断。
3. 图片结论与代码输出矛盾时,以代码实际输出为准,让 Qwen 再确认一次
4. 绝不因为外挂故障停止主线推理;绝不编造"Qwen 说…"的内容——没跑成功的调用,结果不存在

## 初始化(init)

**默认轻量:什么都不用做。** 脚本自动从 CC Switch 读 key,不需要在项目里装任何东西;
图片按协议存文件后提路径即可。

**可选:项目级协议**(某项目要长期用双模型时)
1. 拷贝 `templates/CLAUDE.md` 为项目根 `CLAUDE.md`
2. 可选:把 `templates/hooks.settings.json` 合并进项目 `.claude/settings.json`
   (或合并进**全局** `~/.claude/settings.json`,那样所有项目都生效;**本机已经全局装好**)
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

## 成本与轮次(决定"值不值得开 Qwen 会话")

| | Qwen3.8-Max | DeepSeek V4.1-Flash |
|---|---|---|
| 输出价 | $6 / M | $0.60 / M(**1/10**) |
| 输入价 | $2 / M | $0.15 / M(离峰) |
| 每任务成本(AA 实测) | ~$1.14 | ~$0.27 |
| 每任务轮次(AA 实测) | ~64 轮(上代 14 轮) | — |

Artificial Analysis 实测 Qwen3.8-Max 每任务约 **64 轮 vs 上代 14 轮**、输入 token 涨约 15 倍,每任务成本 $0.53 → $1.14。

→ **长程 agent 任务不要放进 Qwen 会话**:输出价差 10 倍 × 轮次膨胀,长会话账单会很可观。
→ Qwen 会话留给**短程高价值视觉任务**(精读、复核、扫描件)—— 这也是"只在两种情况开 Qwen 会话"那条限定成立的量化理由。

## 已知风险:Qwen 的幻觉率

Artificial Analysis 的 AA-Omniscience 实测:Qwen3.8-Max 幻觉率 **23% → 40%**(上代 3.7-Max 为 23%),
"回答不知道"的次数近乎腰斩。**跑分涨了 ≠ 审得准了**——这两件事是同一枚硬币的两面(更长的推理链 = 更多机会自信地答错)。

**适用边界**(分析师给的判据,直接决定我们用不用它):

| 任务类型 | 风险 | 我们的处置 |
|---|---|---|
| 代码 / agent(错误会"响亮地失败") | 基本不可见 | 放心用 Qwen 审 |
| 检索 / 摘要 / **数值复算**(流畅的错误答案不被察觉) | **高** | `recompute`/`review` 提示词已加硬约束:必须逐式给出核算过程 + 原文位置引用,**无过程支撑一律判「无法验证」** |

## 用户习惯提示

- 图片一律**存文件后提路径**(按协议统一走 Qwen 视觉,口径一致)
- CC Switch 切换只影响新开的会话;双开 Qwen 会话与主会话并存互不影响
- 本机 `TEMP=D:\Temp`(即 Git Bash 的 `/tmp`)

---

# 附录:数学建模竞赛(CUMCM / MCM / 电工杯)

**阶段映射与挂载点已移入任务剧本:`scenarios/contest.md`**(权威副本——含每个阶段的可复制命令、stage 9 的关键挂载点、AI 声明核对)。

- 竞赛项目的项目级协议 + bridge 双开信箱:`templates/CLAUDE.competition.md`
- 合规细节:`mathmodel-skill/references/2026_ai_regulation.md`
- 一句话:**别用 `qwen_ask --context`**(该参数不存在);AI 声明必须与实际用过的模型一致
