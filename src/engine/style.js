// AI 文风 / 模板化表达 / 说教腔 / 情绪水词特征检测
import { findWords, findPatterns, tally, cv, mean, norm, round, charsOnly } from './text.js';

/** 连续 ≥3 句以相同两个字开头 → 一组排比 */
export function parallelRuns(sents) {
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

/** 滑动窗口：连续 size 句长度变异系数 < maxCV → 节奏单调区间（合并重叠） */
export function monotoneRanges(sents, { size, maxCV, minSentences }) {
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

export function analyzeStyle(text, sents, len, rules) {
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
