# qwen-dual-model — DeepSeek 主线 + Qwen 视觉/评审双模型联动 Skill

> 给 Claude Code 会话配一套**双模型协作**:主会话跑 DeepSeek,Qwen(百炼 qwen3.8-max)补上**视觉**与**跨厂商独立评审**两块短板。
> 主链路零改动、无代理、无常驻进程 —— 外挂挂了只影响"读图/评审"这一件事,主线推理不受任何影响。

> 📖 **日常怎么用看 [USAGE.md](USAGE.md)**(触发方式、四个 mode 怎么选、`--context` 心法、场景速查表)。本文件讲原理、安装与脚本细节。

## 为什么需要它

单一模型有两个真实短板:

1. **视觉**——主模型可能读不了图,而题目图、数据图、手写公式、论文插图都需"看图"
2. **自审盲区**——同一个模型审自己写的东西,错误的思路会一起被带过去

本 skill 在**工具层**实现双模型联动:

```
DeepSeek 会话(主线)
   ├─ 遇到图片 → qwen_vision / pdf_read → Qwen 读图 → 文字回灌,继续推理
   ├─ 产物完成 → qwen_review → 非驱动方厂商独立评审(不同厂商,真第二意见)
   └─ 需要意见 → qwen_ask → 跨厂商头脑风暴
```

## 核心机制

### 1. 视觉固定走 Qwen

读图与 PDF 含图页统一由 Qwen 处理,口径一致、便于配图复核。

> ℹ️ **DeepSeek V4.1-Flash 已有原生视觉**——本 skill 让你按协议继续走 Qwen,而不是因为主模型看不见。
> 好处是故障路径变强了:hook 是 fail-open 的,Qwen 挂掉时放行原生 Read,主模型真的读得了图。

### 2. 评审自动翻转

**评审方 = 非驱动方的那个厂商**,脚本自动判定:

| 你的会话跑在 | 评审/咨询方 | 用的档 |
|---|---|---|
| DeepSeek | Qwen(百炼) | `qwen3.8-max` |
| Qwen(百炼) | DeepSeek | `deepseek-v4-pro`(纯文本);含图时自动落 `deepseek-flash` |

判定依据:CC Switch 的 `settings.json → currentProviderClaude`(数据库 `is_current` 兜底);`DRIVER_PROVIDER` 环境变量可强制覆盖。

**为什么重要**:双开 Qwen 会话时,如果评审还走 Qwen,就成了自己审自己,"独立评审"直接失效。翻转后无论哪边当主模型,拿到的都是真第二意见。

### 3. 会话路由

1. **默认开 DeepSeek 会话**
2. 只在这两种情况开 Qwen 会话(CC Switch 切百炼 + 新终端):① 连续多轮的视觉/PDF 精读 ② 开题即知的硬骨头
3. **中途遇到难题不切会话**(会丢掉全部上下文)→ 用 `qwen_ask` / `qwen_review challenge`
4. 误判触发器:同一 bug 修 2 轮不过 / 算法题卡 20 分钟 / 读 3 个文件没定位 → 送会诊

> 建议把这段放进全局 `~/.claude/CLAUDE.md` —— "开哪种会话"的决定发生在会话开始时,那时还没 cd 进项目。模板见 [USAGE.md §六](USAGE.md#六把路由规则放进全局claudemd)。

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
| `qwen_vision.mjs` | 读图/手写公式转 LaTeX/数据图检查 | `node scripts/qwen_vision.mjs <图片...> "<问题>"` |
| `pdf_read.mjs` | PDF 文字提取 + 含图页自动视觉 | `node scripts/pdf_read.mjs <pdf>` |
| `qwen_review.mjs` | 独立评审:review / challenge / recompute / latex | `node scripts/qwen_review.mjs review <文件...> [--context "..."]` |
| `qwen_ask.mjs` | 第二意见/会诊/头脑风暴 | `node scripts/qwen_ask.mjs "<问题>" [--file 附件]` |
| `qwen_read_hook.mjs` | Read 工具自动路由(图片→Qwen;Qwen 会话让行) | 项目 `.claude/settings.json` 挂 PreToolUse hook |
| `self_test.mjs` | 全链路自检(20 项) | `node scripts/self_test.mjs` |

## 环境要求

- **Claude Code**(任意版本,支持 hooks)
- **Node.js ≥ 22.5**(内置 `fetch` 与 `node:sqlite`,零 npm 依赖)
- **CC Switch**(GUI 管理 provider;脚本自动从它的数据库读两家 API key,与 CC Switch 配置保持同步,**key 不落盘、不进仓库**)
- **百炼(Bailian)API key**:开通 qwen3.8-max(实测支持视觉)
- **DeepSeek API key**(仅当你要在 Qwen 会话里用评审翻转时;脚本从 CC Switch 读)
- Python + `pdfplumber` + `pypdfium2`(仅 PDF 功能需要:`pip install pdfplumber pypdfium2`)

## 安装

```bash
# 克隆到 Claude Code 的 skills 目录
git clone https://github.com/wzx666-source/claude-skill-dsv4-Qwen3.8-.git ~/.claude/skills/qwen-dual-model

# 跑自检(全部 ✅ 即可用)
node ~/.claude/skills/qwen-dual-model/scripts/self_test.mjs
```

> ⚠️ **路径适配**:本仓库模板中的绝对路径基于作者机器(`C:/Users/王子轩`)。安装到别处后,请把 `templates/CLAUDE.md`、`templates/CLAUDE.competition.md` 与 `templates/hooks.settings.json` 里的用户名路径改成你自己的;不想依赖 CC Switch 数据库结构的话,也可以直接 `export QWEN_API_KEY=...` / `export DEEPSEEK_API_KEY=...`,脚本优先读环境变量。

## 快速开始(3 分钟)

```bash
# 1. 自检
node scripts/self_test.mjs

# 2. 看图
node scripts/qwen_vision.mjs 题目图.png "详细描述图中的数据和要求"

# 3. 审一份代码或推导(带领域背景,判据更贴)
node scripts/qwen_review.mjs review src/cache.py --context "Python 并发,关注竞态与锁粒度"

# 4. 读一份带图的 PDF(文字自动提取到同名 .txt,含图页自动视觉)
node scripts/pdf_read.mjs 题目.pdf
```

## 脚本详解

### qwen_vision.mjs — 视觉

```bash
node scripts/qwen_vision.mjs <图片路径...> "<要检查的问题>"

# 单图检查
node scripts/qwen_vision.mjs figures/fit.png "曲线在 x>5 处是否有断点?"

# 多图对比(最多 6 张,按顺序编号为图1..图N)
node scripts/qwen_vision.mjs a.png b.png "哪张趋势异常?为什么?"

# 手写公式转 LaTeX
node scripts/qwen_vision.mjs photos/note.jpg "把手写推导逐行转成 LaTeX"
```

- 支持 png / jpg / jpeg / webp / bmp / gif / tiff,单图 ≤8MB
- 问题要具体(断点?异常?趋势?坐标轴?),答案质量与问题质量正相关

### pdf_read.mjs — PDF 自动处理

```bash
node scripts/pdf_read.mjs <pdf> [--pages 1-3] [--no-images] [--max-img-pages 4] ["图页检查重点"]
```

流程:`pdftotext` 提取全文文字 → 存 `<pdf同名>.txt`(主模型直接 Read)→ pdfplumber 检测含图页(**矢量图也算**,覆盖题目/论文常见的矢量插图)→ pypdfium2 渲染 PNG → Qwen 逐页读图。

- 扫描件(无文字层)会被检测为整页图片走视觉 OCR;精度要求高时建议开 Qwen 会话直接 Read
- 通篇图表的 PDF 建议 `--max-img-pages 8` 分批,或直接 Qwen 会话读

### qwen_review.mjs — 独立评审(四模式)

```bash
node scripts/qwen_review.mjs <mode> <文件...> [--focus "关注点"] [--context "领域背景"]
```

| mode | 用途 | 时机 |
|---|---|---|
| `review` | 常规评审:逻辑/数值/符号/表达,分级报告 | 一个模块/章节完成后 |
| `challenge` | 对抗评审:假设结论错误,全力找反例 | 架构定稿、关键结论定稿前 |
| `recompute` | 独立复算:自行从头核算,不沿用材料中间步骤 | 关键数值结果 |
| `latex` | LaTeX 语法/公式正确性/符号一致性 | 转 LaTeX 后、编译前 |

- **`--context`** 注入领域背景,让评审按该领域的规范判;不给则按通用标准。这是最值得用好的参数
- 输出首行固定为「总体结论:…」;问题按【高/中/低】分级,【高】必须修复后才进下一阶段
- **闭环规则**:修完【高】级问题后必须复评,直到无【高】级问题
- 评审方打印在 **stderr**,stdout 首行仍是结论 —— 落盘/解析脚本不受影响

### qwen_ask.mjs — 第二意见

```bash
node scripts/qwen_ask.mjs "这个死锁怎么排查" --file worker.py
node scripts/qwen_ask.mjs "架构 A 还是 B?" --file design_a.md design_b.md
```

### qwen_read_hook.mjs — Read 工具自动路由(可选)

把 `templates/hooks.settings.json` 合并进项目的 `.claude/settings.json` 后:

- **DeepSeek 会话**:Read **图片** → 自动调 Qwen 读图,结果直接注入上下文;Read **PDF** → 拦截并提示三条正确路径
- **Qwen 会话**:**整体让行**——Qwen 自己有原生视觉,"扫描件就在 Qwen 会话里直接 Read"这条协议依赖它
- 其他文件 → 放行
- **fail-open 设计**:Qwen API 故障时自动放行原 Read,绝不卡住主会话

## 测试

- 自动自检:`node scripts/self_test.mjs`(**20 项**:环境/两家 key/驱动方识别/**翻转两个方向**/**档位选择**/文本/视觉/hook 两个方向/banner 不污染 stdout)
- 完整测试方案:`TESTPLAN.md`(35+ 项,含素材一键生成 `scripts/make_test_materials.py`)

## 故障排查

| 现象 | 处理 |
|---|---|
| `API key 无效或过期` | 到 CC Switch 检查对应 provider 的 key(报错会指明是哪家) |
| `百炼限流(429)` | 稍后重试;脚本已内置自动重试 2 次 |
| `模型不可用` | 检查模型名;可用 `QWEN_MODEL` / `DEEPSEEK_MODEL` 覆盖 |
| `图片过大` | 单图限 8MB,压缩后再传 |
| 视觉调用偶发超时 | 已内置 240s 超时与重试;仍失败按降级规则处理 |
| 评审方不是预期的那家 | 检查 CC Switch 当前 provider;或 `DRIVER_PROVIDER=bailian\|deepseek` 强制指定 |
| hook 不生效 | 确认 hook 配置在**项目** `.claude/settings.json`;新开会话生效;看 `~/.claude/hooks-logs/` 当天日志 |
| 找不到 CC Switch 数据库 | 脚本自动读 `~/.cc-switch/cc-switch.db`;或直接 `QWEN_API_KEY` / `DEEPSEEK_API_KEY` 环境变量绕过 |

## 安全说明

- 仓库**不含任何 API key**:脚本运行时从 CC Switch 数据库读取,或用 `QWEN_API_KEY` / `DEEPSEEK_API_KEY` 环境变量注入
- 视觉/评审数据只发送到阿里云百炼(`dashscope.aliyuncs.com`);Qwen 会话里的评审数据只发送到 DeepSeek(`api.deepseek.com`)。请自行确认合规
- 主模型会话的 API 流量直连 provider,不经任何中间代理

## License

MIT

---

# 附录:数学建模竞赛工作流(配合 mathmodel-skill)

竞赛专用协议见 [`templates/CLAUDE.competition.md`](templates/CLAUDE.competition.md)(通用协议 + bridge 双开信箱 + 阶段映射 + AI 声明核对)。

| 阶段 | 双模型用法 |
|---|---|
| 1 选题 | `qwen_ask` 每题问"获奖潜力与难点";含图题先 `qwen_vision` |
| 2 问题解析 | 题目 PDF 用 `pdf_read`(文字给主线,含图页自动视觉) |
| 3 模型选型 | 每个候选定稿前 `qwen_review.mjs challenge` |
| 5 子问题求解 | 推导+代码后 `review`;关键数值 `recompute`;画图后 `qwen_vision` 检查 |
| 6 灵敏度 | 曲线图 `qwen_vision` 查单调性/断点,结论 `review` |
| 8 论文写作 | 每节 `review`;转 LaTeX 后 `latex`;插图生成后 `qwen_vision` 配图注 |
| 9 终稿 | 摘要双通道:`challenge` 审文字 + `qwen_vision` 审插图排版 |

评审时建议带领域背景:
`--context "数学建模竞赛论文,关注模型合理性、创新性、灵敏度分析与摘要扣题"`

> ⚠️ **AI 使用声明一致性**:竞赛提交的 AI 声明必须与实际工具集相符。若某次由 DeepSeek 原生视觉读了图
> (hook fail-open 放行,或手动 Read),声明里就不能只写 Qwen。赛前对一遍
> `mathmodel-skill/references/2026_ai_regulation.md`。
