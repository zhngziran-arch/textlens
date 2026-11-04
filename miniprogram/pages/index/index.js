const { analyzeSingle, toMarkdown, charLen } = require('../../engine/index.js');
const { commonRules, platformProfiles } = require('../../engine/rulesData.js');
const { SINGLE_SAMPLES } = require('../../engine/samples.js');

const app = getApp();

function tagClassOf(ruleId = '') {
  const id = String(ruleId).toUpperCase();
  if (id.startsWith('AI') || id.startsWith('RHY')) return 'tag-ai';
  if (id.startsWith('INFO')) return 'tag-info';
  if (id.startsWith('DUP')) return 'tag-dup';
  if (id.startsWith('PF') || id.startsWith('WX') || id.startsWith('XHS') || id.startsWith('ZH') || id.startsWith('TT')) return 'tag-pf';
  return '';
}

function buildSegments(text, highlights, filterType = 'all') {
  if (!text) return [];
  const filtered = (highlights || []).filter(h => filterType === 'all' || h.type === filterType);
  if (!filtered.length) {
    return [{ text, isHl: false }];
  }
  const sorted = [...filtered].sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const segments = [];
  let cursor = 0;

  for (const h of sorted) {
    const start = Math.max(cursor, h.start);
    const end = Math.min(text.length, h.end);
    if (start >= end) continue;
    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), isHl: false });
    }
    segments.push({
      text: text.slice(start, end),
      isHl: true,
      type: h.type,
      ruleId: h.ruleId,
      label: h.label,
      msg: h.msg
    });
    cursor = end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), isHl: false });
  }
  return segments;
}

const PLATFORM_SPECS = {
  wechat: {
    name: '微信公众号',
    lengthText: '1000–6000 字',
    titleText: '8–32 字',
    focusText: '信息增量 · 诱导词',
    tip: '公域推流极看重完读率与独创细节（数据/亲历/案例），忌长段空泛议论与诱导分享。'
  },
  xhs: {
    name: '小红书笔记',
    lengthText: '200–1000 字',
    titleText: '6–20 字',
    focusText: '极限词 · 真实体感',
    tip: '严查《广告法》绝对化用语（最/第一/顶级）与虚假种草套话，建议带 3–8 个精准话题标签。'
  },
  zhihu: {
    name: '知乎回答/文章',
    lengthText: '600–8000 字',
    titleText: '6–40 字',
    focusText: '信源出处 · 论据链',
    tip: '读者与专业权重高度依赖可核实的文献、财报、数据出处，忌无依据断言与情绪引战。'
  },
  toutiao: {
    name: '今日头条',
    lengthText: '800–3500 字',
    titleText: '12–30 字',
    focusText: '首段要素 · 标题党',
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

Page({
  data: {
    platforms: [
      { id: 'wechat', name: '公众号' },
      { id: 'xhs', name: '小红书' },
      { id: 'zhihu', name: '知乎' },
      { id: 'toutiao', name: '头条' },
      { id: 'general', name: '通用' }
    ],
    curPlatform: 'wechat',
    curSpec: PLATFORM_SPECS.wechat,
    title: '',
    content: '',
    date: '',
    reads: '',
    charCount: 0,
    isReady: false,
    report: null,
    activeTab: 'write', // 'write' 编辑态, 'report' 诊断报告, 'annotate' 批注
    hlFilter: 'all',
    hlFilters: [
      { id: 'all', name: '全部' },
      { id: 'ai', name: 'AI套话' },
      { id: 'rhythm', name: '节奏' },
      { id: 'info', name: '空洞段' },
      { id: 'platform', name: '平台词' }
    ],
    segments: [],
    filteredHighlights: []
  },

  onLoad() {
    const today = new Date().toISOString().slice(0, 10);
    const pf = app.globalData.platform || 'wechat';
    this.setData({
      date: today,
      curPlatform: pf,
      curSpec: PLATFORM_SPECS[pf] || PLATFORM_SPECS.wechat
    });
  },

  onSelectPlatform(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({
      curPlatform: id,
      curSpec: PLATFORM_SPECS[id] || PLATFORM_SPECS.wechat
    });
    app.globalData.platform = id;
    if (this.data.report) {
      this.runAnalysis(true);
    }
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value });
  },

  onDateInput(e) {
    this.setData({ date: e.detail.value });
  },

  onReadsInput(e) {
    this.setData({ reads: e.detail.value });
  },

  onContentInput(e) {
    const val = e.detail.value || '';
    const cleanChars = charLen(val);
    this.setData({
      content: val,
      charCount: cleanChars,
      isReady: cleanChars >= 50
    });
  },

  loadDemoBad() {
    const s = SINGLE_SAMPLES[this.data.curPlatform] || SINGLE_SAMPLES.wechat;
    const cleanChars = charLen(s.content);
    this.setData({
      title: s.title,
      content: s.content,
      charCount: cleanChars,
      isReady: cleanChars >= 50
    });
    this.runAnalysis();
  },

  loadDemoGood() {
    const s = SINGLE_SAMPLES.general;
    const cleanChars = charLen(s.content);
    this.setData({
      title: s.title,
      content: s.content,
      charCount: cleanChars,
      isReady: cleanChars >= 50
    });
    this.runAnalysis();
  },

  clearInput() {
    this.setData({
      title: '',
      content: '',
      reads: '',
      charCount: 0,
      isReady: false,
      report: null,
      activeTab: 'write',
      segments: [],
      filteredHighlights: []
    });
  },

  runAnalysis(silent = false) {
    const { title, date, content, curPlatform } = this.data;
    if (!content || content.trim().length < 50) {
      if (!silent) wx.showToast({ title: '正文需至少 50 字', icon: 'none' });
      return;
    }

    try {
      const pf = platformProfiles[curPlatform] || platformProfiles.wechat;
      const r = analyzeSingle({ title, date, content }, commonRules, pf);

      // 格式化百分比与色彩标签，避免 WXML 浮点数精度问题
      r.coveragePct = Math.round((r.info?.coverage || 0) * 100);
      if (r.info && r.info.radar) {
        r.info.radar = r.info.radar.map(item => ({
          ...item,
          fillPct: Math.round((item.fill || 0) * 100)
        }));
      }
      r.dimsList = Object.entries(r.dims || {}).map(([key, val]) => ({
        key,
        ...val
      }));
      r.findings = (r.findings || []).map(f => ({
        ...f,
        tagClass: tagClassOf(f.ruleId)
      }));
      r.suggestions = (r.suggestions || []).map(s => ({
        ...s,
        tagClass: tagClassOf(s.ruleId)
      }));
      r.highlights = (r.highlights || []).map((h, idx) => ({
        ...h,
        uid: `${h.start}_${h.end}_${idx}`,
        snippet: r.text.slice(h.start, Math.min(r.text.length, h.end)).slice(0, 42),
        tagClass: tagClassOf(h.ruleId)
      }));

      const hlFilter = 'all';
      const segments = buildSegments(r.text, r.highlights, hlFilter);

      this.setData({
        report: r,
        activeTab: silent ? this.data.activeTab : 'report',
        hlFilter,
        segments,
        filteredHighlights: r.highlights
      });
      if (!silent) wx.showToast({ title: '审阅完成', icon: 'success' });
    } catch (err) {
      wx.showModal({
        title: '审阅提示',
        content: err.message || '分析失败',
        showCancel: false
      });
    }
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab });
    wx.pageScrollTo({ scrollTop: 0, duration: 150 });
  },

  onSelectHlFilter(e) {
    const filter = e.currentTarget.dataset.id;
    const { report } = this.data;
    if (!report) return;
    const filteredHighlights = filter === 'all'
      ? report.highlights
      : report.highlights.filter(h => h.type === filter);
    const segments = buildSegments(report.text, report.highlights, filter);
    this.setData({
      hlFilter: filter,
      filteredHighlights,
      segments
    });
  },

  onTapHighlight(e) {
    const item = e.currentTarget.dataset.item;
    if (!item || !item.isHl) return;
    wx.showModal({
      title: `[${item.ruleId}] ${item.label}`,
      content: `命中片段：“${item.text.slice(0, 60)}”\n\n诊断说明：${item.msg}`,
      confirmText: '知道了',
      showCancel: false
    });
  },

  saveToHistory() {
    const { title, date, content, curPlatform, reads } = this.data;
    if (!content || content.trim().length < 50) {
      wx.showToast({ title: '正文满 50 字可归档', icon: 'none' });
      return;
    }
    const list = wx.getStorageSync('tl_history') || [];
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    list.unshift({
      id,
      title: title || '未命名文稿',
      date: date || new Date().toISOString().slice(0, 10),
      platform: curPlatform,
      recommendedReads: reads ? Number(reads) : null,
      content
    });
    wx.setStorageSync('tl_history', list);
    wx.showToast({ title: '已存入本地归档', icon: 'success' });
  },

  copyMarkdown() {
    if (!this.data.report) return;
    const md = toMarkdown(this.data.report);
    wx.setClipboardData({
      data: md,
      success() {
        wx.showToast({ title: 'Markdown已复制', icon: 'success' });
      }
    });
  },

  showRuleDetail(e) {
    const item = e.currentTarget.dataset.item;
    if (!item) return;
    wx.showModal({
      title: `规则 [${item.ruleId}]`,
      content: item.text || item.msg || '',
      confirmText: '明白',
      showCancel: false
    });
  }
});
