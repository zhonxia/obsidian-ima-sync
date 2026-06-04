import { fetchSyncPost } from 'siyuan';

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
}
