/**
 * TextLens 创作透镜核心引擎（微信小程序原生单文件 CommonJS 版）
 * 零外部依赖、零跨文件循环引用、100% 兼容微信小程序原生运行时
 */

// ==================== 1. 基础文本工具 ====================
const PUNCT_AND_SPACE_RE = /[\s\u0021-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007e\u00a0-\u00bf\u2000-\u206f\u3000-\u303f\uff00-\uffef]/g;
const EMOJI_RE = /[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF]/;

const clean = t => String(t == null ? '' : t)
  .replace(/\r\n?/g, '\n')
  .replace(/\u00a0/g, ' ')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const charsOnly = t => String(t == null ? '' : t).replace(PUNCT_AND_SPACE_RE, '');
const charLen = t => charsOnly(t).length;

const clamp01 = x => Math.max(0, Math.min(1, x));
const norm = (x, lo, hi) => clamp01((x - lo) / (hi - lo));
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const std = a => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map(x => Math.pow(x - m, 2))));
};
const cv = a => {
  const m = mean(a);
  return m ? std(a) / m : 0;
};
const round = (x, d = 2) => {
  const p = Math.pow(10, d);
  return Math.round(x * p) / p;
};

function paragraphs(text) {
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

function sentences(text) {
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

function ngrams(t, n) {
  const s = charsOnly(t);
  const set = new Set();
  for (let i = 0; i + n <= s.length; i++) set.add(s.slice(i, i + n));
  return set;
}

function findWords(text, words) {
  const taken = new Uint8Array(text.length);
  const out = [];
  const sortedWords = Array.from(new Set(words || [])).sort((a, b) => b.length - a.length);
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

function findPatterns(text, patterns) {
  const out = [];
  for (const p of (patterns || [])) {
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

function tally(matches) {
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

function keywords(text, stopwords = [], k = 30) {
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

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  const sm = a.size < b.size ? a : b;
  const lg = a.size < b.size ? b : a;
  let inter = 0;
  for (const x of sm) if (lg.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const titleLen = t => Array.from(String(t || '').trim()).length;
const hasEmoji = t => EMOJI_RE.test(String(t || ''));

// ==================== 2. 文风与模板特征检测 ====================
function parallelRuns(sents) {
  const runs = [];
  let startIdx = 0;
  const head = s => charsOnly(s.text).slice(0, 2);
  for (let i = 1; i <= sents.length; i++) {
    const same = i < sents.length && head(sents[i]).length === 2 && head(sents[i]) === head(sents[i - 1]);
    if (!same) {
      if (i - startIdx >= 3) {
        runs.push({
          start: sents[startIdx].start,
          end: sents[i - 1].end,
          count: i - startIdx,
          head: head(sents[startIdx])
        });
      }
      startIdx = i;
    }
  }
  return runs;
}

function monotoneRanges(sents, { size, maxCV, minSentences }) {
  if (sents.length < minSentences) return [];
  const ranges = [];
  for (let i = 0; i + size <= sents.length; i++) {
    const win = sents.slice(i, i + size);
    if (win.every(s => s.len >= 8) && cv(win.map(s => s.len)) < maxCV) {
      const r = { start: win[0].start, end: win[size - 1].end, sample: win[0].text.slice(0, 18) };
      const last = ranges[ranges.length - 1];
      if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
      else ranges.push(r);
    }
  }
  return ranges;
}

function analyzeStyle(text, sents, len, rules) {
  const L = rules.lexicons;
  const T = rules.thresholds;
  const conn = findWords(text, L.aiConnectors ? L.aiConnectors.words : []);
  const hollow = findWords(text, L.hollow ? L.hollow.words : []);
  const cliche = findPatterns(text, L.cliches ? L.cliches.patterns : []);
  const preachy = findWords(text, L.preachy ? L.preachy.words : []);
  const filler = findWords(text, L.fillerEmotion ? L.fillerEmotion.words : []);

  const par = parallelRuns(sents);
  const mono = monotoneRanges(sents, T.rhythmWindow);
  const lens = sents.map(s => s.len);
  const k = 1000 / Math.max(len, 1);

  const f = {
    connDensity: round(conn.length * k),
    hollowDensity: round((hollow.length + preachy.length * 0.8 + filler.length * 0.8) * k),
    clicheDensity: round(cliche.length * k),
    preachyCount: preachy.length,
    fillerCount: filler.length,
    sentenceCount: sents.length,
    sentenceMean: round(mean(lens), 1),
    sentenceCV: round(cv(lens)),
    parallel: par.length,
    parallelList: par,
    monotoneRanges: mono.length,
    monotoneList: mono,
    topConnectors: tally(conn).slice(0, 8),
    topHollow: tally(hollow).slice(0, 8),
    topCliches: tally(cliche).slice(0, 6),
    topPreachy: tally(preachy).slice(0, 6),
    topFiller: tally(filler).slice(0, 6)
  };

  const shortText = sents.length < T.rhythmWindow.minSentences;
  const score = Math.round(100 * (
    0.28 * norm(f.connDensity, T.connDensity.lo, T.connDensity.hi) +
    0.24 * norm(f.hollowDensity, T.hollowDensity.lo, T.hollowDensity.hi) +
    0.15 * norm(f.clicheDensity, T.clicheDensity.lo, T.clicheDensity.hi) +
    (shortText ? 0 : 0.23 * norm(T.sentenceCV.hi - f.sentenceCV, 0, T.sentenceCV.hi - T.sentenceCV.lo)) +
    0.10 * norm(f.parallel, T.parallelRuns.lo, T.parallelRuns.hi)
  ) / (shortText ? 0.77 : 1));

  const hl = [];
  const lx = (arr, lex, type) => {
    if (!lex) return;
    arr.forEach(m => hl.push({
      start: m.start,
      end: m.end,
      type,
      ruleId: lex.id,
      label: lex.name,
      msg: `${lex.name}：“${m.word}”。${lex.advice || ''}`
    }));
  };
  lx(conn, L.aiConnectors, 'ai');
  lx(hollow, L.hollow, 'ai');
  lx(cliche, L.cliches, 'ai');
  lx(preachy, L.preachy, 'ai');
  lx(filler, L.fillerEmotion, 'ai');

  par.forEach(r => hl.push({
    start: r.start,
    end: r.end,
    type: 'rhythm',
    ruleId: 'AI-004',
    label: '排比堆叠',
    msg: `连续 ${r.count} 句以“${r.head}”开头。密集同字排比容易产生机器生成感，建议保留 2 句并打乱第 3 句的句式。`
  }));
  mono.forEach(r => hl.push({
    start: r.start,
    end: r.end,
    type: 'rhythm',
    ruleId: 'AI-005',
    label: '节奏单调',
    msg: `该区间连续多句字数高度接近（变异系数 < ${T.rhythmWindow.maxCV}），建议插入一句 6 字以内的短促反问或结论打破节拍。`
  }));

  const findings = [];
  if (f.connDensity >= 5.5) {
    findings.push({
      ruleId: L.aiConnectors.id,
      type: 'ai',
      text: `机械连接词偏密（${f.connDensity} 次/千字，自然叙事常见 2–5）：${f.topConnectors.slice(0, 4).map(x => `“${x.word}”×${x.count}`).join('、')}`
    });
  }
  if (hollow.length >= 2 || f.hollowDensity >= 1.5) {
    findings.push({
      ruleId: L.hollow.id,
      type: 'ai',
      text: `互联网黑话/空泛大词命中 ${hollow.length} 处：${f.topHollow.slice(0, 5).map(x => `“${x.word}”×${x.count}`).join('、')}`
    });
  }
  if (cliche.length >= 1) {
    findings.push({
      ruleId: L.cliches.id,
      type: 'ai',
      text: `典型模板句式 ${cliche.length} 处：${f.topCliches.slice(0, 3).map(x => `“${x.word}”`).join('、')}`
    });
  }
  if (preachy.length >= 1 && L.preachy) {
    findings.push({
      ruleId: L.preachy.id,
      type: 'ai',
      text: `说教腔/悬浮金句 ${preachy.length} 处：${f.topPreachy.slice(0, 4).map(x => `“${x.word}”`).join('、')}`
    });
  }
  if (filler.length >= 1 && L.fillerEmotion) {
    findings.push({
      ruleId: L.fillerEmotion.id,
      type: 'ai',
      text: `情绪注水/自嗨词 ${filler.length} 处：${f.topFiller.slice(0, 4).map(x => `“${x.word}”`).join('、')}`
    });
  }
  if (!shortText && f.sentenceCV < 0.42) {
    findings.push({
      ruleId: 'AI-005',
      type: 'rhythm',
      text: `全篇句长过于整齐划一（平均句长 ${f.sentenceMean} 字，变异系数仅 ${f.sentenceCV}，真人写作通常 > 0.50）`
    });
  }
  if (par.length >= 1) {
    findings.push({
      ruleId: 'AI-004',
      type: 'rhythm',
      text: `发现 ${par.length} 组连续以“${par.map(p => p.head).join('/')}”开头的机械排比句`
    });
  }

  return { score, features: f, highlights: hl, findings };
}

// ==================== 3. 信息增量检测 ====================
function analyzeInfo(text, paras, len, rules) {
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

function lowInfoScore(info, paraCount, novelty = null, T = null) {
  const thinRatio = paraCount ? info.thinCount / paraCount : 0;
  const base = 0.75 * (1 - info.coverage) + 0.25 * clamp01(thinRatio * 2);
  if (novelty === null) return Math.round(100 * base);
  const nov = clamp01((novelty - T.novelty.lo) / (T.novelty.hi - T.novelty.lo));
  return Math.round(100 * (0.75 * base + 0.25 * (1 - nov)));
}

// ==================== 4. 平台体裁适配 ====================
const SEV = { high: 25, mid: 12, low: 5 };
const SEV_LABEL = { high: '高', mid: '中', low: '低' };

function analyzePlatform(title, text, len, info, platform) {
  const findings = [];
  const hl = [];
  const titleIssues = [];
  let penalty = 0;

  const { min, max } = platform.length || {};
  if (min && len < min) {
    penalty += 30 * clamp01((min - len) / min);
    findings.push({ ruleId: 'PF-LEN', type: 'platform', text: `正文 ${len} 字，低于${platform.name}常见体量 ${min}–${max} 字` });
  }
  if (max && len > max) {
    penalty += 15 * clamp01((len - max) / max);
    findings.push({ ruleId: 'PF-LEN', type: 'platform', text: `正文 ${len} 字，超过${platform.name}常见体量上限 ${max} 字，可考虑拆分` });
  }

  const tl = titleLen(title);
  if (title) {
    if (platform.title && platform.title.max && tl > platform.title.max) {
      penalty += 8;
      titleIssues.push(`标题 ${tl} 字，超过建议上限 ${platform.title.max} 字`);
    }
    if (platform.title && platform.title.min && tl < platform.title.min) {
      penalty += 5;
      titleIssues.push(`标题 ${tl} 字，信息量可能不足（建议 ≥ ${platform.title.min}）`);
    }
  } else {
    titleIssues.push('未填写标题');
  }

  for (const lex of (platform.lexicons || [])) {
    const where = lex.where || 'both';
    const bodyHits = where !== 'title' ? findWords(text, lex.words) : [];
    const titleHits = where !== 'body' ? findWords(title || '', lex.words) : [];
    const n = bodyHits.length + titleHits.length;
    if (!n) continue;
    penalty += Math.min(SEV[lex.severity] * n, SEV[lex.severity] * 3);
    const words = Array.from(new Set(titleHits.concat(bodyHits).map(h => h.word)));
    findings.push({
      ruleId: lex.id,
      type: 'platform',
      severity: lex.severity,
      text: `【${SEV_LABEL[lex.severity]}】${lex.name}：${words.slice(0, 6).map(w => `“${w}”`).join('、')}${titleHits.length ? '（含标题）' : ''}。${lex.advice || ''}`
    });
    if (titleHits.length) titleIssues.push(`${lex.name}：${Array.from(new Set(titleHits.map(h => h.word))).join('、')}`);
    bodyHits.forEach(h => hl.push({
      start: h.start,
      end: h.end,
      type: 'platform',
      ruleId: lex.id,
      label: lex.name,
      msg: `${lex.name}：“${h.word}”。${lex.advice || ''}`
    }));
  }

  let tagCount = null;
  if (platform.tags) {
    tagCount = (text.match(/#[^\s#]{1,20}/g) || []).length;
    if (tagCount < platform.tags.min) {
      penalty += 5;
      findings.push({ ruleId: 'PF-TAG', type: 'platform', text: `话题标签 ${tagCount} 个，建议 ${platform.tags.min}–${platform.tags.max} 个，帮助内容被检索和归类` });
    }
    if (tagCount > platform.tags.max) {
      penalty += 5;
      findings.push({ ruleId: 'PF-TAG', type: 'platform', text: `话题标签 ${tagCount} 个，过多会稀释主题（建议 ≤ ${platform.tags.max}）` });
    }
  }

  if (platform.evidence) {
    const src = info.radar.find(c => c.key === 'source');
    if (src && src.density < platform.evidence.minPer1000) {
      penalty += 10;
      findings.push({ ruleId: 'PF-EVID', type: 'platform', text: `出处/引用 ${src.density} 处/千字，${platform.name}读者更看重论据，建议补充来源` });
    }
  }

  return {
    score: Math.round(Math.min(100, penalty)),
    title: { text: title, length: tl, emoji: hasEmoji(title || ''), hasNumber: /\d/.test(title || ''), issues: titleIssues },
    tagCount,
    findings,
    highlights: hl
  };
}

// ==================== 5. 结构与多篇对比 ====================
const HEADING_RE = /^(#{1,6}\s|[一二三四五六七八九十]+[、.．]|\d{1,2}[、.．)）]|第[一二三四五六七八九十\d]+[点部分章步个]|[（(][一二三四五六七八九十\d]+[)）])/;
const OPENING_LABEL = { question: '问题引入', hotspot: '热点引入', data: '数据开头', story: '故事/经历开头', quote: '引语开头', statement: '直接陈述' };
const ENDING_LABEL = { cta: '号召互动', question: '提问收尾', summary: '总结收尾', golden: '金句收尾', plain: '自然收尾' };

function isHeading(p, total) {
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

function classifyOpening(s = '') {
  s = s.slice(0, 120);
  if (/^(“|"|「)|有人说|俗话说|曾经说过|说过一句/.test(s)) return 'quote';
  if (/近日|日前|刚刚|热搜|冲上|官宣|发布会/.test(s)) return 'hotspot';
  if (/[？?]/.test(s)) return 'question';
  if (/那天|那年|去年|前几天|昨天|上周|记得|我有个|朋友|小时候|当时/.test(s)) return 'story';
  if (/\d/.test(s)) return 'data';
  return 'statement';
}

function classifyEnding(s = '', rules) {
  s = s.slice(-150);
  if (rules.lexicons.cta && rules.lexicons.cta.words.some(w => s.includes(w))) return 'cta';
  if (/[？?]\s*$/.test(s)) return 'question';
  if (rules.lexicons.summary && rules.lexicons.summary.words.some(w => s.includes(w))) return 'summary';
  const ss = sentences(s);
  const last = ss[ss.length - 1];
  if (last && last.len <= 22) return 'golden';
  return 'plain';
}

function structureOf(paras, sentMean, len, rules) {
  const heads = paras.filter(p => isHeading(p, paras.length));
  const body = paras.filter(p => !heads.includes(p));
  return {
    paraCount: paras.length,
    avgParaLen: Math.round(len / Math.max(1, paras.length)),
    headingCount: heads.length,
    headingStyle: headingStyle(heads),
    sentenceMean: sentMean,
    opening: classifyOpening(((body[0] || paras[0]) || {}).text),
    ending: classifyEnding(((body[body.length - 1] || paras[paras.length - 1]) || {}).text, rules)
  };
}

const numSim = (a, b) => (a === 0 && b === 0 ? 1 : 1 - Math.abs(a - b) / Math.max(a, b));
function structureSim(a, b) {
  const nums = (numSim(a.paraCount, b.paraCount) + numSim(a.avgParaLen, b.avgParaLen) + numSim(a.headingCount, b.headingCount) + numSim(a.sentenceMean, b.sentenceMean)) / 4;
  return 0.5 * nums + 0.2 * (a.opening === b.opening) + 0.2 * (a.ending === b.ending) + 0.1 * (a.headingStyle === b.headingStyle);
}

function duplicateSentences(A, B, T) {
  const out = [];
  const bs = B.sents.filter(s => s.len >= T.dupSentence.minChars).map(s => ({ s, g: ngrams(s.text, 2) }));
  for (const s of A.sents) {
    if (s.len < T.dupSentence.minChars) continue;
    const g = ngrams(s.text, 2);
    for (const t of bs) {
      if (jaccard(g, t.g) >= T.dupSentence.sim) {
        out.push({ a: s, b: t.s });
        break;
      }
    }
  }
  return out;
}

function comparePair(A, B, T) {
  return {
    title: jaccard(A.titleGrams, B.titleGrams),
    topic: jaccard(A.kw, B.kw),
    content: jaccard(A.grams3, B.grams3),
    structure: structureSim(A.structure, B.structure),
    dups: duplicateSentences(A, B, T)
  };
}

function noveltyOf(A, others) {
  if (!others.length || !A.grams3.size) return 1;
  let fresh = 0;
  for (const g of A.grams3) if (!others.some(o => o.grams3.has(g))) fresh++;
  return fresh / A.grams3.size;
}

// ==================== 6. Markdown 报告导出 ====================
const pct = x => `${Math.round(x * 100)}%`;
const fmtObj = o => Object.entries(o).map(([k, v]) => `${k}×${v}`).join('，');

function renderArticleMd(L, a, idx) {
  if (idx !== null) L.push(`### ${idx}. ${a.title || '（未填标题）'}（${a.length} 字）`, '');
  L.push(`- 分项：AI 文风 ${a.dims.aiStyle.score} ｜ 信息增量不足 ${a.dims.lowInfo.score} ｜ 平台适配 ${a.dims.platformFit.score}${a.novelty !== null ? ` ｜ 新内容占比 ${pct(a.novelty)}` : ''}`);
  L.push(`- 结构：${a.structure.paraCount} 段，${a.structure.headingCount} 个小标题，开头「${a.structure.opening}」，结尾「${a.structure.ending}」，平均句长 ${a.style.sentenceMean}，句长变异系数 ${a.style.sentenceCV}`);
  if (a.titleCheck && a.titleCheck.issues && a.titleCheck.issues.length) L.push(`- 标题提示：${a.titleCheck.issues.join('；')}`);
  for (const f of a.findings) L.push(`- [${f.ruleId}] ${f.text}`);
  L.push('');
}

function toMarkdown(r) {
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

// ==================== 7. 主引擎与智能上下文靶向处方 ====================
const ENGINE_VERSION = '0.2.0';
const DIM_LABEL = {
  aiStyle: 'AI 文风特征',
  lowInfo: '信息增量不足',
  platformFit: '平台体裁适配',
  homogeneity: '选题/标题同质化',
  duplication: '跨文重复',
  template: '结构模板化'
};
const DIM_DESC = {
  aiStyle: '连接词、黑话套话、说教腔、模板句式密度，以及句长节奏是否机械',
  lowInfo: '数据、时间、出处、亲历、案例五维覆盖度，以及空洞长段落比例',
  platformFit: '字数区间、标题规格、平台专属词表（极限词、诱导分享、标题党等）',
  homogeneity: '多篇文章标题与核心主题词的重合集中度',
  duplication: '多篇文章之间的正文片段与跨篇高度相似句',
  template: '段落数量、开头切入方式与结尾收束套路的一致程度'
};

const WORD_REWRITE_TIPS = {
  '首先': '直接删去“首先”，或改为具体切入点（如“先看最直观的一件事”）',
  '其次': '把“其次”改为自然递进（如“再往深一层看”“光有这步还不够”）',
  '再次': '删去“再次”，直接另起一段写具体事实',
  '最后': '把“最后”改为具体时间或收束动作（如“走到这一步”“落到实操上”）',
  '此外': '把“此外”改为“顺带提一句”或直接省去连接词',
  '与此同时': '删掉句首“与此同时”，直接陈述并列发生的细节',
  '值得注意的是': '删掉“值得注意的是”，直接把后半句的核心反常点亮出来',
  '需要注意的是': '把“需要注意的是”改为“这里最容易踩的一个坑是”',
  '值得一提的是': '删掉“值得一提的是”，直接写具体事实',
  '总而言之': '删掉“总而言之/综上所述”，结尾直接落在一个具体画面或行动建议上',
  '综上所述': '删掉“综上所述”，避免公文汇报感',
  '不可否认': '删掉“不可否认/毋庸置疑”，用真实数据代替口头强调',
  '毋庸置疑': '删掉“毋庸置疑”，越绝对的套话越削弱可信度',
  '显而易见': '删掉“显而易见”，直接亮出证据',
  '归根结底': '把“归根结底”改为“说穿了就是一件事”',
  '赋能': '把“为…赋能”改为具体结果（如“帮团队每天省下 40 分钟”）',
  '抓手': '把“以…为抓手”改为“从…切入”或具体操作动作',
  '底层逻辑': '把“底层逻辑”替换为“背后的真实账本”或“根本原因”',
  '闭环': '把“形成闭环”改为具体首尾动作（如“从发现问题到当天复盘落地”）',
  '颗粒度': '把“对齐颗粒度”改为“把执行细节定到人头和小时”',
  '认知升级': '把“认知升级/思维跃迁”改为“我改变了某一个具体习惯”',
  '思维跃迁': '把“思维跃迁”改为具体的思考前后对比',
  '降维打击': '把“降维打击”改为具体的效率或成本差距数字',
  '破局': '把“如何破局”改为“怎么迈出第一步”',
  '复盘': '把抽象“复盘”改为“回头算了一笔账”',
  '沉淀': '把“沉淀方法论”改为“攒下了 3 条能直接抄的经验”',
  '日新月异': '删掉“日新月异/随着科技的发展”等宏大背景，第一句直接进具体场景',
  '随着科技的发展': '删掉“随着…的发展”开篇套话，直接从今天的一个具体问题切入',
  '在当今社会': '删掉“在当今社会/在这个时代”，改为具体年份或个人亲历场景',
  '在这个时代': '删掉“在这个…的时代”，直接写身边发生的具体变化',
  '至关重要': '把“至关重要/举足轻重”改为如果不做会造成什么具体损失',
  '提供了新的思路': '说明白到底是什么新做法，删掉“提供了新的思路”',
  '你要明白': '把说教感强的“你要明白/你要知道”改为第一人称“我踩过坑才发现”',
  '真正厉害的人': '把悬浮的“真正厉害的人/高手都在”改为某一个具体人物的真实做法',
  '干货满满': '删掉自夸式的“干货满满/吐血整理”，直接列出核心结论或步骤数',
  '颠覆认知': '删掉“颠覆认知”，写出原以为是什么、实测结果是什么的反差'
};

function levelOf(score, rules) {
  const { mid, high } = rules.thresholds.levels;
  return score < mid
    ? { key: 'low', label: '风险较低' }
    : score < high
    ? { key: 'mid', label: '中等风险' }
    : { key: 'high', label: '风险较高' };
}

function combine(dims, rules, platform) {
  const w = Object.assign({}, rules.weights, (platform && platform.weights) || {});
  const keys = Object.keys(dims);
  const sw = keys.reduce((s, k) => s + (w[k] || 0), 0) || 1;
  const weighted = keys.reduce((s, k) => s + dims[k] * (w[k] || 0), 0) / sw;
  const maxDim = Math.max.apply(null, Object.values(dims));
  return Math.round(Math.max(weighted, 0.8 * maxDim));
}

function dimsOut(dims, rules) {
  const out = {};
  for (const [k, v] of Object.entries(dims)) {
    out[k] = { score: v, level: levelOf(v, rules), label: DIM_LABEL[k], desc: DIM_DESC[k] };
  }
  return out;
}

function prepare(article, rules, platform, i = 0) {
  const title = clean(article.title);
  const text = clean(article.content);
  const len = charLen(text);
  const paras = paragraphs(text);
  const sents = sentences(text);
  const style = analyzeStyle(text, sents, len, rules);
  const info = analyzeInfo(text, paras, len, rules);
  const pf = analyzePlatform(title, text, len, info, platform);
  const structure = structureOf(paras, style.features.sentenceMean, len, rules);
  return {
    id: article.id != null ? article.id : i + 1,
    title,
    text,
    date: article.date || '',
    len,
    paras,
    sents,
    style,
    info,
    pf,
    structure,
    titleGrams: ngrams(title, 2),
    grams3: ngrams(text, 3),
    kw: new Set(keywords(text, rules.stopwords, 30))
  };
}

function singleSuggestions(d, P, platform) {
  const s = [];
  const sf = P.style.features;
  const topKw = Array.from(P.kw).slice(0, 3);
  const kwLabel = topKw.length ? `围绕本文核心词「${topKw.join('、')}」` : '针对本文主题';

  const hitWords = []
    .concat(sf.topConnectors || [], sf.topHollow || [], sf.topPreachy || [], sf.topFiller || []);

  if (hitWords.length > 0) {
    const topHits = hitWords.slice(0, 4);
    const hitSummary = topHits.map(x => `“${x.word}”(${x.count}次)`).join('、');
    const concreteTips = [];
    for (const h of topHits) {
      if (WORD_REWRITE_TIPS[h.word] && concreteTips.length < 2) {
        concreteTips.push(WORD_REWRITE_TIPS[h.word]);
      }
    }
    const fallbackTip = (sf.topPreachy && sf.topPreachy.length)
      ? `把“${sf.topPreachy[0].word}”等说教口吻改为第一人称亲历（“我当时踩的坑是…”）`
      : `直接删去句首冗余连接词，将抽象大词还原为具体的动作、耗时或数字`;

    s.push({
      ruleId: 'AI-WORD',
      text: `【靶向去套话】文中高频出现 ${hitSummary}。具体改写处方：${concreteTips.length ? concreteTips.join('；') : fallbackTip}。`
    });
  }

  if ((sf.topCliches && sf.topCliches.length > 0) || sf.sentenceCV < 0.44 || sf.parallel > 0) {
    const parts = [];
    if (sf.topCliches && sf.topCliches.length > 0) {
      parts.push(`把文中“${sf.topCliches[0].word}”这类典型 AI 过渡句直接砍掉前半截，开门见山亮出观点`);
    }
    if (sf.parallel > 0 && sf.parallelList && sf.parallelList.length > 0) {
      const p0 = sf.parallelList[0];
      parts.push(`文中存在连续 ${p0.count} 句以“${p0.head}”开头的整齐排比，建议打断第 3 句改为短促反问或具体例子`);
    }
    if (sf.sentenceCount >= 10 && sf.sentenceCV < 0.44) {
      const monoHint = (sf.monotoneList && sf.monotoneList.length > 0)
        ? `（特别是“${sf.monotoneList[0].sample}…”附近）`
        : '';
      parts.push(`全文平均句长 ${sf.sentenceMean} 字，句长变异系数仅 ${sf.sentenceCV}${monoHint}，节拍过于机械匀速。建议每隔 3~4 句插入一个 6 字以内的短句（如“结果呢？”“真没必要。”）制造呼吸感`);
    }
    if (parts.length) {
      s.push({
        ruleId: 'AI-RHY',
        text: `【句法与节奏整形】${parts.join('；')}。`
      });
    }
  }

  const missCats = P.info.radar.filter(c => c.fill < 0.35);
  const thinParas = P.info.thinParas || [];
  if (d.lowInfo >= 25 || thinParas.length > 0 || missCats.length >= 2) {
    const dimAdviceMap = {
      data: '具体前后对比数字（如耗时、百分比、成本）',
      time: '明确的时间节点（如“去年10月”“实测第3天”）',
      source: '可查证的出处或原话引用',
      experience: '第一人称实测体感（如“我试了3次发现…”）',
      case: '一个具体的反面或正面小案例'
    };
    const neededPrompts = missCats.slice(0, 3).map(c => dimAdviceMap[c.key] || c.label).join('、');

    if (thinParas.length > 0) {
      const worstPara = thinParas.slice().sort((a, b) => b.charCount - a.charCount)[0];
      s.push({
        ruleId: 'INFO-LOC',
        text: `【段落级增量手术】第 ${worstPara.paraIndex} 段（“${worstPara.preview}…”共 ${worstPara.charCount} 字）全是抽象判断，零具象锚点。建议${kwLabel}，直接在该段第 2 句后补入${neededPrompts || ' 1 个具体数字或亲身踩坑细节'}。`
      });
    } else if (missCats.length > 0) {
      s.push({
        ruleId: 'INFO-ADD',
        text: `【信息维度补齐】${kwLabel}，目前全文缺少【${missCats.map(c => c.label).join('、')}】支撑。建议在核心论点处补充${neededPrompts}，让“知识增量”肉眼可见。`
      });
    }
  }

  const firstPara = P.paras[0];
  if (firstPara && charLen(firstPara.text) >= 85 && P.structure.opening === 'statement') {
    s.push({
      ruleId: 'HOOK',
      text: `【首段完读率优化】第 1 段（“${firstPara.text.slice(0, 14)}…”共 ${charLen(firstPara.text)} 字）铺垫偏长且属平铺直叙。移动端读者前 3 秒极易划走，建议将首段拆短，第一句直接抛出反常识结果或冲突场景。`
    });
  }

  if (d.platformFit >= 15 || (P.pf.title && P.pf.title.issues.length > 0)) {
    const pfIssues = []
      .concat(P.pf.title ? P.pf.title.issues : [])
      .concat((P.pf.findings || []).map(f => f.text));
    if (pfIssues.length > 0) {
      s.push({
        ruleId: 'PF-FIT',
        text: `【${platform.name}体裁调优】${pfIssues.slice(0, 2).join('；')}。建议标题直接采用「${topKw[0] || '具体对象'} + 实测动作/反差 + 明确数字收益」结构。`
      });
    }
  }

  if (!s.length) {
    s.push({
      ruleId: 'PASS',
      text: `【高质感通过】本文（${P.len}字）词汇克制自然，句长变异系数 ${sf.sentenceCV}（节奏富有弹性），且围绕「${topKw.join('、') || '核心主题'}」具备扎实的具象信息支撑。可进一步使用「多篇对比」排查跨篇同质化。`
    });
  }
  return s;
}

function toDoc(P, rules, platform, extra = {}) {
  const noveltyVal = extra.novelty !== undefined ? extra.novelty : null;
  const dims = {
    aiStyle: P.style.score,
    lowInfo: lowInfoScore(P.info, P.paras.length, noveltyVal, rules.thresholds),
    platformFit: P.pf.score
  };
  const overall = combine(dims, rules, platform);
  const allHighlights = []
    .concat(P.style.highlights, P.info.highlights, P.pf.highlights, extra.highlights || [])
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const allFindings = [].concat(P.style.findings, P.info.findings, P.pf.findings, extra.findings || []);

  return {
    id: P.id,
    title: P.title,
    date: P.date,
    text: P.text,
    length: P.len,
    overall,
    level: levelOf(overall, rules),
    dims: dimsOut(dims, rules),
    style: P.style.features,
    info: {
      coverage: P.info.coverage,
      thinCount: P.info.thinCount,
      thinParas: P.info.thinParas || [],
      radar: P.info.radar
    },
    titleCheck: P.pf.title,
    tagCount: P.pf.tagCount,
    structure: Object.assign({}, P.structure, {
      opening: OPENING_LABEL[P.structure.opening],
      ending: ENDING_LABEL[P.structure.ending]
    }),
    keywords: Array.from(P.kw).slice(0, 12),
    novelty: noveltyVal,
    highlights: allHighlights,
    findings: allFindings,
    suggestions: singleSuggestions(dims, P, platform)
  };
}

function meta(rules, platform) {
  return {
    engine: ENGINE_VERSION,
    rules: rules.version,
    platform: { id: platform.id, name: platform.name },
    generatedAt: new Date().toISOString()
  };
}

function analyzeSingle(article, rules, platform) {
  const P = prepare(article, rules, platform);
  if (P.len < 50) throw new Error('正文太短（少于 50 字），无法分析');
  return Object.assign({ mode: 'single' }, meta(rules, platform), toDoc(P, rules, platform));
}

const countBy = arr => arr.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});
const top = o => Object.entries(o).sort((a, b) => b[1] - a[1])[0];
const relabel = (o, L) => {
  const res = {};
  for (const [k, v] of Object.entries(o)) res[L[k]] = v;
  return res;
};

function rhythmOf(Ps, pairs) {
  const ts = Ps.map(P => Date.parse(P.date));
  const dated = ts.filter(t => !isNaN(t)).sort((a, b) => a - b);
  if (dated.length < 2) return null;
  const gaps = dated.slice(1).map((t, k) => (t - dated[k]) / 864e5);
  const close = pairs.filter(p => !isNaN(ts[p.i]) && !isNaN(ts[p.j]) && Math.abs(ts[p.i] - ts[p.j]) <= 7 * 864e5 && p.topic >= 0.25).length;
  return { avgGapDays: round(mean(gaps), 1), minGapDays: round(Math.min.apply(null, gaps), 1), closeSimilarPairs: close };
}

function batchSuggestions(r, Ps, topO, topE, n) {
  const s = [];
  const d = r.dims;
  const titleOf = idx => `《${(Ps[idx] && Ps[idx].title) ? Ps[idx].title.slice(0, 14) : ('文稿' + (idx + 1))}》`;

  if (r.pairs.length > 0) {
    const worstTopicPair = r.pairs.slice().sort((a, b) => (b.topic + b.title) - (a.topic + a.title))[0];
    if (d.homogeneity.score >= 25 || worstTopicPair.topic >= 0.18 || worstTopicPair.title >= 0.25) {
      const kwStr = worstTopicPair.sharedKeywords && worstTopicPair.sharedKeywords.length
        ? `共同高频围绕「${worstTopicPair.sharedKeywords.slice(0, 5).join('、')}」展开`
        : `标题句式与核心切入点高度接近`;
      s.push({
        ruleId: 'HOMO-PAIR',
        text: `【选题撞车定位】${titleOf(worstTopicPair.a)}与${titleOf(worstTopicPair.b)}选题重合度达 ${Math.round(worstTopicPair.topic * 100)}%（标题重合 ${Math.round(worstTopicPair.title * 100)}%），${kwStr}。建议将其中一篇改为「反面踩坑复盘」或「具体人群个案深挖」，错开核心主语。`
      });
    }
  }

  const pairsWithDups = r.pairs.filter(p => p.dupCount > 0).sort((a, b) => b.dupCount - a.dupCount);
  if (pairsWithDups.length > 0) {
    const p0 = pairsWithDups[0];
    const ex0 = p0.dupExamples && p0.dupExamples[0] ? p0.dupExamples[0][0].slice(0, 28) : '';
    const totalDups = pairsWithDups.reduce((acc, p) => acc + p.dupCount, 0);
    s.push({
      ruleId: 'DUP-EXACT',
      text: `【跨篇原句复用】共检出 ${totalDups} 处跨篇相似句，最明显在${titleOf(p0.a)}与${titleOf(p0.b)}之间（如复用句：“${ex0}…”）。平台去重算法对同一账号跨篇搬运段落极敏感，请彻底重写该段表述。`
    });
  }

  if (d.template.score >= 30 || topO[1] >= Math.ceil(n * 0.65)) {
    const allOpenKeys = Object.keys(OPENING_LABEL);
    const unusedOpens = allOpenKeys.filter(k => k !== topO[0]).slice(0, 3).map(k => OPENING_LABEL[k]);
    const paraLens = Ps.map(p => `${p.structure.paraCount}段`).join('/');
    s.push({
      ruleId: 'TPL-DIFF',
      text: `【行文骨架同质】这 ${n} 篇文稿段落数为（${paraLens}），且有 ${topO[1]} 篇均采用「${OPENING_LABEL[topO[0]]}」、${topE[1]} 篇采用「${ENDING_LABEL[topE[0]]}」。下一篇建议切换为「${unusedOpens.join('」或「')}」切入，并打破固定段落数。`
    });
  }

  const wordDocFreq = new Map();
  for (const P of Ps) {
    const seenInDoc = new Set();
    const list = []
      .concat(P.style.features.topConnectors || [])
      .concat(P.style.features.topHollow || [])
      .concat(P.style.features.topPreachy || []);
    for (const item of list) {
      if (!seenInDoc.has(item.word)) {
        seenInDoc.add(item.word);
        wordDocFreq.set(item.word, (wordDocFreq.get(item.word) || 0) + 1);
      }
    }
  }
  const habitWords = Array.from(wordDocFreq.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (habitWords.length > 0) {
    const habitStr = habitWords.map(([w, c]) => `“${w}”(${c}篇出现)`).join('、');
    s.push({
      ruleId: 'AI-HABIT',
      text: `【跨篇习惯词指纹】你在多篇文稿中反复使用了 ${habitStr}。这种跨篇固定连接词/黑话极易被算法聚类为“批量模板生成账号”，建议将这些词列入你的发文前必删清单。`
    });
  }

  const weakestInfoDoc = r.articles.slice().sort((a, b) => a.info.coverage - b.info.coverage)[0];
  if (weakestInfoDoc && weakestInfoDoc.info.coverage < 0.45) {
    const miss = weakestInfoDoc.info.radar.filter(c => c.fill < 0.34).map(c => c.label).slice(0, 3);
    s.push({
      ruleId: 'INFO-WEAK',
      text: `【单篇短板点名】《${(weakestInfoDoc.title || '未命名').slice(0, 14)}》是本批中信息增量最薄弱的一篇（覆盖率仅 ${Math.round(weakestInfoDoc.info.coverage * 100)}%），缺失【${miss.join('、')}】，建议优先为该篇补入真实数据与亲历细节。`
    });
  }

  if (r.rhythm && r.rhythm.closeSimilarPairs) {
    s.push({
      ruleId: 'RHY-GAP',
      text: `【发文排期预警】检测到 ${r.rhythm.closeSimilarPairs} 对题材相近文稿在 7 天内密集发布（最短间隔 ${r.rhythm.minGapDays} 天）。同题材连续日更极易触发公域流量衰减，建议同方向选题至少间隔 3~5 天或穿插不同体裁。`
    });
  }

  if (!s.length) {
    s.push({
      ruleId: 'BATCH-OK',
      text: `【多篇差异化良好】这 ${n} 篇文稿在选题词分布、开头结尾结构与句式指纹上保持了健康的差异度，未见明显跨篇模板复用。`
    });
  }
  return s;
}

function analyzeBatch(articles, rules, platform) {
  const T = rules.thresholds;
  const Ps = articles.map((a, i) => prepare(a, rules, platform, i)).filter(P => P.len >= 100);
  if (Ps.length < 2) throw new Error(`至少需要 2 篇正文 ≥100 字的文章（当前有效 ${Ps.length} 篇）`);
  const n = Ps.length;

  const pairs = [];
  const extraHl = Ps.map(() => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const c = comparePair(Ps[i], Ps[j], T);
      pairs.push(Object.assign({ i, j }, c));
      for (const d of c.dups) {
        extraHl[i].push({
          start: d.a.start,
          end: d.a.end,
          type: 'dup',
          ruleId: 'DUP-001',
          label: '跨文重复',
          msg: `与《${Ps[j].title || '文章' + (j + 1)}》中的句子高度相似：“${d.b.text.slice(0, 40)}…”`
        });
        extraHl[j].push({
          start: d.b.start,
          end: d.b.end,
          type: 'dup',
          ruleId: 'DUP-001',
          label: '跨文重复',
          msg: `与《${Ps[i].title || '文章' + (i + 1)}》中的句子高度相似：“${d.a.text.slice(0, 40)}…”`
        });
      }
    }
  }

  const docs = Ps.map((P, idx) => {
    const novelty = round(noveltyOf(P, Ps.filter((_, k) => k !== idx)));
    const findings = novelty < 0.7
      ? [{ ruleId: 'DUP-002', type: 'dup', text: `相对同批其它文章，本篇独创新内容仅占 ${Math.round(novelty * 100)}%` }]
      : [];
    return toDoc(P, rules, platform, { novelty, highlights: extraHl[idx], findings });
  });

  const avg = k => mean(pairs.map(p => p[k]));
  const max = k => Math.max.apply(null, pairs.map(p => p[k]));
  const longSents = Ps.reduce((s, P) => s + P.sents.filter(x => x.len >= T.dupSentence.minChars).length, 0) || 1;
  const dupTotal = pairs.reduce((s, p) => s + p.dups.length, 0);
  const openings = countBy(Ps.map(P => P.structure.opening));
  const endings = countBy(Ps.map(P => P.structure.ending));
  const topO = top(openings);
  const topE = top(endings);
  const uniformity = (topO[1] / n + topE[1] / n) / 2;

  const dims = {
    aiStyle: Math.round(mean(docs.map(d => d.dims.aiStyle.score))),
    lowInfo: Math.round(mean(docs.map(d => d.dims.lowInfo.score))),
    platformFit: Math.round(mean(docs.map(d => d.dims.platformFit.score))),
    homogeneity: Math.round(100 * Math.max(
      0.4 * norm(avg('title'), T.titleSim.lo, T.titleSim.hi) + 0.6 * norm(avg('topic'), T.topicSim.lo, T.topicSim.hi),
      0.85 * norm(Math.max(max('title'), max('topic')), 0.15, 0.6)
    )),
    duplication: Math.round(100 * Math.max(norm(max('content'), T.contentSim.lo, T.contentSim.hi), norm(dupTotal / longSents, 0, 0.15))),
    template: Math.round(100 * (0.6 * norm(avg('structure'), T.structureSim.lo, T.structureSim.hi) + 0.4 * norm(uniformity, 0.5, 1)))
  };
  const overall = combine(dims, rules, platform);

  const report = Object.assign({ mode: 'batch' }, meta(rules, platform), {
    count: n,
    overall,
    level: levelOf(overall, rules),
    dims: dimsOut(dims, rules),
    pairs: pairs.map(p => ({
      a: p.i,
      b: p.j,
      title: round(p.title),
      topic: round(p.topic),
      content: round(p.content),
      structure: round(p.structure),
      dupCount: p.dups.length,
      dupExamples: p.dups.slice(0, 3).map(d => [d.a.text, d.b.text]),
      sharedKeywords: Array.from(Ps[p.i].kw).filter(w => Ps[p.j].kw.has(w)).slice(0, 8)
    })),
    patterns: { opening: relabel(openings, OPENING_LABEL), ending: relabel(endings, ENDING_LABEL) },
    rhythm: rhythmOf(Ps, pairs),
    articles: docs
  });
  report.suggestions = batchSuggestions(report, Ps, topO, topE, n);
  return report;
}

// ==================== 8. 相关性洞察 ====================
function rank(arr) {
  const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(arr.length);
  for (let k = 0; k < idx.length;) {
    let e = k;
    while (e + 1 < idx.length && idx[e + 1][0] === idx[k][0]) e++;
    const avg = (k + e) / 2 + 1;
    for (let m = k; m <= e; m++) r[idx[m][1]] = avg;
    k = e + 1;
  }
  return r;
}

function pearson(x, y) {
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < x.length; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += Math.pow(x[i] - mx, 2);
    dy += Math.pow(y[i] - my, 2);
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

const spearman = (x, y) => pearson(rank(x), rank(y));

const METRIC_LABEL = {
  titleSimPrev: '与近期文章的标题相似度',
  topicSimPrev: '与近期文章的选题相似度',
  contentSimPrev: '与近期文章的正文相似度',
  structSimPrev: '与近期文章的结构相似度',
  noveltyPrev: '相对近期文章的新内容占比',
  aiStyle: 'AI 文风分',
  infoCoverage: '信息增量覆盖度',
  length: '字数'
};

function insights(history, rules, platform, windowSize = 5) {
  const items = (history || [])
    .filter(h => (h.content || '').length >= 100)
    .sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));
  const Ps = items.map((h, i) => prepare(h, rules, platform, i));
  const T = rules.thresholds;
  const rows = items.map((h, i) => {
    const prev = Ps.slice(Math.max(0, i - windowSize), i);
    const P = Ps[i];
    const cmp = prev.map(p => comparePair(P, p, T));
    const mx = k => (cmp.length ? Math.max.apply(null, cmp.map(c => c[k])) : 0);
    return {
      id: h.id,
      title: h.title,
      date: h.date,
      recommendedReads: h.recommendedReads != null ? h.recommendedReads : null,
      totalReads: h.totalReads != null ? h.totalReads : null,
      metrics: {
        titleSimPrev: round(mx('title')),
        topicSimPrev: round(mx('topic')),
        contentSimPrev: round(mx('content')),
        structSimPrev: round(mx('structure')),
        noveltyPrev: round(noveltyOf(P, prev)),
        aiStyle: P.style.score,
        infoCoverage: P.info.coverage,
        length: P.len
      }
    };
  });
  const valid = rows.filter(r => typeof r.recommendedReads === 'number' && r.recommendedReads >= 0);
  let correlations = [];
  if (valid.length >= 6) {
    const y = valid.map(r => Math.log1p(r.recommendedReads));
    correlations = Object.keys(METRIC_LABEL)
      .map(k => {
        const rho = round(spearman(valid.map(r => r.metrics[k]), y));
        return {
          key: k,
          label: METRIC_LABEL[k],
          rho,
          strength: Math.abs(rho) >= 0.5 ? '较强' : Math.abs(rho) >= 0.3 ? '中等' : '弱'
        };
      })
      .sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho));
  }
  return {
    total: rows.length,
    withReads: valid.length,
    rows,
    correlations,
    note: valid.length < 6
      ? `已填写推荐阅读数的文章 ${valid.length} 篇，至少需要 6 篇才计算相关性（建议 15 篇以上结论才较稳定）。`
      : `基于 ${valid.length} 篇文章的 Spearman 秩相关。样本较小，相关不等于因果；选题热度、发布时间等未纳入的因素同样有影响。`
  };
}

module.exports = {
  ENGINE_VERSION,
  charLen,
  clean,
  analyzeSingle,
  analyzeBatch,
  insights,
  toMarkdown
};
