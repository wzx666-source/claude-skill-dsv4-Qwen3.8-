#!/usr/bin/env node
// canary.mjs — 开跑前的通道预检(几秒,不是 self_test 那种全链路体检)
//
// 用法: node canary.mjs [--json] [--provider bailian|deepseek|both] [--budget 秒]
//
// 为什么需要它:批量任务(翻译、批量评审)跑到一半撞上 402/401,前面所有产出都要手工收尾。
// self_test 要几分钟(含视觉调用、hook 子进程、溯源探针),不适合每次开跑前跑;
// 这里只做一件事:**确认这条路现在通不通**,顺带把余额/欠费、key 失效这类
// "再跑一万次也不会好"的错,在花掉第一个 token 之前暴露出来。
//
// 判据(三态,不是两态):
//   ok       拿到正文
//   thinking 没正文但思考了 —— 通道是通的(推理模型把预算全花在思考上),算通过
//   fail     调用抛错 / 完全空白
// 只看 content 会把"推理模型 + 小 max_tokens"误报成故障 —— 这正是本次任务里
// Qwen "思考了 7.5 万字符、零产出"的形态,必须在预检里就能区分。
//
// **刻意不传 max_tokens**:实测(2026-10-23)max_tokens 只约束正文,
// reasoning 另算 —— 给 32 会让 deepseek-v4-pro 思考 57 字后被长度截断、正文零字,
// 于是把一条健康的通道报成故障。预检靠 budget(墙钟)兜底,不靠生成量。
//
// 走的是**流式**路径:出问题的就是流式(卡死、空转、中途断),非流式预检验不到。
import { callModel, pickModel, PROVIDERS, activeProviderName, loadKey } from './qwen_common.mjs';

const args = process.argv.slice(2);
const jsonOut = args.includes('--json');
const provIdx = args.indexOf('--provider');
const provArg = provIdx >= 0 ? args[provIdx + 1] : 'both';
const budgetIdx = args.indexOf('--budget');
const budgetSec = budgetIdx >= 0 ? Number(args[budgetIdx + 1]) : 60;
if (!['bailian', 'deepseek', 'both'].includes(provArg)) {
  console.error(`✗ --provider 只能是 bailian | deepseek | both,收到: ${provArg}`);
  process.exit(1);
}
if (!Number.isFinite(budgetSec) || budgetSec <= 0) {
  console.error(`✗ --budget 应为正数(秒),收到: ${args[budgetIdx + 1] ?? ''}`);
  process.exit(1);
}
const targets = provArg === 'both' ? ['bailian', 'deepseek'] : [provArg];

const driver = activeProviderName();

async function probe(name) {
  const p = PROVIDERS[name];
  const model = pickModel(name);
  const t0 = Date.now();
  try {
    const r = await callModel(
      [{ role: 'user', content: '只回复两个字母:OK。不要解释,不要思考过程。' }],
      {
        provider: name, stream: true, returnMeta: true,
        timeoutMs: budgetSec * 1000, budgetMs: budgetSec * 1000,
      },
    );
    const reasoning = r.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    const state = r.content?.trim() ? 'ok' : (reasoning > 0 ? 'thinking' : 'fail');
    return {
      provider: name, label: p.label, model: r.model || model, state,
      latencyMs: Date.now() - t0,
      promptTokens: r.usage?.prompt_tokens ?? null,
      completionTokens: r.usage?.completion_tokens ?? null,
      reasoningTokens: reasoning || null,
      reply: (r.content || '').trim().slice(0, 40),
      error: null,
    };
  } catch (e) {
    return {
      provider: name, label: p.label, model, state: 'fail',
      latencyMs: Date.now() - t0, error: e.message,
    };
  }
}

// 先做一次纯本地检查:key 读不到就不用发请求了(能给出比"网络请求失败"准得多的原因)
const results = [];
for (const name of targets) {
  try {
    loadKey(name);
  } catch (e) {
    results.push({ provider: name, label: PROVIDERS[name].label, model: pickModel(name),
      state: 'fail', latencyMs: 0, error: e.message });
    continue;
  }
  results.push(await probe(name));
}

const ok = results.every(r => r.state !== 'fail');

if (jsonOut) {
  console.log(JSON.stringify({ ok, driver, at: new Date().toISOString(), providers: results }, null, 2));
} else {
  console.log(`🔎 通道预检(驱动方 ${PROVIDERS[driver].label})`);
  for (const r of results) {
    const mark = r.state === 'ok' ? '✅' : r.state === 'thinking' ? '🟡' : '❌';
    const s = (r.latencyMs / 1000).toFixed(1) + 's';
    if (r.state === 'fail') {
      console.log(`${mark} ${r.label} (${r.model}) ${s} — ${r.error}`);
    } else if (r.state === 'thinking') {
      console.log(`${mark} ${r.label} (${r.model}) ${s} — 通道通,但预算全花在思考上`
        + `(reasoning ${r.reasoningTokens ?? '?'} tok,正文为空)`);
    } else {
      console.log(`${mark} ${r.label} (${r.model}) ${s} — "${r.reply}"`
        + (r.promptTokens != null ? `｜${r.promptTokens}+${r.completionTokens} tok` : ''));
    }
  }
  if (!ok) {
    console.log('\n✗ 有通道不通。批量任务不要开跑 —— 先按上面的提示修好(402 = 充值,401 = key)。');
  } else {
    console.log('\n✓ 可以开跑。');
  }
}

process.exitCode = ok ? 0 : 1;
