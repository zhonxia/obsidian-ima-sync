/**
 * 核心同步逻辑。
 *
 * 设计原则（v2 简化版）：
 * - 主动同步：fs → siyuan（监听文件变动时自动）
 * - 手动同步：siyuan → fs（"导出当前文档为 .md"命令）
 * - 单向为主，回声检测靠 hash 缓存
 * - 冲突时备份 .md 为 .conflict-<ts>.md，不自动 merge
 */

import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { showMessage } from 'siyuan';
import { t } from './i18n.js';

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

/** 文件路径（绝对）→ 在 HPath root 下的相对路径。返回 null 表示不在任何监听目录下。 */
function relToRoot(absPath, folders) {
  for (const f of folders) {
    if (absPath.startsWith(f.path + path.sep) || absPath === f.path) {
      let rel = absPath.slice(f.path.length).replace(/\\/g, '/');
      if (rel.startsWith('/')) rel = rel.slice(1);
      return rel;
    }
  }
  return null;
}

/** rel (e.g. "foo/bar.md") → 思源 HPath (e.g. "/inbox/foo/bar"). */
function toHPath(rootHpath, rel) {
  const stem = rel.replace(/\.md$/i, '');
  const root = rootHpath.endsWith('/') ? rootHpath.slice(0, -1) : rootHpath;
  return root + '/' + stem;
}

/** 思源 HPath → 思源 HPath 下的"虚拟" .md 相对路径，用于回写到 fs。 */
function fromHPath(rootHpath, hpath) {
  const root = rootHpath.endsWith('/') ? rootHpath.slice(0, -1) : rootHpath;
  if (!hpath.startsWith(root + '/')) return null;
  return hpath.slice(root.length + 1) + '.md';
}

export class Sync {
  constructor(api, state, opts = {}) {
    this.api = api;
    this.state = state;
    this.notify = opts.notify || ((msg, type) => showMessage(msg, 3000, type || 'info'));
    this.log = opts.log || console.log;
    this._pullTimers = {};
  }

  /** 给定一个 .md 的绝对路径，判断它归属哪个监听文件夹。 */
  findWatchedFolder(absPath) {
    for (const f of this.state.folders) {
      if (absPath.startsWith(f.path + path.sep) || absPath === f.path) return f;
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
      this.log('未配置目标笔记本，跳过');
      return null;
    }
    let content;
    try {
      content = await fs.readFile(absPath, 'utf-8');
    } catch (e) {
      this.log('readFile 失败', absPath, e.message);
      return null;
    }
    const h = sha256(content);
    const existing = this.state.get(absPath);
    if (!force && existing && existing.mdHash === h) {
      this.log('[import] hash 匹配，跳过:', absPath);
      return existing.docId;
    }

    const folder = this.findWatchedFolder(absPath);
    if (!folder) {
      this.log('[import] 路径不在任何监听目录内:', absPath);
      return null;
    }
    const rel = relToRoot(absPath, [folder]);
    const hpath = toHPath(this.state.rootHpath, rel);

    try {
      // 先删旧（如果存在），否则新文档的 IAL 块 ID 不会被思源复用
      if (existing?.docId) {
        const storage = await this.api.getDocStoragePath(existing.docId);
        if (storage) {
          await this.api.removeDoc(this.state.notebookId, storage);
        }
      }
      const newId = await this.api.createDocWithMd(this.state.notebookId, hpath, content);
      if (!newId) throw new Error('createDocWithMd 未返回 id');

      // 回读以拿到思源规范化后的内容（带 IAL）
      const syContent = await this.api.getDocKramdown(newId);
      const syHash = sha256(syContent);

      // 可选：把 IAL 写回源文件（让 .md 包含 {: id="..."}）
      if (this.state.writeBackIAL && syContent !== content) {
        await fs.writeFile(absPath, syContent, 'utf-8');
      }

      this.state.set(absPath, {
        docId: newId,
        hpath,
        mdHash: this.state.writeBackIAL ? syHash : h,
        syHash,
      });
      this.state.save();
      this.log('[import] OK', absPath, '→', hpath);
      return newId;
    } catch (e) {
      this.log('[import] 失败', absPath, e.message);
      this.notify(t('error') + ': ' + e.message, 'error');
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
        this.log('[delete] OK', absPath);
      }
    } catch (e) {
      this.log('[delete] 失败', absPath, e.message);
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
      try { entries = await fs.readdir(dir, { withFileTypes: true }); }
      catch (e) { return; }
      for (const e of entries) {
        // 隐藏文件/系统文件跳过
        if (e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(p);
      }
    };
    await walk(folderPath);
    return out;
  }

  /** 导入整个文件夹（已存在于监听列表中的会被自动用监听路径计算 hpath）。 */
  async importFolder(folderPath) {
    this.notify(t('importing'));
    const files = await this.walkMd(folderPath);
    let n = 0;
    for (const f of files) {
      const id = await this.importFile(f);
      if (id) n++;
    }
    this.notify(`${t('imported')}: ${n}/${files.length}`);
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
      // 冲突检测：如果目标文件已存在且 hash 与 state 中记录不同
      let existing = '';
      try { existing = await fs.readFile(targetAbsPath, 'utf-8'); } catch {}
      const existingRecord = this.state.get(targetAbsPath);
      if (existing && existingRecord && sha256(existing) !== existingRecord.mdHash) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const dir = path.dirname(targetAbsPath);
        const base = path.basename(targetAbsPath, '.md');
        const backup = path.join(dir, `${base}.conflict-${ts}.md`);
        await fs.writeFile(backup, existing, 'utf-8');
        this.notify(`已备份冲突: ${path.basename(backup)}`, 'info');
      }
      await fs.writeFile(targetAbsPath, kramdown, 'utf-8');
      const h = sha256(kramdown);
      this.state.set(targetAbsPath, {
        docId,
        hpath: '',
        mdHash: h,
        syHash: h,
      });
      this.state.save();
      this.notify(t('exported'));
      return true;
    } catch (e) {
      this.notify(t('error') + ': ' + e.message, 'error');
      return false;
    }
  }

  // ============================================================
  // siyuan → fs（事件驱动的反向同步）
  // ============================================================

  /**
   * 监听 ws-main 事件：检查消息里有没有我们追踪的 doc id，有就排程一次 pull。
   * 思路：把所有追踪到的 docId 拼成一个集合，扫描消息 data 的字符串表示，
   * 任何 docId 子串命中就排程。
   */
  onWebSocketMessage(msg) {
    if (this.state.bidirectional === false) return;
    if (!msg || !msg.data) return;
    const trackedIds = new Set();
    for (const info of Object.values(this.state.mappings || {})) {
      if (info?.docId) trackedIds.add(info.docId);
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
    try { return JSON.stringify(obj); } catch { return ''; }
  }

  /** Debounce: 800ms 内多次触发同一 docId 只 pull 一次。 */
  schedulePull(docId) {
    if (this._pullTimers[docId]) clearTimeout(this._pullTimers[docId]);
    this._pullTimers[docId] = setTimeout(() => {
      delete this._pullTimers[docId];
      this.pullFromSiyuan(docId).catch(e => this.log('[pull] err', docId, e.message));
    }, 800);
  }

  /**
   * 把思源文档的最新 kramdown 写回对应的 .md 文件。
   * 防回声关键：写完后把 mdHash 和 syHash 都更新成新 hash，
   * 这样 fs.watch → importFile 时 hash 匹配会跳过，不会重新 import 思源。
   */
  async pullFromSiyuan(docId) {
    const mapping = this.state.byDocId(docId);
    if (!mapping) {
      this.log('[pull] docId 未追踪:', docId);
      return;
    }
    let kramdown;
    try {
      kramdown = await this.api.getDocKramdown(docId);
    } catch (e) {
      this.log('[pull] getDocKramdown 失败', docId, e.message);
      return;
    }
    const newHash = sha256(kramdown);
    const existing = this.state.get(mapping.path);
    if (existing && existing.syHash === newHash) {
      this.log('[pull] syHash 一致，无需写回:', mapping.path);
      return;
    }
    try {
      await fs.writeFile(mapping.path, kramdown, 'utf-8');
    } catch (e) {
      this.log('[pull] writeFile 失败', mapping.path, e.message);
      return;
    }
    this.state.set(mapping.path, {
      ...existing,
      docId,
      hpath: existing?.hpath || '',
      mdHash: newHash,
      syHash: newHash,
    });
    await this.state.save();
    this.log('[pull] OK', mapping.path, '←', docId);
  }

  // ============================================================
  // 对账（手动触发或启动时调用）
  // ============================================================

  /** 遍历所有监听文件夹，处理 hash 不一致的 .md。 */
  async reconcile() {
    this.log('[reconcile] start');
    let changed = 0;
    for (const folder of this.state.folders) {
      try {
        const files = await this.walkMd(folder.path);
        for (const f of files) {
          const content = await fs.readFile(f, 'utf-8').catch(() => null);
          if (content == null) continue;
          const h = sha256(content);
          const ex = this.state.get(f);
          if (!ex || ex.mdHash !== h) {
            const id = await this.importFile(f);
            if (id) changed++;
          }
        }
      } catch (e) {
        this.log('[reconcile] folder error', folder.path, e.message);
      }
    }
    this.notify(`${t('reconcileDone')}: ${changed}`);
    return changed;
  }
}
