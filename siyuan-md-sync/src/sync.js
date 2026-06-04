/**
 * 核心同步逻辑。
 *
 * 设计：
 * - 1-to-many: 同一个 .md 文件可以同步到多个笔记本，每个笔记本一个 docId
 * - mappings[path] = { mdHash, instances: [{docId, notebookId, hpath, syHash}, ...] }
 * - mdHash 是文件磁盘内容 hash（共享）
 * - 每个 instance 各自有 syHash（思源侧的 hash，用于回声抑制）
 */

import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { showMessage } from 'siyuan';
import { t } from './i18n.js';

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

/**
 * 把思源 kramdown 里的 IAL 剥掉，让 .md 干净可读。
 * IAL 形如 `{: id="20240101-abc1234" updated="20240101"}`，两种位置：
 *   - 独占一行：    `text\n{: id="..."}\n` → 直接删 IAL 行
 *   - 行内末尾：    `- text{: id="..."}`   → 删掉 `{: ...}` 本身
 * doc 末尾的 `{: ... type="doc" ...}` 也是独占一行。
 */
function stripIal(text) {
  let out = text.replace(/^[ \t]*\{:[^}]*\}[ \t]*\r?\n?/gm, '');
  out = out.replace(/\{:[^}]*\}/g, '');
  out = out.replace(/\n{3,}/g, '\n\n');
  out = out.replace(/\s+$/, '');
  return out;
}

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

function toHPath(rootHpath, rel) {
  const stem = rel.replace(/\.md$/i, '');
  // 空 / "/" 视为「笔记本根目录」
  const r = (rootHpath || '').replace(/\/+$/, '');
  return r ? `${r}/${stem}` : `/${stem}`;
}

function fromHPath(rootHpath, hpath) {
  const r = (rootHpath || '').replace(/\/+$/, '');
  if (!r) {
    // 根目录模式：剥掉开头的 /
    if (!hpath.startsWith('/')) return null;
    return hpath.slice(1) + '.md';
  }
  if (!hpath.startsWith(r + '/')) return null;
  return hpath.slice(r.length + 1) + '.md';
}

export class Sync {
  constructor(api, state, opts = {}) {
    this.api = api;
    this.state = state;
    this.notify = opts.notify || ((msg, type) => showMessage(msg, 3000, type || 'info'));
    this.log = opts.log || console.log;
    this._pullTimers = {};
  }

  /** 给定一个 .md 的绝对路径，返回所有应拥有它的 (notebookId, folder, rootHpath)。 */
  findWatchers(absPath) {
    const out = [];
    for (const item of this.state.allWatched()) {
      const f = item.folder;
      if (absPath.startsWith(f.path + path.sep) || absPath === f.path) {
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
      this.log('[import] 路径不在任何监听目录内:', absPath);
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

    // 判断是否需要更新：
    // - mdHash 变了（文件被改）
    // - 某个 target 在该 path 下没有 instance（新笔记本接管）
    // - force 标志
    const needsUpdate = !existing
      || existing.mdHash !== h
      || targets.some(t => !existing.instances.some(i => i.notebookId === t.notebookId));

    if (!needsUpdate) {
      return existing.instances[0].docId;
    }

    let firstId = null;
    for (const t of targets) {
      const id = await this._importOne(absPath, content, h, t, existing);
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
    const oldInst = existing?.instances?.find(i => i.notebookId === notebookId);
    const rel = relToRoot(absPath, [folder]);
    const hpath = toHPath(rootHpath, rel);

    try {
      if (oldInst?.docId) {
        try {
          const storage = await this.api.getDocStoragePath(oldInst.docId);
          if (storage) await this.api.removeDoc(notebookId, storage);
        } catch (e) {
          this.log('[import] 旧 doc 已不存在或无法删除:', oldInst.docId);
        }
      }
      this.log('[import] creating', hpath, 'in', notebookId.slice(0,12)+'...');
      const newId = await this.api.createDocWithMd(notebookId, hpath, content);
      this.log('[import] createDocWithMd returned:', JSON.stringify(newId));
      if (!newId) throw new Error('createDocWithMd 未返回 id');

      // 回读拿到 IAL；用 strip 后的内容算 syHash（与 pull 一致）
      const syContent = await this.api.getDocKramdown(newId);
      const syHash = sha256(stripIal(syContent));

      // 可选：把 IAL 写回源文件
      if (this.state.writeBackIAL && syContent !== content) {
        await fs.writeFile(absPath, syContent, 'utf-8');
      }

      this.state.upsertInstance(absPath, {
        docId: newId,
        hpath,
        syHash,
        notebookId,
      }, h);
      this.log('[import] OK', absPath, '→', hpath, 'in', notebookId.slice(0, 8) + '...', 'docId=' + newId, 'syHash=' + syHash.slice(0,8));
      return newId;
    } catch (e) {
      this.log('[import] 失败', absPath, '→', notebookId, e.message);
      this.notify(`${t('error')}: ${absPath} → ${notebookId.slice(0,8)}: ${e.message}`, 'error');
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
          this.log('[delete] OK', absPath, 'in', inst.notebookId.slice(0, 8) + '...');
        }
      } catch (e) {
        this.log('[delete] 失败', absPath, 'in', inst.notebookId, e.message);
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
      try { entries = await fs.readdir(dir, { withFileTypes: true }); }
      catch (e) { return; }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(p);
      }
    };
    await walk(folderPath);
    return out;
  }

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

  async exportDocToFile(docId, targetAbsPath) {
    try {
      const kramdown = await this.api.getDocKramdown(docId);
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
      // 暂时只给 activeNotebookId 建一个 instance（用户主动导出的不参与多副本）
      this.state.upsertInstance(targetAbsPath, {
        docId,
        hpath: '',
        syHash: h,
        notebookId: this.state.activeNotebookId || '',
      }, h);
      await this.state.save();
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

  onWebSocketMessage(msg) {
    if (this.state.bidirectional === false) return;
    if (!msg || !msg.data) return;
    const trackedIds = new Set();
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
    try { return JSON.stringify(obj); } catch { return ''; }
  }

  schedulePull(docId) {
    if (this._pullTimers[docId]) clearTimeout(this._pullTimers[docId]);
    this._pullTimers[docId] = setTimeout(() => {
      delete this._pullTimers[docId];
      this.pullFromSiyuan(docId).catch(e => this.log('[pull] err', docId, e.message));
    }, 800);
  }

  /**
   * 把思源文档的最新内容写回对应的 .md 文件。
   * 写完后更新 mdHash + 所有 instance 的 syHash（防止任意一个笔记本的 echo 重导）。
   */
  async pullFromSiyuan(docId) {
    const found = this.state.byDocId(docId);
    if (!found) {
      this.log('[pull] docId 未追踪:', docId);
      return;
    }
    const { path: absPath, mdHash: oldMdHash, instance: inst } = found;
    let kramdown;
    try {
      kramdown = await this.api.getDocKramdown(docId);
    } catch (e) {
      this.log('[pull] getDocKramdown 失败', docId, e.message);
      return;
    }
    const cleaned = stripIal(kramdown);
    const cleanedHash = sha256(cleaned);
    const newMdHash = cleanedHash;

    // 内容没变（syHash 比较）：什么都不做
    if (inst.syHash === cleanedHash) {
      this.log('[pull] syHash 一致，跳过:', absPath);
      return;
    }

    try {
      await fs.writeFile(absPath, cleaned, 'utf-8');
    } catch (e) {
      this.log('[pull] writeFile 失败', absPath, e.message);
      return;
    }

    // 更新该 instance 的 syHash（= 新 hash），同时把 mdHash 也更新成新 hash
    // 关键：其他 instance 的 syHash 不动 —— 这样下次 fs.watch 触发 reconcile 时，
    // mdHash 跟其他 instance 的 syHash 不一致，会被正确识别为"该文件改了，需要重导"
    this.state.upsertInstance(absPath, {
      ...inst,
      docId,
      syHash: cleanedHash,
    }, newMdHash);
    await this.state.save();
    this.log('[pull] OK', absPath, '←', docId, 'mdHash updated, all instances will resync');
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
    this.log('[reconcile] start');
    const watched = this.state.allWatched();
    this.log('[reconcile] watched:', watched.map(w => `${w.notebookId.slice(0,8)}…: ${w.folder.path}`).join('; '));
    if (watched.length === 0) {
      this.notify('没有配置任何监听文件夹');
      return 0;
    }

    // 按 folder 缓存 walk 结果
    const folderCache = new Map();
    for (const item of watched) {
      if (!folderCache.has(item.folder.path)) {
        folderCache.set(item.folder.path, await this.walkMd(item.folder.path));
      }
    }

    // 对每个 (notebook, folder) 组合，把里面的每个文件 import 到那个笔记本
    let totalChanged = 0;
    const summary = { added: 0, updated: 0, skipped: 0, failed: 0 };
    for (const item of watched) {
      const files = folderCache.get(item.folder.path) || [];
      this.log('[reconcile] scanning', item.folder.path, 'for notebook', item.notebookId.slice(0, 12) + '...', '→', files.length, 'files');
      for (const f of files) {
        const content = await fs.readFile(f, 'utf-8').catch(() => null);
        if (content == null) { summary.failed++; continue; }
        const h = sha256(content);
        const existing = this.state.get(f);
        const hasInstance = existing?.instances?.some(i => i.notebookId === item.notebookId);
        if (existing && existing.mdHash === h && hasInstance) {
          summary.skipped++;
          continue;
        }
        this.log('[reconcile]', f, '→', item.notebookId.slice(0,12) + '...', 'hasInstance=' + hasInstance, 'mdMatch=' + (existing?.mdHash === h));
        const id = await this.importFile(f, item);
        if (id) {
          totalChanged++;
          if (hasInstance) summary.updated++; else summary.added++;
        } else {
          summary.failed++;
        }
      }
    }
    const msg = `对账完成：新增 ${summary.added}，更新 ${summary.updated}，跳过 ${summary.skipped}，失败 ${summary.failed}`;
    this.notify(msg);
    this.log('[reconcile]', msg);
    return totalChanged;
  }
}
