# Obsidian IMA Sync

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> English | [中文](#中文)

Sync Obsidian notes to **IMA knowledge base** for AI-powered search and Q&A.

English
-------

### Features

- **Sidebar View** — Browse all markdown files with sync status at a glance
- **Sync to IMA** — Push notes to IMA as notes, optionally add to a knowledge base
- **Incremental Updates** — First sync creates a new IMA note; subsequent edits append timestamped updates
- **Batch Operations** — Select multiple files and sync at once
- **Auto-sync** — Optionally sync on file save
- **Knowledge Base Discovery** — Fetch and select your knowledge bases by name

### Screenshots

<!-- TODO: Add screenshots
![Sidebar View](docs/screenshots/sidebar.png)
![Settings](docs/screenshots/settings.png)
-->

### Installation

1. Download the latest release from [GitHub Releases](https://github.com/zhonxia/obsidian-ima-sync/releases)
2. Extract the files to `{your-vault}/.obsidian/plugins/obsidaiantoima/`
3. Enable the plugin in Obsidian Settings → Community Plugins
4. Open plugin settings to configure your IMA credentials

### Configuration

1. Go to **https://ima.qq.com/agent-interface** to get your **Client ID** and **API Key**
2. Enter them in plugin settings → **Test Connection** to verify
3. (Optional) Click **Refresh** to load your knowledge bases → select one

### Usage

- Click the 🔄 ribbon icon to open the IMA Sync sidebar view
- Check files and click **Sync Selected** to batch sync
- Click the ↻ button on any file to sync it individually
- Use **Sync All** to sync all unsynced or modified files
- Enable **Auto-sync on save** in settings for automatic syncing

### Development

```bash
npm install
npm run build   # production build
npm run dev     # watch mode
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

### License

MIT

---

<a name="中文"></a>

中文
----

### 功能

- **侧边栏视图** — 浏览所有 markdown 文件，直观显示同步状态
- **同步到 IMA** — 将笔记推送到 IMA，可选同步到知识库
- **增量更新** — 首次同步创建 IMA 笔记，后续编辑追加带时间戳的更新
- **批量操作** — 多选文件一键同步
- **自动同步** — 可选保存文件时自动触发同步
- **知识库发现** — 自动读取知识库列表，按名称选择

### 安装

1. 从 [GitHub Releases](https://github.com/zhonxia/obsidian-ima-sync/releases) 下载最新版本
2. 解压到 `{你的仓库}/.obsidian/plugins/obsidaiantoima/` 目录
3. 在 Obsidian 设置 → 第三方插件 中启用插件
4. 在插件设置中配置 IMA 凭证

### 配置

1. 访问 **https://ima.qq.com/agent-interface** 获取 **Client ID** 和 **API Key**
2. 填入插件设置 → 点击 **Test Connection** 验证
3. （可选）点击 **Refresh** 拉取你的知识库列表 → 选择目标知识库

### 使用

- 点击 🔄 图标打开 IMA Sync 侧边栏
- 勾选文件 → **Sync Selected** 批量同步
- 点击文件旁的 ↻ 按钮同步单个文件
- 点击 **Sync All** 同步所有未同步/有修改的文件
- 在设置中开启 **Auto-sync on save** 可自动同步

### 开发

```bash
npm install
npm run build   # 生产构建
npm run dev     # 监听模式
```

### 协议

MIT
