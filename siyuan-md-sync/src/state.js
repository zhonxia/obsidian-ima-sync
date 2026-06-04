const STORAGE_KEY = 'state';
const SCHEMA_VERSION = 3;

export class State {
  constructor(plugin) {
    this.plugin = plugin;
    this.notebooks = {};
    this.activeNotebookId = '';
    this.writeBackIAL = false;
    this.importOnChange = true;
    this.bidirectional = true;
    // 1-to-many：mappings[absPath] = { mdHash, instances: [{docId, hpath, syHash, notebookId}, ...] }
    this.mappings = {};
  }

  async load() {
    try {
      const raw = await this.plugin.loadData(STORAGE_KEY);
      if (!raw) return;

      // 笔记本配置迁移
      if (!raw.schemaVersion || raw.schemaVersion < 2) {
        this._migrateV1Notebooks(raw);
      } else {
        this.notebooks = raw.notebooks || {};
        this.activeNotebookId = raw.activeNotebookId || '';
      }

      this.writeBackIAL = raw.writeBackIAL === true;
      this.importOnChange = raw.importOnChange !== false;
      this.bidirectional = raw.bidirectional !== false;

      // mappings 结构迁移：v1/v2 是单实例，v3 是多实例数组
      const oldMappings = raw.mappings || {};
      if (!raw.schemaVersion || raw.schemaVersion < 3) {
        this.mappings = this._migrateMappingsToMulti(oldMappings, this.activeNotebookId);
      } else {
        this.mappings = oldMappings;
      }

      // 容错
      if (this.activeNotebookId && !this.notebooks[this.activeNotebookId]) {
        this.activeNotebookId = Object.keys(this.notebooks)[0] || '';
      }

      // 恢复: 如果 mappings 里有 notebookId 引用了未配置的笔记本，自动建空条目
      // （防止设置被误清空后 reconcile 找不到任何文件夹）
      this._recoverNotebooksFromMappings();

      // 如果发生了迁移，触发一次 save 持久化新结构
      if (!raw.schemaVersion || raw.schemaVersion < SCHEMA_VERSION) {
        console.log('[state] auto-save after migration to v' + SCHEMA_VERSION);
        await this.save();
      }
    } catch (e) {
      console.warn('[state] load failed:', e);
    }
  }

  /** 从 mappings 恢复：凡是 instances 提到的 notebookId，若 notbooks 里没有，就加一个空配置 */
  _recoverNotebooksFromMappings() {
    const used = new Set();
    for (const m of Object.values(this.mappings || {})) {
      for (const inst of m.instances || []) {
        if (inst?.notebookId) used.add(inst.notebookId);
      }
    }
    for (const nbId of used) {
      if (!this.notebooks[nbId]) {
        console.log('[state] recovering notebook config for', nbId.slice(0, 14) + '...');
        this.notebooks[nbId] = { folders: [], rootHpath: '' };
      }
    }
  }

  _migrateV1Notebooks(raw) {
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
  }

  /** v1/v2 单实例 → v3 多实例。 */
  _migrateMappingsToMulti(oldMappings, fallbackNotebookId) {
    const out = {};
    for (const [absPath, info] of Object.entries(oldMappings)) {
      if (!info) continue;
      if (info.instances) {
        // 已经是 v3 格式
        out[absPath] = info;
        continue;
      }
      // v1/v2 单实例格式：{ docId, hpath, mdHash, syHash, notebookId }
      const notebookId = info.notebookId || fallbackNotebookId;
      if (!notebookId) {
        // 找不到归属笔记本，丢弃
        continue;
      }
      out[absPath] = {
        mdHash: info.mdHash || '',
        instances: [{
          docId: info.docId,
          hpath: info.hpath || '',
          syHash: info.syHash || '',
          notebookId,
        }],
      };
    }
    return out;
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
  // 笔记本配置（per-notebook folders/rootHpath）
  // ============================================================

  getActive() {
    if (!this.activeNotebookId) return null;
    return this.notebooks[this.activeNotebookId] || null;
  }

  ensureActive() {
    if (!this.activeNotebookId) return null;
    if (!this.notebooks[this.activeNotebookId]) {
      this.notebooks[this.activeNotebookId] = { folders: [], rootHpath: '' };
    }
    return this.notebooks[this.activeNotebookId];
  }

  setActive(notebookId) {
    this.activeNotebookId = notebookId || '';
    if (this.activeNotebookId && !this.notebooks[this.activeNotebookId]) {
      this.notebooks[this.activeNotebookId] = { folders: [], rootHpath: '' };
    }
  }

  /** 返回 [{notebookId, folder, rootHpath}, ...] 所有笔记本的所有监听文件夹。 */
  allWatched() {
    const out = [];
    for (const [nbId, cfg] of Object.entries(this.notebooks)) {
      const rootHpath = cfg.rootHpath || '';
      for (const folder of cfg.folders || []) {
        out.push({ notebookId: nbId, folder, rootHpath });
      }
    }
    return out;
  }

  // ============================================================
  // mappings（multi-instance）
  // ============================================================

  /** 返回 {mdHash, instances: [...]}; 不存在则 null */
  get(absPath) {
    return this.mappings[absPath] || null;
  }

  /** 添加或更新一个 instance。mdHash 是文件在磁盘上的 hash。 */
  upsertInstance(absPath, instance, mdHash) {
    if (!this.mappings[absPath]) {
      this.mappings[absPath] = { mdHash: mdHash || '', instances: [] };
    }
    if (mdHash !== undefined) this.mappings[absPath].mdHash = mdHash;
    const arr = this.mappings[absPath].instances;
    const idx = arr.findIndex(i => i.notebookId === instance.notebookId);
    if (idx >= 0) {
      arr[idx] = { ...arr[idx], ...instance, lastSync: Date.now() };
    } else {
      arr.push({ ...instance, lastSync: Date.now() });
    }
  }

  /** 移除某 instance（按 docId）。如果该 path 没有 instance 了，删除整个 entry。 */
  removeInstance(absPath, docId) {
    const m = this.mappings[absPath];
    if (!m) return;
    m.instances = m.instances.filter(i => i.docId !== docId);
    if (m.instances.length === 0) {
      delete this.mappings[absPath];
    }
  }

  /** 按 docId 找到 instance 和 path。 */
  byDocId(docId) {
    for (const [path, m] of Object.entries(this.mappings)) {
      for (const inst of m.instances || []) {
        if (inst.docId === docId) return { path, mdHash: m.mdHash, instance: inst };
      }
    }
    return null;
  }

  /** 删除整个 mapping entry。 */
  remove(absPath) {
    delete this.mappings[absPath];
  }

  /** 按 notebookId 移除该 path 的 instance（用于从笔记本上删除文件夹时）。 */
  removeByNotebook(absPath, notebookId) {
    const m = this.mappings[absPath];
    if (!m) return;
    m.instances = m.instances.filter(i => i.notebookId !== notebookId);
    if (m.instances.length === 0) {
      delete this.mappings[absPath];
    }
  }

  /** 返回所有 path。用于 cmdCleanIal。 */
  allPaths() {
    return Object.keys(this.mappings);
  }
}
