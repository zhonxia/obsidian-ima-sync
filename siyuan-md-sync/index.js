var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.js
var index_exports = {};
__export(index_exports, {
  default: () => index_default
});
module.exports = __toCommonJS(index_exports);
var import_siyuan5 = require("siyuan");

// src/api.js
var import_siyuan = require("siyuan");
var SiyuanError = class extends Error {
  constructor(msg, resp) {
    super(msg);
    this.resp = resp;
  }
};
function check(resp) {
  if (!resp) throw new SiyuanError("empty response");
  if (resp.code !== 0) {
    throw new SiyuanError(resp.msg || `code=${resp.code}`, resp);
  }
  return resp.data;
}
var Api = class {
  async _post(endpoint, data = {}) {
    const resp = await (0, import_siyuan.fetchSyncPost)(endpoint, data);
    return check(resp);
  }
  async listNotebooks() {
    return this._post("/api/notebook/lsNotebooks").then((d) => d.notebooks || []);
  }
  async openNotebook(notebookId) {
    return this._post("/api/notebook/openNotebook", { notebook: notebookId });
  }
  async sql(stmt) {
    return this._post("/api/query/sql", { stmt });
  }
  async listDocs(notebookId) {
    return this.sql(
      `SELECT id, hpath, path, updated FROM blocks WHERE type='d' AND box='${notebookId.replace(/'/g, "''")}'`
    );
  }
  async getDocKramdown(docId) {
    return this._post("/api/block/getBlockKramdown", { id: docId }).then((d) => d.kramdown || "");
  }
  async getDocStoragePath(docId) {
    const rows = await this.sql(
      `SELECT path FROM blocks WHERE id='${docId.replace(/'/g, "''")}' LIMIT 1`
    );
    return rows?.[0]?.path || "";
  }
  async createDocWithMd(notebookId, hpath, markdown) {
    const data = await this._post("/api/filetree/createDocWithMd", {
      notebook: notebookId,
      path: hpath,
      markdown
    });
    if (typeof data === "string") return data;
    if (data && typeof data === "object" && data.id) return data.id;
    return "";
  }
  async removeDoc(notebookId, storagePath) {
    return this._post("/api/filetree/removeDoc", { notebook: notebookId, path: storagePath });
  }
};

// src/state.js
var STORAGE_KEY = "state";
var SCHEMA_VERSION = 3;
var State = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.notebooks = {};
    this.activeNotebookId = "";
    this.writeBackIAL = false;
    this.importOnChange = true;
    this.bidirectional = true;
    this.mappings = {};
  }
  async load() {
    try {
      const raw = await this.plugin.loadData(STORAGE_KEY);
      if (!raw) return;
      if (!raw.schemaVersion || raw.schemaVersion < 2) {
        this._migrateV1Notebooks(raw);
      } else {
        this.notebooks = raw.notebooks || {};
        this.activeNotebookId = raw.activeNotebookId || "";
      }
      this.writeBackIAL = raw.writeBackIAL === true;
      this.importOnChange = raw.importOnChange !== false;
      this.bidirectional = raw.bidirectional !== false;
      const oldMappings = raw.mappings || {};
      if (!raw.schemaVersion || raw.schemaVersion < 3) {
        this.mappings = this._migrateMappingsToMulti(oldMappings, this.activeNotebookId);
      } else {
        this.mappings = oldMappings;
      }
      if (this.activeNotebookId && !this.notebooks[this.activeNotebookId]) {
        this.activeNotebookId = Object.keys(this.notebooks)[0] || "";
      }
      this._recoverNotebooksFromMappings();
      if (!raw.schemaVersion || raw.schemaVersion < SCHEMA_VERSION) {
        console.log("[state] auto-save after migration to v" + SCHEMA_VERSION);
        await this.save();
      }
    } catch (e) {
      console.warn("[state] load failed:", e);
    }
  }
  /** 从 mappings 恢复：凡是 instances 提到的 notebookId，若 notbooks 里没有，就加一个空配置 */
  _recoverNotebooksFromMappings() {
    const used = /* @__PURE__ */ new Set();
    for (const m of Object.values(this.mappings || {})) {
      for (const inst of m.instances || []) {
        if (inst?.notebookId) used.add(inst.notebookId);
      }
    }
    for (const nbId of used) {
      if (!this.notebooks[nbId]) {
        console.log("[state] recovering notebook config for", nbId.slice(0, 14) + "...");
        this.notebooks[nbId] = { folders: [], rootHpath: "" };
      }
    }
  }
  _migrateV1Notebooks(raw) {
    const oldNbId = raw.notebookId || "";
    const oldFolders = raw.folders || [];
    const oldRootHpath = raw.rootHpath || "/inbox";
    if (oldNbId) {
      this.notebooks[oldNbId] = {
        folders: oldFolders,
        rootHpath: oldRootHpath
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
        out[absPath] = info;
        continue;
      }
      const notebookId = info.notebookId || fallbackNotebookId;
      if (!notebookId) {
        continue;
      }
      out[absPath] = {
        mdHash: info.mdHash || "",
        instances: [{
          docId: info.docId,
          hpath: info.hpath || "",
          syHash: info.syHash || "",
          notebookId
        }]
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
        mappings: this.mappings
      });
    } catch (e) {
      console.warn("[state] save failed:", e);
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
      this.notebooks[this.activeNotebookId] = { folders: [], rootHpath: "" };
    }
    return this.notebooks[this.activeNotebookId];
  }
  setActive(notebookId) {
    this.activeNotebookId = notebookId || "";
    if (this.activeNotebookId && !this.notebooks[this.activeNotebookId]) {
      this.notebooks[this.activeNotebookId] = { folders: [], rootHpath: "" };
    }
  }
  /** 返回 [{notebookId, folder, rootHpath}, ...] 所有笔记本的所有监听文件夹。 */
  allWatched() {
    const out = [];
    for (const [nbId, cfg] of Object.entries(this.notebooks)) {
      const rootHpath = cfg.rootHpath || "";
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
      this.mappings[absPath] = { mdHash: mdHash || "", instances: [] };
    }
    if (mdHash !== void 0) this.mappings[absPath].mdHash = mdHash;
    const arr = this.mappings[absPath].instances;
    const idx = arr.findIndex((i) => i.notebookId === instance.notebookId);
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
    m.instances = m.instances.filter((i) => i.docId !== docId);
    if (m.instances.length === 0) {
      delete this.mappings[absPath];
    }
  }
  /** 按 docId 找到 instance 和 path。 */
  byDocId(docId) {
    for (const [path4, m] of Object.entries(this.mappings)) {
      for (const inst of m.instances || []) {
        if (inst.docId === docId) return { path: path4, mdHash: m.mdHash, instance: inst };
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
    m.instances = m.instances.filter((i) => i.notebookId !== notebookId);
    if (m.instances.length === 0) {
      delete this.mappings[absPath];
    }
  }
  /** 返回所有 path。用于 cmdCleanIal。 */
  allPaths() {
    return Object.keys(this.mappings);
  }
};

// src/sync.js
var import_crypto = __toESM(require("crypto"));
var import_path = __toESM(require("path"));
var import_promises = __toESM(require("fs/promises"));
var import_siyuan2 = require("siyuan");

// src/i18n.js
var lang = typeof window !== "undefined" && window.siyuan?.config?.lang || "zh_CN";
var messages = {
  zh_CN: {
    pluginLoaded: "Markdown \u540C\u6B65\u5DF2\u52A0\u8F7D",
    pluginUnloaded: "Markdown \u540C\u6B65\u5DF2\u5378\u8F7D",
    firstRunTitle: "\u9996\u6B21\u8FD0\u884C",
    firstRunHint: "\u8BF7\u5148\u6253\u5F00\u63D2\u4EF6\u8BBE\u7F6E\uFF0C\u914D\u7F6E\u76EE\u6807\u7B14\u8BB0\u672C\u548C\u76D1\u542C\u6587\u4EF6\u5939\u3002",
    openSettings: "\u6253\u5F00\u8BBE\u7F6E",
    addFolder: "\u6DFB\u52A0\u76D1\u542C\u6587\u4EF6\u5939",
    removeFolder: "\u79FB\u9664",
    watchedFolders: "\u76D1\u542C\u6587\u4EF6\u5939",
    noFolders: "\u672C\u5730\u8981\u76D1\u542C\u7684 Markdown \u6587\u4EF6\u5939\uFF08\u53EF\u591A\u4E2A\uFF09",
    targetNotebook: "\u76EE\u6807\u7B14\u8BB0\u672C",
    targetNotebookDesc: '\u4E0B\u9762\u7684"\u76D1\u542C\u6587\u4EF6\u5939"\u548C"\u76EE\u6807 HPath"\u90FD\u9488\u5BF9\u6B64\u7B14\u8BB0\u672C\u3002\u5207\u6362\u7B14\u8BB0\u672C \u2192 \u5207\u6362\u914D\u7F6E\u3002',
    rootHpath: "\u76EE\u6807 HPath\uFF08\u5F53\u524D\u7B14\u8BB0\u672C\u5185\u7684\u6839\u8DEF\u5F84\uFF09",
    rootHpathHint: "\u4F8B\u5982\u586B /inbox\uFF1B\u76D1\u542C\u6587\u4EF6\u5939\u91CC\u7684 foo/bar.md \u4F1A\u53D8\u6210 /inbox/foo/bar\u3002\u7559\u7A7A = \u76F4\u63A5\u5B58\u5230\u7B14\u8BB0\u672C\u6839\u76EE\u5F55\uFF08foo/bar.md \u2192 /foo/bar\uFF09",
    rootHpathPlaceholder: "\u7559\u7A7A = \u7B14\u8BB0\u672C\u6839\u76EE\u5F55",
    writeBackIAL: "\u5C06\u601D\u6E90\u751F\u6210\u7684 IAL \u5757 ID \u5199\u56DE .md \u6E90\u6587\u4EF6",
    writeBackIALHint: "\u5173\u95ED\uFF08\u9ED8\u8BA4\uFF09\u540E .md \u4FDD\u6301\u5E72\u51C0\uFF0C\u5757\u5F15\u7528 ((xxx)) \u4F1A\u5931\u6548",
    bidirectional: "\u53CC\u5411\u540C\u6B65\uFF1A\u601D\u6E90\u91CC\u4FEE\u6539\u4E5F\u81EA\u52A8\u5199\u56DE .md",
    bidirectionalHint: '\u5173\u95ED\u540E\u53EA\u80FD\u4ECE .md \u63A8\u5230\u601D\u6E90\uFF0C\u601D\u6E90\u91CC\u6539\u4E86\u9700\u8981\u624B\u52A8"\u5BFC\u51FA\u5F53\u524D\u6587\u6863"',
    importOnChange: "\u6587\u4EF6\u6539\u52A8\u65F6\u81EA\u52A8\u5BFC\u5165",
    cmdImportFile: "\u5BFC\u5165 Markdown \u6587\u4EF6",
    cmdImportFolder: "\u5BFC\u5165 Markdown \u6587\u4EF6\u5939",
    cmdExportCurrent: "\u5C06\u5F53\u524D\u6587\u6863\u5BFC\u51FA\u4E3A .md",
    cmdReconcile: "\u7ACB\u5373\u5BF9\u8D26\uFF08\u626B\u6240\u6709\u76D1\u542C\u6587\u4EF6\u5939+\u6240\u6709\u7B14\u8BB0\u672C\uFF09",
    reconciling: "\u5BF9\u8D26\u4E2D...",
    cmdForcePull: "\u4ECE\u601D\u6E90\u62C9\u53D6\u6240\u6709\u6620\u5C04\u6587\u6863\u5230 .md\uFF08\u8C03\u8BD5\uFF09",
    forcePullDone: "\u5DF2\u62C9\u53D6",
    cmdCleanIal: "\u6E05\u7406\u6240\u6709 .md \u91CC\u7684 IAL \u5757 ID \u566A\u97F3",
    cleanIalDone: "\u5DF2\u6E05\u7406",
    importing: "\u6B63\u5728\u5BFC\u5165...",
    imported: "\u5DF2\u5BFC\u5165",
    exported: "\u5DF2\u5BFC\u51FA",
    reconcileDone: "\u5BF9\u8D26\u5B8C\u6210",
    confirmRemoveFolder: "\u786E\u5B9A\u8981\u79FB\u9664\u8BE5\u6587\u4EF6\u5939\u5417\uFF1F\u5DF2\u6709\u6587\u6863\u4E0D\u4F1A\u88AB\u5220\u9664\u3002",
    error: "\u9519\u8BEF",
    save: "\u4FDD\u5B58",
    saved: "\u5DF2\u4FDD\u5B58",
    addFolderPrompt: "\u7C98\u8D34\u8981\u76D1\u542C\u7684\u6587\u4EF6\u5939\u7EDD\u5BF9\u8DEF\u5F84\uFF08\u4F8B\u5982 /Users/me/notes\uFF09",
    cancel: "\u53D6\u6D88",
    confirm: "\u786E\u8BA4",
    addFolderTitle: "\u6DFB\u52A0\u76D1\u542C\u6587\u4EF6\u5939",
    pickAFile: "\u9009\u62E9 Markdown \u6587\u4EF6",
    pickAFileTitle: "\u9009\u62E9 .md \u6587\u4EF6",
    pickAFilePrompt: "\u7C98\u8D34 .md \u6587\u4EF6\u7684\u7EDD\u5BF9\u8DEF\u5F84",
    pickAFolder: "\u9009\u62E9\u6587\u4EF6\u5939",
    watching: "\u6B63\u5728\u76D1\u542C",
    stopped: "\u5DF2\u505C\u6B62\u76D1\u542C",
    needsFsAccess: "\u6B64\u63D2\u4EF6\u9700\u8981 Node fs \u6743\u9650\u3002\u5728\u67D0\u4E9B\u5B89\u88C5\u65B9\u5F0F\u4E0B fs \u4E0D\u53EF\u7528\uFF0C\u8BF7\u786E\u8BA4\u5DF2 npm install\u3002"
  },
  en_US: {
    pluginLoaded: "Markdown Sync loaded",
    pluginUnloaded: "Markdown Sync unloaded",
    firstRunTitle: "First run",
    firstRunHint: "Open settings first to configure the target notebook and watched folders.",
    openSettings: "Open settings",
    addFolder: "Add watched folder",
    removeFolder: "Remove",
    watchedFolders: "Watched folders",
    noFolders: "Local Markdown folders to watch (multiple supported)",
    targetNotebook: "Target notebook",
    targetNotebookDesc: "Synced documents will be created inside this notebook",
    rootHpath: "Target HPath (root path inside the notebook)",
    rootHpathHint: "e.g. /inbox \u2192 watched/foo/bar.md becomes /inbox/foo/bar. Leave empty for notebook root (foo/bar.md \u2192 /foo/bar)",
    rootHpathPlaceholder: "empty = notebook root",
    writeBackIAL: "Write back Siyuan IAL block IDs into the source .md",
    writeBackIALHint: "Off keeps .md clean, but breaks block references ((xxx))",
    bidirectional: "Bidirectional: Siyuan edits auto-write back to .md",
    bidirectionalHint: 'Off: only push fs \u2192 Siyuan. Use "Export current document" for Siyuan \u2192 fs.',
    importOnChange: "Auto-import on file change",
    cmdImportFile: "Import Markdown file",
    cmdImportFolder: "Import Markdown folder",
    cmdExportCurrent: "Export current document as .md",
    cmdReconcile: "Reconcile now (all folders, all notebooks)",
    reconciling: "reconciling...",
    cmdForcePull: "Force pull all mapped docs from Siyuan (debug)",
    forcePullDone: "pulled",
    cmdCleanIal: "Strip IAL block IDs from all .md files",
    cleanIalDone: "cleaned",
    importing: "Importing...",
    imported: "Imported",
    exported: "Exported",
    reconcileDone: "Reconciliation complete",
    confirmRemoveFolder: "Remove this folder? Existing docs will not be deleted.",
    error: "Error",
    save: "Save",
    saved: "Saved",
    addFolderPrompt: "Paste absolute path of folder to watch (e.g. /Users/me/notes)",
    cancel: "Cancel",
    confirm: "OK",
    addFolderTitle: "Add watched folder",
    pickAFile: "Pick a Markdown file",
    pickAFileTitle: "Pick a .md file",
    pickAFilePrompt: "Paste the absolute path of the .md file",
    pickAFolder: "Pick a folder",
    watching: "Watching",
    stopped: "Stopped watching",
    needsFsAccess: "This plugin requires Node fs. If unavailable, run npm install in the plugin folder."
  }
};
var t = (key) => {
  const dict = messages[lang] || messages.zh_CN;
  return dict[key] || messages.en_US[key] || key;
};

// src/sync.js
var sha256 = (text) => import_crypto.default.createHash("sha256").update(text).digest("hex");
function stripIal(text) {
  let out = text.replace(/^[ \t]*\{:[^}]*\}[ \t]*\r?\n?/gm, "");
  out = out.replace(/\{:[^}]*\}/g, "");
  out = out.replace(/\n{3,}/g, "\n\n");
  out = out.replace(/\s+$/, "");
  return out;
}
function relToRoot(absPath, folders) {
  for (const f of folders) {
    if (absPath.startsWith(f.path + import_path.default.sep) || absPath === f.path) {
      let rel = absPath.slice(f.path.length).replace(/\\/g, "/");
      if (rel.startsWith("/")) rel = rel.slice(1);
      return rel;
    }
  }
  return null;
}
function toHPath(rootHpath, rel) {
  const stem = rel.replace(/\.md$/i, "");
  const r = (rootHpath || "").replace(/\/+$/, "");
  return r ? `${r}/${stem}` : `/${stem}`;
}
var Sync = class {
  constructor(api, state, opts = {}) {
    this.api = api;
    this.state = state;
    this.notify = opts.notify || ((msg, type) => (0, import_siyuan2.showMessage)(msg, 3e3, type || "info"));
    this.log = opts.log || console.log;
    this._pullTimers = {};
  }
  /** 给定一个 .md 的绝对路径，返回所有应拥有它的 (notebookId, folder, rootHpath)。 */
  findWatchers(absPath) {
    const out = [];
    for (const item of this.state.allWatched()) {
      const f = item.folder;
      if (absPath.startsWith(f.path + import_path.default.sep) || absPath === f.path) {
        out.push(item);
      }
    }
    return out;
  }
  // ============================================================
  // fs → siyuan
  // ============================================================
  /**
   * 导入/更新一个 .md 到所有相关的笔记本。
   * - 没传 target 时，自动找出所有应拥有此文件的笔记本
   * - 传了 target 时只导入到那个笔记本（用于 reconcile 里的精确控制）
   * @returns {string|null} 第一个 instance 的 docId，失败为 null
   */
  async importFile(absPath, target = null) {
    const targets = target ? [target] : this.findWatchers(absPath);
    if (targets.length === 0) {
      this.log("[import] \u8DEF\u5F84\u4E0D\u5728\u4EFB\u4F55\u76D1\u542C\u76EE\u5F55\u5185:", absPath);
      return null;
    }
    let content;
    try {
      content = await import_promises.default.readFile(absPath, "utf-8");
    } catch (e) {
      this.log("readFile \u5931\u8D25", absPath, e.message);
      return null;
    }
    const h = sha256(content);
    const existing = this.state.get(absPath);
    const needsUpdate = !existing || existing.mdHash !== h || targets.some((t2) => !existing.instances.some((i) => i.notebookId === t2.notebookId));
    if (!needsUpdate) {
      return existing.instances[0].docId;
    }
    let firstId = null;
    for (const t2 of targets) {
      const id = await this._importOne(absPath, content, h, t2, existing);
      if (id && !firstId) firstId = id;
    }
    await this.state.save();
    return firstId;
  }
  /**
   * 把一份 .md 内容导入到单个 (notebookId, folder, rootHpath)。
   * 删除该笔记本上该 path 的旧 doc（如有），创建新 doc，更新 instance。
   */
  async _importOne(absPath, content, h, target, existing) {
    const { notebookId, folder, rootHpath } = target;
    const oldInst = existing?.instances?.find((i) => i.notebookId === notebookId);
    const rel = relToRoot(absPath, [folder]);
    const hpath = toHPath(rootHpath, rel);
    try {
      if (oldInst?.docId) {
        try {
          const storage = await this.api.getDocStoragePath(oldInst.docId);
          if (storage) await this.api.removeDoc(notebookId, storage);
        } catch (e) {
          this.log("[import] \u65E7 doc \u5DF2\u4E0D\u5B58\u5728\u6216\u65E0\u6CD5\u5220\u9664:", oldInst.docId);
        }
      }
      this.log("[import] creating", hpath, "in", notebookId.slice(0, 12) + "...");
      const newId = await this.api.createDocWithMd(notebookId, hpath, content);
      this.log("[import] createDocWithMd returned:", JSON.stringify(newId));
      if (!newId) throw new Error("createDocWithMd \u672A\u8FD4\u56DE id");
      const syContent = await this.api.getDocKramdown(newId);
      const syHash = sha256(stripIal(syContent));
      if (this.state.writeBackIAL && syContent !== content) {
        await import_promises.default.writeFile(absPath, syContent, "utf-8");
      }
      this.state.upsertInstance(absPath, {
        docId: newId,
        hpath,
        syHash,
        notebookId
      }, h);
      this.log("[import] OK", absPath, "\u2192", hpath, "in", notebookId.slice(0, 8) + "...", "docId=" + newId, "syHash=" + syHash.slice(0, 8));
      return newId;
    } catch (e) {
      this.log("[import] \u5931\u8D25", absPath, "\u2192", notebookId, e.message);
      this.notify(`${t("error")}: ${absPath} \u2192 ${notebookId.slice(0, 8)}: ${e.message}`, "error");
      return null;
    }
  }
  /** 删除 fs 文件时，同步删除所有 instance 对应的思源文档。 */
  async deleteFile(absPath) {
    const mapping = this.state.get(absPath);
    if (!mapping) return;
    for (const inst of mapping.instances) {
      try {
        const storage = await this.api.getDocStoragePath(inst.docId);
        if (storage) {
          await this.api.removeDoc(inst.notebookId, storage);
          this.log("[delete] OK", absPath, "in", inst.notebookId.slice(0, 8) + "...");
        }
      } catch (e) {
        this.log("[delete] \u5931\u8D25", absPath, "in", inst.notebookId, e.message);
      }
    }
    this.state.remove(absPath);
    await this.state.save();
  }
  // ============================================================
  // 批量
  // ============================================================
  async walkMd(folderPath) {
    const out = [];
    const walk = async (dir) => {
      let entries;
      try {
        entries = await import_promises.default.readdir(dir, { withFileTypes: true });
      } catch (e) {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        const p = import_path.default.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) out.push(p);
      }
    };
    await walk(folderPath);
    return out;
  }
  async importFolder(folderPath) {
    this.notify(t("importing"));
    const files = await this.walkMd(folderPath);
    let n = 0;
    for (const f of files) {
      const id = await this.importFile(f);
      if (id) n++;
    }
    this.notify(`${t("imported")}: ${n}/${files.length}`);
    return n;
  }
  // ============================================================
  // siyuan → fs（手动）
  // ============================================================
  async exportDocToFile(docId, targetAbsPath) {
    try {
      const kramdown = await this.api.getDocKramdown(docId);
      let existing = "";
      try {
        existing = await import_promises.default.readFile(targetAbsPath, "utf-8");
      } catch {
      }
      const existingRecord = this.state.get(targetAbsPath);
      if (existing && existingRecord && sha256(existing) !== existingRecord.mdHash) {
        const ts = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
        const dir = import_path.default.dirname(targetAbsPath);
        const base = import_path.default.basename(targetAbsPath, ".md");
        const backup = import_path.default.join(dir, `${base}.conflict-${ts}.md`);
        await import_promises.default.writeFile(backup, existing, "utf-8");
        this.notify(`\u5DF2\u5907\u4EFD\u51B2\u7A81: ${import_path.default.basename(backup)}`, "info");
      }
      await import_promises.default.writeFile(targetAbsPath, kramdown, "utf-8");
      const h = sha256(kramdown);
      this.state.upsertInstance(targetAbsPath, {
        docId,
        hpath: "",
        syHash: h,
        notebookId: this.state.activeNotebookId || ""
      }, h);
      await this.state.save();
      this.notify(t("exported"));
      return true;
    } catch (e) {
      this.notify(t("error") + ": " + e.message, "error");
      return false;
    }
  }
  // ============================================================
  // siyuan → fs（事件驱动的反向同步）
  // ============================================================
  onWebSocketMessage(msg) {
    if (this.state.bidirectional === false) return;
    if (!msg || !msg.data) return;
    const trackedIds = /* @__PURE__ */ new Set();
    for (const m of Object.values(this.state.mappings || {})) {
      for (const inst of m.instances || []) {
        if (inst?.docId) trackedIds.add(inst.docId);
      }
    }
    if (trackedIds.size === 0) return;
    const dataStr = this._safeStringify(msg.data);
    for (const docId of trackedIds) {
      if (dataStr.includes(docId)) {
        this.schedulePull(docId);
      }
    }
  }
  _safeStringify(obj) {
    try {
      return JSON.stringify(obj);
    } catch {
      return "";
    }
  }
  schedulePull(docId) {
    if (this._pullTimers[docId]) clearTimeout(this._pullTimers[docId]);
    this._pullTimers[docId] = setTimeout(() => {
      delete this._pullTimers[docId];
      this.pullFromSiyuan(docId).catch((e) => this.log("[pull] err", docId, e.message));
    }, 800);
  }
  /**
   * 把思源文档的最新内容写回对应的 .md 文件。
   * 写完后更新 mdHash + 所有 instance 的 syHash（防止任意一个笔记本的 echo 重导）。
   */
  async pullFromSiyuan(docId) {
    const found = this.state.byDocId(docId);
    if (!found) {
      this.log("[pull] docId \u672A\u8FFD\u8E2A:", docId);
      return;
    }
    const { path: absPath, mdHash: oldMdHash, instance: inst } = found;
    let kramdown;
    try {
      kramdown = await this.api.getDocKramdown(docId);
    } catch (e) {
      this.log("[pull] getDocKramdown \u5931\u8D25", docId, e.message);
      return;
    }
    const cleaned = stripIal(kramdown);
    const cleanedHash = sha256(cleaned);
    const newMdHash = cleanedHash;
    if (inst.syHash === cleanedHash) {
      this.log("[pull] syHash \u4E00\u81F4\uFF0C\u8DF3\u8FC7:", absPath);
      return;
    }
    try {
      await import_promises.default.writeFile(absPath, cleaned, "utf-8");
    } catch (e) {
      this.log("[pull] writeFile \u5931\u8D25", absPath, e.message);
      return;
    }
    this.state.upsertInstance(absPath, {
      ...inst,
      docId,
      syHash: cleanedHash
    }, newMdHash);
    await this.state.save();
    this.log("[pull] OK", absPath, "\u2190", docId, "mdHash updated, all instances will resync");
  }
  // ============================================================
  // 对账（手动触发或启动时调用）
  // ============================================================
  /**
   * 遍历所有监听文件夹，把每个 .md 同步到所有应该拥有它的笔记本。
   * 规则：
   * - 文件 mdHash 变了 → 重新生成该 path 在所有 target 上的 instance
   * - 某 target 还没有该 path 的 instance → 创建一个（1-to-many 场景）
   */
  async reconcile() {
    this.log("[reconcile] start");
    const watched = this.state.allWatched();
    this.log("[reconcile] watched:", watched.map((w) => `${w.notebookId.slice(0, 8)}\u2026: ${w.folder.path}`).join("; "));
    if (watched.length === 0) {
      this.notify("\u6CA1\u6709\u914D\u7F6E\u4EFB\u4F55\u76D1\u542C\u6587\u4EF6\u5939");
      return 0;
    }
    const folderCache = /* @__PURE__ */ new Map();
    for (const item of watched) {
      if (!folderCache.has(item.folder.path)) {
        folderCache.set(item.folder.path, await this.walkMd(item.folder.path));
      }
    }
    let totalChanged = 0;
    const summary = { added: 0, updated: 0, skipped: 0, failed: 0 };
    for (const item of watched) {
      const files = folderCache.get(item.folder.path) || [];
      this.log("[reconcile] scanning", item.folder.path, "for notebook", item.notebookId.slice(0, 12) + "...", "\u2192", files.length, "files");
      for (const f of files) {
        const content = await import_promises.default.readFile(f, "utf-8").catch(() => null);
        if (content == null) {
          summary.failed++;
          continue;
        }
        const h = sha256(content);
        const existing = this.state.get(f);
        const hasInstance = existing?.instances?.some((i) => i.notebookId === item.notebookId);
        if (existing && existing.mdHash === h && hasInstance) {
          summary.skipped++;
          continue;
        }
        this.log("[reconcile]", f, "\u2192", item.notebookId.slice(0, 12) + "...", "hasInstance=" + hasInstance, "mdMatch=" + (existing?.mdHash === h));
        const id = await this.importFile(f, item);
        if (id) {
          totalChanged++;
          if (hasInstance) summary.updated++;
          else summary.added++;
        } else {
          summary.failed++;
        }
      }
    }
    const msg = `\u5BF9\u8D26\u5B8C\u6210\uFF1A\u65B0\u589E ${summary.added}\uFF0C\u66F4\u65B0 ${summary.updated}\uFF0C\u8DF3\u8FC7 ${summary.skipped}\uFF0C\u5931\u8D25 ${summary.failed}`;
    this.notify(msg);
    this.log("[reconcile]", msg);
    return totalChanged;
  }
};

// src/watcher.js
var import_fs = __toESM(require("fs"));
var import_path2 = __toESM(require("path"));
var Watcher = class {
  constructor(sync, state, { notify, log } = {}) {
    this.sync = sync;
    this.state = state;
    this.notify = notify || console.log;
    this.log = log || console.log;
    this._handles = [];
    this._timers = {};
  }
  start() {
    const watched = this.state.allWatched();
    if (!watched.length) return;
    for (const item of watched) {
      this._watchOne(item.folder.path);
    }
    const nbCount = new Set(watched.map((w) => w.notebookId)).size;
    this.notify(`${t("watching")}: ${watched.length} \u4E2A\u6587\u4EF6\u5939\uFF0C${nbCount} \u4E2A\u7B14\u8BB0\u672C`);
    this.sync.reconcile().catch((e) => this.log("[watcher] reconcile err", e));
  }
  stop() {
    for (const h of this._handles) {
      try {
        h.close();
      } catch {
      }
    }
    this._handles = [];
    for (const t2 of Object.values(this._timers)) clearTimeout(t2);
    this._timers = {};
  }
  _watchOne(dir) {
    try {
      const w = import_fs.default.watch(dir, { recursive: true }, (event, filename) => {
        if (!filename) return;
        if (!filename.toLowerCase().endsWith(".md")) return;
        if (filename.startsWith(".")) return;
        const abs = import_path2.default.resolve(dir, filename);
        if (this._timers[abs]) clearTimeout(this._timers[abs]);
        this._timers[abs] = setTimeout(() => {
          delete this._timers[abs];
          try {
            import_fs.default.accessSync(abs);
            this.sync.importFile(abs).catch((e) => this.log("[watcher] import err", e));
          } catch {
            this.sync.deleteFile(abs).catch((e) => this.log("[watcher] delete err", e));
          }
        }, 400);
      });
      this._handles.push(w);
    } catch (e) {
      this.log("[watcher] \u76D1\u542C\u5931\u8D25", dir, e.message);
    }
  }
};

// src/commands.js
var import_path3 = __toESM(require("path"));
var import_siyuan4 = require("siyuan");

// src/picker.js
var import_siyuan3 = require("siyuan");
function inputDialog(title, message, placeholder = "") {
  return new Promise((resolve) => {
    const dialog = new import_siyuan3.Dialog({
      title,
      content: `<div class="b3-dialog__content">
  <div>${message}</div>
  <div class="fn__hr"></div>
  <input class="b3-text-field fn__block" placeholder="${placeholder}" />
</div>
<div class="b3-dialog__action">
  <button class="b3-button b3-button--cancel">${t("cancel")}</button><div class="fn__space"></div>
  <button class="b3-button b3-button--text">${t("confirm")}</button>
</div>`,
      width: "520px"
    });
    const input = dialog.element.querySelector("input");
    const [cancelBtn, confirmBtn] = dialog.element.querySelectorAll(".b3-button");
    setTimeout(() => input.focus(), 0);
    dialog.bindInput(input, () => confirmBtn.click());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") cancelBtn.click();
    });
    cancelBtn.addEventListener("click", () => {
      dialog.destroy();
      resolve(null);
    });
    confirmBtn.addEventListener("click", () => {
      const v = input.value.trim();
      dialog.destroy();
      resolve(v || null);
    });
  });
}
async function pickDirectory() {
  return inputDialog(t("addFolderTitle"), t("addFolderPrompt"), "/Users/me/notes");
}
async function pickFile() {
  return inputDialog(t("pickAFileTitle"), t("pickAFilePrompt"), "/Users/me/notes/foo.md");
}

// src/commands.js
function registerCommands(plugin) {
  const { sync, state } = plugin;
  plugin.addCommand({
    langKey: "cmdImportFile",
    hotkey: "",
    callback: async () => {
      const filePath = await pickFile();
      if (!filePath) return;
      if (!state.activeNotebookId) {
        (0, import_siyuan4.showMessage)("\u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u91CC\u9009\u62E9\u4E00\u4E2A\u7B14\u8BB0\u672C", 3e3, "error");
        return;
      }
      const watched = state.allWatched();
      if (!watched.some((w) => filePath.startsWith(w.folder.path + "/") || filePath === w.folder.path)) {
        const cur = state.ensureActive();
        cur.folders.push({ path: import_path3.default.dirname(filePath), label: "\u4E34\u65F6" });
        await state.save();
        await plugin.stopWatcher();
        plugin.startWatcher();
      }
      const id = await sync.importFile(filePath);
      if (id) {
        (0, import_siyuan4.showMessage)(`${t("imported")}: ${id.slice(0, 12)}...`, 2e3);
      }
    }
  });
  plugin.addCommand({
    langKey: "cmdImportFolder",
    hotkey: "",
    callback: async () => {
      const folderPath = await pickDirectory();
      if (!folderPath) return;
      if (!state.activeNotebookId) {
        (0, import_siyuan4.showMessage)("\u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u91CC\u9009\u62E9\u4E00\u4E2A\u7B14\u8BB0\u672C", 3e3, "error");
        return;
      }
      const cur = state.ensureActive();
      if (!cur.folders.some((f) => f.path === folderPath)) {
        cur.folders.push({ path: folderPath, label: folderPath });
        await state.save();
        await plugin.stopWatcher();
        plugin.startWatcher();
      }
      const n = await sync.importFolder(folderPath);
      (0, import_siyuan4.showMessage)(`${t("imported")}: ${n}`, 2e3);
    }
  });
  plugin.addCommand({
    langKey: "cmdExportCurrent",
    hotkey: "",
    callback: async () => {
      const tab = document.querySelector(".layout__center .layout-tab--active");
      if (!tab) {
        (0, import_siyuan4.showMessage)("\u6CA1\u6709\u6253\u5F00\u7684\u6587\u6863", 2e3, "error");
        return;
      }
      const protyle = tab.querySelector("protyle")?.__protyle || tab.querySelector('[data-type="NodeDocument"]')?.__protyle;
      const docId = protyle?.block?.rootID;
      if (!docId) {
        (0, import_siyuan4.showMessage)("\u65E0\u6CD5\u83B7\u53D6\u5F53\u524D\u6587\u6863 id", 2e3, "error");
        return;
      }
      const target = await pickFile();
      if (!target) return;
      if (!target.toLowerCase().endsWith(".md")) {
        (0, import_siyuan4.showMessage)("\u76EE\u6807\u4E0D\u662F .md \u6587\u4EF6\uFF0C\u7EE7\u7EED\u5BFC\u51FA", 2e3);
      }
      await sync.exportDocToFile(docId, target);
    }
  });
  plugin.addCommand({
    langKey: "cmdReconcile",
    hotkey: "",
    callback: async () => {
      const n = await sync.reconcile();
      (0, import_siyuan4.showMessage)(`${t("reconcileDone")}: ${n}`, 2e3);
    }
  });
  plugin.addCommand({
    langKey: "cmdForcePull",
    hotkey: "",
    callback: async () => {
      let n = 0;
      for (const info of Object.values(state.mappings || {})) {
        if (info?.docId) {
          await sync.pullFromSiyuan(info.docId);
          n++;
        }
      }
      (0, import_siyuan4.showMessage)(`${t("forcePullDone")}: ${n}`, 2e3);
    }
  });
  plugin.addCommand({
    langKey: "cmdCleanIal",
    hotkey: "",
    callback: async () => {
      const fs3 = require("fs/promises");
      const crypto2 = require("crypto");
      const sha = (t2) => crypto2.createHash("sha256").update(t2).digest("hex");
      const strip = (txt) => txt.replace(/^[ \t]*\{:[^}]*\}[ \t]*\r?\n?/gm, "").replace(/\{:[^}]*\}/g, "").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "");
      let n = 0;
      for (const absPath of state.allPaths()) {
        try {
          const orig = await fs3.readFile(absPath, "utf-8");
          const cleaned = strip(orig);
          if (cleaned !== orig) {
            await fs3.writeFile(absPath, cleaned, "utf-8");
            const m = state.get(absPath);
            if (m) m.mdHash = sha(cleaned);
            n++;
          }
        } catch (e) {
        }
      }
      await state.save();
      (0, import_siyuan4.showMessage)(`${t("cleanIalDone")}: ${n}`, 2e3);
    }
  });
}

// src/index.js
function inputDialog2(title, message, placeholder = "", defaultValue = "") {
  return new Promise((resolve) => {
    const dialog = new import_siyuan5.Dialog({
      title,
      content: `<div class="b3-dialog__content">
  <div>${message}</div>
  <div class="fn__hr"></div>
  <input class="b3-text-field fn__block" placeholder="${placeholder}" value="${defaultValue.replace(/"/g, "&quot;")}" />
</div>
<div class="b3-dialog__action">
  <button class="b3-button b3-button--cancel">${t("cancel")}</button><div class="fn__space"></div>
  <button class="b3-button b3-button--text">${t("confirm")}</button>
</div>`,
      width: "520px"
    });
    const input = dialog.element.querySelector("input");
    const [cancelBtn, confirmBtn] = dialog.element.querySelectorAll(".b3-button");
    setTimeout(() => input.focus(), 0);
    dialog.bindInput(input, () => confirmBtn.click());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") cancelBtn.click();
    });
    cancelBtn.addEventListener("click", () => {
      dialog.destroy();
      resolve(null);
    });
    confirmBtn.addEventListener("click", () => {
      const v = input.value.trim();
      dialog.destroy();
      resolve(v || null);
    });
  });
}
var index_default = class extends import_siyuan5.Plugin {
  async onload() {
    this.log = (...args) => console.log("[siyuan-md-sync]", ...args);
    this.notify = (msg, type) => (0, import_siyuan5.showMessage)(msg, 3e3, type || "info");
    try {
      this.api = new Api();
      this.state = new State(this);
      await this.state.load();
      this.notebooks = [];
      await this.refreshNotebooks();
      this.sync = new Sync(this.api, this.state, {
        notify: this.notify,
        log: this.log
      });
      this.watcher = new Watcher(this.sync, this.state, {
        notify: this.notify,
        log: this.log
      });
      this.initSettings();
      this.eventBus.on("opened-notebook", () => this.refreshNotebooks());
      this.eventBus.on("closed-notebook", () => this.refreshNotebooks());
      this.eventBus.on("ws-main", (e) => {
        this.sync.onWebSocketMessage(e?.detail);
      });
      registerCommands(this);
      if (this.state.allWatched().length && this.state.importOnChange) {
        this.startWatcher();
      }
      if (!this.state.activeNotebookId) {
        (0, import_siyuan5.showMessage)(t("firstRunHint"), 5e3, "info");
      } else {
        this.notify(t("pluginLoaded"));
      }
      this.log("plugin loaded");
      if (typeof window !== "undefined") {
        window.__mdSync = {
          plugin: this,
          sync: this.sync,
          state: this.state,
          api: this.api,
          forcePull: (docId) => this.sync.pullFromSiyuan(docId),
          forcePullAll: async () => {
            const ids = /* @__PURE__ */ new Set();
            for (const m of Object.values(this.state.mappings || {})) {
              for (const inst of m.instances || []) {
                if (inst?.docId) ids.add(inst.docId);
              }
            }
            const results = [];
            for (const id of ids) {
              try {
                await this.sync.pullFromSiyuan(id);
                results.push({ id, ok: true });
              } catch (e) {
                results.push({ id, ok: false, err: e.message });
              }
            }
            return results;
          },
          simulateWsEvent: (docId) => this.sync.schedulePull(docId),
          reconcile: () => this.sync.reconcile(),
          dump: () => ({
            activeNotebookId: this.state.activeNotebookId,
            notebooks: this.state.notebooks,
            mappings: this.state.mappings
          })
        };
        this.log("window.__mdSync ready (debug)");
      }
    } catch (e) {
      this.log("load failed", e);
      (0, import_siyuan5.showMessage)(`${t("error")}: ${e.message}`, 5e3, "error");
    }
  }
  async refreshNotebooks() {
    try {
      this.notebooks = await this.api.listNotebooks();
    } catch (e) {
      this.log("refreshNotebooks failed", e);
    }
  }
  async onunload() {
    try {
      await this.stopWatcher();
      await this.state.save();
      this.log("plugin unloaded");
    } catch (e) {
      this.log("unload error", e);
    }
  }
  initSettings() {
    const setting = new import_siyuan5.Setting({
      confirmCallback: () => this.state.save()
    });
    setting.addItem({
      title: t("targetNotebook"),
      direction: "row",
      description: t("targetNotebookDesc"),
      createActionElement: () => {
        const sel = document.createElement("select");
        sel.className = "b3-select";
        this._renderNotebookSelect(sel);
        sel.addEventListener("change", async () => {
          this.state.setActive(sel.value);
          await this.state.save();
          this._renderFolderList();
          this._renderRootHpathInput();
          await this.stopWatcher();
          if (this.state.allWatched().length && this.state.importOnChange) {
            this.startWatcher();
          }
        });
        return sel;
      }
    });
    this._hpathInput = document.createElement("input");
    this._hpathInput.className = "b3-text-field fn__size200";
    this._renderRootHpathInput();
    setting.addItem({
      title: t("rootHpath"),
      direction: "row",
      description: t("rootHpathHint"),
      actionElement: this._hpathInput
    });
    this._folderContainer = document.createElement("div");
    this._renderFolderList();
    setting.addItem({
      title: t("watchedFolders"),
      direction: "row",
      description: t("noFolders"),
      actionElement: this._folderContainer
    });
    const ialCheckbox = document.createElement("input");
    ialCheckbox.type = "checkbox";
    ialCheckbox.className = "b3-switch fn__flex-center";
    ialCheckbox.checked = this.state.writeBackIAL;
    ialCheckbox.addEventListener("change", () => {
      this.state.writeBackIAL = ialCheckbox.checked;
    });
    setting.addItem({
      title: t("writeBackIAL"),
      direction: "row",
      description: t("writeBackIALHint"),
      actionElement: ialCheckbox
    });
    const bidiCheckbox = document.createElement("input");
    bidiCheckbox.type = "checkbox";
    bidiCheckbox.className = "b3-switch fn__flex-center";
    bidiCheckbox.checked = this.state.bidirectional !== false;
    bidiCheckbox.addEventListener("change", () => {
      this.state.bidirectional = bidiCheckbox.checked;
    });
    setting.addItem({
      title: t("bidirectional"),
      direction: "row",
      description: t("bidirectionalHint"),
      actionElement: bidiCheckbox
    });
    this.setting = setting;
  }
  _renderNotebookSelect(sel) {
    sel.innerHTML = "";
    const current = this.state.activeNotebookId;
    if (current && !this.notebooks.some((nb) => nb.id === current)) {
      const opt = document.createElement("option");
      opt.value = current;
      opt.textContent = `(\u4E0D\u53EF\u7528) ${current.slice(0, 8)}\u2026`;
      opt.selected = true;
      sel.appendChild(opt);
    }
    if (!current) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "\u2014 \u8BF7\u5148\u9009\u62E9\u4E00\u4E2A\u7B14\u8BB0\u672C \u2014";
      opt.selected = true;
      sel.appendChild(opt);
    }
    for (const nb of this.notebooks) {
      const opt = document.createElement("option");
      opt.value = nb.id;
      opt.textContent = nb.closed ? `${nb.name}\uFF08\u5DF2\u5173\u95ED\uFF09` : nb.name;
      if (nb.id === current) opt.selected = true;
      sel.appendChild(opt);
    }
  }
  _renderRootHpathInput() {
    const cfg = this.state.getActive();
    this._hpathInput.value = cfg?.rootHpath || "";
    this._hpathInput.placeholder = t("rootHpathPlaceholder");
    this._hpathInput.onchange = () => {
      const cur = this.state.ensureActive();
      if (cur) {
        cur.rootHpath = this._hpathInput.value.trim();
        this._hpathInput.value = cur.rootHpath;
        this.state.save();
      }
    };
  }
  _renderFolderList() {
    if (!this._folderContainer) return;
    this._folderContainer.innerHTML = "";
    const cfg = this.state.getActive();
    const folders = cfg?.folders || [];
    const list = document.createElement("div");
    list.style.cssText = "display:flex;flex-direction:column;gap:4px;";
    folders.forEach((f, i) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:4px;align-items:center;";
      const span = document.createElement("span");
      span.textContent = f.path;
      span.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      const btn = document.createElement("button");
      btn.textContent = "\u2715";
      btn.className = "b3-button b3-button--outline fn__size100";
      btn.addEventListener("click", async () => {
        const cur = this.state.ensureActive();
        cur.folders.splice(i, 1);
        await this.state.save();
        this._renderFolderList();
        await this.stopWatcher();
        if (this.state.allWatched().length && this.state.importOnChange) {
          this.startWatcher();
        }
      });
      row.appendChild(span);
      row.appendChild(btn);
      list.appendChild(row);
    });
    const addBtn = document.createElement("button");
    addBtn.textContent = "+ " + t("addFolder");
    addBtn.className = "b3-button b3-button--outline fn__size200";
    addBtn.addEventListener("click", async () => {
      const cur = this.state.ensureActive();
      if (!cur) {
        this.notify("\u8BF7\u5148\u5728\u4E0A\u65B9\u4E0B\u62C9\u6846\u4E2D\u9009\u62E9\u4E00\u4E2A\u7B14\u8BB0\u672C", "error");
        return;
      }
      const p = await inputDialog2(t("addFolderTitle"), t("addFolderPrompt"), "/Users/me/notes");
      if (p) {
        cur.folders.push({ path: p, label: p });
        await this.state.save();
        this._renderFolderList();
        if (this.state.importOnChange) {
          await this.stopWatcher();
          this.startWatcher();
        }
      }
    });
    list.appendChild(addBtn);
    const stats = document.createElement("div");
    stats.style.cssText = "font-size:12px;color:var(--b3-theme-on-surface-light);margin-top:4px;";
    const updateStats = () => {
      const cfg2 = this.state.getActive();
      const folderCount = cfg2?.folders?.length || 0;
      const fileCount = Object.values(this.state.mappings).filter(
        (m) => m.instances.some((i) => i.notebookId === this.state.activeNotebookId)
      ).length;
      stats.textContent = `\u5F53\u524D\u7B14\u8BB0\u672C\uFF1A${folderCount} \u4E2A\u6587\u4EF6\u5939\uFF0C\u5DF2\u6620\u5C04 ${fileCount} \u4E2A .md`;
    };
    updateStats();
    const reconcileBtn = document.createElement("button");
    reconcileBtn.textContent = "\u{1F504} " + t("cmdReconcile");
    reconcileBtn.className = "b3-button b3-button--outline fn__size200";
    reconcileBtn.style.marginTop = "8px";
    reconcileBtn.addEventListener("click", async () => {
      reconcileBtn.disabled = true;
      reconcileBtn.textContent = "\u23F3 " + t("reconciling");
      try {
        await this.sync.reconcile();
        updateStats();
      } finally {
        reconcileBtn.disabled = false;
        reconcileBtn.textContent = "\u{1F504} " + t("cmdReconcile");
      }
    });
    list.appendChild(reconcileBtn);
    list.appendChild(stats);
    this._folderContainer.appendChild(list);
  }
  startWatcher() {
    if (!this.watcher) return;
    this.watcher.start();
  }
  async stopWatcher() {
    if (this.watcher) {
      await this.watcher.stop();
    }
  }
};

module.exports=module.exports.default;
