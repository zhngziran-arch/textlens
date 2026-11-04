// 信息增量：数据 / 时间 / 出处 / 亲历 / 案例
import { findPatterns, charLen, mean, round, clamp01 } from './text.js';

export function analyzeInfo(text, paras, len, rules) {
  const k = 1000 / Math.max(len, 1);
  const cats = Object.entries(rules.info).map(([key, c]) => {
    const matches = findPatterns(text, c.patterns);
    const density = matches.length * k;
    return {
      key,
      id: c.id,
      label: c.label,
      count: matches.length,
      density: round(density),
      target: c.target,
      fill: round(clamp01(density / c.target)),
      matches
    };
  });
  const coverage = round(mean(cats.map(c => c.fill)));
  const all = cats.reduce((acc, c) => acc.concat(c.matches), []);

  // 信息稀薄段落：足够长、但不含任何具体信息（记录段落序号与首句预览，供智能处方精确定位）
  const minChars = rules.thresholds.thinParagraph.minChars;
  const thin = [];
  paras.forEach((p, idx) => {
    const pLen = charLen(p.text);
    const hasAnchor = all.some(m => m.start >= p.start && m.end <= p.end);
    if (pLen >= minChars && !hasAnchor) {
      thin.push({
        start: p.start,
        end: p.end,
        paraIndex: idx + 1,
        charCount: pLen,
        preview: p.text.slice(0, 16)
      });
    }
  });

  const hl = thin.map(p => ({
    start: p.start,
    end: p.end,
    type: 'info',
    ruleId: 'INFO-THIN',
    label: `第${p.paraIndex}段信息稀薄`,
    msg: `第 ${p.paraIndex} 段（“${p.preview}…”共 ${p.charCount} 字）纯属抽象议论，未包含任何数字、时间、出处、亲历或案例。建议在此段插入 1 个具体数字或实测细节。`
  }));

  const missing = cats.filter(c => c.fill < 0.34).map(c => c.label);
  const findings = [];
  if (missing.length) {
    findings.push({
      ruleId: 'INFO',
      type: 'info',
      text: `信息维度缺口：全文较缺少【${missing.join('、')}】（按每千字基准计算）`
    });
  }
  if (thin.length) {
    const locStr = thin.slice(0, 3).map(t => `第${t.paraIndex}段(“${t.preview.slice(0, 8)}…”)
`).join('、').replace(/\n/g, '');
    findings.push({
      ruleId: 'INFO-THIN',
      type: 'info',
      text: `定位到 ${thin.length} 个空洞长段落：${locStr}`
    });
  }

  return {
    coverage,
    thinCount: thin.length,
    thinParas: thin,
    radar: cats.map(({ matches, ...c }) => ({
      ...c,
      examples: Array.from(new Set(matches.map(m => m.word))).slice(0, 5)
    })),
    highlights: hl,
    findings
  };
}

/** 信息增量风险分：覆盖度越低风险越高；有批量新颖度时一起考虑 */
export function lowInfoScore(info, paraCount, novelty = null, T = null) {
  const thinRatio = paraCount ? info.thinCount / paraCount : 0;
  const base = 0.75 * (1 - info.coverage) + 0.25 * clamp01(thinRatio * 2);
  if (novelty === null) return Math.round(100 * base);
  const nov = clamp01((novelty - T.novelty.lo) / (T.novelty.hi - T.novelty.lo));
  return Math.round(100 * (0.75 * base + 0.25 * (1 - nov)));
}
