/**
 * 文件监听：基于 Node fs.watch（macOS 支持 recursive）。
 * - 不用 chokidar，避免思源插件系统无法解析外部 npm 包 import 的问题
 * - 手动防抖 + hash 去重（依赖 SyncEngine 的 hash 回声检测）
 * - 删除用 try/catch 判断文件存在性
 */

import fs from 'fs';
import path from 'path';
import { t } from './i18n.js';

export class Watcher {
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
    const nbCount = new Set(watched.map(w => w.notebookId)).size;
    this.notify(`${t('watching')}: ${watched.length} 个文件夹，${nbCount} 个笔记本`);
    // 首次自启动自动对账
    this.sync.reconcile().catch(e => this.log('[watcher] reconcile err', e));
  }

  stop() {
    for (const h of this._handles) {
      try { h.close(); } catch {}
    }
    this._handles = [];
    for (const t of Object.values(this._timers)) clearTimeout(t);
    this._timers = {};
  }

  _watchOne(dir) {
    try {
      const w = fs.watch(dir, { recursive: true }, (event, filename) => {
        if (!filename) return;
        if (!filename.toLowerCase().endsWith('.md')) return;
        if (filename.startsWith('.')) return;
        const abs = path.resolve(dir, filename);
        if (this._timers[abs]) clearTimeout(this._timers[abs]);
        this._timers[abs] = setTimeout(() => {
          delete this._timers[abs];
          try {
            fs.accessSync(abs);
            this.sync.importFile(abs).catch(e => this.log('[watcher] import err', e));
          } catch {
            this.sync.deleteFile(abs).catch(e => this.log('[watcher] delete err', e));
          }
        }, 400);
      });
      this._handles.push(w);
    } catch (e) {
      this.log('[watcher] 监听失败', dir, e.message);
    }
  }
}
