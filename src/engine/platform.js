// 平台体裁适配：字数、标题、平台词表、标签、论据
import { findWords, titleLen, hasEmoji, round, clamp01 } from './text.js';

const SEV = { high: 25, mid: 12, low: 5 };
const SEV_LABEL = { high: '高', mid: '中', low: '低' };

export function analyzePlatform(title, text, len, info, platform) {
  const findings = [], hl = [], titleIssues = [];
  let penalty = 0;

  // 字数
  const { min, max } = platform.length || {};
  if (min && len < min) { penalty += 30 * clamp01((min - len) / min); findings.push({ ruleId: 'PF-LEN', type: 'platform', text: `正文 ${len} 字，低于${platform.name}常见体量 ${min}–${max} 字` }); }
  if (max && len > max) { penalty += 15 * clamp01((len - max) / max); findings.push({ ruleId: 'PF-LEN', type: 'platform', text: `正文 ${len} 字，超过${platform.name}常见体量上限 ${max} 字，可考虑拆分` }); }

  // 标题
  const tl = titleLen(title);
  if (title) {
    if (platform.title?.max && tl > platform.title.max) { penalty += 8; titleIssues.push(`标题 ${tl} 字，超过建议上限 ${platform.title.max} 字`); }
    if (platform.title?.min && tl < platform.title.min) { penalty += 5; titleIssues.push(`标题 ${tl} 字，信息量可能不足（建议 ≥ ${platform.title.min}）`); }
  } else titleIssues.push('未填写标题');

  // 平台词表
  for (const lex of platform.lexicons || []) {
    const where = lex.where || 'both';
    const bodyHits = where !== 'title' ? findWords(text, lex.words) : [];
    const titleHits = where !== 'body' ? findWords(title || '', lex.words) : [];
    const n = bodyHits.length + titleHits.length;
    if (!n) continue;
    penalty += Math.min(SEV[lex.severity] * n, SEV[lex.severity] * 3);
    const words = [...new Set([...titleHits, ...bodyHits].map(h => h.word))];
    findings.push({ ruleId: lex.id, type: 'platform', severity: lex.severity, text: `【${SEV_LABEL[lex.severity]}】${lex.name}：${words.slice(0, 6).map(w => `“${w}”`).join('、')}${titleHits.length ? '（含标题）' : ''}。${lex.advice || ''}` });
    if (titleHits.length) titleIssues.push(`${lex.name}：${[...new Set(titleHits.map(h => h.word))].join('、')}`);
    bodyHits.forEach(h => hl.push({ start: h.start, end: h.end, type: 'platform', ruleId: lex.id, label: lex.name, msg: `${lex.name}：“${h.word}”。${lex.advice || ''}` }));
  }

  // 标签（小红书等）
  let tagCount = null;
  if (platform.tags) {
    tagCount = (text.match(/#[^\s#]{1,20}/g) || []).length;
    if (tagCount < platform.tags.min) { penalty += 5; findings.push({ ruleId: 'PF-TAG', type: 'platform', text: `话题标签 ${tagCount} 个，建议 ${platform.tags.min}–${platform.tags.max} 个，帮助内容被检索和归类` }); }
    if (tagCount > platform.tags.max) { penalty += 5; findings.push({ ruleId: 'PF-TAG', type: 'platform', text: `话题标签 ${tagCount} 个，过多会稀释主题（建议 ≤ ${platform.tags.max}）` }); }
  }

  // 论据（知乎等）
  if (platform.evidence) {
    const src = info.radar.find(c => c.key === 'source');
    if (src && src.density < platform.evidence.minPer1000) { penalty += 10; findings.push({ ruleId: 'PF-EVID', type: 'platform', text: `出处/引用 ${src.density} 处/千字，${platform.name}读者更看重论据，建议补充来源` }); }
  }

  return {
    score: Math.round(Math.min(100, penalty)),
    title: { text: title, length: tl, emoji: hasEmoji(title || ''), hasNumber: /\d/.test(title || ''), issues: titleIssues },
    tagCount, findings, highlights: hl
  };
}
