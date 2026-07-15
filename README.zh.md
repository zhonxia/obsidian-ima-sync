# Obsidian IMA Sync

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub Release](https://img.shields.io/github/v/release/zhonxia/obsidian-ima-sync)](https://github.com/zhonxia/obsidian-ima-sync/releases)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/zhonxia/obsidian-ima-sync/pulls)

> **你的数据就是你的。云端能力，本地主权。**

[English](README.md) | [中文](README.zh.md)

---

## 核心理念

> **你的笔记，你拥有，AI 替你整理、检索、问答。**

笔记永远在 Obsidian 里，纯 Markdown，随时可迁移。IMA 是检索和 AI 加工的副本，源文件由你掌控。

---

## 为什么不用本地向量知识库？

这是最根本的问题。本地跑 embedding 看起来很美好，但**向量检索的质量是瓶颈**——本地方案在根本上就无法匹敌云端基础设施：

| 本地方案 | IMA 云端 |
|---------|----------|
| 小模型 (384维) | 生产级模型 (768维+) |
| 纯稠密向量，无混合检索 | 混合检索：稠密 + 稀疏 + 关键词 |
| 无重排序 (reranking) | 完整重排序 pipeline |
| 固定模型，永不升级 | 模型持续迭代优化 |
| 单机索引，无法扩展 | 分布式向量数据库，亿级规模 |
| 没有技能生态 | **IMA Skill 系统** — 在知识库上构建自定义 AI Agent |

**这不是"云端 vs 本地"的选择，而是"有能力 vs 没能力"的选择。**  
本地向量库不能 rerank、不能混合搜索、不能随时间变好。IMA 可以——因为它跑在腾讯的生产基础设施上，而不是你的笔记本上。

---

## IMA Skill：不只是检索，是智能体平台

笔记同步到 IMA 后，你得到的不只是一个可搜索的知识库，而是一个**能运行 AI Agent 的平台**。IMA 的 Skill 系统让你在知识库上构建各种 AI 工作流：

- 🔬 **调研助手** — 跨整库深度研究，自动整理文献综述
- 📋 **日报生成** — AI 自动总结你最近写了什么
- 🔗 **笔记关联器** — 发现笔记之间的隐性连接，构建知识图谱
- 🛠️ **自定义 Skill** — 通过 IMA OpenAPI 构建你自己的 AI Agent

你的 Obsidian 笔记不再只是笔记——它们是 **AI 工作流的原材料**，IMA 是加工厂。

---

## IMA Copilot 能力

- ✨ **自动整理** — AI 帮你分类、归纳、打标签
- 🔍 **精准检索** — 自然语言提问，混合搜索 + reranking 保证精度
- 💬 **智能问答** — 基于你的知识库回答，上下文相关
- 🌐 **知识图谱** — 自动构建笔记之间的语义关联

---

## 解决的问题

| 问题 | 解法 |
|------|------|
| 本地向量检索不准 (无 rerank、无混合搜索) | IMA 生产级检索 pipeline |
| 电脑带不动大模型 | 不需要本地 GPU，全部云端 |
| IMA 没有好用的编辑器 | Obsidian 写，IMA 消费，两不耽误 |
| Obsidian 没有 AI 能力 | 笔记同步后，直接获得整个 IMA Skill 生态 |
| 数据被锁定 | 笔记永远是 Obsidian 的 .md 文件，随时可迁移 |

---

## 一句话总结

> **你的数据在你手里，AI 能力在云端。Obsidian IMA Sync 是那座桥。**

---

## 安装

```bash
# 方式一：通过 Releases 下载
# 1. 下载 https://github.com/zhonxia/obsidian-ima-sync/releases
# 2. 解压到 {你的仓库}/.obsidian/plugins/obsidaiantoima/
# 3. 在 Obsidian 设置 → 第三方插件 中启用

# 方式二：从源码构建
cd your-vault/.obsidian/plugins/
git clone https://github.com/zhonxia/obsidian-ima-sync.git obsidaiantoima
cd obsidaiantoima
npm install && npm run build
```

---

## 配置

1. 访问 **https://ima.qq.com/agent-interface** 获取 **Client ID** 和 **API Key**
2. 填入插件设置 → 点击 **Test Connection** 验证凭证
3. 点击 **Refresh** 自动拉取知识库列表，按名称选择目标知识库
4. 开启 **Auto-sync on save** 即可在保存笔记时自动同步

---

## 使用

| 操作 | 方式 |
|------|------|
| 打开同步面板 | 点击 🔄 图标或 `Cmd+P` → "Open IMA Sync view" |
| 同步单个文件 | 点击文件旁的 ↻ 按钮 |
| 批量同步 | 勾选多个文件 → **Sync Selected** |
| 同步全部 | **Sync All**（只同步未同步/有修改的文件） |
| 同步当前笔记 | `Cmd+P` → "Sync current note to IMA" |

---

## 同步策略

- **首次同步** — `import_doc` 在 IMA 创建一条新笔记，可选添加到知识库
- **增量同步** — `append_doc` 在 IMA 笔记末尾追加带时间戳的最新完整内容
- **为什么追加？** IMA API 不支持原地更新。追加格式保留了变更历史，同时 AI 检索和 Skill 能读到最新内容

---

## 开发

```bash
npm install
npm run dev    # 开发模式（监听文件变化）
npm run build  # 生产构建
```

### 目录

```
obsidian-ima-sync/
├── manifest.json          # 插件元数据
├── package.json           # 依赖管理
├── esbuild.config.mjs     # 构建配置
├── styles.css             # 样式
└── src/
    ├── main.ts            # 插件入口
    ├── api.ts             # IMA OpenAPI 客户端
    ├── settings.ts        # 设置面板
    ├── sync.ts            # 同步引擎
    └── view.ts            # 侧边栏视图
```

---

## 协议

MIT
