// Markdown 报告导出（单篇与多篇通用）
const pct = x => `${Math.round(x * 100)}%`;
const fmtObj = o => Object.entries(o).map(([k, v]) => `${k}×${v}`).join('，');

export function toMarkdown(r) {
  const L = [];
  L.push(`# TextLens 文本体检报告（${r.mode === 'batch' ? '多篇对比' : '单篇体检'}）`, '');
  L.push(`- 生成时间：${new Date(r.generatedAt).toLocaleString('zh-CN')}`);
  L.push(`- 平台体裁配置：${r.platform.name}（rules v${r.rules} / engine v${r.engine}）`);
  if (r.mode === 'batch') L.push(`- 有效文章数：${r.count} 篇`);
  else L.push(`- 文章标题：${r.title || '（未填标题）'}（${r.length} 字）`);
  L.push(`- **综合指数：${r.overall}（${r.level.label}）**`, '');

  L.push('## 一、维度概览', '', '| 维度 | 分数 | 等级 | 说明 |', '|---|---|---|---|');
  for (const d of Object.values(r.dims)) L.push(`| ${d.label} | ${d.score} | ${d.level.label} | ${d.desc} |`);

  if (r.mode === 'batch') {
    L.push('', '## 二、两两相似度矩阵', '', '| 文章 A | 文章 B | 标题 | 选题 | 正文 | 结构 | 跨文重复句 |', '|---|---|---|---|---|---|---|');
    for (const p of r.pairs) {
      const a = r.articles[p.a].title || `文章 ${p.a + 1}`;
      const b = r.articles[p.b].title || `文章 ${p.b + 1}`;
      L.push(`| ${a} | ${b} | ${pct(p.title)} | ${pct(p.topic)} | ${pct(p.content)} | ${pct(p.structure)} | ${p.dupCount} |`);
    }
    L.push('', '## 三、结构套路与节奏', '');
    L.push(`- 开头模式分布：${fmtObj(r.patterns.opening)}`);
    L.push(`- 结尾模式分布：${fmtObj(r.patterns.ending)}`);
    if (r.rhythm) L.push(`- 发文间隔：平均 ${r.rhythm.avgGapDays} 天，最短 ${r.rhythm.minGapDays} 天；7 天内题材接近 ${r.rhythm.closeSimilarPairs} 对`);
    L.push('', '## 四、单篇明细', '');
    r.articles.forEach((a, idx) => renderArticleMd(L, a, idx + 1));
    L.push('## 五、优化建议', '');
  } else {
    L.push('', '## 二、信息增量覆盖', '', '| 类别 | 数量 | 密度(次/千字) | 目标 | 覆盖率 | 示例 |', '|---|---|---|---|---|---|');
    for (const c of r.info.radar) L.push(`| ${c.label} | ${c.count} | ${c.density} | ${c.target} | ${pct(c.fill)} | ${c.examples.slice(0, 3).join('、') || '-'} |`);
    L.push('', '## 三、文风与结构明细', '');
    renderArticleMd(L, r, null);
    L.push('## 四、优化建议', '');
  }

  r.suggestions.forEach((s, i) => L.push(`${i + 1}. **[${s.ruleId}]** ${s.text}`));
  return L.join('\n');
}

function renderArticleMd(L, a, idx) {
  if (idx !== null) L.push(`### ${idx}. ${a.title || '（未填标题）'}（${a.length} 字）`, '');
  L.push(`- 分项：AI 文风 ${a.dims.aiStyle.score} ｜ 信息增量不足 ${a.dims.lowInfo.score} ｜ 平台适配 ${a.dims.platformFit.score}${a.novelty !== null ? ` ｜ 新内容占比 ${pct(a.novelty)}` : ''}`);
  L.push(`- 结构：${a.structure.paraCount} 段，${a.structure.headingCount} 个小标题，开头「${a.structure.opening}」，结尾「${a.structure.ending}」，平均句长 ${a.style.sentenceMean}，句长变异系数 ${a.style.sentenceCV}`);
  if (a.titleCheck.issues.length) L.push(`- 标题提示：${a.titleCheck.issues.join('；')}`);
  for (const f of a.findings) L.push(`- [${f.ruleId}] ${f.text}`);
  L.push('');
}
