// 视图渲染组件：SVG 仪表盘、五维雷达图、同质化热力矩阵、双向相关性图与公开规则手册
import { HL_TYPES, renderHighlightedText } from './highlight.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = x => `${Math.round(x * 100)}%`;

/** SVG 圆弧仪表盘（带 CSS 过渡与数字滚动属性） */
function scoreGauge(score, level, title, subtitle) {
  const r = 42;
  const c = +(2 * Math.PI * r).toFixed(2);
  const offset = +(c * (1 - Math.max(0, Math.min(100, score)) / 100)).toFixed(2);
  return `
    <div class="gauge-hero">
      <div class="gauge-wrap tone-${level.key}">
        <svg class="gauge-svg" viewBox="0 0 104 104" aria-hidden="true">
          <circle class="gauge-track" cx="52" cy="52" r="${r}" />
          <circle class="gauge-bar" cx="52" cy="52" r="${r}"
            stroke-dasharray="${c}"
            stroke-dashoffset="${c}"
            data-target-offset="${offset}" />
        </svg>
        <div class="gauge-center">
          <b class="gauge-num" data-count-to="${score}">0</b>
          <span>${esc(level.label)}</span>
        </div>
      </div>
      <div class="gauge-info">
        <div class="gauge-kicker">${title}</div>
        <div class="gauge-sub">${subtitle}</div>
      </div>
    </div>`;
}

function dimBars(dims) {
  return `<div class="dims-grid">${Object.values(dims).map(d => `
    <div class="dim-card" title="${esc(d.desc)}">
      <div class="dim-top">
        <span class="dim-label">${esc(d.label)}</span>
        <b class="dim-score tone-text-${d.level.key}" data-count-to="${d.score}">${d.score}</b>
      </div>
      <div class="progress-track">
        <i class="progress-fill tone-bg-${d.level.key}" style="--w:${d.score}%"></i>
      </div>
      <div class="dim-caption">${esc(d.desc)}</div>
    </div>`).join('')}</div>`;
}

/** SVG 五维雷达图（数据 / 时间 / 出处 / 亲历 / 案例） */
function svgPentagonRadar(cats) {
  const cx = 95, cy = 95, R = 66;
  const pt = (i, ratio) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    return [+(cx + R * ratio * Math.cos(ang)).toFixed(1), +(cy + R * ratio * Math.sin(ang)).toFixed(1)];
  };
  const ringPoly = ratio => [0, 1, 2, 3, 4].map(i => pt(i, ratio).join(',')).join(' ');
  const axes = [0, 1, 2, 3, 4].map(i => {
    const [x, y] = pt(i, 1);
    const [lx, ly] = pt(i, 1.24);
    const label = cats[i]?.label || '';
    return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" class="radar-axis" />
            <text x="${lx}" y="${ly}" class="radar-label" text-anchor="middle" dominant-baseline="middle">${esc(label)}</text>`;
  }).join('');
  const vals = [0, 1, 2, 3, 4].map(i => Math.max(0.08, Math.min(1, cats[i]?.fill ?? 0)));
  const dataPoly = vals.map((v, i) => pt(i, v).join(',')).join(' ');
  const dots = vals.map((v, i) => {
    const [x, y] = pt(i, v);
    return `<circle cx="${x}" cy="${y}" r="3.5" class="radar-dot" />`;
  }).join('');

  return `
    <svg class="radar-svg" viewBox="0 0 190 190" aria-label="信息增量五维雷达图">
      <polygon points="${ringPoly(1)}" class="radar-ring" />
      <polygon points="${ringPoly(0.66)}" class="radar-ring" />
      <polygon points="${ringPoly(0.33)}" class="radar-ring" />
      ${axes}
      <polygon points="${dataPoly}" class="radar-area" />
      ${dots}
    </svg>`;
}

function infoSection(info) {
  return `
    <section class="panel-block stagger-item">
      <div class="block-head">
        <div>
          <h3>信息增量五维图</h3>
          <p class="block-sub">统计具体事实与一手细节的每千字密度</p>
        </div>
        <span class="pill-metric">覆盖率 <b>${pct(info.coverage)}</b></span>
      </div>
      <div class="info-viz">
        <div class="info-radar-box">${svgPentagonRadar(info.radar)}</div>
        <div class="info-bars">
          ${info.radar.map(c => `
            <div class="info-row">
              <div class="info-row-top">
                <b>${esc(c.label)}</b>
                <span>${c.count} 处 · ${c.density}/千字 <em class="muted">(参考 ≥${c.target})</em></span>
              </div>
              <div class="progress-track slim">
                <i class="progress-fill tone-bg-info" style="--w:${Math.round(c.fill * 100)}%"></i>
              </div>
              <div class="info-samples">
                ${c.examples.length ? c.examples.map(e => `<span class="sample-tag">${esc(e.slice(0, 16))}</span>`).join('') : '<span class="muted-xs">正文未检出此类细节</span>'}
              </div>
            </div>`).join('')}
        </div>
      </div>
    </section>`;
}

function vitalsStrip(doc) {
  const s = doc.structure;
  const items = [
    ['正文字数', `${doc.length}`],
    ['段落结构', `${s.paraCount} 段 · 均 ${s.avgParaLen} 字`],
    ['句长波动 CV', `${doc.style.sentenceCV}`],
    ['开篇切入', s.opening],
    ['收尾方式', s.ending],
    ['显式连接词', `${doc.style.connDensity}/千字`],
    ['空泛套话', `${doc.style.hollowDensity}/千字`]
  ];
  if (doc.novelty !== null) items.push(['本篇独有表述', pct(doc.novelty)]);
  if (doc.tagCount !== null) items.push(['话题标签', `${doc.tagCount} 个`]);
  return `<div class="vitals-strip stagger-item">${items.map(([k, v]) => `
    <div class="vital-item"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>`;
}

function badgeClassOf(ruleId = '') {
  const id = String(ruleId).toUpperCase();
  if (id.startsWith('AI') || id.startsWith('RHY') || id.startsWith('TPL')) return 'badge-ai';
  if (id.startsWith('INFO') || id.startsWith('HOOK')) return 'badge-info';
  if (id.startsWith('DUP') || id.startsWith('HOMO')) return 'badge-dup';
  if (id.startsWith('PF') || id.startsWith('WX') || id.startsWith('XHS') || id.startsWith('ZH') || id.startsWith('TT') || id.startsWith('TITLE')) return 'badge-pf';
  if (id === 'PASS' || id === 'BATCH-OK') return 'badge-ok';
  return '';
}

function findingsSection(doc) {
  const items = [];
  for (const t of doc.titleCheck.issues) {
    items.push({ ruleId: 'TITLE', text: t, interactive: false });
  }
  for (const f of doc.findings) {
    items.push({ ruleId: f.ruleId, text: f.text, interactive: f.type !== 'note' });
  }
  if (!items.length) {
    return `<div class="clean-pass">文风节奏自然，未检出明显的套话堆叠或体裁冲突。</div>`;
  }
  return `<ul class="finding-list">${items.map(it => `
    <li class="finding-item ${it.interactive ? 'is-clickable' : ''}" ${it.interactive ? `data-jump-rule="${esc(it.ruleId)}" title="点击在左侧正文中定位高亮"` : ''}>
      <span class="rule-badge ${badgeClassOf(it.ruleId)}">${esc(it.ruleId)}</span>
      <span class="finding-text">${esc(it.text)}</span>
      ${it.interactive ? '<span class="jump-hint">定位 ↗</span>' : ''}
    </li>`).join('')}</ul>`;
}

/** 渲染批注态工具栏与正文 HTML */
export function renderAnnotatedManuscript(doc, boxId = 'single') {
  const counts = {};
  for (const h of doc.highlights) counts[h.type] = (counts[h.type] || 0) + 1;
  const totalHl = doc.highlights.length;
  const toggles = Object.entries(HL_TYPES).map(([k, v]) => {
    const n = counts[k] || 0;
    return `<label class="filter-chip ${v.cls} ${n ? '' : 'is-empty'}">
      <input type="checkbox" data-hl-toggle="${k}" checked />
      <span class="dot"></span>
      <span>${esc(v.label)}</span>
      <b>${n}</b>
    </label>`;
  }).join('');

  return `
    <div class="annotated-box" data-hl-box="${boxId}">
      <div class="annotated-toolbar">
        <div class="hl-filters">${toggles}</div>
        <span class="muted-xs">共 ${totalHl} 处标注 · 点击彩色词句查看改写方向</span>
      </div>
      <article class="manuscript-Annotated" data-hl-stage="${boxId}">
        ${doc.title ? `<h1 class="ms-render-title">${esc(doc.title)}</h1>` : ''}
        ${renderHighlightedText(doc.text, doc.highlights)}
      </article>
    </div>`;
}

export function renderSingleReport(r) {
  const title = `<b>${esc(r.platform.name)}</b> 体裁审阅`;
  const sub = `全文 ${r.length} 字 · 共标记 <b>${r.highlights.length}</b> 处可优化细节（左侧已切换为批注视图）`;
  return `
    <div class="report-flow">
      <section class="panel-block stagger-item">
        ${scoreGauge(r.overall, r.level, title, sub)}
        ${dimBars(r.dims)}
      </section>
      ${vitalsStrip(r)}
      <section class="panel-block stagger-item">
        <div class="block-head">
          <div>
            <h3>文本特征诊断</h3>
            <p class="block-sub">点击任意条目可在左侧正文中闪烁定位</p>
          </div>
        </div>
        ${findingsSection(r)}
      </section>
      ${infoSection(r.info)}
      <section class="panel-block stagger-item">
        <div class="block-head">
          <div>
            <h3>智能靶向修订处方</h3>
            <p class="block-sub">根据本文实际命中词汇、具体段落序号与主题词动态生成</p>
          </div>
        </div>
        <ol class="advice-list">
          ${r.suggestions.map(s => `<li><span class="rule-badge ${badgeClassOf(s.ruleId)}">${esc(s.ruleId)}</span><span>${esc(s.text)}</span></li>`).join('')}
        </ol>
      </section>
    </div>`;
}

function heatTone(v, hi = 0.35, mid = 0.18) {
  return v >= hi ? 'heat-high' : v >= mid ? 'heat-mid' : 'heat-low';
}

export function renderBatchReport(r) {
  const title = `<b>${r.count} 篇</b>近期文稿同质化对比`;
  const sub = `${esc(r.platform.name)}配置 · 检查跨篇选题撞车、结构套路与重复句`;

  const patO = Object.entries(r.patterns.opening).map(([k, v]) => `<div class="vital-item"><span>开篇·${esc(k)}</span><b>${v} 篇</b></div>`).join('');
  const patE = Object.entries(r.patterns.ending).map(([k, v]) => `<div class="vital-item"><span>收尾·${esc(k)}</span><b>${v} 篇</b></div>`).join('');
  const rhy = r.rhythm ? `
    <div class="vital-item"><span>平均发文间隔</span><b>${r.rhythm.avgGapDays} 天</b></div>
    <div class="vital-item"><span>7天内同题材</span><b>${r.rhythm.closeSimilarPairs} 对</b></div>` : '';

  const pairRows = r.pairs.map((p, idx) => {
    const a = r.articles[p.a].title || `文稿 ${p.a + 1}`;
    const b = r.articles[p.b].title || `文稿 ${p.b + 1}`;
    const hasDetail = p.dupExamples.length > 0 || p.sharedKeywords.length > 0;
    return `
      <tr class="pair-row ${hasDetail ? 'has-detail' : ''}" data-pair-idx="${idx}">
        <td><span class="idx-mini">${p.a + 1}</span> ${esc(a)}</td>
        <td><span class="idx-mini">${p.b + 1}</span> ${esc(b)}</td>
        <td class="num"><span class="heat-pill ${heatTone(p.title, 0.35, 0.18)}">${pct(p.title)}</span></td>
        <td class="num"><span class="heat-pill ${heatTone(p.topic, 0.32, 0.16)}">${pct(p.topic)}</span></td>
        <td class="num"><span class="heat-pill ${heatTone(p.content, 0.18, 0.08)}">${pct(p.content)}</span></td>
        <td class="num"><span class="heat-pill ${heatTone(p.structure, 0.82, 0.7)}">${pct(p.structure)}</span></td>
        <td class="num">${p.dupCount ? `<b class="tone-text-high">${p.dupCount} 处</b>` : '<span class="muted-xs">0</span>'}</td>
      </tr>
      ${hasDetail ? `
      <tr class="pair-detail-row">
        <td colspan="7">
          <div class="pair-diff-box">
            ${p.sharedKeywords.length ? `<div class="shared-kw"><span>共用核心词：</span>${p.sharedKeywords.map(w => `<span class="sample-tag">${esc(w)}</span>`).join('')}</div>` : ''}
            ${p.dupExamples.map(([sa, sb]) => `
              <div class="dup-compare">
                <div><span class="idx-mini">${p.a + 1}</span> ${esc(sa)}</div>
                <div><span class="idx-mini">${p.b + 1}</span> ${esc(sb)}</div>
              </div>`).join('')}
          </div>
        </td>
      </tr>` : ''}`;
  }).join('');

  const perArt = r.articles.map((a, idx) => `
    <details class="batch-art-drawer" ${idx === 0 ? 'open' : ''}>
      <summary>
        <span class="idx-pill">${idx + 1}</span>
        <strong class="drawer-title">${esc(a.title || '（未命名文稿）')}</strong>
        <span class="drawer-badges">
          <span class="pill-mini tone-bg-${a.level.key}">综合 ${a.overall}</span>
          <span class="pill-mini">AI文风 ${a.dims.aiStyle.score}</span>
          <span class="pill-mini">独有度 ${pct(a.novelty)}</span>
        </span>
      </summary>
      <div class="drawer-body">
        ${vitalsStrip(a)}
        ${findingsSection(a)}
        ${renderAnnotatedManuscript(a, `batch-${idx}`)}
      </div>
    </details>`).join('');

  return `
    <div class="report-flow">
      <section class="panel-block stagger-item">
        ${scoreGauge(r.overall, r.level, title, sub)}
        ${dimBars(r.dims)}
      </section>
      <div class="vitals-strip stagger-item">${patO}${patE}${rhy}</div>
      <section class="panel-block stagger-item">
        <div class="block-head">
          <div>
            <h3>两两相似度热力表</h3>
            <p class="block-sub">对比标题、核心选题词、正文三元组与段落结构套路</p>
          </div>
        </div>
        <div class="table-scroll">
          <table class="clean-table">
            <thead>
              <tr><th>文稿 A</th><th>文稿 B</th><th class="num">标题</th><th class="num">选题词</th><th class="num">正文</th><th class="num">结构套路</th><th class="num">近似重复句</th></tr>
            </thead>
            <tbody>${pairRows}</tbody>
          </table>
        </div>
      </section>
      <section class="panel-block stagger-item">
        <div class="block-head">
          <div>
            <h3>智能去同质化调整建议</h3>
            <p class="block-sub">精准定位撞题篇章、跨篇重复原句、结构分布与作者跨篇习惯词</p>
          </div>
        </div>
        <ol class="advice-list">
          ${r.suggestions.map(s => `<li><span class="rule-badge ${badgeClassOf(s.ruleId)}">${esc(s.ruleId)}</span><span>${esc(s.text)}</span></li>`).join('')}
        </ol>
      </section>
      <section class="panel-block stagger-item">
        <div class="block-head">
          <div>
            <h3>单篇批注展开</h3>
            <p class="block-sub">深粉色下划线标出与其他文稿高度相似的句子</p>
          </div>
        </div>
        ${perArt}
      </section>
    </div>`;
}

export function renderInsightsView(ins) {
  if (!ins.correlations.length) {
    return `<div class="empty-state compact">
      <p>${esc(ins.note)}</p>
      <p class="muted-xs">你可以直接点击右上角「载入演示数据」立即查看相关性图谱效果。</p>
    </div>`;
  }

  const rows = ins.correlations.map(c => {
    const abs = Math.min(1, Math.abs(c.rho));
    const widthPct = Math.round(abs * 50);
    const isPos = c.rho >= 0;
    const dirText = c.rho > 0.12 ? '指标越高，推荐阅读往往越高' : c.rho < -0.12 ? '指标越高，推荐阅读往往越低' : '在当前样本中影响不显著';
    return `
      <div class="corr-row">
        <div class="corr-meta">
          <b>${esc(c.label)}</b>
          <span class="muted-xs">${dirText}</span>
        </div>
        <div class="corr-track">
          <div class="corr-zero"></div>
          <div class="corr-bar ${isPos ? 'is-pos' : 'is-neg'}"
               style="left:${isPos ? 50 : 50 - widthPct}%; width:${widthPct}%"></div>
        </div>
        <div class="corr-val ${Math.abs(c.rho) >= 0.35 ? (isPos ? 'tone-text-low' : 'tone-text-high') : ''}">
          ${c.rho > 0 ? '+' : ''}${c.rho.toFixed(2)}
          <small>${esc(c.strength)}</small>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="corr-header">
      <span>负相关（拉低推荐） ← 0 → 正相关（助推推荐）</span>
      <span class="muted-xs">${esc(ins.note)}</span>
    </div>
    <div class="corr-list">${rows}</div>`;
}

export function renderRulesTransparency(common, platforms) {
  let totalWordCount = 0;
  const lexCards = Object.values(common.lexicons).map(l => {
    const items = l.words || l.patterns || [];
    totalWordCount += items.length;
    return `
    <div class="spec-card">
      <div class="spec-head">
        <div>
          <span class="rule-badge ${badgeClassOf(l.id)}">${esc(l.id)}</span>
          <strong>${esc(l.name)}</strong>
        </div>
        <span class="pill-metric">${items.length} 项</span>
      </div>
      <p class="spec-desc">${esc(l.basis)}</p>
      ${l.advice ? `<p class="spec-advice">改写方向：${esc(l.advice)}</p>` : ''}
      <div class="tag-cloud">${items.map(w => `<code>${esc(w)}</code>`).join('')}</div>
    </div>`;
  }).join('');

  const infoRows = Object.values(common.info).map(c => `
    <tr>
      <td><span class="rule-badge badge-info">${esc(c.id)}</span> <b>${esc(c.label)}</b></td>
      <td class="num">≥ ${c.target} 次/千字</td>
      <td>${esc(c.basis)}</td>
      <td><div class="tag-cloud">${c.patterns.map(p => `<code>${esc(p)}</code>`).join('')}</div></td>
    </tr>`).join('');

  const pfCards = Object.values(platforms).map(p => {
    for (const l of (p.lexicons || [])) {
      totalWordCount += (l.words ? l.words.length : 0);
    }
    return `
    <div class="spec-card">
      <div class="spec-head">
        <strong>${esc(p.name)}</strong>
        <code>rules/platforms/${esc(p.id)}.json</code>
      </div>
      <p class="spec-desc">${esc(p.description)}</p>
      <p class="muted-xs">配置依据：${esc(p.basis)}</p>
      <div class="vitals-strip compact">
        <div class="vital-item"><span>建议正文</span><b>${p.length?.min ?? '-'}–${p.length?.max ?? '-'} 字</b></div>
        <div class="vital-item"><span>建议标题</span><b>${p.title?.min ?? '-'}–${p.title?.max ?? '-'} 字</b></div>
        ${p.tags ? `<div class="vital-item"><span>话题标签</span><b>${p.tags.min}–${p.tags.max} 个</b></div>` : ''}
        ${p.evidence ? `<div class="vital-item"><span>出处密度</span><b>≥ ${p.evidence.minPer1000}/千字</b></div>` : ''}
      </div>
      ${(p.lexicons || []).map(l => `
        <div class="spec-sub">
          <div class="spec-sub-head">
            <div><span class="rule-badge badge-pf">${esc(l.id)}</span> <b>${esc(l.name)}</b> <span class="muted-xs">（权重：${esc(l.severity)} · 范围：${esc(l.where)}）</span></div>
            <span class="muted-xs">${l.words.length} 词</span>
          </div>
          <div class="tag-cloud">${l.words.map(w => `<code>${esc(w)}</code>`).join('')}</div>
        </div>`).join('')}
    </div>`;
  }).join('');

  return `
    <div class="rules-layout">
      <section class="panel-block">
        <div class="block-head">
          <div>
            <h2>通用文风、黑话、说教腔与连接词表</h2>
            <p class="block-sub">实时读取自仓库 <code>rules/common.json</code>（v${esc(common.version)}），当前全库共收录 <b>${totalWordCount}</b> 条高频套话与平台词条</p>
          </div>
          <span class="pill-metric">共 <b>${totalWordCount}</b> 项规则词条</span>
        </div>
        <div class="spec-grid">${lexCards}</div>
      </section>

      <section class="panel-block">
        <div class="block-head">
          <div>
            <h2>信息增量五维识别规则</h2>
            <p class="block-sub">用于衡量文稿中可验证事实、具体时间、引用出处与一手经验的密度</p>
          </div>
        </div>
        <div class="table-scroll">
          <table class="clean-table">
            <thead><tr><th>维度</th><th class="num">经验目标</th><th>设计说明</th><th>匹配模式</th></tr></thead>
            <tbody>${infoRows}</tbody>
          </table>
        </div>
      </section>

      <section class="panel-block">
        <div class="block-head">
          <div>
            <h2>多平台体裁专属规范与雷区词表</h2>
            <p class="block-sub">各平台在篇幅、标题、广告法极限词、诱导互动词与信息密度上的侧重差异</p>
          </div>
        </div>
        <div class="spec-grid">${pfCards}</div>
      </section>

      <section class="panel-block">
        <div class="block-head">
          <div>
            <h2>评分权重与阈值参数</h2>
            <p class="block-sub">引擎完全采用确定性公式计算，以下为当前生效的参数配置</p>
          </div>
        </div>
        <pre class="json-viewer">${esc(JSON.stringify({ weights: common.weights, thresholds: common.thresholds }, null, 2))}</pre>
      </section>

      <section class="panel-block boundary-note">
        <h3>数据隐私与评估说明</h3>
        <p>1. <b>本地运行</b>：TextLens 采用纯前端架构，分词、相似度计算与历史记录存储（IndexedDB）均在你的浏览器内完成，文稿内容不会上传至任何远程服务器。</p>
        <p>2. <b>指标性质</b>：本工具输出的所有分数均基于文本自身的统计特征（词汇密度、句长变异系数、n-gram 重合度、结构特征与公开法规词表），用于辅助创作者打磨文风与排查同质化，不连接任何内容平台后台，亦不代表特定平台的内部推荐或审核算法。</p>
      </section>
    </div>`;
}
