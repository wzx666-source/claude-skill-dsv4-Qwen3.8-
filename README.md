# qwen-dual-model — DeepSeek 主线 + Qwen 视觉/评审双模型联动

> 给你(和 Claude)配一套**双模型协作**:主会话跑 DeepSeek,Qwen(百炼 qwen3.8-max)补上**视觉**(读图/PDF)与**跨厂商独立评审**两块短板。
> 主链路零改动、无代理、无常驻进程 —— 外挂挂了只影响"读图/评审"这一件事,主线推理不受任何影响。

## 我在做什么?(从这里开始)

**先按任务找入口** —— 四份任务剧本在 [`scenarios/`](scenarios/),每份都带可复制的命令:

| 我在做 | 读哪份剧本 | 这份剧本管什么 |
|---|---|---|
| **日常作业**(题目照片 / 手写推导 / 数值答案 / 代码作业) | [`scenarios/homework.md`](scenarios/homework.md) | **作业复核**:题目转录 + 关键数值独立复算 + 卡住时会诊 |
| **PPT**(课程汇报 / 答辩) | [`scenarios/ppt.md`](scenarios/ppt.md) | **答辩 PPT 终稿检查**:讲稿评审 + 逐张排版视觉检查(不做 PPT 本体) |
| **数学建模竞赛**(CUMCM / MCM / 电工杯) | [`scenarios/contest.md`](scenarios/contest.md) | **竞赛插图与数值复核**:10 阶段挂载点 + AI 声明一致性 |
| **科研**(文献 / 实验 / 论文) | [`scenarios/research.md`](scenarios/research.md) | **论文插图复核与终稿评审**:PDF 图页精读 + 插图复核 + 跨厂商终审 |

**不按任务**、只想直接调某个能力:

| 我要 | 开口就说 | 或敲命令 |
|---|---|---|
| 看图 / 手写公式转 LaTeX | 「这张图看一下:…」 | `node $S/qwen_vision.mjs <图...> "<问题>"` |
| 读 PDF(自动提文字 + 图页走视觉) | 「读一下这个 PDF」 | `node $S/pdf_read.mjs <pdf>` |
| 常规评审 | 「评审一下 <文件>」 | `node $S/qwen_review.mjs review <文件...>` |
| 对抗 / 复算 / LaTeX 检查 | 「challenge 一下」/「复算一下」 | 把 `review` 换成 `challenge`/`recompute`/`latex` |
| 第二意见 / 会诊 | 「问一下 Qwen:…」 | `node $S/qwen_ask.mjs "<问题>" [--file 附件]` |

```bash
S=~/.claude/skills/qwen-dual-model/scripts      # Windows: /c/Users/<你>/.claude/skills/qwen-dual-model/scripts
```

> 本文与四份剧本统一用 `$S` 表示 scripts 目录。

## 快速开始(3 分钟)

```bash
# 1. 自检(全 ✅ 即可用)
node $S/self_test.mjs

# 2. 看图
node $S/qwen_vision.mjs 题目图.png "详细描述图中的数据和要求"

# 3. 审一份代码或推导(带领域背景,判据更贴)
node $S/qwen_review.mjs review src/cache.py --context "Python 并发,关注竞态与锁粒度"

# 4. 读一份带图的 PDF(文字自动提取到同名 .txt,含图页自动视觉)
node $S/pdf_read.mjs 题目.pdf
```

## 安装

```bash
# 克隆到 Claude Code 的 skills 目录
git clone https://github.com/wzx666-source/claude-skill-dsv4-Qwen3.8-.git ~/.claude/skills/qwen-dual-model

# 本仓库装【两个】skill:上面那份是 qwen-dual-model,下面把姊妹 skill model-switch 装出来
# (嵌套的 SKILL.md 不会被 Claude Code 识别,必须放到 skills/ 下一级)
cp -r ~/.claude/skills/qwen-dual-model/model-switch ~/.claude/skills/

# 跑自检(全部 ✅ 即可用)
node ~/.claude/skills/qwen-dual-model/scripts/self_test.mjs
```

- **路径适配**:本仓库模板中的绝对路径基于作者机器(`C:/Users/王子轩`)。安装到别处后,请把
  `templates/CLAUDE.md`、`templates/CLAUDE.competition.md` 与 `templates/hooks.settings.json` 里的用户名路径改成你自己的。
- **不想依赖 CC Switch 数据库**:直接 `export QWEN_API_KEY=...` / `export DEEPSEEK_API_KEY=...`(脚本优先读环境变量)。
- **hook 装哪**:`templates/hooks.settings.json` 可合并进项目 `.claude/settings.json`(单项目),或**全局** `~/.claude/settings.json`(所有项目生效;**作者机器是全局装的**)。

## 文档地图

| 文件 | 给谁 | 是什么 | 权威 / 副本 |
|---|---|---|---|
| `scenarios/*.md` | 用户 + Claude | 四份任务剧本(按任务组织的入口) | **权威**(任务用法) |
| `SKILL.md` | Claude(自动加载) | 机制参考:分工、路由、脚本用法、降级 | **权威**(机制) |
| `README.md`(本文) | 用户 | 入口 + 文档地图 + 安装 | — |
| [`USAGE.md`](USAGE.md) | 用户 | 命令手册:触发方式、**哪 7 种情况必须手动调用**、四个 mode 怎么选、`--context` 心法 | **权威**(手调细节) |
| [`model-switch/`](model-switch/) | 用户 + Claude | **姊妹 skill**:什么时候离开双模型(切 Claude / 用 GPT)的完整判据 | **权威**(跨厂商判据) |
| `templates/` | 项目 | 拷进项目的协议(通用版 + 竞赛增量) | 副本(带版本戳,过期重拷) |
| `MODEL_UPGRADE.md` | 维护者 | 模型升级后怎么重分档 | **权威** |
| `TESTPLAN.md` | 维护者 | 完整测试方案 | **权威** |
| `model_roster.json` | 维护者 | 跑分事实源(档位推导的唯一输入) | **唯一源头** |
| `scripts/` | — | 全部脚本 | — |

> **档位表只由 `model_roster.json` 推导**(由 `--sync-docs` 写入标记块)。文档里所有档位表都是**生成物,不要手改**;
> 要改档位走 [`MODEL_UPGRADE.md`](MODEL_UPGRADE.md) 的流程。

## 核心机制(简版)

### 1. 视觉固定走 Qwen

读图与 PDF 含图页统一由 Qwen 处理,口径一致、便于配图复核。

> ℹ️ **DeepSeek V4.1-Flash 已有原生视觉** —— 本 skill 让你按协议继续走 Qwen,而不是因为主模型看不见。
> 好处是故障路径变强了:hook 是 fail-open 的,Qwen 挂掉时放行原生 Read,主模型真的读得了图。

### 2. 评审自动翻转

**评审方 = 非驱动方的那个厂商**,脚本自动判定:

<!-- ROSTER:mode-tiers:begin -->
| 你的会话跑在 | 评审/咨询方 | 用的档 |
|---|---|---|
| DeepSeek | Qwen(百炼) | `qwen3.8-max`(4 个 mode 同一档) |
| Qwen(百炼) | DeepSeek | `review`/`challenge`/`latex` → `deepseek-v4-pro`;`recompute` → `deepseek-flash` |
<!-- ROSTER:mode-tiers:end -->

- 档位不手挑,由 [`model_roster.json`](model_roster.json) 的跑分**推导**(每个 mode 取主维度分数最高者),所以它会随模型升级自动变
- **含图是硬约束**:一律落该厂商有原生视觉的那一档,不参与维度推导
- **咨询(`qwen_ask`)不按 mode 分档**:它恒用该厂商的 textModel(DeepSeek 侧即 `deepseek-v4-pro`)
- 判定依据:CC Switch 的 `settings.json → currentProviderClaude`(数据库 `is_current` 兜底);`DRIVER_PROVIDER` 环境变量可强制覆盖

**为什么重要**:双开 Qwen 会话时,如果评审还走 Qwen,就成了自己审自己,"独立评审"直接失效。翻转后无论哪边当主模型,拿到的都是真第二意见。

### 3. 会话路由

1. **默认开 DeepSeek 会话**
2. 只在**两种情况**开 Qwen 会话(CC Switch 切百炼 + 新终端):① 连续多轮的视觉/PDF 精读 ② 开题即知的硬骨头
3. **中途遇到难题不切会话**(会丢掉全部上下文)→ 用 `qwen_ask` / `qwen_review challenge`
4. 误判触发器:同一 bug 修 2 轮不过 / 算法题卡 20 分钟 / 读 3 个文件没定位 → 送 `qwen_ask` 会诊

> **纯前端长程项目**(组件库 / 设计系统 / SPA)按 skill **`model-switch`** 的判据**切 Claude**,不开 Qwen 会话。
> 建议把这段路由规则放进全局 `CLAUDE.md`(决定发生在会话开始时)——模板见 [USAGE.md §七](USAGE.md#七把路由规则放进全局-claudemd)。

### 4. 和已有评审类 skill 的分工

| 要什么 | 用哪个 |
|---|---|
| 多智能体对抗辩论、覆盖每个角度 | `agent-review-panel` |
| 学术论文同行评审模拟 | `academic-paper-reviewer` |
| 代码改动的 bug/简化审查 | `/code-review` |
| **换个厂商看一眼、几十秒出结果** | **`qwen_review`(本 skill)** |

差异化 = **跨厂商**(真第二意见)+ **一次调用**(快、便宜、可脚本化)。

## 功能总览

| 脚本 | 能力 | 一句话用法 |
|---|---|---|
| `qwen_vision.mjs` | 读图/手写公式转 LaTeX/数据图检查 | `node $S/qwen_vision.mjs <图片...> "<问题>"` |
| `pdf_read.mjs` | PDF 文字提取 + 含图页自动视觉 | `node $S/pdf_read.mjs <pdf>` |
| `qwen_review.mjs` | 独立评审:review / challenge / recompute / latex | `node $S/qwen_review.mjs review <文件...> [--context "..."]` |
| `qwen_ask.mjs` | 第二意见/会诊/头脑风暴 | `node $S/qwen_ask.mjs "<问题>" [--file 附件]` |
| `qwen_read_hook.mjs` | Read 工具自动路由(图片→Qwen;Qwen 会话让行) | 合并 `templates/hooks.settings.json` |
| `model_audit.mjs` | **模型迭代通道**:档位体检/生成/文档同步 | `node $S/model_audit.mjs [--apply\|--sync-docs\|--render\|--probe]` |
| `slides_to_png.py` | pptx → 每页 PNG(PPT 剧本用;绕开缺失的 LibreOffice/poppler) | `python $S/slides_to_png.py <pptx>` |
| `self_test.mjs` | 全链路自检 | `node $S/self_test.mjs` |

参数细节、输入上限(图 6 张/8MB、文本 200KB)、四个 mode 的选择心法 → [USAGE.md](USAGE.md) 与 `SKILL.md`「脚本用法」。

## 环境要求

- **Claude Code**(任意版本,支持 hooks)
- **Node.js ≥ 22.5**(内置 `fetch` 与 `node:sqlite`,零 npm 依赖)
- **CC Switch**(GUI 管理 provider;脚本自动从它的数据库读两家 API key,与 CC Switch 配置保持同步,**key 不落盘、不进仓库**)
- **百炼(Bailian)API key**:开通 qwen3.8-max(实测支持视觉)
- **DeepSeek API key**(仅当你要在 Qwen 会话里用评审翻转时;脚本从 CC Switch 读)
- Python + `pdfplumber` + `pypdfium2`(仅 PDF 功能需要:`pip install pdfplumber pypdfium2`)

## 测试

- 自动自检:`node $S/self_test.mjs`(输出末尾会打印实际跑了几项,全 ✅ 即可)
- 完整测试方案:`TESTPLAN.md`(A–H 共 8 组,含素材一键生成 `scripts/make_test_materials.py`)

## 故障排查

| 现象 | 处理 |
|---|---|
| `API key 无效或过期` | 到 CC Switch 检查对应 provider 的 key(报错会指明是哪家) |
| `百炼限流(429)` | 稍后重试;脚本已内置自动重试 2 次 |
| `模型不可用` | 检查模型名;可用 `QWEN_MODEL` / `DEEPSEEK_MODEL` 覆盖(**只影响脚本进程,不改会话主模型**) |
| 体检报"生成物损坏" | `tiers.generated.json` 被改坏;运行时已静默回落基线,跑 `node $S/model_audit.mjs --apply` 重建 |
| 体检报"档位漂移" | 改了 `model_roster.json` 没 `--apply`;或处于 `freezeUntil` 冻结期(属预期)。跑 `--apply` 或等解冻 |
| 体检报"文档漂移" | 档位变了但文档标记块没同步 → `node $S/model_audit.mjs --sync-docs --write` |
| `图片过大` | 单图限 8MB,压缩后再传 |
| 视觉调用偶发超时 | 单次超时 240s、自动重试 2 次(最坏约 12 分钟;**hook 内收紧为单次 90s 不重试**);仍失败按降级规则处理 |
| 评审方不是预期的那家 | 检查 CC Switch 当前 provider;或 `DRIVER_PROVIDER=bailian\|deepseek` 强制指定 |
| hook 不生效 | 确认 hook 配置(项目 `.claude/settings.json` 或**全局** `~/.claude/settings.json`,本机是全局);新开会话生效;看 `~/.claude/hooks-logs/` 当天日志(该目录也混有其它 hook 的 `BLOCKED` 记录,别误读) |
| 找不到 CC Switch 数据库 | 脚本自动读 `~/.cc-switch/cc-switch.db`;或直接 `QWEN_API_KEY` / `DEEPSEEK_API_KEY` 环境变量绕过 |

## 安全说明

- 仓库**不含任何 API key**:脚本运行时从 CC Switch 数据库读取,或用 `QWEN_API_KEY` / `DEEPSEEK_API_KEY` 环境变量注入
- 视觉/评审数据只发送到阿里云百炼(`dashscope.aliyuncs.com`);Qwen 会话里的评审数据只发送到 DeepSeek(`api.deepseek.com`)。请自行确认合规
- 主模型会话的 API 流量直连 provider,不经任何中间代理

## License

MIT

---

## 附录:数学建模竞赛

竞赛的阶段映射与挂载点已移入任务剧本 **[`scenarios/contest.md`](scenarios/contest.md)**(权威副本);项目级协议(含 bridge 双开信箱)见 [`templates/CLAUDE.competition.md`](templates/CLAUDE.competition.md)。

> ⚠️ **AI 使用声明一致性**:竞赛提交的 AI 声明必须与实际工具集相符。若某次由 DeepSeek 原生视觉读了图
> (hook fail-open 放行,或手动 Read),声明里就不能只写 Qwen。赛前对一遍
> `mathmodel-skill/references/2026_ai_regulation.md`。
