// 全局小程序逻辑
App({
  globalData: {
    platform: 'wechat'
  },
  onLaunch() {
    // 首次启动时若无历史数据，初始化空数组
    const hist = wx.getStorageSync('tl_history');
    if (!hist) {
      wx.setStorageSync('tl_history', []);
    }
  }
});
