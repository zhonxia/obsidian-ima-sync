import { fetchSyncPost } from 'siyuan';
import path from 'path';
import fs from 'fs/promises';

export class SiyuanError extends Error {
  constructor(msg, resp) {
    super(msg);
    this.resp = resp;
  }
}

function check(resp) {
  if (!resp) throw new SiyuanError('empty response');
  if (resp.code !== 0) {
    throw new SiyuanError(resp.msg || `code=${resp.code}`, resp);
  }
  return resp.data;
}

export class Api {
  constructor(opts = {}) {
    // 思源数据根目录（包含 /data/{notebookId}/）。
    // 优先使用 opts.dataDir；否则从 /api/system/getWorkspaces 动态获取。
    // 注意：__dirname 在打包后的插件中不可靠（解析到 Siyuan.app 内）。
    this.dataDir = opts.dataDir || '';
    this._dataDirPromise = null;
  }

  /**
   * 初始化 dataDir。必须先调用一次，再使用 readTitleFromSy 等需要绝对路径的方法。
   * 在 plugin.onload 中尽早调用。
   */
  async initDataDir() {
    if (this.dataDir) return this.dataDir;
    if (this._dataDirPromise) return this._dataDirPromise;
    this._dataDirPromise = (async () => {
      // 优先用 getWorkspaceInfo（直接返回 workspaceDir）
      let workspaceDir = '';
      try {
        const info = await this._post('/api/system/getWorkspaceInfo');
        workspaceDir = info?.workspaceDir || '';
      } catch {}
      // 退化到 getWorkspaces（返回 [{path, closed}]）
      if (!workspaceDir) {
        try {
          const list = await this._post('/api/system/getWorkspaces');
          const ws = Array.isArray(list) ? list.find(x => !x.closed) || list[0] : null;
          workspaceDir = ws?.path || '';
        } catch {}
      }
      if (!workspaceDir) {
        workspaceDir = process.env.SIYUAN_DATA_DIR || '';
      }
      if (!workspaceDir) {
        this.dataDir = '';
        return '';
      }
      // workspaceDir 是工作区根目录，数据子目录为 <workspace>/data
      const dataDir = path.join(workspaceDir, 'data');
      // 兜底：如果 /data 不存在，看看 workspaceDir 自己是否就是 dataDir
      try {
        await fs.access(dataDir);
        this.dataDir = dataDir;
      } catch {
        this.dataDir = workspaceDir;
      }
      return this.dataDir;
    })();
    return this._dataDirPromise;
  }

  /** 同步获取 dataDir（如果已 init）。 */
  getDataDir() {
    return this.dataDir;
  }

  async _post(endpoint, data = {}) {
    const resp = await fetchSyncPost(endpoint, data);
    return check(resp);
  }

  async listNotebooks() {
    return this._post('/api/notebook/lsNotebooks').then(d => d.notebooks || []);
  }

  async openNotebook(notebookId) {
    return this._post('/api/notebook/openNotebook', { notebook: notebookId });
  }

  async sql(stmt) {
    return this._post('/api/query/sql', { stmt });
  }

  async listDocs(notebookId) {
    return this.sql(
      `SELECT id, hpath, path, updated FROM blocks WHERE type='d' AND box='${notebookId.replace(/'/g, "''")}'`
    );
  }

  async getDocKramdown(docId) {
    return this._post('/api/block/getBlockKramdown', { id: docId })
      .then(d => d.kramdown || '');
  }

  async getDocStoragePath(docId) {
    const rows = await this.sql(
      `SELECT path FROM blocks WHERE id='${docId.replace(/'/g, "''")}' LIMIT 1`
    );
    return rows?.[0]?.path || '';
  }

  async createDocWithMd(notebookId, hpath, markdown) {
    const data = await this._post('/api/filetree/createDocWithMd', {
      notebook: notebookId,
      path: hpath,
      markdown,
    });
    if (typeof data === 'string') return data;
    if (data && typeof data === 'object' && data.id) return data.id;
    return '';
  }

  async removeDoc(notebookId, storagePath) {
    return this._post('/api/filetree/removeDoc', { notebook: notebookId, path: storagePath });
  }

  /** 读取块信息（含 box、path、rootTitle 等）。 */
  async getBlockInfo(id) {
    return this._post('/api/block/getBlockInfo', { id });
  }

  /** 从 .sy 文件读取标题。storagePath 形如 /parent/thisDoc.sy */
  async readTitleFromSy(notebookId, storagePath) {
    if (!this.dataDir) {
      try { require('fs').appendFileSync('/tmp/siyuan-ws-debug.log',
        `[readTitle] dataDir not initialized!\n`); } catch {}
      // 尝试按需初始化
      await this.initDataDir();
    }
    const fp = path.join(this.dataDir, notebookId, storagePath);
    try {
      const buf = await fs.readFile(fp, 'utf-8');
      const j = JSON.parse(buf);
      const t = j?.Properties?.title || '';
      try { require('fs').appendFileSync('/tmp/siyuan-ws-debug.log',
        `[readTitle] ${fp} => ${JSON.stringify(t)}\n`); } catch {}
      return t;
    } catch (e) {
      try {
        require('fs').appendFileSync('/tmp/siyuan-ws-debug.log',
          `[readTitle err] ${fp}: ${e.message}\n`);
      } catch {}
      return '';
    }
  }
}
