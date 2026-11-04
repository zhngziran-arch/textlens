const { analyzeBatch, toMarkdown } = require('../../engine/index.js');
const { commonRules, platformProfiles } = require('../../engine/rulesData.js');
const { BATCH_SAMPLES } = require('../../engine/samples.js');

const app = getApp();

Page({
  data: {
    items: [
      { id: 1, title: '', content: '', collapsed: false },
      { id: 2, title: '', content: '', collapsed: false },
      { id: 3, title: '', content: '', collapsed: false }
    ],
    nextId: 4,
    report: null
  },

  onLoad() {},

  toggleCollapse(e) {
    const idx = e.currentTarget.dataset.index;
    const key = `items[${idx}].collapsed`;
    this.setData({ [key]: !this.data.items[idx].collapsed });
  },

  onTitleChange(e) {
    const idx = e.currentTarget.dataset.index;
    this.setData({ [`items[${idx}].title`]: e.detail.value });
  },

  onContentChange(e) {
    const idx = e.currentTarget.dataset.index;
    this.setData({ [`items[${idx}].content`]: e.detail.value });
  },

  addItem() {
    if (this.data.items.length >= 8) {
      wx.showToast({ title: '手机端建议最多对比 8 篇', icon: 'none' });
      return;
    }
    const newItem = { id: this.data.nextId++, title: '', content: '', collapsed: false };
    this.setData({
      items: [...this.data.items, newItem]
    });
  },

  removeItem(e) {
    const idx = e.currentTarget.dataset.index;
    if (this.data.items.length <= 2) {
      wx.showToast({ title: '至少需保留 2 篇进行对比', icon: 'none' });
      return;
    }
    const next = [...this.data.items];
    next.splice(idx, 1);
    this.setData({ items: next });
  },

  loadDemo() {
    const demos = BATCH_SAMPLES.map((s, i) => ({
      id: i + 1,
      title: s.title,
      content: s.content,
      collapsed: i > 0
    }));
    this.setData({
      items: demos,
      nextId: demos.length + 1
    });
    this.runBatch();
  },

  loadFromHistory() {
    const list = wx.getStorageSync('tl_history') || [];
    if (list.length < 2) {
      wx.showToast({ title: '历史归档不足 2 篇', icon: 'none' });
      return;
    }
    const items = list.slice(0, 5).map((h, i) => ({
      id: i + 1,
      title: h.title,
      content: h.content,
      collapsed: i > 0
    }));
    this.setData({
      items,
      nextId: items.length + 1
    });
    this.runBatch();
  },

  clearAll() {
    this.setData({
      items: [
        { id: 1, title: '', content: '', collapsed: false },
        { id: 2, title: '', content: '', collapsed: false }
      ],
      nextId: 3,
      report: null
    });
  },

  runBatch() {
    const valid = this.data.items.filter(it => it.content && it.content.trim().length >= 100);
    if (valid.length < 2) {
      wx.showToast({ title: '至少需要 2 篇正文满 100 字的文稿', icon: 'none' });
      return;
    }

    try {
      const pfId = app.globalData.platform || 'wechat';
      const pf = platformProfiles[pfId] || platformProfiles.wechat;
      const r = analyzeBatch(valid, commonRules, pf);

      r.dimsList = Object.entries(r.dims || {}).map(([key, val]) => ({
        key,
        ...val
      }));
      r.pairs = (r.pairs || []).map(p => {
        const artA = (r.articles && r.articles[p.a]) || {};
        const artB = (r.articles && r.articles[p.b]) || {};
        return {
          ...p,
          nameA: artA.title || ('文稿' + (p.a + 1)),
          nameB: artB.title || ('文稿' + (p.b + 1)),
          titlePct: Math.round((p.title || 0) * 100),
          topicPct: Math.round((p.topic || 0) * 100),
          contentPct: Math.round((p.content || 0) * 100),
          structurePct: Math.round((p.structure || 0) * 100)
        };
      });

      this.setData({ report: r });
      wx.showToast({ title: '对比完成', icon: 'success' });
    } catch (err) {
      wx.showModal({
        title: '分析提示',
        content: err.message || '对比失败',
        showCancel: false
      });
    }
  },

  copyReport() {
    if (!this.data.report) return;
    const md = toMarkdown(this.data.report);
    wx.setClipboardData({
      data: md,
      success() {
        wx.showToast({ title: '对比报告已复制', icon: 'success' });
      }
    });
  }
});
