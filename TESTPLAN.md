# qwen-dual-model 功能测试方案

**目的**:赛前验证 skill 全部功能可用,发现环境/配置问题。
**预计耗时**:15-20 分钟(约 25 次 API 调用,费用 <1 元)。
**通过标准**:除标注"可选"的项外全部 ✅。

## 0. 准备

```bash
export SK=~/.claude/skills/qwen-dual-model/scripts
export T=~/qwen-dual-model-test
# 前置检查
node --version                          # ≥ 22.5
python -c "import matplotlib,pdfplumber,pypdfium2; print('py deps OK')"
# 生成全部测试素材
python $SK/make_test_materials.py
# 先跑自动自检(7 项)
node $SK/self_test.mjs
```

---

## A. 视觉外挂 qwen_vision.mjs

| # | 测试点 | 命令 | 预期 |
|---|---|---|---|
| A1 | 单图基础识图 | `node $SK/qwen_vision.mjs $T/solid_blue.png "这张图是什么颜色?只回答颜色"` | 回答含"蓝"或 blue |
| A2 | 多图一次传入 | `node $SK/qwen_vision.mjs $T/two_a.png $T/two_b.png "哪张是线性趋势?哪张是二次趋势?"` | 正确区分 A 线性 / B 二次 |
| A3 | 数据图异常检查 | `node $SK/qwen_vision.mjs $T/anomaly_plot.png "这条曲线有没有离群点?在什么位置?"` | 指出 x≈5 处存在离群点 |
| A4 | 公式图转 LaTeX | `node $SK/qwen_vision.mjs $T/formula.png "把图中的公式转成 LaTeX"` | 输出含 `\frac` / `\sum` / `x_i` 等结构 |
| A5 | 参数校验 | ① 不存在的图片 ② 传 .md 文件 ③ 传 7 张图 | ①②③ 均报清晰中文错误,退出码非 0 |
| A6 | 旧路径兼容 | `node ~/.claude/scripts/qwen_vision.mjs $T/solid_blue.png "什么颜色?"` | 与 A1 结果一致 |

## B. PDF 处理 pdf_read.mjs

| # | 测试点 | 命令 | 预期 |
|---|---|---|---|
| B1 | 文字提取 | `node $SK/pdf_read.mjs $T/doc_with_figure.pdf --no-images` | 生成 `doc_with_figure.txt`,含 "fit y = ax + b" |
| B2 | 矢量图页检测+视觉 | `node $SK/pdf_read.mjs $T/doc_with_figure.pdf` | 检测到第 2 页为含图页,视觉描述含数据点/线性趋势 |
| B3 | 扫描件(无文字层) | `node $SK/pdf_read.mjs $T/scanned_sim.pdf` | 文字提取为空或极少;整页被检测为图并走视觉,描述出曲线内容 |
| B4 | --pages 限页 | `node $SK/pdf_read.mjs $T/doc_with_figure.pdf --pages 2-2` | 只处理第 2 页 |
| B5 | --max-img-pages 上限 | `node $SK/pdf_read.mjs $T/doc_with_figure.pdf --max-img-pages 1` | 只处理 1 页并提示其余未处理 |
| B6 | 自定义问题 | `node $SK/pdf_read.mjs $T/doc_with_figure.pdf "图里 x 和 y 是什么函数关系?"` | 视觉回答围绕该问题 |
| B7 | 参数校验 | ① 不存在的 PDF ② 传 .png | ①报"文件不存在" ②报"只支持 .pdf" |

## C. 独立评审 qwen_review.mjs

| # | 测试点 | 命令 | 预期 |
|---|---|---|---|
| C1 | review 抓硬伤 | `node $SK/qwen_review.mjs review $T/flawed_derivation.md` | 首行"总体结论:有硬伤";含【高】级问题指出最大值应为 f(2)=4 |
| C2 | challenge 对抗 | `node $SK/qwen_review.mjs challenge $T/flawed_derivation.md` | 首行结论 + 含"最致命的三个质疑" |
| C3 | recompute 复算 | `node $SK/qwen_review.mjs recompute $T/data.csv $T/wrong_result.md` | 首行"有出入";指出 RSS/MAE 应接近 0 而非 100/8 |
| C4 | latex 检查 | `node $SK/qwen_review.mjs latex $T/broken_latex.tex` | 指出: `\frac{1}{2` 括号不配对、`\gama` 未定义、`\end{align` 缺右括号 |
| C5 | --focus 关注点 | `node $SK/qwen_review.mjs review $T/flawed_derivation.md --focus "重点检查闭区间端点处理"` | 回答围绕端点处理展开 |
| C6 | 参数校验 | ① 非法 mode ② 缺文件参数 | ①报"mode 必须是 review \| challenge \| recompute \| latex" ②报"至少给一个文件" |
| C7 | **档位分派:recompute→flash** | `DRIVER_PROVIDER=bailian node $SK/qwen_review.mjs recompute $T/data.csv $T/wrong_result.md 2>&1 >/dev/null \| head -1` | stderr banner 含 `DeepSeek (deepseek-flash)｜按 recompute 档选模型` |
| C8 | **档位分派:review→pro** | `DRIVER_PROVIDER=bailian node $SK/qwen_review.mjs review $T/flawed_derivation.md 2>&1 >/dev/null \| head -1` | banner 含 `DeepSeek (deepseek-v4-pro)`;第 2 行含存疑提示或为空(取决于 `MODEL_ALIAS_PROBE.verdict`) |
| C9 | 环境变量仍覆盖 mode 分档 | `DRIVER_PROVIDER=bailian DEEPSEEK_MODEL=deepseek-flash node $SK/qwen_review.mjs review $T/flawed_derivation.md 2>&1 >/dev/null \| head -1` | banner 含 `deepseek-flash` 而非 pro(env 优先级高于 mode 档) |
| C10 | **recompute 幻觉防护生效** | `DRIVER_PROVIDER=bailian node $SK/qwen_review.mjs recompute $T/data.csv $T/wrong_result.md` | 每项数值都带【核算过程】的逐式演算 **与**【出处】的位置引用;**只给结论数字、无过程 = 不通过** |
| C11 | review 幻觉防护生效 | `DRIVER_PROVIDER=bailian node $SK/qwen_review.mjs review $T/flawed_derivation.md` | 每条问题都带可核对的位置引用;指不出位置的判断被降级为【低】或标注「无法定位」 |

## D. 自由咨询 qwen_ask.mjs

| # | 测试点 | 命令 | 预期 |
|---|---|---|---|
| D1 | 自由问答 | `node $SK/qwen_ask.mjs "用一句话解释最小二乘法"` | 给出合理解释 |
| D2 | 带附件 | `node $SK/qwen_ask.mjs "这个推导有什么问题?" --file $T/flawed_derivation.md` | 指出最大值判断错误 |

## E. 自动路由 hook(qwen_read_hook.mjs)

模拟 stdin 测试(不消耗 API 的项除外):

| # | 测试点 | 命令 | 预期 |
|---|---|---|---|
| E1 | 图片→自动读图 | `echo '{"tool_name":"Read","tool_input":{"file_path":"'$T'/solid_blue.png"}}' \| node $SK/qwen_read_hook.mjs` | 输出 JSON:`permissionDecision:"deny"`,reason 含图片颜色描述 |
| E2 | PDF→拦截提示 | `echo '{"tool_name":"Read","tool_input":{"file_path":"'$T'/doc_with_figure.pdf"}}' \| node $SK/qwen_read_hook.mjs` | deny,reason 推荐 `pdf_read.mjs` |
| E3 | 文本→放行 | `echo '{"tool_name":"Read","tool_input":{"file_path":"'$T'/flawed_derivation.md"}}' \| node $SK/qwen_read_hook.mjs` | 输出 `{}` |
| E4 | 不存在文件→放行 | 同上,路径改为不存在文件 | 输出 `{}` |
| E5 | **fail-open** | `QWEN_API_KEY=bad-key node $SK/qwen_read_hook.mjs`(stdin 为图片) | 输出 `{}`(外挂故障放行,不卡会话) |
| E6 | 真实会话验证(可选) | 临时把 `templates/hooks.settings.json` 合并进测试项目的 `.claude/settings.json`,新开会话让我 Read 一张图 | 观察到图片被拦截且视觉内容自动注入;测完删掉 hook |

## F. 健壮性与降级

| # | 测试点 | 命令 | 预期 |
|---|---|---|---|
| F1 | 错误 key | `QWEN_API_KEY=wrong-key node $SK/qwen_vision.mjs $T/solid_blue.png "x"` | 报"API key 无效或过期 → 到 CC Switch 检查…" |
| F2 | 错误模型名 | `QWEN_MODEL=no-such-model node $SK/qwen_vision.mjs $T/solid_blue.png "x"` | 报模型不可用提示 |
| F3 | 超大图片 | `node $SK/qwen_vision.mjs $T/big_image.png "x"` | 报"图片过大…单图限 8MB" |
| F4 | 超大文本截断 | `node -e "import('$SK/qwen_common.mjs').then(m=>console.log(m.readTextCapped('$T/big_text.md').endsWith('字节]')?'TRUNCATED OK':'FAIL'))"` | 输出 TRUNCATED OK |
| F5 | 连续调用稳定性 | `for i in 1 2 3; do node $SK/qwen_vision.mjs $T/solid_blue.png "什么颜色?" \| head -c 40; echo; done` | 3 次全部正常返回 |
| F6 | 网络错误重试 | 断网或用防火墙临时屏蔽 `dashscope.aliyuncs.com` 后跑一次 vision | 报"网络请求失败…已重试 2 次",退出码非 0,机器不卡死 |
| F7 | **溯源探针:V4-Pro 是否被重定向** | `node $SK/self_test.mjs`(看第 14 节「溯源探针」) | 打印两档服务端回显的 model id,并核对与 `MODEL_ALIAS_PROBE.verdict` 一致;两档回显相同 = 别名属实,分档当前是空操作 |

## G. 模板与 init 产物

| # | 测试点 | 命令 | 预期 |
|---|---|---|---|
| G1 | CLAUDE.md 模板 | `cat $SK/../templates/CLAUDE.md` | 包含视觉/评审/PDF 三协议,脚本路径正确 |
| G2 | hook 配置模板 | `jq -e . $SK/../templates/hooks.settings.json` | JSON 合法 |
| G3 | init 演练(可选) | 新建测试项目目录 → 拷入 CLAUDE.md 模板 → 新开会话问"这是什么项目" | 会话遵守双模型协议;可顺手验证 E6 |

## H. 模型迭代通道(model_roster.json / model_audit.mjs)

除 H7 外均不耗 token。跑前确认起点干净:`node $SK/model_audit.mjs` 退出码应为 0。

| # | 测试点 | 命令 | 预期 |
|---|---|---|---|
| H1 | 体检:无漂移 | `node $SK/model_audit.mjs` | 退出码 0;"✅ 无漂移";生成物与文档各一行 ✅ |
| H2 | **推导重现手挑档位** | 同 H1 看表 | `recompute→deepseek-flash`,其余三档 →`deepseek-v4-pro`;Qwen 四档都 `qwen3.8-max`。**若不一致,不是 policy/跑分填错了,就是当初手挑错了** |
| H3 | 跑分表渲染 | `node $SK/model_audit.mjs --render` | markdown 表;DeepSeek 表有"胜方"列,单模型的 Qwen 表**无**该列;分数保留 1 位小数(显示 93.0 而非 93),价格 2 位(0.60 非 0.6) |
| H4 | 同步幂等 | `node $SK/model_audit.mjs --sync-docs` | 第二次跑报"共 0 处待更新";文件 mtime 不变 |
| H5 | 标记块独占行 | `grep -n -A1 "ROSTER:bench-tables:begin" $SK/../SKILL.md` | 内容在标记块的**下一行**,不与 `-->` 同行——否则 Markdown 把该行当 HTML 块,表格渲染不出来 |
| H6 | 生成物损坏 → 静默回落 + 报警 | `echo 'not json' > $SK/../tiers.generated.json`,跑 `node $SK/self_test.mjs \| grep 档位` 与 `node $SK/model_audit.mjs` | 档位断言**仍全 ✅**(回落硬编码基线,主线不受影响);但体检报 ❌ "生成物损坏"。`node $SK/model_audit.mjs --apply` 后恢复 |
| H7 | 溯源探针 | `node $SK/model_audit.mjs --probe` | 逐条打印服务端回显的 model id;不一致标 ⚠️。**耗 token** |
| H8 | **模拟新模型上线(端到端)** | 往 roster 的 `deepseek.models` 加 `deepseek-v9`(`hard_reasoning` 填 99),然后 H1 → `--apply` → `--sync-docs --write` → H1 | ① H1 报 drift 且退出码 1;② apply 后 H1 恢复 0;③ `SKILL.md`/`templates/CLAUDE.md`/全局 `CLAUDE.md` 的档位表**自动变成 deepseek-v9**;④ 还原后重跑 apply+sync |
| H9 | 冻结拒绝写入 | roster 设 `"freezeUntil":"<明天>"`,改个分数让推荐变化,跑 `--apply`,再跑 `self_test.mjs` | `--apply` 报"冻结中,拒绝写入"且退出码 1;**漂移降级为 ⚠️ 而非 ❌**,self_test 不因此失败。测完清空 `freezeUntil` |
| H10 | 标记块被破坏 → 拒绝盲写 | 把 SKILL.md 里某对标记复制一份(变成 2 对),跑 `--sync-docs` | 报"标记块出现次数异常…拒绝改写",退出码 1,**且不写入该文件**。测完还原 |
| H11 | 生效档位不在 roster | 从 roster 删掉当前生效的 `deepseek-flash`,跑 `model_audit.mjs` 与 `self_test.mjs` | 报"生效档位不在 roster 中";self_test 该项 ❌。测完还原 |

> ⚠️ H8–H11 会改 roster / 生成物 / 文档,**必须备份并还原**:
> ```bash
> cp $SK/../model_roster.json /tmp/roster.bak
> # …测试…
> cp /tmp/roster.bak $SK/../model_roster.json
> node $SK/model_audit.mjs --apply && node $SK/model_audit.mjs --sync-docs --write
> node $SK/self_test.mjs | tail -3   # 应恢复全 ✅
> ```

## 测试后清理

```bash
rm -rf ~/qwen-dual-model-test   # 素材目录
# 若做过 E6/G3:删除测试项目的 hook 配置和临时目录
```

## 失败处理

- **A/B/C 组失败**:看错误信息是否含修复提示(key/限流/模型);按提示处理后重跑单项
- **E 组失败**:hook 属于可选第二阶段,失败不影响主线;可直接跳过,靠 CLAUDE.md 协议兜底
- **全部失败但 self_test 通过**:检查网络与百炼账号额度
- 任何失败都可把输出发给我定位
