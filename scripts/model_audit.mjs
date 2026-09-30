#!/usr/bin/env node
// model_audit.mjs — 模型迭代通道:从 roster 推导档位 / 体检 / 生成配置 / 同步文档
//
// 用法:
//   node model_audit.mjs                        体检(默认,不耗 token)
//   node model_audit.mjs --render                打印跑分表(markdown)
//   node model_audit.mjs --apply                 写 tiers.generated.json(冻结中拒绝,--force 越过)
//   node model_audit.mjs --sync-docs             预览文档标记块 diff
//   node model_audit.mjs --sync-docs --write     原地重写标记块(幂等)
//   node model_audit.mjs --probe                 验证 roster 中每个 model id 真能被服务(耗 token)
//
// 三层分离:
//   model_roster.json   事实(跑分/能力/价格/来源)—— 唯一事实源,升级只改这里
//   model_audit.mjs     推导(维度 argmax,不发明权重)+ 体检 + 同步
//   tiers.generated.json 生成物(不手改),qwen_common 运行时读取,坏掉静默回落硬编码
//
// 推导的稳定性:**推荐永远从 qwen_common 的硬编码 modeModels(基线意图)出发做 tie-break,
// 不读生成物** —— 否则推荐会自我引用,体检就失去意义。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROVIDERS, resolvedTiers, callModel, fail, isFatal } from './qwen_common.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.dirname(__dirname);
const ROSTER_FILE = path.join(SKILL_ROOT, 'model_roster.json');
const TIERS_FILE = path.join(SKILL_ROOT, 'tiers.generated.json');

const SKILL_MD = path.join(SKILL_ROOT, 'SKILL.md');
const README_MD = path.join(SKILL_ROOT, 'README.md');
const USAGE_MD = path.join(SKILL_ROOT, 'USAGE.md');
const TPL_CLAUDE = path.join(SKILL_ROOT, 'templates', 'CLAUDE.md');
const TPL_COMP = path.join(SKILL_ROOT, 'templates', 'CLAUDE.competition.md');
const GLOBAL_CLAUDE = path.join(SKILL_ROOT, '..', '..', 'CLAUDE.md');

const today = () => new Date().toISOString().slice(0, 10);

// ────────────────────────────── 读取 ──────────────────────────────

function readRoster() {
  if (!fs.existsSync(ROSTER_FILE)) fail(`找不到事实源: ${ROSTER_FILE}`);
  let j;
  try {
    j = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf8'));
  } catch (e) {
    fail(`model_roster.json 不是合法 JSON: ${e.message}`);
  }
  if (j.schema !== 1) fail(`roster schema 版本不认(期望 1,实得 ${j.schema});本脚本需同步升级`);
  if (!j.providers || !j.policy) fail('roster 缺少 providers / policy 字段');
  return j;
}

function readGenerated() {
  try {
    const j = JSON.parse(fs.readFileSync(TIERS_FILE, 'utf8'));
    return j?.schema === 1 ? j : null;
  } catch { return null; }
}

// ─────────────────────── 推导:维度 argmax ───────────────────────

/** 降序比较,返回负数表示 x 应排在 y 前 */
const desc = (x, y) => (y > x ? 1 : y < x ? -1 : 0);

/**
 * 推荐档位 = 该 provider 下 primary 维度分数最高者;并列比 secondary;
 * 仍并列则保持基线意图(避免无谓 churn)。**不做加权评分**——权重会是拍脑袋的数字。
 */
function recommendTiers(roster) {
  const out = {};
  for (const [prov, pdef] of Object.entries(roster.providers)) {
    out[prov] = {};
    const baseline = PROVIDERS[prov]?.modeModels ?? {};
    for (const [mode, pol] of Object.entries(roster.policy)) {
      const cur = baseline[mode];
      const cands = Object.entries(pdef.models || {}).map(([id, m]) => ({
        id,
        pri: m.scores?.[pol.primary]?.v ?? -Infinity,
        sec: m.scores?.[pol.secondary]?.v ?? -Infinity,
      })).filter(c => Number.isFinite(c.pri) || Number.isFinite(c.sec));
      if (!cands.length) { out[prov][mode] = null; continue; }
      cands.sort((a, b) => desc(a.pri, b.pri) || desc(a.sec, b.sec)
        || (a.id === cur ? -1 : b.id === cur ? 1 : 0));
      out[prov][mode] = cands[0].id;
    }
  }
  return out;
}

function buildTiers(roster) {
  const rec = recommendTiers(roster);
  const providers = {};
  for (const [prov, modes] of Object.entries(rec)) providers[prov] = { modeModels: modes };
  return {
    schema: 1,
    generatedAt: today(),
    rosterUpdatedAt: roster.updatedAt,
    recheckBy: roster.recheckBy ?? null,
    providers,
  };
}

/**
 * 文档里该写的档位 = **运行时实际生效**的档位(不是推荐值)。
 * 两者背离时(roster 已更新但未 --apply,或冻结期)文档必须写实际生效的,
 * 否则文档会宣传一个运行时并没在做的事。renderers 用该结果 + 背离提示。
 */
function tierState(roster) {
  const eff = resolvedTiers().providers;
  const rec = recommendTiers(roster);
  const tiers = {};
  let diverged = false;
  for (const prov of Object.keys(roster.providers)) {
    tiers[prov] = {};
    for (const mode of Object.keys(roster.policy)) {
      const e = eff[prov]?.modeModels?.[mode] ?? null;
      const r = rec[prov]?.[mode] ?? null;
      tiers[prov][mode] = e ?? r;
      if (e && r && e !== r) diverged = true;
    }
  }
  return { tiers, diverged };
}

const divergenceNote = (diverged) => (diverged
  ? '\n> ⚠️ 生效档位与 roster 推荐**不一致**(roster 已更新但 `--apply` 未执行,或处于冻结期)。本表按**实际生效**渲染。'
  : '');

function freezeState(roster) {
  const until = roster.freezeUntil;
  if (!until) return { frozen: false };
  return { frozen: today() <= until, until };
}

// ────────────────────────── 文档标记块 ──────────────────────────

const mark = (block) => ({
  begin: `<!-- ROSTER:${block}:begin -->`,
  end: `<!-- ROSTER:${block}:end -->`,
});

/** 在 content 里定位标记块;返回 { start, end } 字符区间或 { error } */
function locateBlock(content, block) {
  const { begin, end } = mark(block);
  const starts = content.split(begin).length - 1;
  const ends = content.split(end).length - 1;
  if (starts === 0 && ends === 0) return { missing: true };
  if (starts !== 1 || ends !== 1) {
    return { error: `标记块 ${block} 出现次数异常(begin×${starts} / end×${ends}),应为各 1 —— 拒绝改写` };
  }
  const s = content.indexOf(begin) + begin.length;
  const e = content.indexOf(end);
  if (e < s) return { error: `标记块 ${block} 的 end 在 begin 之前 —— 拒绝改写` };
  return { start: s, end: e };
}

function sourceLegend(roster) {
  const set = new Set();
  for (const p of Object.values(roster.providers)) {
    for (const m of Object.values(p.models || {})) {
      for (const s of Object.values(m.scores || {})) set.add(s.source);
    }
  }
  const label = { vendor: '厂商自报(无独立复现)', thirdparty: '第三方', measured: '本机实测' };
  return [...set].map(s => `${s}=${label[s] || s}`).join('、');
}

// 跑分保留 1 位小数(93 → 93.0);四位数以上是 rating,按整数显示
const fmtScore = (v) => (Math.abs(v) >= 1000 ? String(v) : v.toFixed(1));
const fmtPrice = (v) => v.toFixed(2);

/** 表格:行=维度,列=该 provider 的模型;末行=价格。单模型时不渲染"胜方"列 */
function renderProviderTable(roster, prov) {
  const pdef = roster.providers[prov];
  const models = Object.entries(pdef.models || {});
  if (!models.length) return `(${prov} 无模型)`;
  const multi = models.length > 1;
  const cols = models.map(([, m]) => m.label);
  const head = `| 维度(基准) | ${cols.join(' | ')} |${multi ? ' 胜方 |' : ''}`;
  const sep = `|---|${cols.map(() => '---').join('|')}|${multi ? '---|' : ''}`;

  // 高亮最优值(分数取最大、价格取最小);单模型或全部相同则不高亮
  const mark = (vals, fmt, mode = 'max') => {
    const nums = vals.filter(v => v !== null);
    const best = nums.length ? (mode === 'min' ? Math.min(...nums) : Math.max(...nums)) : null;
    const highlight = multi && new Set(nums).size > 1;
    return vals.map(v => {
      if (v === null) return '—';
      return highlight && v === best ? `**${fmt(v)}**` : fmt(v);
    });
  };

  const rows = [];
  for (const d of Object.keys(roster.dimensions)) {
    const cells = models.map(([, m]) => m.scores?.[d]);
    if (cells.every(c => !c)) continue;                 // 该 provider 没有这个维度的分数
    const vals = cells.map(c => (c ? c.v : null));
    const bench = (cells.find(c => c) || {}).bench || '';
    const rendered = mark(vals, fmtScore);
    let winner = '';
    if (multi) {
      const nums = vals.filter(v => v !== null);
      const best = nums.length ? Math.max(...nums) : null;
      winner = models.filter((_, i) => vals[i] === best).map(([, m]) => m.label).join('/');
    }
    rows.push(`| ${roster.dimensions[d]} (${bench}) | ${rendered.join(' | ')} |${multi ? ` ${winner} |` : ''}`);
  }

  const prices = models.map(([, m]) => (m.pricePerM ? m.pricePerM.out : null));
  if (prices.some(p => p !== null)) {
    const rendered = mark(prices, fmtPrice, 'min');
    let winner = '';
    if (multi) {
      const nums = prices.filter(p => p !== null);
      const min = nums.length ? Math.min(...nums) : null;
      winner = `便宜:${models.filter((_, i) => prices[i] === min).map(([, m]) => m.label).join('/')}`;
    }
    rows.push(`| 输出价 $/M | ${rendered.join(' | ')} |${multi ? ` ${winner} |` : ''}`);
  }
  return [head, sep, ...rows].join('\n');
}

function renderSkillModeTiers(roster) {
  const { tiers, diverged } = tierState(roster);
  const rows = Object.entries(roster.policy).map(([mode, pol]) => {
    const cell = Object.entries(tiers).map(([, modes]) => {
      const id = modes[mode];
      return id ? `\`${id}\`` : '—';
    }).join(' / ');
    return `| \`${mode}\` | ${cell} | ${pol.primary}${pol.secondary ? ` → ${pol.secondary}` : ''} |`;
  });
  return [
    '| mode | 档位(DeepSeek / Qwen) | 主维度 → 副维度 |',
    '|---|---|---|',
    ...rows,
    '',
    `> 由 \`model_roster.json\` 推导(roster@${roster.updatedAt},复核期限 ${roster.recheckBy ?? '未设'})。改档位请走 \`MODEL_UPGRADE.md\` 的流程,不要直接编辑本表。`,
    divergenceNote(diverged),
  ].join('\n');
}

function renderTplModeTiers(roster) {
  const { tiers, diverged } = tierState(roster);
  const d = tiers.deepseek || {};
  return [
    '| mode | 评审档位(评审方为 DeepSeek 时) |',
    '|---|---|',
    ...Object.keys(roster.policy).map(m => `| \`${m}\` | \`${d[m] ?? '—'}\` |`),
    divergenceNote(diverged),
  ].join('\n');
}

function renderGlobalModeTiers(roster) {
  const { tiers, diverged } = tierState(roster);
  const d = tiers.deepseek || {};
  const pairs = Object.entries(d).map(([m, id]) => `\`${m}\`→\`${id}\``).join('、');
  return `- **评审/咨询按 mode 分档**(由 \`model_roster.json\` 推导,roster@${roster.updatedAt}):`
    + `DeepSeek 侧 ${pairs};含图一律落 \`${PROVIDERS.deepseek.visionModel}\`(仅它有原生视觉)。`
    + (diverged ? '\n  ⚠️ 生效档位与 roster 推荐不一致(--apply 待执行或冻结中)。' : '');
}

/**
 * README / USAGE 共用的「评审角色翻转」表 —— 两份文档这张表内容相同,故共用渲染器。
 * 按档位**归组** mode(而非逐行罗列),所以档位一变整张表跟着重排,不会漏改某一行。
 */
function renderFlipTable(roster) {
  const { tiers, diverged } = tierState(roster);
  const group = (modes) => {
    const byModel = new Map();
    for (const [mode, id] of Object.entries(modes)) {
      if (!byModel.has(id)) byModel.set(id, []);
      byModel.get(id).push(`\`${mode}\``);
    }
    const single = byModel.size === 1;
    return [...byModel].map(([id, ms]) => (single
      ? `\`${id}\`(${ms.length} 个 mode 同一档)`
      : `${ms.join('/')} → \`${id}\``)).join(';');
  };
  return [
    '| 你的会话跑在 | 评审/咨询方 | 用的档 |',
    '|---|---|---|',
    `| DeepSeek | Qwen(百炼) | ${group(tiers.bailian || {})} |`,
    `| Qwen(百炼) | DeepSeek | ${group(tiers.deepseek || {})} |`,
    divergenceNote(diverged),
  ].join('\n');
}

function renderBenchTables(roster) {
  const parts = ['### DeepSeek:两档是两个方向,不是快慢档', ''];
  parts.push(renderProviderTable(roster, 'deepseek'));
  parts.push('');
  for (const prov of Object.keys(roster.providers)) {
    if (prov === 'deepseek') continue;
    const pdef = roster.providers[prov];
    const n = Object.keys(pdef.models || {}).length;
    // 单候选时说明清楚:该 provider 的档位是默认,不来自维度推导(免得误以为"它赢了")
    parts.push(`### ${PROVIDERS[prov]?.label ?? prov}${n === 1 ? '(单一候选,档位无需推导)' : ''}`, '');
    parts.push(renderProviderTable(roster, prov));
    parts.push('');
  }
  parts.push(`> 数据来源:${sourceLegend(roster)}。`);
  parts.push('> **复核期限 ' + (roster.recheckBy ?? '未设') + '** —— 到期跑 `node scripts/model_audit.mjs` 并按 `MODEL_UPGRADE.md` 重分档。');
  return parts.join('\n');
}

/**
 * 版本戳只能依赖**已入库的事实**(roster 的日期),不能依赖 `tiers.generated.json`
 * 那种本地未跟踪状态 —— 否则同一份提交在不同机器上会渲染出不同内容,
 * 全新 clone(没有生成物)反而报"文档漂移"并失败。
 * "生成物是否已 apply"属于运行时状态,由 model_audit 的体检输出报告,不写进文档。
 */
function renderStamp(roster) {
  return `> 档位依据:\`model_roster.json\` @ ${roster.updatedAt}(复核期限 ${roster.recheckBy ?? '未设'})。`
    + '若此戳早于 skill 内的 roster 版本,说明本项目这份协议已过期,请重新拷贝模板。';
}

const DOC_BLOCKS = [
  { file: SKILL_MD, block: 'mode-tiers', render: renderSkillModeTiers },
  { file: SKILL_MD, block: 'bench-tables', render: renderBenchTables },
  // README / USAGE 各有一张翻转表 —— 不纳入同步的话,重分档时这两份会悄悄漂移
  { file: README_MD, block: 'mode-tiers', render: renderFlipTable },
  { file: USAGE_MD, block: 'mode-tiers', render: renderFlipTable },
  { file: TPL_CLAUDE, block: 'mode-tiers', render: renderTplModeTiers },
  { file: TPL_CLAUDE, block: 'roster-stamp', render: renderStamp },
  { file: TPL_COMP, block: 'roster-stamp', render: renderStamp },
  { file: GLOBAL_CLAUDE, block: 'mode-tiers', render: renderGlobalModeTiers },
];

/**
 * 按**文件**归组同步计划:文件内容快照每个文件只取一次,供同文件的多个块共用。
 * (逐块各取一次快照会出事:同文件第二个块会用陈旧快照把第一个块的写入覆盖掉。)
 */
function planDocSync(roster) {
  const byFile = new Map();
  for (const { file, block, render } of DOC_BLOCKS) {
    if (!byFile.has(file)) {
      byFile.set(file, {
        file,
        rel: path.relative(SKILL_ROOT, file),
        content: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null,
        blocks: [],
      });
    }
    const doc = byFile.get(file);
    if (doc.content === null) { doc.blocks.push({ block, status: 'no-file' }); continue; }
    // 前后各留一个换行:内容必须独占行。若与 `<!-- ...begin -->` 挤在同一行,
    // Markdown 会把该行当 HTML 块,后面的表格就渲染不出来了。
    const want = '\n' + render(roster).trim() + '\n';
    const loc = locateBlock(doc.content, block);
    if (loc.missing) { doc.blocks.push({ block, status: 'no-marker' }); continue; }
    if (loc.error) { doc.blocks.push({ block, status: 'bad-marker', error: loc.error }); continue; }
    const has = doc.content.slice(loc.start, loc.end);
    doc.blocks.push({ block, status: has === want ? 'ok' : 'drift', want, has, loc });
  }
  return [...byFile.values()];
}

/** 把嵌套的 (文件 → 块) 计划摊平成带 rel 的块列表 */
const flattenPlan = (plan) => plan.flatMap(d => d.blocks.map(b => ({ ...b, rel: d.rel })));

// ────────────────────────────── 各命令 ──────────────────────────────

function cmdAudit(roster, tiers) {
  const lines = [];
  const warn = [], bad = [];
  const eff = resolvedTiers();          // qwen_common 实际会用的档位
  const rec = recommendTiers(roster);
  const freeze = freezeState(roster);

  // 期限
  if (roster.recheckBy && today() > roster.recheckBy) {
    warn.push(`复核期限已过(${roster.recheckBy});请按 MODEL_UPGRADE.md 重查跑分`);
  }
  if (freeze.frozen) warn.push(`档位冻结中(至 ${freeze.until});--apply 会被拒绝`);

  // 生效档位是否都在 roster 里(抓"模型下线了但配置还指着它")
  for (const [prov, modes] of Object.entries(eff.providers)) {
    const known = new Set(Object.keys(roster.providers[prov]?.models || {}));
    for (const [mode, id] of Object.entries(modes.modeModels || {})) {
      if (id && !known.has(id)) {
        bad.push(`生效档位不在 roster 中:${prov}/${mode} → ${id}(模型已下线?请更新 roster 或 --apply)`);
      }
    }
  }

  // 推荐 vs 生效
  lines.push('## 推荐档位(由 roster 按维度 argmax 推导)');
  lines.push('');
  lines.push('| provider | mode | 生效 | 推荐 | 主维度分 |');
  lines.push('|---|---|---|---|---|');
  let drift = 0;
  for (const [prov, modes] of Object.entries(rec)) {
    const pol = roster.policy;
    for (const [mode, want] of Object.entries(modes)) {
      const now = eff.providers[prov]?.modeModels?.[mode] ?? '(无)';
      const same = now === want;
      if (!same) drift++;
      const m = roster.providers[prov]?.models?.[want];
      const sc = m?.scores?.[pol[mode].primary];
      // 漂移标记挂在"推荐"格里,不另起一行(另起行会撑散表格)
      lines.push(`| ${PROVIDERS[prov]?.label ?? prov} | ${mode} | \`${now}\` | `
        + `\`${want ?? '—'}\`${same ? '' : ' ⚠️'} | ${sc ? `${sc.v} (${sc.bench})` : '—'} |`);
    }
  }
  // 漂移的严重度取决于是否冻结:冻结期内背离是**预期**的,不该判失败
  const sev = freeze.frozen ? warn : bad;
  const tail = freeze.frozen
    ? '(冻结期内属预期;解冻后跑 --apply)'
    : ' → 跑 `node scripts/model_audit.mjs --apply`,再 `--sync-docs --write`';

  lines.push('');
  if (drift) {
    lines.push(`**有 ${drift} 处漂移**${tail}。`);
    sev.push(`档位漂移 ${drift} 处:生效档位 ≠ roster 推导${tail}`);
  } else {
    lines.push('✅ 无漂移:生效档位与 roster 推导一致。');
  }

  // 生成物 vs 推荐
  lines.push('');
  if (!tiers) {
    if (fs.existsSync(TIERS_FILE)) {
      // 存在但解析不了 = 损坏(手改过?写入被打断?)——运行时虽已安全回落,但这是真故障,要报
      sev.push('生成物 `tiers.generated.json` 存在但无法解析(损坏)→ 跑 --apply 重建');
      lines.push('- ❌ 生成物**损坏**(运行时已静默回落硬编码基线,主线未受影响)。跑 `--apply` 重建。');
    } else {
      lines.push('- ⚠️ 生成物 `tiers.generated.json` 不存在 → 运行时正在用硬编码基线(不影响主线)。跑 `--apply` 生成。');
    }
  } else {
    const same = JSON.stringify(tiers.providers) === JSON.stringify(buildTiers(roster).providers);
    if (same) lines.push(`- ✅ 生成物与 roster 一致(生成于 ${tiers.generatedAt})。`);
    else sev.push(`生成物与 roster 推导不一致${tail}`);
  }

  // 文档标记块
  const docs = flattenPlan(planDocSync(roster));
  const driftDocs = docs.filter(d => d.status === 'drift');
  const noMarker = docs.filter(d => d.status === 'no-marker');
  const badDocs = docs.filter(d => d.status === 'bad-marker');
  // 标记块本身坏了(缺失/重复)永远是硬故障,与冻结无关
  if (badDocs.length) badDocs.forEach(d => bad.push(`${d.error} (${d.rel})`));
  if (driftDocs.length) {
    // 文档块按"生效档位 + 背离提示"渲染,所以冻结期的漂移同样属于预期,跟随 sev
    sev.push(`文档漂移 ${driftDocs.length} 处:${driftDocs.map(d => `${d.rel}#${d.block}`).join('、')} → 跑 --sync-docs --write`);
    lines.push(`- ${freeze.frozen ? '⚠️' : '❌'} 文档待同步 ${driftDocs.length} 处 → \`--sync-docs --write\``);
  }
  if (noMarker.length) {
    warn.push(`未铺标记块(不参与同步):${noMarker.map(d => `${d.rel}#${d.block}`).join('、')}`);
  }
  if (!driftDocs.length && !noMarker.length && !badDocs.length) lines.push('- ✅ 所有文档标记块与 roster 一致。');

  console.log(lines.join('\n'));
  reportIssues(bad, warn);
  return bad.length === 0;
}

function reportIssues(bad, warn) {
  if (warn.length) {
    console.error('\n⚠️  提示(不阻断):');
    warn.forEach(w => console.error('  - ' + w));
  }
  if (bad.length) {
    console.error('\n❌ 问题:');
    bad.forEach(b => console.error('  - ' + b));
    process.exitCode = 1;
  }
}

function cmdApply(roster, force) {
  const freeze = freezeState(roster);
  if (freeze.frozen && !force) {
    console.error(`⚠️  档位冻结中(至 ${freeze.until}),拒绝写入。确需写入加 --force。`);
    process.exitCode = 1;
    return;
  }
  const next = buildTiers(roster);
  const prev = readGenerated();
  const changed = !prev || JSON.stringify(prev.providers) !== JSON.stringify(next.providers);
  if (!changed) {
    console.error('无变化,未写入。');
    console.log(JSON.stringify(next.providers, null, 2));
    return;
  }
  fs.writeFileSync(TIERS_FILE, JSON.stringify(next, null, 2) + '\n');
  console.error(`✓ 已写 ${path.relative(SKILL_ROOT, TIERS_FILE)}(roster@${next.rosterUpdatedAt})`);
  console.log(JSON.stringify(next.providers, null, 2));
}

function cmdSyncDocs(roster, write) {
  let drifted = 0, writtenFiles = 0, problems = 0;
  for (const doc of planDocSync(roster)) {
    if (doc.content === null) { console.log(`  · ${doc.rel} — 文件不存在,跳过`); continue; }
    const edits = doc.blocks.filter(b => b.status === 'drift');
    for (const b of doc.blocks) {
      if (b.status === 'ok') { console.log(`  ✓ ${doc.rel} #${b.block} — 无变化`); continue; }
      if (b.status === 'no-marker') { console.log(`  · ${doc.rel} #${b.block} — 无标记块,跳过`); continue; }
      if (b.status === 'bad-marker') { console.error(`  ✗ ${doc.rel} #${b.block} — ${b.error}`); problems++; continue; }
      drifted++;
      console.log(`  ✎ ${doc.rel} #${b.block} — 待更新`);
      // 只显示第一处差异,避免刷屏
      const a = b.has.trim().split('\n'), w = b.want.trim().split('\n');
      for (let i = 0; i < Math.max(a.length, w.length); i++) {
        if (a[i] !== w[i]) {
          if (a[i] !== undefined) console.log(`      - ${a[i]}`);
          if (w[i] !== undefined) console.log(`      + ${w[i]}`);
          break;
        }
      }
    }
    if (write && edits.length) {
      // 同一文件的多个块:共用一份快照,**从后往前**替换,最后一次性写盘。
      // 顺序替换会让前面的 offset 失效;各自写盘则会让后写的块覆盖前一个块的成果。
      let content = doc.content;
      for (const b of [...edits].sort((x, y) => y.loc.start - x.loc.start)) {
        content = content.slice(0, b.loc.start) + b.want + content.slice(b.loc.end);
      }
      fs.writeFileSync(doc.file, content);
      writtenFiles++;
    }
  }
  console.log(write && writtenFiles
    ? `\n已写入 ${writtenFiles} 个文件(共 ${drifted} 处待更新)。`
    : `\n共 ${drifted} 处待更新(仅预览;加 --write 落盘)。`);
  if (problems) process.exitCode = 1;
}

async function cmdProbe(roster) {
  let bad = 0;
  for (const [prov, pdef] of Object.entries(roster.providers)) {
    for (const id of Object.keys(pdef.models || {})) {
      try {
        const r = await callModel([{ role: 'user', content: '只回复两个字母:OK' }],
          { provider: prov, model: id, returnMeta: true });
        const served = r.model;
        const ok = served === id;
        if (!ok) bad++;
        console.log(`${ok ? '✅' : '⚠️ '} ${prov}/${id} → 服务端回显 ${served}${ok ? '' : '(不一致:可能被别名/重定向)'}`);
      } catch (e) {
        bad++;
        console.log(`❌ ${prov}/${id} → ${e.message}`);
      }
    }
  }
  console.log(`\n探针:${bad === 0 ? '全部一致' : `${bad} 个异常`}。`);
  if (bad) process.exitCode = 1;
}

// ────────────────────────────── 入口 ──────────────────────────────

try {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const roster = readRoster();
  const tiers = readGenerated();

  if (has('--render')) {
    console.log(renderBenchTables(roster));
  } else if (has('--apply')) {
    cmdApply(roster, has('--force'));
  } else if (has('--sync-docs')) {
    cmdSyncDocs(roster, has('--write'));
  } else if (has('--probe')) {
    await cmdProbe(roster);
  } else {
    cmdAudit(roster, tiers);
  }
} catch (e) {
  if (!isFatal(e)) { console.error(e); process.exitCode = 1; }
}
