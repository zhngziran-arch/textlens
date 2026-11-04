// 规则引擎回归测试（每次 push / Netlify 部署自动执行）
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeSingle, analyzeBatch, insights, toMarkdown } from '../src/engine/index.js';
import { renderHighlightedText } from '../src/ui/highlight.js';
import { SINGLE_SAMPLES, BATCH_SAMPLES } from '../src/samples.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

const common = readJson('rules/common.json');
const idx = readJson('rules/index.json');
const platforms = Object.fromEntries(idx.platforms.map(p => [p.id, readJson(`rules/${p.file}`)]));

// 1. 反面模板稿 vs 高信息量真实稿：风险分应有显著区分
const badWechat = analyzeSingle(SINGLE_SAMPLES.wechat, common, platforms.wechat);
const goodGeneral = analyzeSingle(SINGLE_SAMPLES.general, common, platforms.general);

assert.ok(badWechat.overall >= 55, `模板稿综合分应较高，实际为 ${badWechat.overall}`);
assert.ok(goodGeneral.overall <= 30, `高信息量实测稿综合分应较低，实际为 ${goodGeneral.overall}`);
assert.ok(badWechat.dims.aiStyle.score > goodGeneral.dims.aiStyle.score + 30, 'AI 文风分应显著拉开差距');
assert.ok(goodGeneral.info.coverage > badWechat.info.coverage + 0.35, '真实稿的信息覆盖度应显著更高');

// 2. 小红书广告法极限词与种草套话识别
const xhsRes = analyzeSingle(SINGLE_SAMPLES.xhs, common, platforms.xhs);
assert.ok(xhsRes.dims.platformFit.score >= 50, `小红书极限词稿平台适配风险应较高，实际 ${xhsRes.dims.platformFit.score}`);
assert.ok(xhsRes.highlights.some(h => h.ruleId === 'XHS-001'), '应标出 XHS-001 广告法极限词');

// 3. 原文内联高亮 HTML 切分不丢字
const html = renderHighlightedText(badWechat.text, badWechat.highlights);
const stripped = html.replace(/<br\/>/g, '\n').replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
assert.equal(stripped, badWechat.text, '内联高亮渲染去标签后应与原文逐字一致');

// 4. 多篇对比：前 3 篇同质化模板稿相似度高，第 4 篇实测复盘稿新颖度高
const batchRes = analyzeBatch(BATCH_SAMPLES, common, platforms.wechat);
assert.equal(batchRes.count, 4);
const pair01 = batchRes.pairs.find(p => p.a === 0 && p.b === 1);
const pair03 = batchRes.pairs.find(p => p.a === 0 && p.b === 3);
assert.ok(pair01.structure > 0.8, `前两篇模板稿结构相似度应 > 0.8，实际 ${pair01.structure}`);
assert.ok(pair01.topic > pair03.topic, '同题材模板稿之间的选题重合度应高于与实测稿的重合度');
assert.ok(batchRes.articles[3].novelty > batchRes.articles[1].novelty, '第 4 篇差异化实测稿的新内容占比应更高');

// 5. Markdown 导出非空且包含关键段落
const md = toMarkdown(batchRes);
assert.ok(md.includes('两两相似度矩阵') && md.includes('优化建议'), 'Markdown 导出应包含完整章节');

// 6. 个人规律相关性：满 6 篇带推荐阅读数时返回 Spearman 系数
const sixDocs = [
  ...BATCH_SAMPLES,
  { ...SINGLE_SAMPLES.general, date: '2026-11-01', recommendedReads: 14200 },
  { ...SINGLE_SAMPLES.wechat, date: '2026-11-02', recommendedReads: 95 }
].map((x, i) => ({ id: `t${i}`, ...x }));
const ins = insights(sixDocs, common, platforms.wechat);
assert.equal(ins.withReads, 6);
assert.ok(ins.correlations.length >= 6, '满 6 篇应输出相关性列表');

console.log('✅ TextLens 全部引擎测试通过！', {
  badWechatScore: badWechat.overall,
  goodGeneralScore: goodGeneral.overall,
  xhsPlatformPenalty: xhsRes.dims.platformFit.score,
  batchOverall: batchRes.overall
});
