---
name: qwen-dual-model
description: 双模型联动外挂——Qwen 提供视觉(读图/PDF)与独立评审(评审/对抗/复算/LaTeX 检查),弥补 DeepSeek 主模型无视觉的短板。数学建模竞赛(CUMCM/MCM/电工杯)与 mathmodel-skill 配合使用。触发词:看图、读图、识图、识别图片、这张图、检查图、手写公式、双模型、用 Qwen、视觉、独立评审、评审一下、challenge、对抗评审、复算、复核数值、第二意见。
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion
---

# qwen-dual-model — DeepSeek 主线 + Qwen 视觉/评审外挂

主会话模型(DeepSeek)无视觉;Qwen(百炼 qwen3.8-max)通过脚本提供两个外挂能力。**主链路直连不动,外挂失败不影响主线**——这是与代理式路由(如 CCR)的本质区别。

## 分工总表

| 能力 | DeepSeek(主线) | Qwen(外挂) |
|---|---|---|
| 长文本推理/推导/代码 | ✅ 全部 | — |
| 读图(题目图/数据图/手写公式/论文插图) | ❌ 无视觉 | ✅ `qwen_vision.mjs` |
| 读 PDF | ✅ 提取后的文字(`pdf_read.mjs` 自动提取) | ✅ 含图页(`pdf_read.mjs` 自动转 PNG 读图)、扫描件/重视觉 PDF 走 Qwen 会话 Read |
| 独立评审/对抗/复算 | 自审同源有盲区 | ✅ `qwen_review.mjs`(不同厂商,真第二意见) |
| 头脑风暴/第二意见 | — | ✅ `qwen_ask.mjs` |

## 脚本用法(scripts/)

```bash
# 视觉:多图 + 一个问题,图按顺序编号
node <skill>/scripts/qwen_vision.mjs <图片路径...> "<问题>"

# PDF:自动提取文字 + 含图页转 PNG 喂视觉外挂(优先用这个,不用开 Qwen 会话)
node <skill>/scripts/pdf_read.mjs <pdf> [--pages 1-3] [--no-images] [--max-img-pages 4] ["图页检查重点"]

# 评审:四模式,模式含义见 prompts
node <skill>/scripts/qwen_review.mjs review|challenge|recompute|latex <文件...> [--focus "关注点"]

# 自由咨询:头脑风暴/选题讨论/第二意见
node <skill>/scripts/qwen_ask.mjs "<问题>" [--file <附件>...]
```

- 评审输出第一行固定为「总体结论:…」,据此判定:【高】级问题必须修复后才进下一阶段
- 评审报告落盘 `results/reviews/`,重要图的结论落盘 `results/fig_notes/`
- 所有脚本自动从 CC Switch 数据库读百炼 key(与 CC Switch 同步);`QWEN_API_KEY` / `QWEN_MODEL` 环境变量可覆盖

## 与 mathmodel-skill 的阶段映射

| 阶段 | 触发 |
|---|---|
| 1 选题 | `qwen_ask` 每题各问一次"从评审角度看该题的获奖潜力与难点";含图题先 `qwen_vision` 看图 |
| 2 问题解析 | 题目 PDF 用 `pdf_read.mjs`(文字给我读,含图页自动走视觉);扫描件/重视觉 PDF 走 Qwen 会话 Read;图的结论落盘后喂主线 |
| 3 模型选型 | 每个候选定稿前跑 `qwen_review.mjs challenge` |
| 5 每个 Qi | 推导+代码完成后 `review`;每个关键数值 `recompute` 一次;画图后 `qwen_vision` 检查 |
| 6 灵敏度 | 灵敏度曲线图 `qwen_vision` 检查单调性/断点;结论 `review` |
| 8 写作 | 每节写完 `review`;转 LaTeX 后 `latex`;每张插图生成后 `qwen_vision` 配图注 |
| 9 终审 | 摘要双通道:文字 `challenge` + 插图/排版 `qwen_vision`;全文 `latex` |

## 自动路由(hook,可选第二阶段)

`templates/hooks.settings.json` 放进竞赛项目 `.claude/settings.json` 后,`Read` 图片会被 hook 自动替换为 Qwen 读图(结果直接注入上下文),Read PDF 会被拦截并提示正确路径。hook 为 fail-open 设计:Qwen 故障时放行原 Read,绝不卡主会话。

## 降级与错误处理(必须遵守)

1. 脚本报错 → 重试 1 次 → 仍失败:改用代码输出/数据交叉核对,并明确告知用户"本次视觉/评审未执行"
2. 图片结论与代码输出矛盾时,以代码实际输出为准,让 Qwen 再确认一次
3. 绝不因为外挂故障停止主线推理;绝不编造"Qwen 说…"的内容——没跑成功的调用,结果不存在

## 初始化竞赛项目(init)

1. 拷贝 `templates/CLAUDE.md` 为竞赛项目根目录的 `CLAUDE.md`(协议对全部会话生效)
2. 创建桥接目录 `bridge/to_qwen/` 与 `bridge/to_ds/`(双开会话联动的文件信箱)
3. 可选:把 `templates/hooks.settings.json` 合并进项目 `.claude/settings.json`
4. 跑自检:`node <skill>/scripts/self_test.mjs`,全部 ✅ 再开始比赛
5. 提醒用户:图片存文件不粘贴;PDF 优先 pdf_read,特殊情况双开 Qwen 会话

## Qwen 会话提醒规则(主线会话必须遵守)

遇到以下情况,**停下当前任务,按模板提醒用户开 Qwen 会话**(不硬扛):
1. PDF 文字提取失败(扫描件);2. pdf_read 报"图密集 PDF"(含图页 >50% 或 >8 页);
3. 用户粘贴图片到会话;4. 任务需要 Qwen 多轮连续讨论;5. Qwen API 连续失败 ≥2 次。

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

## 用户习惯提示(每次 init 时告知)

- 粘贴/附件图片会直接发给无视觉的主模型而失败 → **图片一律存文件后提路径**
- CC Switch 切换只影响新开的会话;双开 Qwen 会话(精读 PDF、深聊)与主会话并存互不影响
