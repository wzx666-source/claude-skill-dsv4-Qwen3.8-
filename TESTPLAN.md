# qwen-dual-model 功能测试方案

**目的**:验证 skill 全部功能可用,发现环境/配置问题。换机器、升级 skill、赛前都建议跑一遍。
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
# 先跑自动自检(20 项,含翻转逻辑与 hook 两个方向)
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
| C7 | **--context 领域背景** | 对同一份代码分别跑:`--context "Python 并发,关注竞态与锁粒度"` 与不带该参数 | 带 context 时评审聚焦竞态/锁;不带时给出通用评审意见。**两者判据应有可见差异** |
| C8 | context 不污染 stdout | `node $SK/qwen_review.mjs review $T/flawed_derivation.md --context "x" 2>/dev/null \| head -1` | 首行仍是「总体结论:…」(banner 只走 stderr) |

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

## G. 模板与 init 产物

| # | 测试点 | 命令 | 预期 |
|---|---|---|---|
| G1 | CLAUDE.md 模板 | `cat $SK/../templates/CLAUDE.md` | 包含视觉/评审/PDF 三协议,脚本路径正确 |
| G2 | hook 配置模板 | `jq -e . $SK/../templates/hooks.settings.json` | JSON 合法 |
| G3 | init 演练(可选) | 新建测试项目目录 → 拷入 CLAUDE.md 模板 → 新开会话问"这是什么项目" | 会话遵守双模型协议;可顺手验证 E6 |

## H. 评审角色翻转(v2 新增,核心机制)

翻转逻辑本身由 self_test 自动覆盖(第 5/6/7 项),这里测**端到端**:

| # | 测试点 | 命令 | 预期 |
|---|---|---|---|
| H1 | 默认方向 | `node $SK/qwen_review.mjs review $T/flawed_derivation.md` | stderr banner 显示「评审方: Qwen(百炼) / 驱动方 DeepSeek 不参与」 |
| H2 | **翻转方向** | `DRIVER_PROVIDER=bailian node $SK/qwen_review.mjs review $T/flawed_derivation.md` | stderr banner 显示「评审方: DeepSeek (deepseek-v4-pro) / 驱动方 Qwen(百炼) 不参与」;评审结论仍能抓出硬伤 |
| H3 | 含图自动落 flash | `DRIVER_PROVIDER=bailian node $SK/qwen_ask.mjs "这张图什么颜色" --file $T/solid_blue.png` | banner 显示 `deepseek-flash`(pro 是纯文本档,含图必须落 flash) |
| H4 | Qwen 会话下 hook 让行 | `DRIVER_PROVIDER=bailian` 时用 E1 的 stdin 喂 hook | 输出 `{}`(让行,不绕回 Qwen 自己) |
| H5 | 双开真实验证(可选) | CC Switch 切百炼 → 新终端 `claude` → 在该会话里跑 `qwen_review` | 评审方为 DeepSeek,且主会话的评审仍走 Qwen —— 两边都不自审自 |

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
