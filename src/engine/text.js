// 文本基础工具：清洗、分段、分句（带原文位置）、分词、统计（兼容微信小程序 Babel 编译，无 Unicode Property Escape 依赖）
const PUNCT_AND_SPACE_RE = /[\s\u0021-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007e\u00a0-\u00bf\u2000-\u206f\u3000-\u303f\uff00-\uffef]/g;
const EMOJI_RE = /[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]/;

export const clean = t => String(t == null ? '' : t)
  .replace(/\r\n?/g, '\n')
  .replace(/\u00a0/g, ' ')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

export const charsOnly = t => String(t == null ? '' : t).replace(PUNCT_AND_SPACE_RE, '');
export const charLen = t => charsOnly(t).length;

export const clamp01 = x => Math.max(0, Math.min(1, x));
export const norm = (x, lo, hi) => clamp01((x - lo) / (hi - lo));
export const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
export const std = a => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map(x => Math.pow(x - m, 2))));
};
export const cv = a => {
  const m = mean(a);
  return m ? std(a) / m : 0;
};
export const round = (x, d = 2) => {
  const p = Math.pow(10, d);
  return Math.round(x * p) / p;
};

/** 段落：[{text,start,end}]，start/end 为在 text 中的字符位置 */
export function paragraphs(text) {
  const out = [];
  const re = /[^\n]+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const trimmedStart = raw.replace(/^\s+/, '');
    const lead = raw.length - trimmedStart.length;
    const t = raw.trim();
    if (t) out.push({ text: t, start: m.index + lead, end: m.index + lead + t.length });
  }
  return out;
}

/** 句子：[{text,start,end,len}]，保留句末标点 */
export function sentences(text) {
  const out = [];
  const re = /[^。！？!?；;\n]+(?:[。！？!?；;…]+[”"』」）)]?)?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const trimmedStart = raw.replace(/^\s+/, '');
    const lead = raw.length - trimmedStart.length;
    const t = raw.trim();
    const len = charLen(t);
    if (len >= 2) out.push({ text: t, start: m.index + lead, end: m.index + lead + t.length, len });
  }
  return out;
}

export function ngrams(t, n) {
  const s = charsOnly(t);
  const set = new Set();
  for (let i = 0; i + n <= s.length; i++) set.add(s.slice(i, i + n));
  return set;
}

export function countMatches(text, regexes) {
  let c = 0;
  for (const re of regexes) {
    re.lastIndex = 0;
    const m = text.match(re);
    if (m) c += m.length;
  }
  return c;
}

/** 词表匹配，长词优先、不重叠。返回 [{word,start,end}] */
export function findWords(text, words) {
  const taken = new Uint8Array(text.length);
  const out = [];
  const sortedWords = Array.from(new Set(words)).sort((a, b) => b.length - a.length);
  for (const w of sortedWords) {
    if (!w) continue;
    let i = 0;
    while ((i = text.indexOf(w, i)) !== -1) {
      let free = true;
      for (let k = i; k < i + w.length; k++) {
        if (taken[k]) {
          free = false;
          break;
        }
      }
      if (free) {
        for (let k = i; k < i + w.length; k++) taken[k] = 1;
        out.push({ word: w, start: i, end: i + w.length });
      }
      i += w.length;
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** 正则匹配，返回 [{word,start,end}] */
export function findPatterns(text, patterns) {
  const out = [];
  for (const p of patterns) {
    const re = p instanceof RegExp ? new RegExp(p.source, 'g') : new RegExp(p, 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      if (!m[0]) {
        re.lastIndex++;
        continue;
      }
      out.push({ word: m[0], start: m.index, end: m.index + m[0].length });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export function tally(matches) {
  const m = new Map();
  for (const x of matches) m.set(x.word, (m.get(x.word) || 0) + 1);
  return Array.from(m.entries())
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count);
}

let cachedSegmenter = undefined;
function getSegmenter() {
  if (cachedSegmenter !== undefined) return cachedSegmenter;
  try {
    cachedSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter('zh', { granularity: 'word' })
      : null;
  } catch (e) {
    cachedSegmenter = null;
  }
  return cachedSegmenter;
}

/** 关键词：优先用 Intl.Segmenter 分词，不支持时退化为二元组 */
export function keywords(text, stopwords = [], k = 30) {
  const stop = stopwords instanceof Set ? stopwords : new Set(stopwords);
  const freq = new Map();
  const add = w => freq.set(w, (freq.get(w) || 0) + 1);
  const seg = getSegmenter();
  if (seg) {
    for (const s of seg.segment(text)) {
      if (!s.isWordLike) continue;
      const w = s.segment.trim();
      if (charLen(w) < 2 || stop.has(w) || /^[\d.]+$/.test(w)) continue;
      add(w.toLowerCase());
    }
  } else {
    const s = charsOnly(text);
    for (let i = 0; i + 2 <= s.length; i++) {
      const g = s.slice(i, i + 2);
      if (!stop.has(g) && !/\d/.test(g)) add(g);
    }
  }
  let list = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]);
  const strong = list.filter(([, c]) => c >= 2);
  if (strong.length >= 8) list = strong;
  return list.slice(0, k).map(([w]) => w);
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  const sm = a.size < b.size ? a : b;
  const lg = a.size < b.size ? b : a;
  let inter = 0;
  for (const x of sm) if (lg.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export const titleLen = t => Array.from(String(t || '').trim()).length;
export const hasEmoji = t => EMOJI_RE.test(String(t || ''));
