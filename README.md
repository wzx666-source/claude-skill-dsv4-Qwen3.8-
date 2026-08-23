# qwen-dual-model — DeepSeek 主线 + Qwen 视觉/评审双模型联动 Skill

> 给 Claude Code 会话装一个"视觉外挂"和一个"独立评审员":主模型跑 DeepSeek(无视觉、1M 上下文、推理/代码主力),Qwen(百炼 qwen3.8-max)通过脚本补上**读图**和**独立评审**两块短板。
> 主链路零改动、无代理、无常驻进程 —— 外挂挂了只影响"读图/评审"这一件事,主线推理不受任何影响。

## 为什么需要它

DeepSeek 系列模型没有视觉能力,而数学建模竞赛(国赛/美赛/电工杯)的题目图、数据图、手写公式、论文插图都需要"看图";同时单一模型自审存在同源盲区。本 skill 在**工具层**实现双模型联动:

```
DeepSeek 会话(主线)
   ├─ 遇到图片 → qwen_vision / pdf_read → Qwen 读图 → 文字回灌,继续推理
   ├─ 产物完成 → qwen_review → Qwen 独立评审(不同厂商,真第二意见)
   └─ 需要意见 → qwen_ask → Qwen 头脑风暴
```

## 功能总览

| 脚本 | 能力 | 一句话用法 |
|---|---|---|
| `qwen_vision.mjs` | 读图/手写公式转 LaTeX/数据图检查 | `node scripts/qwen_vision.mjs <图片...> "<问题>"` |
| `pdf_read.mjs` | PDF 文字提取 + 含图页自动视觉 | `node scripts/pdf_read.mjs <pdf>` |
| `qwen_review.mjs` | 独立评审:review / challenge / recompute / latex | `node scripts/qwen_review.mjs review <文件...>` |
| `qwen_ask.mjs` | 自由咨询/头脑风暴/第二意见 | `node scripts/qwen_ask.mjs "<问题>" [--file 附件]` |
| `qwen_read_hook.mjs` | Read 工具自动路由(图片→Qwen,PDF→拦截提示) | 项目 `.claude/settings.json` 挂 PreToolUse hook |
| `self_test.mjs` | 全链路自检(7 项) | `node scripts/self_test.mjs` |

## 环境要求

- **Claude Code**(任意版本,支持 hooks)
- **Node.js ≥ 22.5**(内置 `fetch` 与 `node:sqlite`,零 npm 依赖)
- **CC Switch**(GUI 管理 provider;脚本自动从它的数据库读百炼 API key,与 CC Switch 配置保持同步,key 不落盘、不进仓库)
- **百炼(Bailian)API key**:开通 qwen3.8-max(实测支持视觉;如你的模型不支持图,可在 CC Switch 里换成 VL 系列并设置 `QWEN_MODEL`)
- Python + `pdfplumber` + `pypdfium2`(仅 PDF 功能需要:`pip install pdfplumber pypdfium2`)

## 安装

```bash
# 克隆到 Claude Code 的 skills 目录
git clone https://github.com/wzx666-source/claude-skill-dsv4-Qwen3.8-.git ~/.claude/skills/qwen-dual-model

# 跑自检(全部 ✅ 即可用)
node ~/.claude/skills/qwen-dual-model/scripts/self_test.mjs
```

> ⚠️ **路径适配**:本仓库模板中的绝对路径基于作者机器(`C:/Users/王子轩`)。安装到别处后,请把 `templates/CLAUDE.md` 与 `templates/hooks.settings.json` 里的用户名路径改成你自己的;不想依赖 CC Switch 数据库结构的话,也可以直接 `export QWEN_API_KEY=你的百炼key`,脚本优先读环境变量。

## 快速开始(3 分钟)

```bash
# 1. 自检
node scripts/self_test.mjs

# 2. 看图
node scripts/qwen_vision.mjs 题目图.png "详细描述图中的数据和要求"

# 3. 审一份推导
node scripts/qwen_review.mjs review 推导.md

# 4. 读一份带图的 PDF(文字自动提取到同名 .txt,含图页自动视觉)
node scripts/pdf_read.mjs 题目.pdf
```

## 脚本详解

### qwen_vision.mjs — 视觉外挂

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
node scripts/qwen_review.mjs <mode> <文件...> [--focus "关注点"]
```

| mode | 用途 | 时机 |
|---|---|---|
| `review` | 同行评审:逻辑/数值/符号/表达,分级报告 | 每个子问题推导、每节论文完成后 |
| `challenge` | 对抗评审:假设结论错误,全力找反例 | 模型选型、关键结论定稿前 |
| `recompute` | 独立复算:对照数据/公式核验关键数值 | 每个关键数值结果(数值铁律) |
| `latex` | LaTeX 语法/公式正确性/符号一致性 | 转 LaTeX 后、终稿编译前 |

输出首行固定为「总体结论:通过 | 需修改 | 有硬伤」;问题按【高/中/低】分级,【高】必须修复后才进下一阶段。

### qwen_ask.mjs — 自由咨询

```bash
node scripts/qwen_ask.mjs "从评审角度,这道题选 A 还是 B 更有获奖潜力?" --file 题A.md 题B.md
```

### qwen_read_hook.mjs — Read 工具自动路由(可选)

把 `templates/hooks.settings.json` 合并进项目的 `.claude/settings.json` 后:

- Read **图片** → 自动调 Qwen 读图,结果直接注入会话上下文(物理上保证图片永远进 Qwen)
- Read **PDF** → 拦截并提示三条正确路径(pdf_read / Qwen 会话 / pdftotext)
- 其他文件 → 放行

**fail-open 设计**:Qwen API 故障时自动放行原 Read,绝不卡住主会话。

## 数学建模竞赛工作流(配合 mathmodel-skill)

| 阶段 | 双模型用法 |
|---|---|
| 1 选题 | `qwen_ask` 每题问"获奖潜力与难点";含图题先 `qwen_vision` |
| 2 问题解析 | 题目 PDF 用 `pdf_read`(文字给主线,含图页自动视觉) |
| 3 模型选型 | 每个候选定稿前 `qwen_review.mjs challenge` |
| 5 子问题求解 | 推导+代码后 `review`;关键数值 `recompute`;画图后 `qwen_vision` 检查 |
| 6 灵敏度 | 曲线图 `qwen_vision` 查单调性/断点,结论 `review` |
| 8 论文写作 | 每节 `review`;转 LaTeX 后 `latex`;插图生成后 `qwen_vision` 配图注 |
| 9 终稿 | 摘要双通道:`challenge` 审文字 + `qwen_vision` 审插图排版 |

**降级规则**:脚本报错 → 重试 1 次 → 仍失败改用代码输出交叉核对,如实告知;绝不编造"Qwen 说…";外挂故障不阻塞主线。

**用户习惯**:图片存文件提路径,不粘贴到会话(粘贴的图直接发给无视觉主模型会失败);PDF 不直接 Read。

## 测试

- 自动自检:`node scripts/self_test.mjs`(7 项:环境/key/文本/视觉/hook 格式)
- 完整测试方案:`TESTPLAN.md`(35+ 项,含素材一键生成 `scripts/make_test_materials.py`)
- 实测记录:所有功能均通过端到端验证(视觉精确识别异常点位置与幅度、recompute 独立抓出错误数值、latex 模式抓出全部语法错误)

## 故障排查

| 现象 | 处理 |
|---|---|
| `API key 无效或过期` | 到 CC Switch 检查百炼 provider 的 key |
| `百炼限流(429)` | 稍后重试;脚本已内置自动重试 2 次 |
| `模型不可用` | 检查模型名(默认 qwen3.8-max);确认百炼已开通;或 `QWEN_MODEL` 指定 VL 模型 |
| `图片过大` | 单图限 8MB,压缩后再传 |
| 视觉调用偶发超时 | 已内置 240s 超时与重试;仍失败按降级规则处理 |
| hook 不生效 | 确认 hook 配置在**项目** `.claude/settings.json`;新开会话生效;看 `~/.claude/hooks-logs/` 当天日志 |
| 找不到 CC Switch 数据库 | 脚本自动读 `~/.cc-switch/cc-switch.db`;或直接 `QWEN_API_KEY` 环境变量绕过 |

## 安全说明

- 仓库**不含任何 API key**:脚本运行时从 CC Switch 数据库读取,或用 `QWEN_API_KEY` 环境变量注入
- 视觉/评审数据只发送到阿里云百炼(dashscope.aliyuncs.com),请自行确认合规
- 主模型会话的 API 流量直连 DeepSeek,不经任何中间代理

## License

MIT
