// 原文内联高亮渲染：支持重叠区间切分、类别开关过滤、点击/悬停查看规则依据
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const HL_TYPES = {
  ai: { label: 'AI词/套话', cls: 'hl-ai' },
  rhythm: { label: '节奏/排比', cls: 'hl-rhythm' },
  info: { label: '信息稀薄段', cls: 'hl-info' },
  platform: { label: '平台词表', cls: 'hl-platform' },
  dup: { label: '跨文重复', cls: 'hl-dup' }
};

/**
 * 将 text 按 highlights 切分为不重叠片段；重叠时优先展示更短（更具体）的标注，并把所有命中的说明合并到 tooltip。
 */
export function renderHighlightedText(text, highlights = [], enabledTypes = null) {
  const active = highlights.filter(h => h.end > h.start && (!enabledTypes || enabledTypes.has(h.type)));
  if (!active.length) return `<div class="hl-text">${esc(text).replace(/\n/g, '<br/>')}</div>`;

  const cuts = new Set([0, text.length]);
  for (const h of active) {
    cuts.add(Math.max(0, Math.min(text.length, h.start)));
    cuts.add(Math.max(0, Math.min(text.length, h.end)));
  }
  const pts = [...cuts].sort((a, b) => a - b);
  let html = '<div class="hl-text">';

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const seg = esc(text.slice(a, b)).replace(/\n/g, '<br/>');
    const covering = active.filter(h => h.start <= a && h.end >= b);
    if (!covering.length) {
      html += seg;
    } else {
      // 短区间优先决定主颜色（单词级优先于整段级）
      covering.sort((x, y) => (x.end - x.start) - (y.end - y.start));
      const primary = covering[0];
      const cls = covering.map(h => HL_TYPES[h.type]?.cls || '').join(' ');
      const tip = covering.map(h => `[${h.ruleId}] ${h.msg}`).join('\n');
      html += `<mark class="${cls}" data-rule="${esc(primary.ruleId)}" data-tip="${esc(tip)}">${seg}</mark>`;
    }
  }
  html += '</div>';
  return html;
}
