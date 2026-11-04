// 多篇对比：标题 / 选题 / 正文 / 结构相似度、跨文重复句
import { charLen, charsOnly, ngrams, jaccard, sentences as splitSentences } from './text.js';

const HEADING_RE = /^(#{1,6}\s|[一二三四五六七八九十]+[、.．]|\d{1,2}[、.．)）]|第[一二三四五六七八九十\d]+[点部分章步个]|[（(][一二三四五六七八九十\d]+[)）])/;
export const OPENING_LABEL = { question: '问题引入', hotspot: '热点引入', data: '数据开头', story: '故事/经历开头', quote: '引语开头', statement: '直接陈述' };
export const ENDING_LABEL = { cta: '号召互动', question: '提问收尾', summary: '总结收尾', golden: '金句收尾', plain: '自然收尾' };

export function isHeading(p, total) {
  return HEADING_RE.test(p.text) || (total > 4 && charLen(p.text) <= 16 && !/[。！？!?，,；;：:…]$/.test(p.text));
}
function headingStyle(hs) {
  if (!hs.length) return 'none';
  const h = hs[0].text;
  if (/^#/.test(h)) return 'markdown';
  if (/^[一二三四五六七八九十]+[、.．]/.test(h)) return 'cn-num';
  if (/^\d/.test(h)) return 'num';
  if (/^第/.test(h)) return 'ordinal';
  return 'short-line';
}
export function classifyOpening(s = '') {
  s = s.slice(0, 120);
  if (/^(“|"|「)|有人说|俗话说|曾经说过|说过一句/.test(s)) return 'quote';
  if (/近日|日前|刚刚|热搜|冲上|官宣|发布会/.test(s)) return 'hotspot';
  if (/[？?]/.test(s)) return 'question';
  if (/那天|那年|去年|前几天|昨天|上周|记得|我有个|朋友|小时候|当时/.test(s)) return 'story';
  if (/\d/.test(s)) return 'data';
  return 'statement';
}
export function classifyEnding(s = '', rules) {
  s = s.slice(-150);
  if (rules.lexicons.cta.words.some(w => s.includes(w))) return 'cta';
  if (/[？?]\s*$/.test(s)) return 'question';
  if (rules.lexicons.summary.words.some(w => s.includes(w))) return 'summary';
  const ss = splitSentences(s); const last = ss[ss.length - 1];
  if (last && last.len <= 22) return 'golden';
  return 'plain';
}

export function structureOf(paras, sentMean, len, rules) {
  const heads = paras.filter(p => isHeading(p, paras.length));
  const body = paras.filter(p => !heads.includes(p));
  return {
    paraCount: paras.length, avgParaLen: Math.round(len / Math.max(1, paras.length)),
    headingCount: heads.length, headingStyle: headingStyle(heads), sentenceMean: sentMean,
    opening: classifyOpening((body[0] || paras[0] || {}).text),
    ending: classifyEnding((body[body.length - 1] || paras[paras.length - 1] || {}).text, rules)
  };
}

const numSim = (a, b) => (a === 0 && b === 0 ? 1 : 1 - Math.abs(a - b) / Math.max(a, b));
export function structureSim(a, b) {
  const nums = (numSim(a.paraCount, b.paraCount) + numSim(a.avgParaLen, b.avgParaLen) + numSim(a.headingCount, b.headingCount) + numSim(a.sentenceMean, b.sentenceMean)) / 4;
  return 0.5 * nums + 0.2 * (a.opening === b.opening) + 0.2 * (a.ending === b.ending) + 0.1 * (a.headingStyle === b.headingStyle);
}

export function duplicateSentences(A, B, T) {
  const out = [];
  const bs = B.sents.filter(s => s.len >= T.dupSentence.minChars).map(s => ({ s, g: ngrams(s.text, 2) }));
  for (const s of A.sents) {
    if (s.len < T.dupSentence.minChars) continue;
    const g = ngrams(s.text, 2);
    for (const t of bs) if (jaccard(g, t.g) >= T.dupSentence.sim) { out.push({ a: s, b: t.s }); break; }
  }
  return out;
}

export function comparePair(A, B, T) {
  return {
    title: jaccard(A.titleGrams, B.titleGrams),
    topic: jaccard(A.kw, B.kw),
    content: jaccard(A.grams3, B.grams3),
    structure: structureSim(A.structure, B.structure),
    dups: duplicateSentences(A, B, T)
  };
}

export function noveltyOf(A, others) {
  if (!others.length || !A.grams3.size) return 1;
  let fresh = 0;
  for (const g of A.grams3) if (!others.some(o => o.grams3.has(g))) fresh++;
  return fresh / A.grams3.size;
}

export { charsOnly };
