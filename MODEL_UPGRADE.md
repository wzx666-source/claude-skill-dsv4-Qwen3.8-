# 模型迭代通道 —— 跑分更新后怎么重分档

档位不是手挑的,是从 `model_roster.json` **推导**出来的。这份文档是唯一的升级入口。

## 什么时候该走一遍

- 官方或第三方放出新跑分(尤其两家任一新模型发布)
- 新模型上线:`model_roster.json` 里加个条目
- 旧模型下线:从 roster 删条目
- `recheckBy` 到期(当前 **2026-10-31**,`self_test.mjs` 会提醒)

## 五步

```bash
SK=~/.claude/skills/qwen-dual-model/scripts

# 1. 查跑分,手动填进 model_roster.json(见下方"填分纪律")
#    这是唯一的人工步骤 —— 跑分来源分散(官方页/第三方榜/本机实测),
#    自动抓取会引入不可控的外部依赖和误读,刻意不做。

# 2. 体检:看推荐档位变没变、有没有漂移、期限到没到
node $SK/model_audit.mjs

# 3. 生效(冻结中会被拒绝,确需写入加 --force)
node $SK/model_audit.mjs --apply

# 4. 同步文档标记块(SKILL.md / README / USAGE / templates / 全局 CLAUDE.md)
node $SK/model_audit.mjs --sync-docs          # 先看 diff
node $SK/model_audit.mjs --sync-docs --write  # 确认后落盘

# 5. 全链路自检,全 ✅ 才算完成
node $SK/self_test.mjs
```

> ℹ️ **从仓库或安装目录跑都可以**(2026-10-08 起):全局 `CLAUDE.md` 按标准位置 `~/.claude/CLAUDE.md` 解析,
> 两处都能覆盖全部 8 个目标。若某个目标文件不存在,体检会明确报「⚠️ N 个同步目标不存在,已跳过」——
> 看到"未校验"的项目别再当成"一致"(旧版会静默跳过并照样打 ✅)。

## 档位是怎么推出来的

每个 mode 在 `policy` 里声明**一个主维度**(+可选副维度),推荐 = 该维度分数最高者:

| mode | 主维度 | 副维度 | 为什么 |
|---|---|---|---|
| `review` | `hard_reasoning` | `knowledge` | 挑得出硬伤靠长尾推理,不是靠查知识 |
| `challenge` | `hard_reasoning` | `knowledge` | 同上,对抗更吃推理 |
| `recompute` | `algo` | `code_agent` | 复算是算法/执行任务,不是知识题 |
| `latex` | `knowledge` | `instruction` | 符号与表达一致性属知识性判断 |

并列时比副维度;**仍并列则保持现状**(避免无谓 churn)。

> **刻意不做加权评分**。"review 需要 knowledge 0.5 + reasoning 0.5" 这种权重是拍脑袋编的数字,
> 却会被包装成计算结果。argmax 只依赖"哪个维度更重要"这一个可辩护的判断,且写在 `policy` 里可审。

**`policy` 是唯一需要人工判断的地方**,`scores` 只是事实。改 policy 等于改职责哲学,要慢;改 scores 只是跟着新数据走,可以快。

## 填分纪律

**每个分数必须带 `bench`(哪个基准)和 `source`**:

| source | 含义 | 用法 |
|---|---|---|
| `vendor` | 厂商自报 | **可以**据此重分档,但要在该模型的 `notes` 里写明"无独立复现" |
| `thirdparty` | 第三方测的(如 Artificial Analysis) | 优先采信 |
| `measured` | 本机实测 | 最高优先 |

- **第三方与厂商冲突时以第三方为准**,把厂商的值降级写进 `notes`
- 同一维度内**必须同量纲**才能 argmax(都是百分比,或都是 rating),别混
- 单模型 provider(如当前 Qwen)不需要每个维度都有分,`—` 是正常的
- 拿不准某个数是哪个基准测的 → **宁可不填**。填错的分比缺失的分危险得多,因为它会驱动一次分档

## 升级通道的两个护栏

### 冻结(比赛 / deadline 期间防误改)

```jsonc
"freezeUntil": "2026-11-30"
```

非 null 且未到期时:`--apply` 拒绝写入(除非 `--force`),且**漂移不判失败**(只告警)——因为冻结期的背离是预期的。
比赛前一设,就不怕 roster 被改到一半、档位在 deadline 当天被静默换掉。

### 复核期限

```jsonc
"recheckBy": "2026-10-31"
```

到期后 `model_audit` 与 `self_test` 都会提醒。**这不是强制的**,只是防止配置静默腐烂——
档位依据是别人家的跑分,别人在变,你不会收到通知。

## 边界(明确不做的事)

- **不自动抓跑分** —— 见上面第 1 步的说明
- **不加权评分** —— 见"档位是怎么推出来的"
- **不翻你的项目目录** —— `templates/*.md` 会被 `init` 拷进项目,拷走的那份脚本管不到。
  所以模板里带一个 `roster-stamp` 版本戳;项目里那份戳旧了就说明协议过期,重新拷贝模板即可。
  脚本只负责让戳准确,**不去你家目录里做手术**
- **不改运行时行为** —— `qwen_common.mjs` 只在**档位来源**上被本通道影响;
  生成物缺失或损坏时静默回落到硬编码基线,主线不受影响

## 出问题时

| 现象 | 原因 | 处置 |
|---|---|---|
| `--apply` 报"冻结中" | `freezeUntil` 未到期 | 等解冻,或 `--force`(想清楚) |
| 体检报"生成物与 roster 推导不一致" | 改了 roster 忘了 `--apply` | `--apply` |
| 体检报"文档漂移" | 改了配置忘了同步文档 | `--sync-docs --write` |
| 体检报"生效档位不在 roster 中" | 模型下线了但配置还指着它 | 补回 roster 条目,或 `--apply` 让推荐重新落档 |
| `--sync-docs` 报"标记块出现次数异常" | 有人手改文档把标记删了/复制了 | 手动补回**恰好一对** begin/end 标记;脚本拒绝盲写 |
| 想临时改档位试试 | —— | 用环境变量 `DEEPSEEK_MODEL` / `QWEN_MODEL` 覆盖,优先级最高,**别改 roster** |
