// 个人规律：每篇文章相对其之前 N 篇的特征 vs 推荐流量（Spearman 秩相关）
import { mean, round } from './text.js';
import { prepare } from './index.js';
import { comparePair, noveltyOf } from './compare.js';

function rank(arr) {
  const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(arr.length);
  for (let k = 0; k < idx.length;) {
    let e = k; while (e + 1 < idx.length && idx[e + 1][0] === idx[k][0]) e++;
    const avg = (k + e) / 2 + 1; for (let m = k; m <= e; m++) r[idx[m][1]] = avg; k = e + 1;
  }
  return r;
}
function pearson(x, y) {
  const mx = mean(x), my = mean(y); let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < x.length; i++) { num += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}
export const spearman = (x, y) => pearson(rank(x), rank(y));

export const METRIC_LABEL = {
  titleSimPrev: '与近期文章的标题相似度', topicSimPrev: '与近期文章的选题相似度', contentSimPrev: '与近期文章的正文相似度',
  structSimPrev: '与近期文章的结构相似度', noveltyPrev: '相对近期文章的新内容占比',
  aiStyle: 'AI 文风分', infoCoverage: '信息增量覆盖度', length: '字数'
};

export function insights(history, rules, platform, window = 5) {
  const items = history.filter(h => (h.content || '').length >= 100)
    .sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));
  const Ps = items.map((h, i) => prepare(h, rules, platform, i));
  const T = rules.thresholds;
  const rows = items.map((h, i) => {
    const prev = Ps.slice(Math.max(0, i - window), i);
    const P = Ps[i];
    const cmp = prev.map(p => comparePair(P, p, T));
    const mx = k => (cmp.length ? Math.max(...cmp.map(c => c[k])) : 0);
    return {
      id: h.id, title: h.title, date: h.date, recommendedReads: h.recommendedReads ?? null, totalReads: h.totalReads ?? null,
      metrics: {
        titleSimPrev: round(mx('title')), topicSimPrev: round(mx('topic')), contentSimPrev: round(mx('content')),
        structSimPrev: round(mx('structure')), noveltyPrev: round(noveltyOf(P, prev)),
        aiStyle: P.style.score, infoCoverage: P.info.coverage, length: P.len
      }
    };
  });
  const valid = rows.filter(r => typeof r.recommendedReads === 'number' && r.recommendedReads >= 0);
  let correlations = [];
  if (valid.length >= 6) {
    const y = valid.map(r => Math.log1p(r.recommendedReads));
    correlations = Object.keys(METRIC_LABEL).map(k => {
      const rho = round(spearman(valid.map(r => r.metrics[k]), y));
      return { key: k, label: METRIC_LABEL[k], rho, strength: Math.abs(rho) >= 0.5 ? '较强' : Math.abs(rho) >= 0.3 ? '中等' : '弱' };
    }).sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho));
  }
  return {
    total: rows.length, withReads: valid.length, rows, correlations,
    note: valid.length < 6
      ? `已填写推荐阅读数的文章 ${valid.length} 篇，至少需要 6 篇才计算相关性（建议 15 篇以上结论才较稳定）。`
      : `基于 ${valid.length} 篇文章的 Spearman 秩相关。样本较小，相关不等于因果；选题热度、发布时间等未纳入的因素同样有影响。`
  };
}
