# 使用教程

面向日常使用。安装见 [README](README.md)。

约定:`$S` = skill 的 scripts 目录。

```bash
S=~/.claude/skills/qwen-dual-model/scripts      # Windows: /c/Users/<你>/.claude/skills/qwen-dual-model/scripts
```

---

## 一、90% 的情况:什么都不用做

如果你把本 skill 的路由规则放进了全局 `~/.claude/CLAUDE.md`(见 [§六](#六把路由规则放进全局claudemd)),
那么开新会话时 Claude 会自己按规则走,你不需要记任何命令。

---

## 二、要用双模型时,三种触发方式

### ① 直接说话(最常用)

用自然语言触发,Claude 自己判断该调哪个脚本:

| 你说 | 触发 |
|---|---|
| "**这张图看一下**,曲线有没有断点" | `qwen_vision` |
| "**评审一下** src/cache.py" | `qwen_review review` |
| "**challenge 一下**这个架构方案" | `qwen_review challenge` |
| "**复算一下**这个结果" | `qwen_review recompute` |
| "**问一下 Qwen** 这个死锁怎么排查" | `qwen_ask` |
| "读一下这个 **PDF**" | `pdf_read` |

### ② 自己敲脚本(要精确控制时)

```bash
# ── 看图(最多 6 张,按顺序编号为图1..图N)
node $S/qwen_vision.mjs 图.png "检查坐标轴刻度和异常点"
node $S/qwen_vision.mjs a.png b.png "哪张趋势异常?为什么?"
node $S/qwen_vision.mjs 手写.jpg "把推导逐行转成 LaTeX"

# ── 评审:常规过一遍
node $S/qwen_review.mjs review src/cache.py

# ── 评审 + 领域背景(判据立刻贴上该领域规范)
node $S/qwen_review.mjs review src/cache.py --context "Python 并发,关注竞态与锁粒度"

# ── 对抗:假设你的结论是错的,全力拆台
node $S/qwen_review.mjs challenge design.md

# ── 复算:关键数值独立核算(不沿用你的中间步骤)
node $S/qwen_review.mjs recompute 数据.csv 结论.md

# ── 指定本轮关注点
node $S/qwen_review.mjs review api.py --focus "并发安全" --context "FastAPI 服务"

# ── 会诊:卡住的问题 + 附属文件
node $S/qwen_ask.mjs "这个死锁怎么排查" --file worker.py

# ── 读 PDF:自动提文字 + 含图页转图给 Qwen
node $S/pdf_read.mjs 论文.pdf --pages 1-8 "重点看第 3 节的收敛性图"
```

### ③ hook 自动(可选,装在某项目里)

把 `templates/hooks.settings.json` 合并进项目 `.claude/settings.json` 后:

- 在 **DeepSeek 会话**里 Read 图片 → 自动转 Qwen 读图,结果直接进上下文
- 在 **Qwen 会话**里 → 整体让行(Qwen 自己就有视觉,再拦截只会绕回自己)
- Read PDF → 拦截并提示正确路径
- **fail-open**:Qwen 挂掉时放行原 Read,绝不卡住主会话

不装也完全能用,只是看图要靠你开口或 Claude 主动调脚本。

---

## 三、四个 mode 怎么选

`qwen_review.mjs` 的四个模式,一句话判据:

| mode | 什么时候用 |
|---|---|
| `review` | 常规过一遍:有硬伤吗 |
| `challenge` | **你对结论没底**,想让人来拆台 |
| `recompute` | **有数值**,且你不完全信任自己算的 |
| `latex` | LaTeX 语法 / 公式正确性 / 符号一致性 |

输出首行固定为「总体结论:…」,问题按【高/中/低】分级——**【高】必须修复后才进下一阶段**。

**闭环规则**:修完【高】级问题后,把修改后的产物**再送一轮** review,直到没有【高】级问题为止。自己修自己验收不算数。

---

## 四、`--context` 的心法

一句话说清"**这是什么领域、该关注什么**",判据就会贴上去。不给则按通用标准判。

```bash
--context "Rust 异步运行时,关注 Send/Sync 边界与取消安全"
--context "机器学习论文,关注消融实验是否充分"
--context "金融风控模型,关注特征穿越与样本不均衡"
--context "Python 并发编程,关注竞态条件、线程安全与 API 设计"
--context "数学建模竞赛论文,关注模型合理性、创新性、灵敏度分析与摘要扣题"
```

这是本 skill 最值得用好的一个参数:**同一个 mode,换个 context 就是另一个领域的评审员。**

---

## 五、评审角色翻转(不用管,但要理解)

**评审方 = 非驱动方的那个厂商**,脚本自动判定,你不需要指定:

| 你的会话跑在 | 评审/咨询方 | 用的档 |
|---|---|---|
| DeepSeek | Qwen(百炼) | `qwen3.8-max` |
| Qwen(百炼) | DeepSeek | `deepseek-v4-pro`(纯文本);**含图时自动落 `deepseek-flash`** |

**为什么重要**:如果你双开了 Qwen 会话,原来的 `qwen_review` 等于让 Qwen 审自己写的东西——"独立评审"名存实亡。翻转后,无论哪边当主模型,拿到的都是**真第二意见**。

评审方会打印在 **stderr**,`stdout` 首行仍是「总体结论:…」,落盘/解析脚本不受影响。

可用 `DRIVER_PROVIDER=bailian|deepseek` 强制覆盖(测试用)。

---

## 六、把路由规则放进全局 `CLAUDE.md`

这一步决定了通用化能否真正生效——因为"开哪种会话"的决定发生在**会话开始时**,那时你还没 cd 进任何项目。

在 `~/.claude/CLAUDE.md` 加入:

```markdown
## 双模型会话路由

- **默认开 DeepSeek 会话。** 只在这两种情况开 Qwen 会话(CC Switch 切百炼 + 新终端):
  ① 核心工作是连续多轮的视觉/PDF 精读;② 开题就知道要连续多轮啃的硬骨头。
- **中途遇到难题不要切会话**(会丢掉已建立的全部上下文)。改用 `qwen_ask` 会诊 /
  `qwen_review challenge` 对抗——**两个模型都要,比切过去只用一个更强**。
- 误判触发器:同一 bug 修 2 轮不过 / 算法题卡 20 分钟 / 读了 3 个文件还没定位 → 送 `qwen_ask` 会诊。
- **读图 / 读 PDF 一律走 Qwen**(`qwen_vision.mjs` / `pdf_read.mjs`),不要直接 Read 图片文件;
  图片存文件后提路径,不要粘贴。
```

---

## 七、场景速查表

判据不是"任务难不难",而是两条:**要不要长时间反复看像素**、**是不是开题就知道要连续多轮啃**。

| 大类 | 场景 | 怎么走 | 为什么 |
|---|---|---|---|
| **编程** | 日常作业 / 简单脚本 / 中等及以下算法题 / 单模块开发 / 简单 bug | DeepSeek 会话 | 便宜档足够,秒出 |
| | 全栈架构 / 复杂系统设计 / 课程设计 / 毕设 / 比赛项目 | DeepSeek 会话 + 架构定稿前 `challenge` | 长时间读仓库,切会话＝丢上下文;质量靠 plan 纪律,不靠换模型 |
| | **深层 bug 排查 / 性能优化** | DeepSeek 会话 + `qwen_ask` 会诊 | 走到一半才发现难,切换成本最高;且更依赖 profiling 输出 |
| | 竞赛难题 / 复杂算法推导 | DeepSeek 主推 + `qwen_review challenge` | **两个模型都要,而不是二选一** |
| **科研** | 文献批量泛读 / 综述初稿 / 基础实验复现 / 写作初稿 | DeepSeek 会话 | 文字密集、便宜、迭代快 |
| | 顶会论文精读 / 含扫描件 | **Qwen 会话** | 连续多轮视觉判读 |
| | 实验改进 | DeepSeek 主推 + `challenge` | 改的是代码与数据 |
| | **学术终稿润色** | **同一模型走完** + `qwen_review` | 初稿换模型润色会丢文风,终稿就不再是"你写的" |
| **文档** | PPT 草稿 / 大纲 / 逐字稿 / 日常文档 | DeepSeek 会话 | 文字工作 |
| | 正式项目文档 / 重要报告 | DeepSeek 会话 + `challenge` | 定稿前对抗一次 |
| | 答辩 PPT 终稿 | **Qwen 会话**,或 `qwen_vision` 逐张检 | 要看排版/配图的像素 |
| | 论文插图复核 | `qwen_vision` 逐张 | 独立视觉复核关口 |
| **学习** | 日常答疑 / 习题讲解 / 技术入门 | 直接在本会话说 | 单次提问,不为一道题切整场会话 |
| | 深层原理 / 学习系统路线 / 工程化进阶 | 直接问 + 必要时 `qwen_ask` | 同上,要第二意见时才调脚本 |

---

## 八、和已有评审类 skill 的分工

| 要什么 | 用哪个 |
|---|---|
| 多智能体对抗辩论、要覆盖每个角度 | `agent-review-panel` |
| 学术论文同行评审模拟(EIC + 3 审稿人) | `academic-paper-reviewer` |
| 代码改动的 bug/简化审查(走 diff) | `/code-review` |
| **换个厂商看一眼、几十秒出结果** | **`qwen_review`(本 skill)** |

本 skill 的差异化就两条:**跨厂商**(不同模型家族 → 真第二意见,不是同一模型的自我批评)+ **一次调用**(快、便宜、可脚本化、可嵌进任何流程)。

要深审用上面那些;要"换双眼睛快速过一遍"用这个。两者不冲突,常配合使用。

---

## 九、三个坑

1. **图片不要粘贴到会话** → 存文件后提路径
   (粘贴的图会直接进主模型,绕过 Qwen 视觉口径;协议要求读图统一走 Qwen)
2. **不要为了"随手问一句"开 Qwen 会话** → 单次提问用 `qwen_ask`
3. **PDF 不要直接 Read** → 用 `pdf_read.mjs`(省上下文,且含图页会自动走视觉)

---

## 十、降级与排错

- 脚本报错 → 重试 1 次 → 仍失败:改用代码输出/数据交叉核对,并**明确告知"本次视觉/评审未执行"**
- **绝不编造"Qwen 说…"** —— 没跑成功的调用,结果不存在
- 外挂故障**不得阻塞主线推理**(这是本方案与代理式路由的本质区别)
- Qwen 视觉挂掉时,hook 会放行原生 `Read`;`deepseek-flash` 有原生视觉,可直接读图(在回复里说明本次未走 Qwen)

排错表见 [README §故障排查](README.md#故障排查)。

---

## 十一、验证它在你手上的手感

最低成本的做法:**下次真遇到问题时随口说一句"评审一下"或"这张图看一下"**。

不用记命令,看它判得对不对。判歪了就改 prompt——`qwen_review.mjs` 顶部的 `MODES` 常量就是全部判据,改起来很快。
