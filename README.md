# Obsidian IMA Sync

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **Your notes, supercharged by AI.**  
> 你的笔记，你拥有，AI 替你整理、检索、问答。

English | [中文](#中文)

---

## The Story

**Obsidian** is where your ideas live. Plain markdown, local files, yours forever.

**IMA** (Tencent's AI knowledge base) is where AI meets your knowledge. Powerful retrieval, intelligent Q&A, automated organization.

But they don't talk to each other.

**Obsidian IMA Sync** is the bridge. Write in Obsidian (your data stays yours), sync to IMA (AI does the heavy lifting). No local vector database, no GPU required — just your notes, with superpowers.

---

## Why This Exists

| Problem | Solution |
|---------|----------|
| Local vector search is slow and inaccurate | IMA's cloud-grade AI delivers precise answers |
| Your laptop can't run large models | Zero local compute — all AI runs on IMA's servers |
| IMA has no good editor | Obsidian is the best markdown editor. Keep writing here |
| Obsidian has no built-in AI knowledge base | Your notes become an AI-searchable knowledge base |
| You want your data portable | Notes stay in Obsidian as plain markdown. No lock-in |

---

## How It Works

```
You write in Obsidian ──→ Sync to IMA ──→ AI search & Q&A
       │                         │
  Your .md files           IMA knowledge base
  Yours forever            AI-powered
  No lock-in               Ask questions, get answers
```

**Your data is yours.** Your notes remain in Obsidian as plain markdown files. IMA is a searchable copy — you can delete it anytime, your originals stay safe.

---

## Screenshots

<!-- TODO: Add screenshots -->
<!-- ![Sidebar View](docs/screenshots/sidebar.png) -->
<!-- ![Settings](docs/screenshots/settings.png) -->

---

## Quick Start

```bash
# 1. Install the plugin
cd your-vault/.obsidian/plugins/
git clone https://github.com/zhonxia/obsidian-ima-sync.git obsidaiantoima

# 2. Install dependencies & build (or download from Releases)
npm install && npm run build

# 3. Enable in Obsidian Settings → Community Plugins
# 4. Get credentials at https://ima.qq.com/agent-interface
# 5. Configure in plugin settings → Test Connection → Sync!
```

### Manual Installation

1. Download the latest `main.js`, `manifest.json`, `styles.css` from [Releases](https://github.com/zhonxia/obsidian-ima-sync/releases)
2. Place them in `{your-vault}/.obsidian/plugins/obsidaiantoima/`
3. Enable in Obsidian Settings → Community Plugins

---

## Configuration

1. Go to **https://ima.qq.com/agent-interface** → get your **Client ID** and **API Key**
2. Enter them in plugin settings → **Test Connection**
3. Click **Refresh** to load your knowledge bases → select one (or leave empty to only create notes)
4. Enable **Auto-sync on save** if you want automatic syncing

---

## Usage

| Action | How |
|--------|-----|
| Open sync panel | Click 🔄 ribbon icon or `Cmd+P` → "Open IMA Sync view" |
| Sync a single file | Click ↻ next to any file |
| Batch sync | Check files → **Sync Selected** |
| Sync all | Click **Sync All** (only syncs unsynced/modified files) |
| Sync current note | `Cmd+P` → "Sync current note to IMA" |

### Sync Strategy

- **First sync** → `import_doc` creates a new IMA note + optionally adds to knowledge base
- **Subsequent syncs** → `append_doc` appends a timestamped update with full latest content
- Why? IMA's API doesn't support in-place updates. The appended format preserves both history and the latest content for AI retrieval.

---

## Development

```bash
npm install
npm run dev    # watch mode
npm run build  # production build
```

### Structure

```
obsidian-ima-sync/
├── manifest.json          # Plugin metadata
├── package.json           # Dependencies
├── esbuild.config.mjs     # Build config
├── styles.css             # Styles
└── src/
    ├── main.ts            # Entry point
    ├── api.ts             # IMA OpenAPI client
    ├── settings.ts        # Settings tab
    ├── sync.ts            # Sync engine
    └── view.ts            # Sidebar view
```

---

## License

MIT

---

<a name="中文"></a>

## 中文

### 为什么你需要这个插件

**Obsidian** 是最好的笔记工具之一。纯 Markdown、本地存储、数据属于你 —— 但它的知识检索能力有限。

**IMA**（腾讯智能知识库）有强大的 AI 能力 —— 精准检索、智能问答、Copilot 自动整理 —— 但它没有一个好的编辑器。

**Obsidian IMA Sync** 让两者各司其职：

> **Obsidian 负责写，IMA 负责 AI。你的数据始终是你的。**

### 解决的问题

| 问题 | 解法 |
|------|------|
| 本地向量知识库检索不准 | IMA 云端 AI，检索和问答准确度高 |
| 电脑带不动大模型 | 不需要本地 GPU，AI 全部跑在云端 |
| IMA 没有好用的编辑器 | Obsidian 写笔记，IMA 消费内容，两不耽误 |
| Obsidian 没有 AI 知识库 | 笔记同步到 IMA，直接 AI 检索和问答 |
| 数据被锁定 | 笔记永远是 Obsidian 的 .md 文件，随时可迁移 |

### 核心理念

**你的数据就是你的。**

- 笔记永远在 Obsidian 里，以纯 Markdown 格式存在
- IMA 是可检索的副本，随时可以删除，源文件不受影响
- 双向隔离，但一键连通：Obsidian 负责创作，IMA 负责 AI

### IMA Copilot 的增值能力

笔记同步到 IMA 后，你可以利用 **IMA Copilot** 实现：

- ✨ **自动整理** — AI 帮你分类、归纳笔记
- 🔍 **深度检索** — 自然语言提问，精准定位内容
- 💬 **智能问答** — 基于你的知识库，AI 给出上下文相关回答
- 📊 **知识图谱** — IMA 自动构建笔记之间的关联

### 安装

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

### 配置

1. 访问 **https://ima.qq.com/agent-interface** 获取 **Client ID** 和 **API Key**
2. 填入插件设置 → 点击 **Test Connection** 验证凭证
3. 点击 **Refresh** 自动拉取知识库列表，按名称选择目标知识库
4. 开启 **Auto-sync on save** 即可在保存笔记时自动同步

### 使用

| 操作 | 方式 |
|------|------|
| 打开同步面板 | 点击 🔄 图标或 `Cmd+P` → "Open IMA Sync view" |
| 同步单个文件 | 点击文件旁的 ↻ 按钮 |
| 批量同步 | 勾选多个文件 → **Sync Selected** |
| 同步全部 | **Sync All**（只同步未同步/有修改的文件） |
| 同步当前笔记 | `Cmd+P` → "Sync current note to IMA" |

### 同步策略

- **首次同步** — `import_doc` 在 IMA 创建一条新笔记，可选添加到知识库
- **增量同步** — `append_doc` 在 IMA 笔记末尾追加带时间戳的最新完整内容
- **为什么是追加？** IMA API 不支持原地更新。追加格式保留了变更历史，同时 AI 检索时能读到最新内容

### 开发

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

### 协议

MIT
