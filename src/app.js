// TextLens 前端交互控制器：滑动胶囊导航、编辑/批注双模态切换、SVG 动态仪表盘与定位闪烁
import { analyzeSingle, analyzeBatch, insights, toMarkdown } from './engine/index.js';
import { charLen } from './engine/text.js';
import { renderHighlightedText } from './ui/highlight.js';
import {
  renderAnnotatedManuscript,
  renderSingleReport,
  renderBatchReport,
  renderInsightsView,
  renderRulesTransparency
} from './ui/render.js';
import { listHistory, upsertArticles, updateMeta, deleteArticle, clearHistory } from './store.js';
import { SINGLE_SAMPLES, BATCH_SAMPLES, DEMO_HISTORY } from './samples.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PF_SHORT = { wechat: '公众号', xhs: '小红书', zhihu: '知乎', toutiao: '头条', general: '通用' };

const PLATFORM_SPECS = {
  wechat: {
    name: '微信公众号',
    lengthText: '1000–6000 字',
    titleText: '8–32 字',
    focusText: '信息增量 · 诱导词排查',
    tip: '公域推荐极看重完读率与独创细节（数据/亲历/案例），忌长段空泛议论与诱导分享表述。'
  },
  xhs: {
    name: '小红书笔记',
    lengthText: '200–1000 字',
    titleText: '6–20 字',
    focusText: '广告法极限词 · 真实体感',
    tip: '严查《广告法》绝对化用语（最/第一/顶级/国家级）与虚假种草套话，建议带 3–8 个精准话题标签。'
  },
  zhihu: {
    name: '知乎回答/文章',
    lengthText: '600–8000 字',
    titleText: '6–40 字',
    focusText: '信源出处 · 论据链条',
    tip: '读者与专业权重高度依赖可核实的文献、财报、数据出处，忌无依据断言与情绪引战。'
  },
  toutiao: {
    name: '今日头条',
    lengthText: '800–3500 字',
    titleText: '12–30 字',
    focusText: '首段要素 · 标题党排查',
    tip: '前 3 秒跳出率决定推荐池层级，首段需直接交代时间、人物与核心事件，忌车轱辘话注水。'
  },
  general: {
    name: '通用深度文',
    lengthText: '500–8000 字',
    titleText: '6–36 字',
    focusText: '句法节奏 · 信息熵',
    tip: '从现代汉语非虚构写作标准出发，重点审视连接词密度、句长呼吸感与五维信息覆盖率。'
  }
};

const state = {
  common: null,
  platforms: {},
  platformId: localStorage.getItem('tl_platform') || 'wechat',
  singleReport: null,
  batchReport: null,
  batchItems: [
    { id: 1, title: '', date: '', recommendedReads: '', content: '', collapsed: false },
    { id: 2, title: '', date: '', recommendedReads: '', content: '', collapsed: false },
    { id: 3, title: '', date: '', recommendedReads: '', content: '', collapsed: false }
  ],
  nextId: 4
};

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2200);
}

async function loadRules() {
  const [common, idx] = await Promise.all([
    fetch('./rules/common.json').then(r => r.json()),
    fetch('./rules/index.json').then(r => r.json())
  ]);
  const list = await Promise.all(idx.platforms.map(p => fetch(`./rules/${p.file}`).then(r => r.json())));
  state.common = common;
  for (const p of list) state.platforms[p.id] = p;
  if (!state.platforms[state.platformId]) state.platformId = 'wechat';
}

const curPlatform = () => state.platforms[state.platformId];

/** SVG 圆弧进度与数字平滑递增动效 */
function animateMetrics(root) {
  requestAnimationFrame(() => {
    root.querySelectorAll('.gauge-bar[data-target-offset]').forEach(circle => {
      circle.style.strokeDashoffset = circle.dataset.targetOffset;
    });
  });

  const dur = 520;
  const t0 = performance.now();
  const nums = [...root.querySelectorAll('[data-count-to]')].map(el => ({
    el,
    target: Number(el.dataset.countTo) || 0
  }));
  if (!nums.length) return;

  function tick(now) {
    const p = Math.min(1, (now - t0) / dur);
    const ease = 1 - (1 - p) ** 3;
    for (const { el, target } of nums) {
      el.textContent = Math.round(target * ease);
    }
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/** 顶部滑动胶囊与平台切换 */
function syncNavGlider() {
  const active = document.querySelector('.nav-segmented .tab.active');
  const glider = $('#nav-glider');
  if (!active || !glider) return;
  glider.style.width = `${active.offsetWidth}px`;
  glider.style.transform = `translateX(${active.offsetLeft - 3}px)`;
}

function initTopbar() {
  const pillsBox = $('#platform-pills');
  const sel = $('#platform-select');
  const order = ['wechat', 'xhs', 'zhihu', 'toutiao', 'general'].filter(id => state.platforms[id]);

  pillsBox.innerHTML = order.map(id => {
    const p = state.platforms[id];
    return `<button class="pf-pill ${id === state.platformId ? 'active' : ''}" data-pf="${esc(id)}" title="${esc(p.name)}">${esc(PF_SHORT[id] || p.name)}</button>`;
  }).join('');

  sel.innerHTML = order.map(id => `<option value="${esc(id)}">${esc(state.platforms[id].name)}</option>`).join('');
  sel.value = state.platformId;

  const syncPlatformUI = () => {
    const p = curPlatform();
    const spec = PLATFORM_SPECS[state.platformId] || PLATFORM_SPECS.wechat;
    $('#platform-desc').textContent = `${p.name}体裁：${p.description}（建议正文 ${p.length.min}–${p.length.max} 字，标题 ${p.title.min}–${p.title.max} 字）`;
    sel.value = state.platformId;
    $$('.pf-pill').forEach(b => b.classList.toggle('active', b.dataset.pf === state.platformId));
    const specCard = $('#single-spec-card');
    if (specCard) {
      specCard.innerHTML = `
        <div class="bench-head">
          <strong>${esc(spec.name)} · 体裁审阅基准</strong>
          <span class="bench-badge">纯本地引擎 v${esc(state.common?.version || '0.2.0')}</span>
        </div>
        <div class="bench-grid">
          <div class="bench-cell"><span>常见篇幅</span><b>${esc(spec.lengthText)}</b></div>
          <div class="bench-cell"><span>标题建议</span><b>${esc(spec.titleText)}</b></div>
          <div class="bench-cell"><span>核心靶点</span><b>${esc(spec.focusText)}</b></div>
        </div>
        <p class="bench-tip">${esc(spec.tip)}</p>`;
    }
  };
  syncPlatformUI();

  const switchPlatform = id => {
    if (!state.platforms[id] || id === state.platformId) return;
    state.platformId = id;
    localStorage.setItem('tl_platform', id);
    syncPlatformUI();
    if (state.singleReport) runSingle(true);
    if (state.batchReport) runBatch(true);
  };

  pillsBox.addEventListener('click', e => {
    const btn = e.target.closest('[data-pf]');
    if (btn) switchPlatform(btn.dataset.pf);
  });
  sel.addEventListener('change', () => switchPlatform(sel.value));

  $$('.nav-segmented .tab').forEach(btn => btn.addEventListener('click', () => {
    $$('.nav-segmented .tab').forEach(b => b.classList.toggle('active', b === btn));
    $$('.view-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`));
    syncNavGlider();
    if (btn.dataset.tab === 'history') refreshHistoryView();
  }));

  window.addEventListener('resize', syncNavGlider);
  requestAnimationFrame(syncNavGlider);
}

/** 批注气泡与过滤开关交互 */
function bindHighlightInteractions(container, getDocByBoxId) {
  container.addEventListener('change', e => {
    const t = e.target;
    if (!t.dataset.hlToggle) return;
    const box = t.closest('[data-hl-box]');
    if (!box) return;
    const doc = getDocByBoxId(box.dataset.hlBox);
    if (!doc) return;
    const enabled = new Set([...box.querySelectorAll('[data-hl-toggle]:checked')].map(x => x.dataset.hlToggle));
    const stage = box.querySelector('[data-hl-stage]');
    const titleHtml = doc.title ? `<h1 class="ms-render-title">${esc(doc.title)}</h1>` : '';
    stage.innerHTML = titleHtml + renderHighlightedText(doc.text, doc.highlights, enabled);
  });

  const pop = $('#popover');
  const showTip = e => {
    const mark = e.target.closest('mark[data-tip]');
    if (!mark) { pop.classList.add('hidden'); return; }
    pop.textContent = mark.dataset.tip;
    pop.classList.remove('hidden');
    const r = mark.getBoundingClientRect();
    const top = r.top - pop.offsetHeight - 10;
    const left = Math.min(window.innerWidth - pop.offsetWidth - 14, Math.max(14, r.left));
    pop.style.top = `${top < 12 ? r.bottom + 10 : top}px`;
    pop.style.left = `${left}px`;
  };
  container.addEventListener('mouseover', showTip);
  container.addEventListener('click', showTip);
  container.addEventListener('mouseleave', () => pop.classList.add('hidden'));
}

/** 单篇视图：切换编辑态 / 批注态 */
function setManuscriptMode(mode) {
  const isAnnotate = mode === 'annotate' && state.singleReport;
  $('#btn-mode-write').classList.toggle('active', !isAnnotate);
  $('#btn-mode-annotate').classList.toggle('active', Boolean(isAnnotate));
  $('#ms-write-pane').classList.toggle('active', !isAnnotate);
  $('#ms-annotate-pane').classList.toggle('active', Boolean(isAnnotate));
}

function runSingle(silent = false) {
  try {
    const article = {
      title: $('#single-title').value,
      date: $('#single-date').value,
      content: $('#single-content').value
    };
    const r = analyzeSingle(article, state.common, curPlatform());
    state.singleReport = r;

    // 渲染左侧批注视图并启用切换
    $('#single-annotated-slot').innerHTML = renderAnnotatedManuscript(r, 'single');
    $('#ms-hl-count').textContent = r.highlights.length;
    $('#btn-mode-annotate').disabled = false;
    setManuscriptMode('annotate');

    // 渲染右侧仪表盘并播放动画
    const slot = $('#single-report');
    slot.innerHTML = renderSingleReport(r);
    animateMetrics(slot);
    $('#single-copy-md').disabled = false;
    if (!silent) toast('审阅完成，已切换至原文批注视图');
  } catch (err) {
    if (!silent) toast(err.message);
  }
}

function initSingle() {
  const contentEl = $('#single-content');
  const titleEl = $('#single-title');
  const updateCount = () => { $('#single-counter').textContent = `${charLen(contentEl.value)} 字`; };
  contentEl.addEventListener('input', updateCount);

  // 编辑态 / 批注态按钮
  $('#btn-mode-write').addEventListener('click', () => setManuscriptMode('write'));
  $('#btn-mode-annotate').addEventListener('click', () => setManuscriptMode('annotate'));
  $('#btn-back-edit').addEventListener('click', () => {
    setManuscriptMode('write');
    contentEl.focus();
  });

  // 快捷键 Ctrl/Cmd + Enter
  const onKey = e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runSingle();
    }
  };
  contentEl.addEventListener('keydown', onKey);
  titleEl.addEventListener('keydown', onKey);

  $('#single-demo-bad').addEventListener('click', () => {
    const s = SINGLE_SAMPLES[state.platformId] || SINGLE_SAMPLES.wechat;
    titleEl.value = s.title;
    contentEl.value = s.content;
    updateCount();
    runSingle();
  });

  $('#single-demo-good').addEventListener('click', () => {
    const s = SINGLE_SAMPLES.general;
    titleEl.value = s.title;
    contentEl.value = s.content;
    updateCount();
    runSingle();
  });

  $('#single-clear').addEventListener('click', () => {
    titleEl.value = '';
    $('#single-reads').value = '';
    contentEl.value = '';
    state.singleReport = null;
    $('#btn-mode-annotate').disabled = true;
    $('#ms-hl-count').textContent = '0';
    setManuscriptMode('write');
    $('#single-copy-md').disabled = true;
    $('#single-report').innerHTML = `
      <div class="empty-state">
        <h3>已清空文稿</h3>
        <p>在左侧输入或粘贴正文后点击「开始审阅」。</p>
      </div>`;
    updateCount();
  });

  $('#single-run').addEventListener('click', () => runSingle());

  $('#single-save').addEventListener('click', async () => {
    const content = contentEl.value.trim();
    if (charLen(content) < 50) return toast('正文至少 50 字再保存');
    const res = await upsertArticles([{
      title: titleEl.value,
      date: $('#single-date').value || new Date().toISOString().slice(0, 10),
      platform: state.platformId,
      recommendedReads: $('#single-reads').value,
      content
    }]);
    toast(`已存入本地历史库（新增 ${res.added}，更新 ${res.updated}）`);
  });

  $('#single-copy-md').addEventListener('click', async () => {
    if (!state.singleReport) return;
    await navigator.clipboard.writeText(toMarkdown(state.singleReport));
    toast('Markdown 报告已复制到剪贴板');
  });

  // 绑定左侧批注气泡
  bindHighlightInteractions($('#single-annotated-slot'), () => state.singleReport);

  // 点击右侧诊断条目 -> 左侧原文滚动并闪烁定位
  $('#single-report').addEventListener('click', e => {
    const item = e.target.closest('[data-jump-rule]');
    if (!item || !state.singleReport) return;
    const ruleId = item.dataset.jumpRule;
    setManuscriptMode('annotate');
    const stage = $('#single-annotated-slot');
    let target = stage.querySelector(`mark[data-rule="${CSS.escape(ruleId)}"]`);
    if (!target && ruleId === 'INFO') target = stage.querySelector('mark[data-rule="INFO-THIN"]');
    if (!target) return toast('当前筛选视图下未找到对应标注');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.remove('pulse-target');
    void target.offsetWidth;
    target.classList.add('pulse-target');
  });
}

// ---------- 2. 多篇对比 ----------
function syncBatchFromDOM() {
  $$('.bcard').forEach(card => {
    const item = state.batchItems.find(x => String(x.id) === card.dataset.id);
    if (!item) return;
    item.title = card.querySelector('.b-title').value;
    item.date = card.querySelector('.b-date').value;
    item.recommendedReads = card.querySelector('.b-reads').value;
    item.content = card.querySelector('.b-content').value;
  });
}

function renderBatchInputs() {
  $('#batch-count').textContent = `（共 ${state.batchItems.length} 篇）`;
  $('#batch-list').innerHTML = state.batchItems.map((it, idx) => `
    <div class="bcard ${it.collapsed ? 'collapsed' : ''}" data-id="${it.id}">
      <div class="bcard-head">
        <span class="idx">${idx + 1}</span>
        <span class="bcard-title">${esc(it.title || '点击展开填写标题与正文')}</span>
        <span class="muted-xs b-len">${charLen(it.content)} 字</span>
        <button class="bcard-del" data-del="${it.id}" title="移除这篇">✕</button>
      </div>
      <div class="bcard-body">
        <input class="b-title" placeholder="文稿标题" value="${esc(it.title)}" />
        <div class="meta-row">
          <input class="b-date" type="date" value="${esc(it.date)}" />
          <input class="b-reads" type="number" min="0" placeholder="推荐阅读数（选填）" value="${esc(it.recommendedReads ?? '')}" />
        </div>
        <textarea class="b-content" rows="5" placeholder="粘贴正文（至少 100 字）">${esc(it.content)}</textarea>
      </div>
    </div>`).join('');
}

function runBatch(silent = false) {
  syncBatchFromDOM();
  try {
    const r = analyzeBatch(state.batchItems, state.common, curPlatform());
    state.batchReport = r;
    const slot = $('#batch-report');
    slot.innerHTML = renderBatchReport(r);
    animateMetrics(slot);
    $('#batch-copy-md').disabled = false;
    if (!silent) toast('多篇同质化对比完成');
  } catch (err) {
    if (!silent) toast(err.message);
  }
}

function initBatch() {
  renderBatchInputs();
  const listEl = $('#batch-list');

  listEl.addEventListener('click', e => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      syncBatchFromDOM();
      if (state.batchItems.length <= 2) return toast('至少保留 2 篇文稿输入框');
      state.batchItems = state.batchItems.filter(x => String(x.id) !== del.dataset.del);
      renderBatchInputs();
      return;
    }
    const head = e.target.closest('.bcard-head');
    if (head) {
      syncBatchFromDOM();
      const card = head.closest('.bcard');
      const it = state.batchItems.find(x => String(x.id) === card.dataset.id);
      if (it) it.collapsed = !it.collapsed;
      card.classList.toggle('collapsed');
    }
  });

  listEl.addEventListener('input', e => {
    const card = e.target.closest('.bcard');
    if (!card) return;
    if (e.target.classList.contains('b-title')) {
      card.querySelector('.bcard-title').textContent = e.target.value || '点击展开填写标题与正文';
    }
    if (e.target.classList.contains('b-content')) {
      card.querySelector('.b-len').textContent = `${charLen(e.target.value)} 字`;
    }
  });

  $('#batch-add').addEventListener('click', () => {
    syncBatchFromDOM();
    if (state.batchItems.length >= 10) return toast('单次最多对比 10 篇');
    state.batchItems.push({ id: state.nextId++, title: '', date: '', recommendedReads: '', content: '', collapsed: false });
    renderBatchInputs();
  });

  $('#batch-demo').addEventListener('click', () => {
    state.batchItems = BATCH_SAMPLES.map((s, i) => ({ id: i + 1, ...s, collapsed: i > 0 }));
    state.nextId = state.batchItems.length + 1;
    renderBatchInputs();
    runBatch();
  });

  $('#batch-from-hist').addEventListener('click', async () => {
    const hist = await listHistory();
    if (hist.length < 2) return toast('历史库不足 2 篇文稿，请先存入或载入演示数据');
    state.batchItems = hist.slice(0, 6).reverse().map((h, i) => ({
      id: i + 1, title: h.title, date: h.date, recommendedReads: h.recommendedReads ?? '', content: h.content, collapsed: i > 0
    }));
    state.nextId = state.batchItems.length + 1;
    renderBatchInputs();
    runBatch();
  });

  $('#batch-clear').addEventListener('click', () => {
    state.batchItems = [1, 2, 3].map(id => ({ id, title: '', date: '', recommendedReads: '', content: '', collapsed: false }));
    state.nextId = 4;
    state.batchReport = null;
    $('#batch-copy-md').disabled = true;
    renderBatchInputs();
    $('#batch-report').innerHTML = '<div class="empty-state"><h3>已清空对比列表</h3><p>填入至少 2 篇文稿后点击「开始对比分析」。</p></div>';
  });

  $('#batch-run').addEventListener('click', () => runBatch());

  $('#batch-save-all').addEventListener('click', async () => {
    syncBatchFromDOM();
    const res = await upsertArticles(state.batchItems.map(x => ({ ...x, platform: state.platformId })));
    toast(`已存入历史库（新增 ${res.added}，更新 ${res.updated}）`);
  });

  $('#batch-copy-md').addEventListener('click', async () => {
    if (!state.batchReport) return;
    await navigator.clipboard.writeText(toMarkdown(state.batchReport));
    toast('Markdown 报告已复制到剪贴板');
  });

  bindHighlightInteractions($('#batch-report'), boxId => {
    const idx = Number(boxId.replace('batch-', ''));
    return state.batchReport?.articles?.[idx];
  });
}

// ---------- 3. 流量规律（本地历史库） ----------
async function refreshHistoryView() {
  const hist = await listHistory();
  const ins = insights(hist, state.common, curPlatform());
  $('#insights-box').innerHTML = renderInsightsView(ins);

  if (!hist.length) {
    $('#history-table').innerHTML = '<div class="empty-state compact"><p>归档库暂无文稿。在审阅页点击「存入历史库」，或点击右上角「载入演示数据（7 篇）」查看效果。</p></div>';
    return;
  }

  const rowMap = new Map(ins.rows.map(r => [r.id, r]));
  $('#history-table').innerHTML = `
    <div class="table-scroll">
      <table class="clean-table">
        <thead>
          <tr>
            <th>发布日期</th>
            <th>文稿标题</th>
            <th class="num">推荐阅读数</th>
            <th class="num">与前5篇选题重合</th>
            <th class="num">本篇独有度</th>
            <th class="num">AI文风分</th>
            <th class="num">信息覆盖率</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${hist.map(h => {
            const m = rowMap.get(h.id)?.metrics;
            return `<tr data-hid="${esc(h.id)}">
              <td><input class="hist-in h-date" type="date" value="${esc(h.date || '')}" /></td>
              <td><b>${esc(h.title || '（无标题）')}</b> <span class="muted-xs">(${charLen(h.content)}字)</span></td>
              <td class="num"><input class="hist-in h-reads" type="number" min="0" placeholder="未填" value="${h.recommendedReads ?? ''}" /></td>
              <td class="num">${m ? Math.round(m.topicSimPrev * 100) + '%' : '-'}</td>
              <td class="num">${m ? Math.round(m.noveltyPrev * 100) + '%' : '-'}</td>
              <td class="num">${m ? m.aiStyle : '-'}</td>
              <td class="num">${m ? Math.round(m.infoCoverage * 100) + '%' : '-'}</td>
              <td>
                <div class="btn-group">
                  <button class="btn-subtle h-load" data-load="${esc(h.id)}">审阅</button>
                  <button class="btn-subtle btn-danger-text h-del" data-hdel="${esc(h.id)}">删除</button>
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function initHistory() {
  const tbl = $('#history-table');
  tbl.addEventListener('change', async e => {
    const tr = e.target.closest('tr[data-hid]');
    if (!tr) return;
    const id = tr.dataset.hid;
    if (e.target.classList.contains('h-date')) await updateMeta(id, { date: e.target.value });
    if (e.target.classList.contains('h-reads')) await updateMeta(id, { recommendedReads: e.target.value });
    await refreshHistoryView();
    toast('已保存并更新相关性图谱');
  });

  tbl.addEventListener('click', async e => {
    const del = e.target.closest('[data-hdel]');
    if (del) {
      await deleteArticle(del.dataset.hdel);
      await refreshHistoryView();
      toast('已移除');
      return;
    }
    const load = e.target.closest('[data-load]');
    if (load) {
      const hist = await listHistory();
      const it = hist.find(x => x.id === load.dataset.load);
      if (!it) return;
      $('#single-title').value = it.title;
      $('#single-date').value = it.date;
      $('#single-reads').value = it.recommendedReads ?? '';
      $('#single-content').value = it.content;
      $('#single-counter').textContent = `${charLen(it.content)} 字`;
      document.querySelector('.nav-segmented .tab[data-tab="single"]').click();
      runSingle();
    }
  });

  $('#hist-seed-demo').addEventListener('click', async () => {
    await upsertArticles([...BATCH_SAMPLES, ...DEMO_HISTORY]);
    await refreshHistoryView();
    toast('已载入 7 篇演示文稿与推荐阅读数据');
  });

  $('#hist-export').addEventListener('click', async () => {
    const hist = await listHistory();
    const blob = new Blob([JSON.stringify(hist, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `textlens-archive-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('#hist-import').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const arr = JSON.parse(await file.text());
      if (!Array.isArray(arr)) throw new Error('JSON 顶层需为数组');
      const res = await upsertArticles(arr);
      await refreshHistoryView();
      toast(`导入成功：新增 ${res.added}，更新 ${res.updated}`);
    } catch (err) {
      toast('导入失败：' + err.message);
    }
    e.target.value = '';
  });

  $('#hist-clear').addEventListener('click', async () => {
    if (!confirm('确定清空本地归档？建议先导出备份。')) return;
    await clearHistory();
    await refreshHistoryView();
    toast('本地归档已清空');
  });
}

// ---------- 启动 ----------
async function boot() {
  await loadRules();
  initTopbar();
  initSingle();
  initBatch();
  initHistory();
  $('#rules-box').innerHTML = renderRulesTransparency(state.common, state.platforms);
}

boot().catch(err => {
  console.error(err);
  toast('初始化失败：' + err.message);
});
