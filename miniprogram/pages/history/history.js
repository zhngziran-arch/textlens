const { insights } = require('../../engine/index.js');
const { commonRules, platformProfiles } = require('../../engine/rulesData.js');
const { BATCH_SAMPLES, DEMO_HISTORY } = require('../../engine/samples.js');

const app = getApp();

Page({
  data: {
    historyList: [],
    insightsData: null
  },

  onShow() {
    this.refreshData();
  },

  refreshData() {
    const list = wx.getStorageSync('tl_history') || [];
    const pfId = app.globalData.platform || 'wechat';
    const pf = platformProfiles[pfId] || platformProfiles.wechat;
    const ins = insights(list, commonRules, pf);
    
    // 计算相关性柱状图的展示比例
    if (ins && ins.correlations) {
      ins.correlations = ins.correlations.map(c => {
        const abs = Math.min(1, Math.abs(c.rho));
        const widthPct = Math.round(abs * 50);
        return {
          ...c,
          isPos: c.rho >= 0,
          rhoText: (c.rho > 0 ? '+' : '') + c.rho,
          widthPct,
          leftPct: c.rho >= 0 ? 50 : 50 - widthPct
        };
      });
    }

    this.setData({
      historyList: list,
      insightsData: ins
    });
  },

  loadDemo() {
    const list = [...BATCH_SAMPLES, ...DEMO_HISTORY].map((item, idx) => ({
      id: 'demo_' + idx,
      title: item.title,
      date: item.date,
      recommendedReads: item.recommendedReads,
      content: item.content
    }));
    wx.setStorageSync('tl_history', list);
    this.refreshData();
    wx.showToast({ title: '已载入7篇演示文稿', icon: 'success' });
  },

  clearHistory() {
    wx.showModal({
      title: '确认清空',
      content: '确定清空所有本地保存的文稿记录？',
      success: (res) => {
        if (res.confirm) {
          wx.setStorageSync('tl_history', []);
          this.refreshData();
          wx.showToast({ title: '已清空', icon: 'success' });
        }
      }
    });
  },

  onReadsBlur(e) {
    const id = e.currentTarget.dataset.id;
    const val = e.detail.value ? Number(e.detail.value) : null;
    const list = wx.getStorageSync('tl_history') || [];
    const item = list.find(x => x.id === id);
    if (item) {
      item.recommendedReads = val;
      wx.setStorageSync('tl_history', list);
      this.refreshData();
    }
  },

  deleteItem(e) {
    const id = e.currentTarget.dataset.id;
    let list = wx.getStorageSync('tl_history') || [];
    list = list.filter(x => x.id !== id);
    wx.setStorageSync('tl_history', list);
    this.refreshData();
    wx.showToast({ title: '已删除', icon: 'none' });
  }
});
