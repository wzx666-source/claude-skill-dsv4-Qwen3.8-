# 双模型协议(DeepSeek 主线 + Qwen 视觉/评审外挂)

本项目启用双模型协作:主会话跑 **DeepSeek**,Qwen(百炼 qwen3.8-max)提供**视觉**与**独立评审**两个外挂能力。

## 会话路由(开哪种会话)

1. **默认开 DeepSeek 会话。** 例外只有第 2 条。
2. **只在以下三种情况开 Qwen 会话**:① 核心工作是连续多轮的视觉/PDF 精读;② 开题就知道要连续多轮啃的硬骨头;③ 开题即知、连续多轮、以 UI/前端为主的项目(前后端混合不算——仓库级改动是 DeepSeek 强项)。
3. **中途遇到难题 → 不切会话**(切会话会丢掉已建立的上下文)。改用 `qwen_ask` 会诊 / `qwen_review challenge` 对抗——**两个模型都要,比切过去只用一个更强**。
4. **误判触发器**:同一 bug 修 2 轮不过 / 算法题卡 20 分钟 / 读 3 个文件还没定位 → 送 `qwen_ask`;
   Qwen 会话里连续两次评审都是"改个参数就行" → 回 DeepSeek。

## 视觉协议(读图走 Qwen)

```
node C:/Users/王子轩/.claude/skills/qwen-dual-model/scripts/qwen_vision.mjs <图片路径...> "<要检查的问题>"
```

- 一次最多 6 张;问题要具体(异常点?趋势?坐标轴?手写公式转 LaTeX?)
- 重要图片的检查结论写进 `results/fig_notes/<名字>.md` 备查,不要只留在会话里
- **例外**:Qwen 故障时 hook 会放行原生 `Read`——`deepseek-flash` 有原生视觉,此时可直接读图,并在回复里说明"本次未走 Qwen 视觉"

## 评审协议(关键产物经独立评审)

```
node C:/Users/王子轩/.claude/skills/qwen-dual-model/scripts/qwen_review.mjs <mode> <文件...> [--focus "..."] [--context "..."]
```

**评审方自动 = 非驱动方的那个厂商**,无需手动指定:本会话跑 DeepSeek 时评审走 Qwen;双开的 Qwen 会话里评审自动走 DeepSeek。这样"独立评审"始终是真第二意见,不会退化成自己审自己。评审方打印在 stderr,stdout 首行仍是「总体结论:…」。

| mode | 时机 |
|---|---|
| `review` | 一个模块/章节完成后 |
| `challenge` | 架构定稿前、关键结论定稿前 |
| `recompute` | 关键数值结果至少独立复算一次 |
| `latex` | 论文章节转 LaTeX 后、编译前 |

评审档位(评审方为 DeepSeek 时,由 skill 内的 `model_roster.json` 推导,**不要手改**):

<!-- ROSTER:mode-tiers:begin -->
| mode | 评审档位(评审方为 DeepSeek 时) |
|---|---|
| `review` | `deepseek-v4-pro` |
| `challenge` | `deepseek-v4-pro` |
| `recompute` | `deepseek-flash` |
| `latex` | `deepseek-v4-pro` |
<!-- ROSTER:mode-tiers:end -->

- 含图一律落 `deepseek-flash`(仅它有原生视觉);这条是硬约束,不参与推导
- **`recompute`/`review` 的幻觉防护**:评审方必须逐式给出核算过程 + 原文位置引用;无过程支撑一律判「无法验证」,不许给"看起来对"
- **`latex` 是编译的补充不是替代**:语法错误交给 `xelatex` 实际编译(编译器零幻觉),模型只判数学正确性与符号一致性

<!-- ROSTER:roster-stamp:begin -->
> 档位依据:`model_roster.json` @ 2026-09-28(复核期限 2026-10-31)。若此戳早于 skill 内的 roster 版本,说明本项目这份协议已过期,请重新拷贝模板。
<!-- ROSTER:roster-stamp:end -->

- **`--context "<领域背景>"`**:不给按通用标准评审;给了按该领域规范判(如 `--context "Rust 异步运行时,关注 Send/Sync 边界"`)
- 评审报告写进 `results/reviews/`;第一行"总体结论"判定:【高】级问题必须修复后才能进下一阶段
- **闭环规则**:修复【高】级问题后,必须把修改后的产物再送一轮 review,直到无【高】级问题为止
- 头脑风暴/第二意见:`node .../qwen_ask.mjs "<问题>" [--file <附件>...]`(咨询方同样自动翻转)
- 要**多智能体深度对抗**请用 `agent-review-panel`;要**学术论文同行评审模拟**用 `academic-paper-reviewer`。本协议定位是"换个厂商快速看一眼"

## PDF 处理(优先 pdf_read.mjs,不用开 Qwen 会话)

```
node C:/Users/王子轩/.claude/skills/qwen-dual-model/scripts/pdf_read.mjs <pdf路径> [--pages 1-3] ["图页检查重点"]
```

- 自动提取全文文字到 `<pdf同名>.txt`(用 Read 读它),并检测含图页转 PNG 喂 Qwen 视觉
- 只有扫描件(无文字层)或通篇图表的 PDF 才需要开 Qwen 会话(CC Switch 切百炼)Read
- 不要对 PDF 用 Read(会被 hook 拦截)

## 降级规则(出错时)

- Qwen 脚本报错 → 重试 1 次 → 仍失败:用代码输出/数据交叉核对代替,并明确告知"本次视觉/评审未执行"
- Qwen 视觉挂掉时,hook 会放行原生 `Read`;**`deepseek-flash` 有原生视觉**,可直接读图(在回复里说明本次未走 Qwen)
- 任何情况下,**外挂故障不得阻塞主线推理**
