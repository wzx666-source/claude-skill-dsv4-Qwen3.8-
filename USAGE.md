# 使用教程

面向日常使用。安装见 [README](README.md)。

约定:`$S` = skill 的 scripts 目录。

```bash
S=~/.claude/skills/qwen-dual-model/scripts      # Windows: /c/Users/<你>/.claude/skills/qwen-dual-model/scripts
```

---

## 一、90% 的情况:按剧本走,不用记命令

**四份任务剧本**(作业 / PPT / 竞赛 / 科研)在 [`scenarios/`](scenarios/),每份都有「开口就说」——你直接说话就行。
如果你还把路由规则放进了全局 `~/.claude/CLAUDE.md`(见 [§七](#七把路由规则放进全局-claudemd)),
开新会话时 Claude 会自己按规则走。

**剩下那 10%** 是自动路由够不着的地方(§三 的 7 种),那时才需要你手动调用。

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

## 三、自动路由的边界:这 7 种情况必须手动调用

自动路由只有两条路:**hook 硬拦截**(只拦 `Read` 工具)和 **Claude 按协议主动调**(软约束)。
两条都够不着的地方,就得你自己动手。按"最容易踩"排序:

### 1. 图片是粘贴/拖进会话的 → 存文件后提路径

hook 只挂在 `Read` 工具上 —— `qwen_read_hook.mjs` 开头就判断 `tool_name !== 'Read'` 则直接放行。
**粘贴的图不经过工具调用**,直奔主模型,完全绕过 Qwen 视觉。

```bash
# ✗ 直接把图粘进对话框
# ✓ 存成文件,然后提路径:
node $S/qwen_vision.mjs 截图.png "这个报错是什么"
```

> 后果取决于**主模型那档有没有原生视觉**(见 `model_roster.json` 各模型的 `vision` 字段):
> 没有 → 粘贴的图根本读不了;有 → 读得了,但绕过了"读图统一走 Qwen"的口径,
> 竞赛场景会牵连 AI 使用声明的一致性(见 README 文末附录)。

### 2. hook 没装的项目 → 手动装,或手动调

`templates/hooks.settings.json` 是**项目级**配置。新项目、别人 clone 下来的仓库,**默认没有**。

```bash
# 全局生效(所有项目):把这段合并进 ~/.claude/settings.json 的 hooks.PreToolUse
# 单项目生效:合并进 <项目>/.claude/settings.json
```

没装时**不报错、不提示,只是静默不路由** —— 这是最容易"以为它在自动跑、其实压根没跑"的一种。

> 装全局前想清楚:那意味着**所有项目**的 `Read` 图片都会转给 Qwen,包括跟本 skill 无关的仓库。
> 好处是不用每个项目配一遍;代价是依赖你的 CC Switch 里始终有可用的百炼 key
> (key 没了会 fail-open 放行并记 `FALLBACK` 日志,不会卡住主线)。

### 3. PDF → 必须手动跑 `pdf_read.mjs`

hook 对 PDF 的动作是 **deny + 打印三条替代路径**,它没法替你把 PDF 转成图。

```bash
node $S/pdf_read.mjs 论文.pdf --pages 1-8 "重点看第 3 节的收敛性图"
```

依赖分两块,**可以分别缺**:

- **文字提取**:`pdftotext`(poppler)优先,没有则退化到 Python 的 `pdfplumber`(`pip install pdfplumber`);
  两条都没有 → 报"文字提取失败,可能是扫描件"
- **图页渲染**:需要 `pypdfium2`(`pip install pypdfium2`),缺它则该页转 PNG 失败并打印提示

两条路都断了,就只能开 Qwen 会话直接读整个 PDF。

### 4. 在 Qwen 会话里 → hook 整体让行,但评审仍要手动

驱动方是百炼时,hook **一律放行**(避免"Qwen 读图还得再调一次 Qwen"这个绕圈)。
所以 Qwen 会话里读图就是直接 `Read` —— **这是设计如此,不是故障**。

但要在 Qwen 会话里拿第二意见,还是得手动敲,只是评审方会自动翻到 DeepSeek:

```bash
node $S/qwen_review.mjs review src/cache.py   # 本次由 DeepSeek 评审
```

### 5. 要指定 mode / `--focus` / `--context` → 只能手敲

自然语言触发走的是默认判据;这三个参数**没有自然语言入口**。
而 `--context` 恰恰是最值得用好的一个参数(见 §五),所以真要把本 skill 用好,手敲是躲不掉的。

### 6. 开 Qwen 会话 → 纯手动,且无法省

CC Switch 切「百炼」+ 新开终端。这是唯一"改主会话模型"的操作,也**没法自动化** ——
CC Switch 的切换只影响新开会话。什么时候该开,见 §八。

### 7. 撞到脚本上限 / 要覆盖环境变量 → 手动处理

| 上限 | 值 | 撞上之后 |
|---|---|---|
| 单次图片数 | **6 张** | 分批调用 |
| 单图大小 | **8MB** | 压缩后再传 |
| 文本附件 | **200KB** | 自动截断并在末尾标注,需人工确认截断处没丢关键内容 |

环境变量只能手动设:

| 变量 | 用途 |
|---|---|
| `QWEN_MODEL` / `DEEPSEEK_MODEL` | 临时换档位(不改配置文件) |
| `DRIVER_PROVIDER=bailian\|deepseek` | 强制翻转方向(测试用) |
| `QWEN_API_KEY` / `DEEPSEEK_API_KEY` | 绕过 CC Switch 直接给 key |

### 附:fail-open 不再静默(2026-09-29 起)

Qwen API 挂掉时,hook 仍会**放行原 `Read`**(fail-open 语义不变,绝不卡住主会话),
但**不再悄悄放行**:

- 模型侧:hook 用 `hookSpecificOutput.additionalContext` 注入一条说明,主模型因此知道
  "本次读图未走 Qwen",可以在回复里讲清楚 —— 在此之前它根本不知道,所以协议里
  "在回复中说明本次未走 Qwen"那条要求从来没真正生效过
- 用户侧:同一条说明也打到 stderr
- **纯文本档会改口**:若当前驱动档是 `deepseek-v4-pro`(无原生视觉),放行原生 Read 是死路,
  此时注入的是"本次视觉未执行,不要假装看到了图",而不是"已放行原生 Read"

排查仍可看当天日志:

```bash
cat ~/.claude/hooks-logs/$(date +%F).jsonl
```

| `level` | 含义 |
|---|---|
| `ROUTED` | 正常走了 Qwen(`kind` 区分 `image` / `pdf`) |
| `PASSTHROUGH` | 驱动方是 Qwen,按设计让行 |
| `FALLBACK` | **Qwen 挂了**,放行了原生 Read —— 要留意的是这种(附 `driverVisionCapable` 字段标明当时驱动档能不能读图) |

---

## 四、四个 mode 怎么选

`qwen_review.mjs` 的四个模式,一句话判据:

| mode | 什么时候用 |
|---|---|
| `review` | 常规过一遍:有硬伤吗 |
| `challenge` | **你对结论没底**,想让人来拆台 |
| `recompute` | **有数值**,且你不完全信任自己算的 |
| `latex` | LaTeX 语法 / 公式正确性 / 符号一致性 |

输出首行固定为「总体结论:…」,问题按【高/中/低】分级——**【高】必须修复后才进下一阶段**。

**四个 mode 都有反幻觉硬约束**(2026-09-29 起补齐:`challenge` 和 `latex` 原先一条都没有)。
共性要求是:**每条判断必须能指到材料中的具体位置,指不到就降级或标「无法定位」;只基于材料本身,不脑补**。
另外各有专属约束 —— `challenge` 不许为凑够三条而编造质疑,反例给不出构造过程就要明说"未能构造出反例";
`latex` 判"符号不一致"必须给出冲突的两处出处,且不许凭记忆断言某条命令不存在(不确定就标"需实际编译验证")。
理由:`challenge` 是自由对抗模式,"全力推翻"这个指令本身就是幻觉的温床;而约束缺失的位置恰好是风险最高的位置。

**闭环规则**:修完【高】级问题后,把修改后的产物**再送一轮** review,直到没有【高】级问题为止。自己修自己验收不算数。

---

## 五、`--context` 的心法

一句话说清"**这是什么领域、该关注什么**",判据就会贴上去。

**2026-09-29 起:不给也会自动推断**(纯文件 I/O,不联网不调模型)。推断输入有两块 ——
待评审文件的扩展名(`.py`→Python 及该关注什么、`.tex`→LaTeX 排版坑、`.sql`→注入/索引失效…),
以及项目根 `CLAUDE.md`/`README.md` 的首个标题当项目背景。结果打印在 **stderr**:

```
🧭 未给 --context,自动推断领域: Python 代码,关注类型与边界条件…；项目背景: …(用 --context 覆盖)
```

推断不出时会明说"按通用标准评审",不假装有领域。**但这只是把"什么都不给"从"按通用标准判"
提到"至少按该语言规范判"—— 它不替代你认真写 `--context`**,后者仍是本 skill 最值得用好的参数。

```bash
--context "Rust 异步运行时,关注 Send/Sync 边界与取消安全"
--context "机器学习论文,关注消融实验是否充分"
--context "金融风控模型,关注特征穿越与样本不均衡"
--context "Python 并发编程,关注竞态条件、线程安全与 API 设计"
--context "数学建模竞赛论文,关注模型合理性、创新性、灵敏度分析与摘要扣题"
```

这是本 skill 最值得用好的一个参数:**同一个 mode,换个 context 就是另一个领域的评审员。**

---

## 六、评审角色翻转(不用管,但要理解)

**评审方 = 非驱动方的那个厂商**,脚本自动判定,你不需要指定:

<!-- ROSTER:mode-tiers:begin -->
| 你的会话跑在 | 评审/咨询方 | 用的档 |
|---|---|---|
| DeepSeek | Qwen(百炼) | `qwen3.8-max`(4 个 mode 同一档) |
| Qwen(百炼) | DeepSeek | `review`/`challenge`/`latex` → `deepseek-v4-pro`;`recompute` → `deepseek-flash` |
<!-- ROSTER:mode-tiers:end -->

档位不手挑,由 `model_roster.json` 的跑分推导(每个 mode 取主维度分数最高者),所以**它会随模型升级自动变**——
具体当前值看 `SKILL.md`「档位依据」的表,那是从 roster 生成的。升级后怎么重分档见 [`MODEL_UPGRADE.md`](MODEL_UPGRADE.md)。

**含图是硬约束**:一律落该厂商有原生视觉的那一档,不参与维度推导 —— 它与上表的「按 mode 分档」并列生效,两者不冲突。

**咨询(`qwen_ask`)不按 mode 分档**:它恒用该厂商的 textModel(DeepSeek 侧即 `deepseek-v4-pro`);上表的分档只对 `qwen_review` 的四个 mode 生效。

**为什么重要**:如果你双开了 Qwen 会话,原来的 `qwen_review` 等于让 Qwen 审自己写的东西——"独立评审"名存实亡。翻转后,无论哪边当主模型,拿到的都是**真第二意见**。

评审方会打印在 **stderr**,`stdout` 首行仍是「总体结论:…」,落盘/解析脚本不受影响。

可用 `DRIVER_PROVIDER=bailian|deepseek` 强制覆盖(测试用)。

---

## 七、把路由规则放进全局 `CLAUDE.md`

这一步决定了通用化能否真正生效——因为"开哪种会话"的决定发生在**会话开始时**,那时你还没 cd 进任何项目。

在 `~/.claude/CLAUDE.md` 加入:

```markdown
## 双模型会话路由

- **默认开 DeepSeek 会话。** 只在以下**两种情况**开 Qwen 会话(CC Switch 切百炼 + 新终端):
  ① 核心工作是连续多轮的视觉/PDF 精读;② 开题就知道要连续多轮啃的硬骨头。
  (纯前端长程项目按「什么时候上 Claude」的判据**切 Claude**,不开 Qwen 会话。)
- **中途遇到难题不要切会话**(会丢掉已建立的全部上下文)。改用 `qwen_ask` 会诊 /
  `qwen_review challenge` 对抗——**两个模型都要,比切过去只用一个更强**。
- **评审/咨询按 mode 分档**:具体档位由 skill 内的 `model_roster.json` 推导;含图一律落 `deepseek-flash`。
  **要改档位走 `MODEL_UPGRADE.md` 的流程,别手改。**
- 误判触发器:同一 bug 修 2 轮不过 / 算法题卡 20 分钟 / 读了 3 个文件还没定位 → 送 `qwen_ask` 会诊。
- **读图 / 读 PDF 一律走 Qwen**(`qwen_vision.mjs` / `pdf_read.mjs`),不要直接 Read 图片文件;
  图片存文件后提路径,不要粘贴。
- **做作业 / PPT / 竞赛 / 科研时**,按 skill 内 `scenarios/` 的对应剧本走(每份都有「开口就说」)。
```

---

## 八、场景速查表

**已移入任务剧本** —— 按你在做的事读对应那份(每份都带可复制命令、坑清单、完成判据):

| 你在做 | 剧本 |
|---|---|
| 日常作业(题目照片/手写推导/数值答案/代码作业) | [`scenarios/homework.md`](scenarios/homework.md) |
| PPT(课程汇报/答辩) | [`scenarios/ppt.md`](scenarios/ppt.md) |
| 数学建模竞赛(CUMCM/MCM/电工杯) | [`scenarios/contest.md`](scenarios/contest.md) |
| 科研(文献/实验/论文) | [`scenarios/research.md`](scenarios/research.md) |

「开哪种会话」的通用规则(不限于这四类任务)在 `SKILL.md`「会话路由规则」与 `README.md`「核心机制」。
判据不是"任务难不难",而是两条:**要不要长时间反复看像素**、**是不是开题就知道要连续多轮啃**。

### 这张表之外:什么时候该上 Claude

本 skill 只管 DeepSeek + Qwen 两家。第三家(Claude 全家桶)走 CC Switch 的另一个 provider,
**纯手动切换,不做自动路由**。判据一句话:**双模型买的是「多样性」,Claude 买的是「天花板」。**

完整判据表与"切过去用哪档"见全局 `~/.claude/CLAUDE.md` 的「什么时候上 Claude」一节;
与本 skill 直接相关的三条升级信号见 `SKILL.md` 同名小节(**这里不重复 —— 重复的信息会漂移**)。

---


## 九、和已有评审类 skill 的分工

| 要什么 | 用哪个 |
|---|---|
| 多智能体对抗辩论、要覆盖每个角度 | `agent-review-panel` |
| 学术论文同行评审模拟(EIC + 3 审稿人) | `academic-paper-reviewer` |
| 代码改动的 bug/简化审查(走 diff) | `/code-review` |
| **换个厂商看一眼、几十秒出结果** | **`qwen_review`(本 skill)** |

本 skill 的差异化就两条:**跨厂商**(不同模型家族 → 真第二意见,不是同一模型的自我批评)+ **一次调用**(快、便宜、可脚本化、可嵌进任何流程)。

要深审用上面那些;要"换双眼睛快速过一遍"用这个。两者不冲突,常配合使用。

---

## 十、三个坑

1. **图片不要粘贴到会话** → 存文件后提路径
   (粘贴的图会直接进主模型,绕过 Qwen 视觉口径;协议要求读图统一走 Qwen)
2. **不要为了"随手问一句"开 Qwen 会话** → 单次提问用 `qwen_ask`
3. **PDF 不要直接 Read** → 用 `pdf_read.mjs`(省上下文,且含图页会自动走视觉)

---

## 十一、降级与排错

- 脚本报错 → 重试 1 次 → 仍失败:改用代码输出/数据交叉核对,并**明确告知"本次视觉/评审未执行"**
- **绝不编造"Qwen 说…"** —— 没跑成功的调用,结果不存在
- 外挂故障**不得阻塞主线推理**(这是本方案与代理式路由的本质区别)
- Qwen 视觉挂掉时,hook 会放行原生 `Read`;`deepseek-flash` 有原生视觉,可直接读图(在回复里说明本次未走 Qwen)

排错表见 [README §故障排查](README.md#故障排查)。

---

## 十二、模型升级了怎么办

**日常不用管** —— 档位由 `model_roster.json` 的跑分推导,`SKILL.md` 的表是生成的。

想在自己机器上跟新版跑分/新模型时:

```bash
S=~/.claude/skills/qwen-dual-model/scripts
node $S/model_audit.mjs                        # 体检:看推荐档位变没变、有无漂移
node $S/model_audit.mjs --apply                # 生效(冻结期会被拒绝,--force 越过)
node $S/model_audit.mjs --sync-docs --write    # 同步文档里的档位表
node $S/self_test.mjs                          # 全 ✅ 才算完成
```

- 改跑分和改政策是两件事:`scores` 跟着新数据走(可以快),`policy` 里的"哪个维度更重要"是**职责哲学**(要慢)
- 比赛/deadline 期间建议在 roster 里设 `"freezeUntil"`,防止档位被中途换掉
- 完整纪律(来源置信度、什么时候不该动档位)见 [`MODEL_UPGRADE.md`](MODEL_UPGRADE.md)

---

## 十三、验证它在你手上的手感

最低成本的做法:**下次真遇到问题时随口说一句"评审一下"或"这张图看一下"**。

不用记命令,看它判得对不对。判歪了就改 prompt——`qwen_review.mjs` 顶部的 `MODES` 常量就是全部判据,改起来很快。
