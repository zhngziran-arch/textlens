# TextLens · 创作透镜

[![GitHub Pages](https://img.shields.io/badge/Live_Demo-在线直接体验-0f766e?style=for-the-badge&logo=github)](https://zhngziran-arch.github.io/textlens/)
[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg?style=for-the-badge)](./LICENSE)
[![Engine Test](https://img.shields.io/badge/Engine_Tests-100%25_Passing-success?style=for-the-badge)](./tests/engine.test.js)

> **开源、纯本地运行的跨平台中文内容审阅与文风体检工具（支持 Web 网页端 + 微信小程序端）。**  
> 🚫 我不想贩卖任何限流焦虑，只是想分享一个好用的免费工具，目前检测原理还是本地的 **399+ 项**识别词表，其中正则、阈值与计算公式 100% 全部公开了、可查可改。

---

## 🌐 在线直接体验（免安装、免下载任何配置）

用户无需下载任何压缩包或配置环境，直接点击下方链接即可在浏览器中一键体验全部功能：

👉 **[点击立即在线体验 TextLens 创作透镜](https://zhngziran-arch.github.io/textlens/)**

欢迎关注我的公众号：非典型思考者，这是一个以深度时评为主的个人账号，我经常会发一些关于当下思考的文章，公众号里面有"创作透镜"的小程序版，可以日常在微信上使用！

<img width="430" height="430" alt="bcf6f153a0ac29464d7f6733e32d5af3" src="https://github.com/user-attachments/assets/49897786-76c1-43ba-ab55-1a16a4b6844f" />


> 💡 **本检测工具暂时没有接入第三方API**：所有文本分词、统计、高亮批注与多篇比对均在你的**浏览器本地内存**中完成（基于原生 JS + IndexedDB），打开浏览器 F12 的 Network（网络）面板即可验证：**你的内容不会被上传到服务器，只有那你自己能看到**。

---

## 💡 为什么做这个项目？

很多创作者在高频创作时会遇到「写久了陷入千篇一律的固定模板」「使用 AI 辅助后通篇都是假大空的连接词与公文废话」「连续几篇选题撞车导致公域流量断崖下滑」的问题。

市面上所谓的“限流检测”或“AI 味体检”工具往往把文章传回闭源后端，调用大模型生成几句模棱两可的套话，再引导付费购买课程或解除限制，尤其是用vibe coding搓出一些质量良莠不齐的网站，然后再宣称自己能识别平台的算法黑箱，解决你的限流、低创问题，高价把他们的工具卖给你。但是平台的规则是显然不可能被这些人这么容易就知道的，实际上大多数检测工具基本依赖的还是分析、语义聚类的相关度、重合度的计算，于是我干脆打算做一个开源工具，把这套计算法则公开了，同时可以更好的辅助大家进行内容创作，也希望大家能够一起维护、更新、优化这个工具（语料库的修改指引都已经提供在下面了）。

**TextLens 对同质化内容的检测，使用了一种完全透明、诚实、硬核的做法：**

1. **精准定位并提供 1 对 1 改写处方**：直接指出作者文中的高频套话原词（并附上 1 对 1 落地替换示范）、空洞段落的精确段号与首句预览、句式变异系数与排比打断建议。
2. **多篇去同质化交叉矩阵**：支持同时导入多篇文稿，精准点名哪两篇文稿选题重合度过高、共用了哪些核心关键词、定位跨篇原句复用，并识破作者长期以来的跨篇口头禅。
3. **真实推荐流量规律图谱**：结合已发文稿的实际推荐阅读数，通过数学算法（Spearman 秩相关）计算不同文本指标（字数、信息增量、AI 味、独有度）与推流的相关性，用自己的历史数据探索科学发布规律。
4. **多端支持**：包含 Web 纯静态网页端，以及专属优化的**微信小程序端**（源码位于 `/miniprogram`）。

---

## 🤝 欢迎开发者与创作者参与优化（开源共建）

本项目旨在构建一个完全由创作者与技术人员共同维护的**中文内容公开基准库**。无论你擅长写代码还是擅长写文章，都可以轻松参与：

### 1. 扩充与优化词库（无需写代码，直接改 JSON）
- **通用套话库**：修改 [`rules/common.json`](./rules/common.json) 中的 `aiConnectors`（连接词）、`hollow`（互联网黑话）、`cliches`（模板句式）、`preachy`（说教爹味腔）等。
- **平台专属规则**：修改 [`rules/platforms/`](./rules/platforms/) 下的 `wechat.json`、`xhs.json`、`zhihu.json`、`toutiao.json`。例如增加小红书最新的广告法雷区词、公众号禁止诱导分享的违规句式。
- 修改后请在规则的 `basis` 字段写明依据或公开发布规范，提交 Pull Request 即可！

### 2. 优化规则引擎与前端体验
- 引擎代码位于 [`src/engine/`](./src/engine/)，采用零依赖纯函数设计，保持单向无环架构。
- 每次提交或提 PR，GitHub Actions 均会自动运行 [`tests/engine.test.js`](./tests/engine.test.js) 确保全部测试通过。

---

## 🛠️ 本地运行与测试

电脑装有 Node.js（≥18）即可在本地启动：

```bash
# 1. 运行引擎自动化测试（秒级完成）
npm test

# 2. 启动本地静态预览（http://127.0.0.1:4173）
npm start
```

Windows 用户也可以直接双击根目录下的 `启动本地预览.bat`。

---

## 目录结构与如何贡献规则

```text
textlens/
├─ index.html                  # 单页应用入口
├─ rules/                      # 社区可直接提 PR 修改的公开规则库
│  ├─ common.json              # 通用连接词、套话、模板句式、信息增量正则与阈值
│  ├─ index.json               # 平台配置索引
│  └─ platforms/               # 各平台体裁配置（wechat / xhs / zhihu / toutiao / general）
├─ src/
│  ├─ engine/                  # 纯函数规则引擎（浏览器与 Node 通用）
│  ├─ ui/                      # 原文内联高亮与报告视图渲染
│  ├─ store.js                 # 浏览器本地 IndexedDB 存储
│  ├─ samples.js               # 内置正反面演示样例
│  └─ app.js                   # 页面交互入口
├─ tests/engine.test.js        # 引擎回归测试
├─ netlify.toml                # Netlify 部署配置
└─ .github/workflows/deploy.yml# GitHub Pages 自动部署
```

**修改或新增识别规则无需写代码**：直接编辑 `rules/common.json` 或 `rules/platforms/*.json`，在 `basis` 字段注明公开依据或经验观察，运行 `npm test` 通过后提交 PR 即可，网页里的「公开规则库」页签会自动同步展示。

---

## 开源协议

[MIT License](./LICENSE)
