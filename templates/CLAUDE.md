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
- 头脑风暴/第二意见:`node .../qwen_ask.mjs "<问题>" [--file <附件>...]`

## PDF 处理(优先 pdf_read.mjs,不用开 Qwen 会话)

```
node C:/Users/王子轩/.claude/skills/qwen-dual-model/scripts/pdf_read.mjs <pdf路径> [--pages 1-3] ["图页检查重点"]
```

- 自动提取全文文字到 `<pdf同名>.txt`(用 Read 读它),并检测含图页转 PNG 喂 Qwen 视觉
- 只有扫描件(无文字层)或通篇图表的 PDF 才需要开 Qwen 会话(CC Switch 切百炼)Read
- 用户习惯:图片存文件不粘贴;不要对 PDF 用 Read(会被 hook 拦截)

## 降级规则(出错时)

- Qwen 脚本报错 → 重试 1 次 → 仍失败:用代码输出/数据交叉核对代替,并明确告知"本次视觉/评审未执行"
- 任何情况下,**外挂故障不得阻塞主线推理**(DeepSeek 主线直连不受影响,这是本方案与代理式路由的本质区别)
