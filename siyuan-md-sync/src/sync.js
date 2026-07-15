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
import fsSync from 'fs';
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
    this._newDocTimers = {};
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
    const data = msg.data;

    // 调试：把 ws 事件写到 /tmp/siyuan-ws-debug.log
    if (!this._wsDbg) {
      this._wsDbg = fsSync.createWriteStream('/tmp/siyuan-ws-debug.log', { flags: 'a' });
    }
    const stamp = new Date().toISOString().slice(11, 23);
    const short = JSON.stringify(data).slice(0, 400);
    this._wsDbg.write(`[${stamp}] ${short}\n`);

    // 检测新 doc 保存事件：{"box":{...}, "path":"/.../xxx.sy", "listDocTree":false}
    // 注意：data.box 可能是 object（新建时）也可能是 string（重命名时）
    if (data && typeof data === 'object' && data.path) {
      if (typeof data.box === 'object' && data.box !== null) {
        // 新建/保存事件
        this.scheduleNewDocCheck(data.box.id, data.path);
      } else if (typeof data.box === 'string' && data.id && data.title) {
        // 重命名/标题变化事件：{"box":"nbId","empty":false,"id":"...","path":"...","refText":"newTitle","title":"newTitle"}
        // 旧标题从 state 推（取该 docId 对应 instance 的 hpath 末段）
        const oldTitle = this._oldTitleFor(data.id);
        if (oldTitle && oldTitle !== data.title) {
          this.scheduleRename(data.id, oldTitle, data.title);
        }
      }
    }

    // 删除事件：{"ids": [docId, ...]} —— 思源删除 doc 时广播
    if (data && Array.isArray(data.ids) && data.ids.length) {
      this.scheduleDeleted(data.ids);
    }

    // 重命名/标题变化：通过 transaction 数组中的 updateAttrs 识别
    if (Array.isArray(data) && data.length) {
      for (const tx of data) {
        if (!tx || !Array.isArray(tx.doOperations)) continue;
        for (const op of tx.doOperations) {
          if (op?.action === 'updateAttrs' && op.data?.new && op.data?.old) {
            const oldTitle = op.data.old.title;
            const newTitle = op.data.new.title;
            const id = op.data.new.id || op.data.old.id;
            if (id && newTitle && oldTitle && newTitle !== oldTitle) {
              this.scheduleRename(id, oldTitle, newTitle);
            }
          }
        }
      }
    }

    // 已有映射的 doc 改动：拉取最新内容到 .md
    const trackedIds = new Set();
    for (const m of Object.values(this.state.mappings || {})) {
      for (const inst of m.instances || []) {
        if (inst?.docId) trackedIds.add(inst.docId);
      }
    }
    const dataStr = this._safeStringify(data);
    for (const docId of trackedIds) {
      if (dataStr.includes(docId)) {
        this.schedulePull(docId);
      }
    }
  }

  // =============== 删除/重命名事件处理 ===============

  /**
   * 防抖删除：多个 docId 一次性处理。500ms 内同一批 ids 只跑一次。
   * 对每个被删的 docId：
   *   1. 找到该 docId 在 mappings 里的所有 .md 路径（一个 docId 可能在多份 .md 中存在）
   *   2. 删除对应的 .md 文件（如果是文件夹/容器，则删除整棵子目录）
   *   3. 从 mappings 中清理所有引用
   */
  scheduleDeleted(ids) {
    if (!Array.isArray(ids) || !ids.length) return;
    const key = 'd:' + ids.slice().sort().join(',');
    if (this._delTimers && this._delTimers[key]) clearTimeout(this._delTimers[key]);
    this._delTimers = this._delTimers || {};
    this._delTimers[key] = setTimeout(() => {
      delete this._delTimers[key];
      this.handleDeleted(ids).catch(e => {
        this.log('[del] err', e.message);
        if (this._wsDbg) this._wsDbg.write(`[ERR del] ${e.message}\n${e.stack}\n`);
      });
    }, 500);
  }

  async handleDeleted(docIds) {
    const idSet = new Set(docIds);
    const dbg = (m) => { this.log('[del]', m); if (this._wsDbg) this._wsDbg.write(`[del] ${m}\n`); };
    dbg(`handle ${docIds.length} ids: ${docIds.join(', ')}`);

    // 0) 等 in-flight newDoc 处理器完成（最多 1.5s），避免 newDoc → del 的竞态
    if (this._newDocInflight) {
      for (const id of docIds) {
        const inflight = this._newDocInflight[id];
        if (inflight) {
          dbg(`waiting up to 1.5s for in-flight newDoc for ${id}`);
          await Promise.race([
            inflight,
            new Promise(r => setTimeout(r, 1500)),
          ]);
        }
      }
    }

    // 1) 收集受影响的 (absPath, mapping)：从 state.mappings 中找 docId 匹配的 instance
    const affected = new Set();
    for (const [abs, m] of Object.entries(this.state.mappings || {})) {
      for (const inst of m.instances || []) {
        if (idSet.has(inst.docId)) {
          affected.add(abs);
          break;
        }
      }
    }
    if (!affected.size) {
      dbg('no affected mapping found, ignoring');
      return;
    }
    dbg(`affected .md paths: ${[...affected].length}`);

    // 2) 对每个受影响的路径，只有当没有剩余 instance 时才 fs rm（1-to-many 保护）
    for (const abs of affected) {
      const m = this.state.get(abs);
      const remaining = (m?.instances || []).filter(inst => !idSet.has(inst.docId));
      if (remaining.length > 0) {
        dbg(`skip fs rm of ${abs}, ${remaining.length} instance(s) still alive (1-to-many)`);
        continue;
      }
      try {
        const stat = await fs.stat(abs).catch(() => null);
        if (stat?.isDirectory()) {
          // 这是个目录，递归删除
          await fs.rm(abs, { recursive: true, force: true });
          dbg(`removed dir ${abs}`);
        } else if (stat?.isFile()) {
          // 单文件删除
          await fs.unlink(abs);
          dbg(`removed file ${abs}`);
        }
      } catch (e) {
        dbg(`fs rm err for ${abs}: ${e.message}`);
      }
      this.state.remove(abs);
    }

    // 3) 同步地：检查任何 mapping 中还有引用被删 id 的 instance 也清掉
    for (const [abs, m] of Object.entries(this.state.mappings || {})) {
      const keep = (m.instances || []).filter(inst => !idSet.has(inst.docId));
      if (keep.length !== (m.instances || []).length) {
        if (keep.length === 0) {
          this.state.remove(abs);
        } else {
          m.instances = keep;
        }
      }
    }

    await this.state.save();
    this.notify(`已删除 ${affected.size} 个 .md（思源 ${docIds.length} 个 doc）`, 'info');
  }

  /**
   * 重命名/标题变化：把 .md 文件名改成新标题。
   * 如果被改名的是父 doc（容器），把整棵子目录改名。
   */
  scheduleRename(docId, oldTitle, newTitle) {
    if (!docId || !newTitle || newTitle === oldTitle) return;
    const key = 'r:' + docId;
    if (this._renameTimers && this._renameTimers[key]) clearTimeout(this._renameTimers[key]);
    this._renameTimers = this._renameTimers || {};
    this._renameTimers[key] = setTimeout(() => {
      delete this._renameTimers[key];
      this.handleRename(docId, newTitle).catch(e => {
        this.log('[rename] err', e.message);
        if (this._wsDbg) this._wsDbg.write(`[ERR rename] ${e.message}\n${e.stack}\n`);
      });
    }, 600);
  }

  async handleRename(docId, newTitle) {
    const dbg = (m) => { this.log('[rename]', m); if (this._wsDbg) this._wsDbg.write(`[rename] ${m}\n`); };
    dbg(`handle ${docId} → "${newTitle}"`);

    // 找到这个 docId 出现在哪些 mapping 里
    const hits = []; // {abs, inst}
    for (const [abs, m] of Object.entries(this.state.mappings || {})) {
      for (const inst of m.instances || []) {
        if (inst.docId === docId) {
          hits.push({ abs, inst });
          break;
        }
      }
    }
    if (!hits.length) {
      dbg('not in any mapping, ignoring');
      return;
    }

    // 对每个 hit：决定是文件改名还是目录改名
    // 规则：如果 abs 是个 .md 文件 → 改文件名；如果 abs 是个目录 → 改目录名
    for (const { abs, inst } of hits) {
      const stat = await fs.stat(abs).catch(() => null);
      if (!stat) continue;

      const parent = path.dirname(abs);
      const newName = newTitle;

      try {
        if (stat.isFile()) {
          // 文件改名
          if (path.basename(abs) === newName + '.md') {
            dbg(`file already named ${newName}.md, skip`);
          } else {
            const newPath = path.join(parent, newName + '.md');
            const target = await this._findFreePath(newPath);
            await fs.rename(abs, target);
            // 更新 mapping 路径
            this.state.renamePath(abs, target);
            // 改 inst.hpath 末段
            inst.hpath = this._replaceLastPathSegment(inst.hpath, newName);
            dbg(`renamed file ${abs} → ${target}`);
            this.notify(`重命名: ${path.basename(abs)} → ${path.basename(target)}`, 'info');
          }
        } else if (stat.isDirectory()) {
          // 目录改名
          if (path.basename(abs) === newName) {
            dbg(`dir already named ${newName}, skip`);
          } else {
            const newDir = path.join(parent, newName);
            const target = await this._findFreePath(newDir);
            await fs.rename(abs, target);
            // 重命名该目录下所有 .md 路径
            await this._renameAllInDir(abs, target, docId);
            dbg(`renamed dir ${abs} → ${target}`);
            this.notify(`重命名目录: ${path.basename(abs)} → ${path.basename(target)}`, 'info');
          }
        }
      } catch (e) {
        dbg(`rename err for ${abs}: ${e.message}`);
      }
    }
    await this.state.save();
  }

  /** 把 oldDir 下所有子 .md 路径映射到 newDir 下，并更新对应 instance.hpath 的最后一段 */
  async _renameAllInDir(oldDir, newDir, renamedDocId) {
    const walk = async (src, dst) => {
      let entries;
      try { entries = await fs.readdir(src, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const oldPath = path.join(src, e.name);
        const newPath = path.join(dst, e.name);
        if (e.isDirectory()) {
          await walk(oldPath, newPath);
        } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
          // 更新 state
          this.state.renamePath(oldPath, newPath);
          // 更新每个 instance 的 hpath（同步映射）
          const m = this.state.get(newPath);
          if (m) {
            for (const inst of m.instances || []) {
              inst.hpath = this._hpathReplaceInPath(inst.hpath, oldDir, newDir);
            }
          }
        }
      }
    };
    await walk(oldDir, newDir);
  }

  /** 把 hpath 末段（最后一级标题）改成新名 */
  _replaceLastPathSegment(hpath, newName) {
    if (!hpath) return hpath;
    const parts = hpath.split('/');
    parts[parts.length - 1] = newName;
    return parts.join('/');
  }

  /** 从 state 推 docId 对应的旧标题（hpath 末段）。无 mapping 时返回 null。 */
  _oldTitleFor(docId) {
    for (const m of Object.values(this.state.mappings || {})) {
      for (const inst of m.instances || []) {
        if (inst.docId === docId && inst.hpath) {
          const parts = inst.hpath.split('/');
          return parts[parts.length - 1];
        }
      }
    }
    return null;
  }

  /** 把 hpath 中 oldDir 这一段替换成 newDir（仅做 prefix 替换） */
  _hpathReplaceInPath(hpath, oldDir, newDir) {
    // 此处 hpath 是思源侧路径（如 /inbox/folder/sub），不需要替换
    // 因为目录改名后，instance.hpath 也不需要变（思源 doc ID 不变）
    return hpath;
  }

  _uniquePath(p) {
    // 同名冲突时加 -1, -2, ...
    const ext = path.extname(p);
    const base = p.slice(0, p.length - ext.length);
    let i = 1;
    let candidate;
    candidate = `${base}-${i}${ext}`;
    return candidate;
  }

  /** 找一个不冲突的目标路径（最多试到 100）。 */
  async _findFreePath(target) {
    try { await fs.access(target); } catch { return target; } // 不存在，OK
    for (let i = 1; i < 100; i++) {
      const c = this._uniquePath(target);
      try { await fs.access(c); } catch { return c; }
    }
    return target; // 几乎不可能
  }

  /**
   * 防抖：同一个 docId 在 800ms 内多次 box 事件只处理一次。
   * 收到 box 事件 → 调用 getBlockInfo → 派生 hpath → 落在 rootHpath 内则导出 .md。
   * 同时给每个 docId 暴露一个 Promise，让 del/rename 处理器能等待 in-flight newDoc 完成。
   */
  scheduleNewDocCheck(notebookId, storagePath) {
    const match = String(storagePath).match(/\/([\w-]+)\.sy$/);
    if (!match) return;
    const docId = match[1];
    this.log('[newDoc] scheduled', docId, 'in', notebookId.slice(0, 14) + '...');
    if (this._wsDbg) this._wsDbg.write(`[newDoc] scheduled ${docId} in ${notebookId}\n`);
    if (this._newDocTimers[docId]) clearTimeout(this._newDocTimers[docId]);
    // 暴露一个 Promise 给 del/rename 处理器等待
    this._newDocInflight = this._newDocInflight || {};
    let resolveInflight;
    this._newDocInflight[docId] = new Promise(r => { resolveInflight = r; });
    this._newDocTimers[docId] = setTimeout(() => {
      delete this._newDocTimers[docId];
      this.handleNewDoc(notebookId, docId, storagePath)
        .then(() => this.log('[newDoc] done', docId))
        .catch(e => {
          this.log('[newDoc] err', docId, e.message, e.stack);
          if (this._wsDbg) this._wsDbg.write(`[ERR ${docId}] ${e.message}\n${e.stack}\n`);
        })
        .finally(() => {
          // 通知等待者；promise 本身保留 3s 供 del handler 来时查
          if (resolveInflight) resolveInflight();
          setTimeout(() => { if (this._newDocInflight) delete this._newDocInflight[docId]; }, 3000);
        });
    }, 800);
  }

  async handleNewDoc(notebookId, docId, storagePath) {
    const dbg = (m) => { this.log('[newDoc]', m); if (this._wsDbg) this._wsDbg.write(`[newDoc] ${m}\n`); };
    dbg(`handle ${docId} ${storagePath}`);
    // 已映射：跳过（让 schedulePull 接管）
    if (this.state.byDocId(docId)) {
      dbg('already in mappings, skipping');
      return;
    }

    // 派生 hpath：path 形如 /parentDir/thisDoc.sy；逐级向上读 .sy 拿 title
    const hpath = await this._deriveHPath(notebookId, storagePath);
    dbg(`hpath = ${hpath}`);
    if (!hpath || hpath === '/') return;

    // 落在某个 (notebookId, rootHpath) 下？
    const target = this.state.allWatched().find(w =>
      w.notebookId === notebookId && this._hpathUnder(hpath, w.rootHpath)
    );
    if (!target) {
      dbg(`hpath not under any watched rootHpath for this notebook`);
      return;
    }
    dbg(`target = ${target.folder.path} rootHpath=${target.rootHpath}`);

    const rel = this._hpathToRel(target.rootHpath, hpath);
    if (!rel) return;
    const targetFile = path.join(target.folder.path, rel);
    if (!targetFile.endsWith('.md')) return;

    // 拉取内容
    const kramdown = await this.api.getDocKramdown(docId);
    const cleaned = stripIal(kramdown);
    if (!cleaned.trim()) {
      // 可能是 doc 在我们 800ms debounce 期间被删了，body 拿不到 → 跳过
      dbg('body empty, doc may have been deleted before our debounce; skipping');
      return;
    }

    // 写 .md（若已存在且 hash 不同 → 备份 .conflict-<ts>.md）
    try {
      const existing = await fs.readFile(targetFile, 'utf-8');
      if (sha256(existing) !== sha256(cleaned)) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const dir = path.dirname(targetFile);
        const base = path.basename(targetFile, '.md');
        await fs.writeFile(path.join(dir, `${base}.conflict-${ts}.md`), existing, 'utf-8');
        this.notify(`已备份冲突: ${base}.conflict-${ts}.md`);
      }
    } catch { /* 不存在则正常 */ }
    await fs.mkdir(path.dirname(targetFile), { recursive: true });
    await fs.writeFile(targetFile, cleaned, 'utf-8');

    // 更新 state
    const mdHash = sha256(cleaned);
    const syHash = sha256(stripIal(kramdown));
    this.state.upsertInstance(targetFile, {
      docId,
      hpath,
      syHash,
      notebookId,
    }, mdHash);
    await this.state.save();
    this.log('[newDoc] 导出', docId, '→', targetFile);
    this.notify(`新建: ${path.relative(target.folder.path, targetFile)}`, 'info');
  }

  /** hpath 是否落在 rootHpath 之下（含本身）。 */
  _hpathUnder(hpath, rootHpath) {
    if (!rootHpath) return hpath.startsWith('/');  // 根目录模式：任何 hpath 都在其下
    const r = rootHpath.replace(/\/+$/, '');
    if (!r) return hpath.startsWith('/');
    return hpath === r || hpath.startsWith(r + '/');
  }

  /** hpath → 相对于 rootHpath 的子路径（含 .md）。如 /inbox/foo → foo.md */
  _hpathToRel(rootHpath, hpath) {
    const r = (rootHpath || '').replace(/\/+$/, '');
    let stem;
    if (!r) {
      if (!hpath.startsWith('/')) return null;
      stem = hpath.slice(1);
    } else {
      if (hpath === r) return null;  // 是 root 本身，不是 doc
      if (!hpath.startsWith(r + '/')) return null;
      stem = hpath.slice(r.length + 1);
    }
    if (!stem) return null;
    return stem + '.md';
  }

  /**
   * 走 storagePath 父链读 .sy 拿 title，组装 hpath。
   * storagePath 形如 /parent/thisDoc.sy 或 /thisDoc.sy
   */
  async _deriveHPath(notebookId, storagePath) {
    const parts = String(storagePath).replace(/^\//, '').replace(/\.sy$/, '').split('/');
    if (!parts.length) return null;
    const titles = [];
    for (let i = 0; i < parts.length; i++) {
      const cur = parts[i];
      let title;
      // 末级：尝试用 getBlockInfo（最权威）
      if (i === parts.length - 1) {
        try {
          const info = await this.api.getBlockInfo(cur);
          title = info?.rootTitle;
        } catch {}
      }
      if (!title) title = await this.api.readTitleFromSy(notebookId, '/' + parts.slice(0, i+1).join('/') + '.sy');
      titles.push(title || cur);
    }
    return '/' + titles.join('/');
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
