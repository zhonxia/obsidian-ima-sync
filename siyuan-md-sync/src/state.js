const STORAGE_KEY = 'state';
const SCHEMA_VERSION = 2;

export class State {
  constructor(plugin) {
    this.plugin = plugin;
    // 多笔记本配置：{ [notebookId]: { folders: [{path, label}], rootHpath: '/inbox' } }
    this.notebooks = {};
    // 当前在设置面板里编辑哪个笔记本
    this.activeNotebookId = '';
    this.writeBackIAL = false;
    this.importOnChange = true;
    this.bidirectional = true;
    this.mappings = {};
  }

  async load() {
    try {
      const raw = await this.plugin.loadData(STORAGE_KEY);
      if (!raw) return;

      // 旧版本（v1）：notebookId/folders/rootHpath 是全局的
      if (!raw.schemaVersion || raw.schemaVersion < 2) {
        this._migrateV1(raw);
      } else {
        this.notebooks = raw.notebooks || {};
        this.activeNotebookId = raw.activeNotebookId || '';
      }

      this.writeBackIAL = raw.writeBackIAL === true;
      this.importOnChange = raw.importOnChange !== false;
      this.bidirectional = raw.bidirectional !== false;
      this.mappings = raw.mappings || {};

      // 把迁移后的旧 mappings 补上 notebookId（v1 的映射都属于 activeNotebookId）
      if (this.activeNotebookId) {
        for (const info of Object.values(this.mappings)) {
          if (!info.notebookId) info.notebookId = this.activeNotebookId;
        }
      }

      // 容错：activeNotebookId 指向不存在的 notebook 时清空
      if (this.activeNotebookId && !this.notebooks[this.activeNotebookId]) {
        this.activeNotebookId = Object.keys(this.notebooks)[0] || '';
      }
    } catch (e) {
      console.warn('[state] load failed:', e);
    }
  }

  /**
   * v1 → v2 数据迁移：把全局的 {notebookId, rootHpath, folders}
   * 挪到 notebooks[oldNotebookId] 下面。
   */
  _migrateV1(raw) {
    const oldNbId = raw.notebookId || '';
    const oldFolders = raw.folders || [];
    const oldRootHpath = raw.rootHpath || '/inbox';
    if (oldNbId) {
      this.notebooks[oldNbId] = {
        folders: oldFolders,
        rootHpath: oldRootHpath,
      };
      this.activeNotebookId = oldNbId;
    }
    console.log('[state] migrated v1 → v2, notebook count:', Object.keys(this.notebooks).length);
  }

  async save() {
    try {
      await this.plugin.saveData(STORAGE_KEY, {
        schemaVersion: SCHEMA_VERSION,
        activeNotebookId: this.activeNotebookId,
        notebooks: this.notebooks,
        writeBackIAL: this.writeBackIAL,
        importOnChange: this.importOnChange,
        bidirectional: this.bidirectional,
        mappings: this.mappings,
      });
    } catch (e) {
      console.warn('[state] save failed:', e);
    }
  }

  // ============================================================
  // 查询/修改当前激活笔记本的配置
  // ============================================================

  /** 返回当前激活笔记本的配置对象（不存在则返回 null）。 */
  getActive() {
    if (!this.activeNotebookId) return null;
    return this.notebooks[this.activeNotebookId] || null;
  }

  /** 确保当前激活笔记本存在配置项（懒创建）。 */
  ensureActive() {
    if (!this.activeNotebookId) return null;
    if (!this.notebooks[this.activeNotebookId]) {
      this.notebooks[this.activeNotebookId] = { folders: [], rootHpath: '/inbox' };
    }
    return this.notebooks[this.activeNotebookId];
  }

  /** 切换 activeNotebookId。会停止并重启 watcher。 */
  setActive(notebookId) {
    this.activeNotebookId = notebookId || '';
    if (this.activeNotebookId && !this.notebooks[this.activeNotebookId]) {
      this.notebooks[this.activeNotebookId] = { folders: [], rootHpath: '/inbox' };
    }
  }

  // ============================================================
  // mappings（按 .md 路径）
  // ============================================================

  get(absPath) {
    return this.mappings[absPath] || null;
  }

  set(absPath, info) {
    this.mappings[absPath] = { ...info, lastSync: Date.now() };
  }

  remove(absPath) {
    delete this.mappings[absPath];
  }

  byDocId(docId) {
    for (const [k, v] of Object.entries(this.mappings)) {
      if (v.docId === docId) return { path: k, ...v };
    }
    return null;
  }

  // ============================================================
  // 跨所有笔记本：用于 reconcile / watcher 遍历
  // ============================================================

  /** 返回 [{notebookId, folder, rootHpath}, ...] 所有笔记本的所有监听文件夹。 */
  allWatched() {
    const out = [];
    for (const [nbId, cfg] of Object.entries(this.notebooks)) {
      const rootHpath = cfg.rootHpath || '/inbox';
      for (const folder of cfg.folders || []) {
        out.push({ notebookId: nbId, folder, rootHpath });
      }
    }
    return out;
  }
}
