const { commonRules, platformProfiles } = require('../../engine/rulesData.js');

Page({
  data: {
    totalWordCount: 0,
    common: {
      lexicons: [],
      info: []
    },
    platforms: []
  },

  onLoad() {
    const lexicons = Object.values(commonRules.lexicons || {}).map(lex => {
      const items = lex.words || lex.patterns || [];
      return Object.assign({}, lex, {
        items,
        itemCount: items.length
      });
    });
    const info = Object.values(commonRules.info || {});
    const platforms = Object.values(platformProfiles || {}).filter(p => p.lexicons && p.lexicons.length > 0);

    let totalWordCount = lexicons.reduce((s, l) => s + l.itemCount, 0);
    for (const p of platforms) {
      for (const l of p.lexicons) {
        totalWordCount += (l.words ? l.words.length : 0);
      }
    }

    this.setData({
      totalWordCount,
      common: {
        lexicons,
        info
      },
      platforms
    });
  }
});
