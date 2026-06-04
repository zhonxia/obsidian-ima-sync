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
var State = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.notebookId = "";
    this.rootHpath = "/inbox";
    this.folders = [];
    this.writeBackIAL = true;
    this.importOnChange = true;
    this.mappings = {};
  }
  async load() {
    try {
      const raw = await this.plugin.loadData(STORAGE_KEY);
      if (raw) {
        this.notebookId = raw.notebookId || "";
        this.rootHpath = raw.rootHpath || "/inbox";
        this.folders = raw.folders || [];
        this.writeBackIAL = raw.writeBackIAL !== false;
        this.importOnChange = raw.importOnChange !== false;
        this.mappings = raw.mappings || {};
      }
    } catch (e) {
      console.warn("[state] load failed:", e);
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
        mappings: this.mappings
      });
    } catch (e) {
      console.warn("[state] save failed:", e);
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
    targetNotebookDesc: "\u540C\u6B65\u540E\u7684\u6587\u6863\u5C06\u521B\u5EFA\u5728\u8FD9\u4E2A\u7B14\u8BB0\u672C\u91CC",
    rootHpath: "\u76EE\u6807 HPath\uFF08\u7B14\u8BB0\u672C\u5185\u7684\u6839\u8DEF\u5F84\uFF09",
    rootHpathHint: "\u4F8B\u5982\u586B /inbox\uFF1B\u76D1\u542C\u6587\u4EF6\u5939\u91CC\u7684 foo/bar.md \u4F1A\u53D8\u6210 /inbox/foo/bar",
    writeBackIAL: "\u5C06\u601D\u6E90\u751F\u6210\u7684 IAL \u5757 ID \u5199\u56DE .md \u6E90\u6587\u4EF6",
    writeBackIALHint: "\u5173\u95ED\u540E .md \u4FDD\u6301\u5E72\u51C0\uFF0C\u4F46\u5757\u5F15\u7528 ((xxx)) \u4F1A\u5931\u6548",
    importOnChange: "\u6587\u4EF6\u6539\u52A8\u65F6\u81EA\u52A8\u5BFC\u5165",
    cmdImportFile: "\u5BFC\u5165 Markdown \u6587\u4EF6",
    cmdImportFolder: "\u5BFC\u5165 Markdown \u6587\u4EF6\u5939",
    cmdExportCurrent: "\u5C06\u5F53\u524D\u6587\u6863\u5BFC\u51FA\u4E3A .md",
    cmdReconcile: "\u7ACB\u5373\u5BF9\u8D26\uFF08\u626B\u4E00\u904D\u6240\u6709\u76D1\u542C\u6587\u4EF6\u5939\uFF09",
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
    rootHpathHint: "e.g. /inbox; watched/foo/bar.md becomes /inbox/foo/bar",
    writeBackIAL: "Write back Siyuan IAL block IDs into the source .md",
    writeBackIALHint: "Off keeps .md clean, but breaks block references ((xxx))",
    importOnChange: "Auto-import on file change",
    cmdImportFile: "Import Markdown file",
    cmdImportFolder: "Import Markdown folder",
    cmdExportCurrent: "Export current document as .md",
    cmdReconcile: "Reconcile now (scan all watched folders)",
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
  const root = rootHpath.endsWith("/") ? rootHpath.slice(0, -1) : rootHpath;
  return root + "/" + stem;
}
var Sync = class {
  constructor(api, state, opts = {}) {
    this.api = api;
    this.state = state;
    this.notify = opts.notify || ((msg, type) => (0, import_siyuan2.showMessage)(msg, 3e3, type || "info"));
    this.log = opts.log || console.log;
  }
  /** 给定一个 .md 的绝对路径，判断它归属哪个监听文件夹。 */
  findWatchedFolder(absPath) {
    for (const f of this.state.folders) {
      if (absPath.startsWith(f.path + import_path.default.sep) || absPath === f.path) return f;
    }
    return null;
  }
  // ============================================================
  // fs → siyuan
  // ============================================================
  /**
   * 导入/更新一个 .md 文件。
   * @returns {string|null} 新建/更新后的 doc id，失败为 null
   */
  async importFile(absPath, { force = false } = {}) {
    if (!this.state.notebookId) {
      this.log("\u672A\u914D\u7F6E\u76EE\u6807\u7B14\u8BB0\u672C\uFF0C\u8DF3\u8FC7");
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
    if (!force && existing && existing.mdHash === h) {
      this.log("[import] hash \u5339\u914D\uFF0C\u8DF3\u8FC7:", absPath);
      return existing.docId;
    }
    const folder = this.findWatchedFolder(absPath);
    if (!folder) {
      this.log("[import] \u8DEF\u5F84\u4E0D\u5728\u4EFB\u4F55\u76D1\u542C\u76EE\u5F55\u5185:", absPath);
      return null;
    }
    const rel = relToRoot(absPath, [folder]);
    const hpath = toHPath(this.state.rootHpath, rel);
    try {
      if (existing?.docId) {
        const storage = await this.api.getDocStoragePath(existing.docId);
        if (storage) {
          await this.api.removeDoc(this.state.notebookId, storage);
        }
      }
      const newId = await this.api.createDocWithMd(this.state.notebookId, hpath, content);
      if (!newId) throw new Error("createDocWithMd \u672A\u8FD4\u56DE id");
      const syContent = await this.api.getDocKramdown(newId);
      const syHash = sha256(syContent);
      if (this.state.writeBackIAL && syContent !== content) {
        await import_promises.default.writeFile(absPath, syContent, "utf-8");
      }
      this.state.set(absPath, {
        docId: newId,
        hpath,
        mdHash: this.state.writeBackIAL ? syHash : h,
        syHash
      });
      this.state.save();
      this.log("[import] OK", absPath, "\u2192", hpath);
      return newId;
    } catch (e) {
      this.log("[import] \u5931\u8D25", absPath, e.message);
      this.notify(t("error") + ": " + e.message, "error");
      return null;
    }
  }
  /** 删除 fs 文件时，同步删除思源文档。 */
  async deleteFile(absPath) {
    const existing = this.state.get(absPath);
    if (!existing?.docId) return;
    try {
      const storage = await this.api.getDocStoragePath(existing.docId);
      if (storage) {
        await this.api.removeDoc(this.state.notebookId, storage);
        this.log("[delete] OK", absPath);
      }
    } catch (e) {
      this.log("[delete] \u5931\u8D25", absPath, e.message);
    } finally {
      this.state.remove(absPath);
      this.state.save();
    }
  }
  // ============================================================
  // 批量
  // ============================================================
  /** 递归收集文件夹下所有 .md。 */
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
  /** 导入整个文件夹（已存在于监听列表中的会被自动用监听路径计算 hpath）。 */
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
  /**
   * 将思源文档导出为 .md 文件。
   * @param {string} docId
   * @param {string} targetAbsPath 绝对目标路径（必须是 .md）
   * @returns {boolean}
   */
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
      this.state.set(targetAbsPath, {
        docId,
        hpath: "",
        mdHash: h,
        syHash: h
      });
      this.state.save();
      this.notify(t("exported"));
      return true;
    } catch (e) {
      this.notify(t("error") + ": " + e.message, "error");
      return false;
    }
  }
  // ============================================================
  // 对账（手动触发或启动时调用）
  // ============================================================
  /** 遍历所有监听文件夹，处理 hash 不一致的 .md。 */
  async reconcile() {
    this.log("[reconcile] start");
    let changed = 0;
    for (const folder of this.state.folders) {
      try {
        const files = await this.walkMd(folder.path);
        for (const f of files) {
          const content = await import_promises.default.readFile(f, "utf-8").catch(() => null);
          if (content == null) continue;
          const h = sha256(content);
          const ex = this.state.get(f);
          if (!ex || ex.mdHash !== h) {
            const id = await this.importFile(f);
            if (id) changed++;
          }
        }
      } catch (e) {
        this.log("[reconcile] folder error", folder.path, e.message);
      }
    }
    this.notify(`${t("reconcileDone")}: ${changed}`);
    return changed;
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
    if (!this.state.folders?.length) return;
    for (const folder of this.state.folders) {
      this._watchOne(folder.path);
    }
    this.notify(`${t("watching")}: ${this.state.folders.length} \u4E2A`);
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
      if (!state.folders.some((f) => filePath.startsWith(f.path + "/") || filePath === f.path)) {
        state.folders.push({ path: import_path3.default.dirname(filePath), label: "\u4E34\u65F6" });
        state.save();
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
      if (!state.folders.some((f) => f.path === folderPath)) {
        state.folders.push({ path: folderPath, label: folderPath });
        state.save();
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
      registerCommands(this);
      if (this.state.folders?.length && this.state.importOnChange) {
        this.startWatcher();
      }
      if (!this.state.notebookId) {
        (0, import_siyuan5.showMessage)(t("firstRunHint"), 5e3, "info");
      } else {
        this.notify(t("pluginLoaded"));
      }
      this.log("plugin loaded");
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
        const current = this.state.notebookId;
        if (!this.notebooks.some((nb) => nb.id === current)) {
          if (current) {
            const opt = document.createElement("option");
            opt.value = current;
            opt.textContent = `(\u4E0D\u53EF\u7528) ${current.slice(0, 8)}\u2026`;
            opt.selected = true;
            sel.appendChild(opt);
          }
        }
        this.notebooks.forEach((nb) => {
          const opt = document.createElement("option");
          opt.value = nb.id;
          opt.textContent = nb.closed ? `${nb.name}\uFF08\u5DF2\u5173\u95ED\uFF09` : nb.name;
          if (nb.id === current) opt.selected = true;
          sel.appendChild(opt);
        });
        sel.addEventListener("change", () => {
          this.state.notebookId = sel.value;
        });
        return sel;
      }
    });
    const hpathInput = document.createElement("input");
    hpathInput.className = "b3-text-field fn__size200";
    hpathInput.value = this.state.rootHpath;
    hpathInput.addEventListener("change", () => {
      this.state.rootHpath = hpathInput.value || "/inbox";
    });
    setting.addItem({
      title: t("rootHpath"),
      direction: "row",
      description: t("rootHpathHint"),
      actionElement: hpathInput
    });
    const folderContainer = document.createElement("div");
    const renderFolders = () => {
      folderContainer.innerHTML = "";
      const list = document.createElement("div");
      list.style.cssText = "display:flex;flex-direction:column;gap:4px;";
      this.state.folders.forEach((f, i) => {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;gap:4px;align-items:center;";
        const span = document.createElement("span");
        span.textContent = f.path;
        span.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
        const btn = document.createElement("button");
        btn.textContent = "\u2715";
        btn.className = "b3-button b3-button--outline fn__size100";
        btn.addEventListener("click", async () => {
          this.state.folders.splice(i, 1);
          await this.state.save();
          renderFolders();
        });
        row.appendChild(span);
        row.appendChild(btn);
        list.appendChild(row);
      });
      const addBtn = document.createElement("button");
      addBtn.textContent = "+ " + t("addFolder");
      addBtn.className = "b3-button b3-button--outline fn__size200";
      addBtn.addEventListener("click", async () => {
        const p = await inputDialog2(t("addFolderTitle"), t("addFolderPrompt"), "/Users/me/notes");
        if (p) {
          this.state.folders.push({ path: p, label: p });
          await this.state.save();
          renderFolders();
        }
      });
      list.appendChild(addBtn);
      folderContainer.appendChild(list);
    };
    renderFolders();
    setting.addItem({
      title: t("watchedFolders"),
      direction: "row",
      description: t("noFolders"),
      actionElement: folderContainer
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
    this.setting = setting;
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
