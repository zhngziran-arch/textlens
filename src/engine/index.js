// TextLens 规则引擎入口：单向无环依赖（零循环引用）+ 智能上下文靶向处方引擎
import { clean, charLen, paragraphs, sentences, ngrams, keywords, mean, norm, round } from './text.js';
import { analyzeStyle } from './style.js';
import { analyzeInfo, lowInfoScore } from './info.js';
import { analyzePlatform } from './platform.js';
import { structureOf, comparePair, noveltyOf, OPENING_LABEL, ENDING_LABEL } from './compare.js';
import { toMarkdown } from './markdown.js';

export const ENGINE_VERSION = '0.2.0';
export const DIM_LABEL = {
  aiStyle: 'AI 文风特征',
  lowInfo: '信息增量不足',
  platformFit: '平台体裁适配',
  homogeneity: '选题/标题同质化',
  duplication: '跨文重复',
  template: '结构模板化'
};
export const DIM_DESC = {
  aiStyle: '连接词、黑话套话、说教腔、模板句式密度，以及句长节奏是否机械',
  lowInfo: '数据、时间、出处、亲历、案例五维覆盖度，以及空洞长段落比例',
  platformFit: '字数区间、标题规格、平台专属词表（极限词、诱导分享、标题党等）',
  homogeneity: '多篇文章标题与核心主题词的重合集中度',
  duplication: '多篇文章之间的正文片段与跨篇高度相似句',
  template: '段落数量、开头切入方式与结尾收束套路的一致程度'
};

// 高频套话与连接词 1对1 靶向替换处方词典
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

export function levelOf(score, rules) {
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

/** 预处理单篇 */
export function prepare(article, rules, platform, i = 0) {
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

/**
 * 智能单篇修订处方生成器：
 * 根据当前文稿实际命中的词汇、具体段落序号、句长变异系数、主题关键词生成千人千面的改写方案
 */
function singleSuggestions(d, P, platform) {
  const s = [];
  const sf = P.style.features;
  const topKw = Array.from(P.kw).slice(0, 3);
  const kwLabel = topKw.length ? `围绕本文核心词「${topKw.join('、')}」` : '针对本文主题';

  // 1. 靶向词汇替换处方（直接点出作者实际写出的套话并给出 1对1 改写示范）
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

  // 2. 模板句式与节奏手术（精确定位句长与排比）
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

  // 3. 段落级信息增量补齐处方（精确到第几段 + 结合文章关键词给出补齐方向）
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

  // 4. 首段黄金 3 秒钩子与平台体裁处方
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

/** 单篇体检 */
export function analyzeSingle(article, rules, platform) {
  const P = prepare(article, rules, platform);
  if (P.len < 50) throw new Error('正文太短（少于 50 字），无法分析');
  return Object.assign({ mode: 'single' }, meta(rules, platform), toDoc(P, rules, platform));
}

/** 多篇对比 */
export function analyzeBatch(articles, rules, platform) {
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

/**
 * 智能多篇去同质化处方生成器：
 * 直接点名具体哪两篇文稿撞题、共享了哪些关键词、复用了哪句原话、跨篇高频口头禅是什么
 */
function batchSuggestions(r, Ps, topO, topE, n) {
  const s = [];
  const d = r.dims;
  const titleOf = idx => `《${(Ps[idx] && Ps[idx].title) ? Ps[idx].title.slice(0, 14) : ('文稿' + (idx + 1))}》`;

  // 1. 精确定位选题与标题最撞车的两篇文稿及重叠词
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

  // 2. 精确定位跨篇复用原句
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

  // 3. 结构克隆与套路化诊断（列出未使用的替代结构）
  if (d.template.score >= 30 || topO[1] >= Math.ceil(n * 0.65)) {
    const allOpenKeys = Object.keys(OPENING_LABEL);
    const unusedOpens = allOpenKeys.filter(k => k !== topO[0]).slice(0, 3).map(k => OPENING_LABEL[k]);
    const paraLens = Ps.map(p => `${p.structure.paraCount}段`).join('/');
    s.push({
      ruleId: 'TPL-DIFF',
      text: `【行文骨架同质】这 ${n} 篇文稿段落数为（${paraLens}），且有 ${topO[1]} 篇均采用「${OPENING_LABEL[topO[0]]}」、${topE[1]} 篇采用「${ENDING_LABEL[topE[0]]}」。下一篇建议切换为「${unusedOpens.join('」或「')}」切入，并打破固定段落数。`
    });
  }

  // 4. 跨篇作者个人/AI 高频口头禅指纹识别
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

  // 5. 信息增量最薄弱的具体单篇点名
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

// ==================== 相关性洞察 ====================
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

export const spearman = (x, y) => pearson(rank(x), rank(y));

export const METRIC_LABEL = {
  titleSimPrev: '与近期文章的标题相似度',
  topicSimPrev: '与近期文章的选题相似度',
  contentSimPrev: '与近期文章的正文相似度',
  structSimPrev: '与近期文章的结构相似度',
  noveltyPrev: '相对近期文章的新内容占比',
  aiStyle: 'AI 文风分',
  infoCoverage: '信息增量覆盖度',
  length: '字数'
};

export function insights(history, rules, platform, windowSize = 5) {
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

export { toMarkdown };
