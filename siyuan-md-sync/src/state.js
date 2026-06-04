const STORAGE_KEY = 'state';

export class State {
  constructor(plugin) {
    this.plugin = plugin;
    this.notebookId = '';
    this.rootHpath = '/inbox';
    this.folders = [];
    this.writeBackIAL = true;
    this.importOnChange = true;
    this.mappings = {};
  }

  async load() {
    try {
      const raw = await this.plugin.loadData(STORAGE_KEY);
      if (raw) {
        this.notebookId = raw.notebookId || '';
        this.rootHpath = raw.rootHpath || '/inbox';
        this.folders = raw.folders || [];
        this.writeBackIAL = raw.writeBackIAL !== false;
        this.importOnChange = raw.importOnChange !== false;
        this.mappings = raw.mappings || {};
      }
    } catch (e) {
      console.warn('[state] load failed:', e);
    }
  }

  async save() {
    try {
      await this.plugin.saveData(STORAGE_KEY, {
        version: 1,
        notebookId: this.notebookId,
        rootHpath: this.rootHpath,
        folders: this.folders,
        writeBackIAL: this.writeBackIAL,
        importOnChange: this.importOnChange,
        mappings: this.mappings,
      });
    } catch (e) {
      console.warn('[state] save failed:', e);
    }
  }

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
}
