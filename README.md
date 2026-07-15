# Obsidian IMA Sync

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub Release](https://img.shields.io/github/v/release/zhonxia/obsidian-ima-sync)](https://github.com/zhonxia/obsidian-ima-sync/releases)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/zhonxia/obsidian-ima-sync/pulls)

> **Your notes, supercharged by AI.**

[English](README.md) | [中文](README.zh.md)

---

## The Story

**Obsidian** is where your ideas live. Plain markdown, local files, yours forever.

**IMA** is where AI meets your knowledge. But it's more than Q&A — IMA is a **vector knowledge base platform** with production-grade semantic search and a **Skill system** that lets you build custom AI agents on top of your data.

The problem? They don't talk to each other.

**Obsidian IMA Sync** bridges them. Write in Obsidian, sync to IMA's vector knowledge base, then build whatever AI workflow you need on top.

---

## Why Cloud Vector Search (Not Local)

This is the core question. Why not just run embeddings locally?

Because **vector search quality is the bottleneck** — and local solutions fundamentally can't match cloud infrastructure:

| Local Vector Search | IMA Cloud Vector Search |
|---------------------|------------------------|
| Tiny embedding models (384d) | Production-grade models (768d+) |
| Dense vector only — no keyword hybrid | Hybrid search: dense + sparse + keyword |
| No reranking | Full reranking pipeline for precision |
| Fixed model, never improves | Model continuously upgraded |
| Single-machine index, no scale | Distributed vector database, billions scale |
| No skill ecosystem | **IMA Skills** — build custom AI agents on your KB |

**This isn't about cloud vs local. It's about capable vs limited.**  
A local vector DB can't rerank, can't hybrid search, can't improve over time. IMA can — because it's built on Tencent's production infrastructure, not a laptop.

---

## Beyond Sync: IMA Skills

Syncing notes to IMA unlocks more than search. IMA's **Skill system** lets you build custom AI agents that operate on your knowledge base:

- **Research Agent** — Ask deep questions across your entire library
- **Daily Briefing** — AI summarizes what you wrote recently
- **Note Connector** — Find implicit connections between notes
- **Custom Skill** — Use IMA's OpenAPI to build your own

Your Obsidian notes become **a platform** for AI workflows, not just a search index.

---

## How It Works

```
You write in Obsidian ──→ Sync to IMA ──→ Vector KB ──→ AI Skills & Agents
       │                         │              │
  Your .md files          IMA knowledge      Hybrid search
  Yours forever            base               Dense + Sparse
  No lock-in                                  + Reranking
```

**Your data is yours.** Notes stay in Obsidian as plain markdown. IMA is a searchable, agent-ready copy — delete it anytime, your originals remain.

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
- Why append? IMA's API doesn't support in-place updates. The appended format preserves history while keeping the latest content available for AI retrieval and Skills.

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
