# 双模型协议(DeepSeek 主线 + Qwen 视觉/评审外挂)

本项目的 Claude Code 会话跑在 **DeepSeek(无视觉)** 上,Qwen 通过脚本提供**视觉**与**独立评审**两个外挂能力。所有会话必须遵守以下规则。

## 视觉协议(读图一律走 Qwen,不许用 Read 读图)

```
node C:/Users/王子轩/.claude/skills/qwen-dual-model/scripts/qwen_vision.mjs <图片路径...> "<要检查的问题>"
```

- 一次最多 6 张;问题要具体(断点?异常?趋势?坐标轴?手写公式转 LaTeX?)
- 重要图片的检查结论写进 `results/fig_notes/<名字>.md` 备查,不要只留在会话里
- 数据图检查后如有异常,必须定位到代码并修复

## 评审协议(关键产物必须经 Qwen 独立评审)

```
node C:/Users/王子轩/.claude/skills/qwen-dual-model/scripts/qwen_review.mjs <mode> <文件...> [--focus "..."]
```

| mode | 时机 |
|---|---|
| `review` | 每个子问题推导/求解代码完成后、论文每节写完后 |
| `challenge` | 模型选型定稿前、关键结论定稿前、终稿提交前 |
| `recompute` | 每个关键数值结果至少独立复算一次(数值铁律) |
| `latex` | 论文章节转 LaTeX 后、终稿编译前 |

- 评审报告写进 `results/reviews/`;第一行"总体结论"判定:【高】级问题必须修复后才能进下一阶段
- **闭环规则**:修复【高】级问题后,必须把修改后的产物再送一轮 review,直到无【高】级问题为止(自己修自己验收不算数)
- 评审是协议驱动:子问题/章节产物完成即主动送审,不等待用户口令
- 头脑风暴/第二意见:`node .../qwen_ask.mjs "<问题>" [--file <附件>...]`

## PDF 处理(优先 pdf_read.mjs,不用开 Qwen 会话)

```
node C:/Users/王子轩/.claude/skills/qwen-dual-model/scripts/pdf_read.mjs <pdf路径> [--pages 1-3] ["图页检查重点"]
```

- 自动提取全文文字到 `<pdf同名>.txt`(用 Read 读它),并检测含图页转 PNG 喂 Qwen 视觉
- 只有扫描件(无文字层)或通篇图表的 PDF 才需要开 Qwen 会话(CC Switch 切百炼)Read
- 用户习惯:图片存文件不粘贴;不要对 PDF 用 Read(会被 hook 拦截)

## 桥接目录(与 Qwen 会话联动用)

- `bridge/to_qwen/` — 本会话写给 Qwen 会话的任务说明
- `bridge/to_ds/` — Qwen 会话的结果落盘处
- 需要双开时:把任务写进 `bridge/to_qwen/<任务>.md`,请用户去 Qwen 会话执行;
  Qwen 结果落到 `bridge/to_ds/` 后,本会话直接读它继续,不重复问

## Qwen 会话提醒规则(遇到以下情况,必须停下来提醒用户,不要硬扛)

触发条件:
1. PDF 文字提取失败(扫描件/图片型 PDF)
2. `pdf_read` 输出"图密集 PDF"警告(含图页 >50% 或 >8 页)
3. 用户把图片直接粘贴到会话(会发给无视觉主模型而失败)→ 提醒存成文件提路径
4. 任务需要 Qwen 多轮连续讨论(逐页讨论题目、深度对话、连续追问)
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

## 降级规则(出错时)

- Qwen 脚本报错 → 重试 1 次 → 仍失败:用代码输出/数据交叉核对代替,并明确告知"本次视觉/评审未执行"
- 任何情况下,**外挂故障不得阻塞主线推理**(DeepSeek 主线直连不受影响,这是本方案与代理式路由的本质区别)
