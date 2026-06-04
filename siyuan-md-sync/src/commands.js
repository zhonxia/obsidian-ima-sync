/**
 * 命令面板：注册 4 个常用命令。
 *
 * - 导入 Markdown 文件  （弹文件选择）
 * - 导入 Markdown 文件夹（弹文件夹选择）
 * - 将当前文档导出为 .md（弹目标路径）
 * - 立即对账
 */

import path from 'path';
import { showMessage } from 'siyuan';
import { t } from './i18n.js';
import { pickDirectory, pickFile } from './picker.js';

export function registerCommands(plugin) {
  const { sync, state } = plugin;

  plugin.addCommand({
    langKey: 'cmdImportFile',
    hotkey: '',
    callback: async () => {
      const filePath = await pickFile();
      if (!filePath) return;
      // 用户从任意位置选的：临时挂到当前活跃笔记本下
      if (!state.activeNotebookId) {
        showMessage('请先在插件设置里选择一个笔记本', 3000, 'error');
        return;
      }
      const watched = state.allWatched();
      if (!watched.some(w => filePath.startsWith(w.folder.path + '/') || filePath === w.folder.path)) {
        const cur = state.ensureActive();
        cur.folders.push({ path: path.dirname(filePath), label: '临时' });
        await state.save();
        await plugin.stopWatcher();
        plugin.startWatcher();
      }
      const id = await sync.importFile(filePath);
      if (id) {
        showMessage(`${t('imported')}: ${id.slice(0, 12)}...`, 2000);
      }
    },
  });

  plugin.addCommand({
    langKey: 'cmdImportFolder',
    hotkey: '',
    callback: async () => {
      const folderPath = await pickDirectory();
      if (!folderPath) return;
      if (!state.activeNotebookId) {
        showMessage('请先在插件设置里选择一个笔记本', 3000, 'error');
        return;
      }
      const cur = state.ensureActive();
      if (!cur.folders.some(f => f.path === folderPath)) {
        cur.folders.push({ path: folderPath, label: folderPath });
        await state.save();
        await plugin.stopWatcher();
        plugin.startWatcher();
      }
      const n = await sync.importFolder(folderPath);
      showMessage(`${t('imported')}: ${n}`, 2000);
    },
  });

  plugin.addCommand({
    langKey: 'cmdExportCurrent',
    hotkey: '',
    callback: async () => {
      // 拿到当前打开的文档
      const tab = document.querySelector('.layout__center .layout-tab--active');
      if (!tab) {
        showMessage('没有打开的文档', 2000, 'error');
        return;
      }
      const protyle = tab.querySelector('protyle')?.__protyle
                  || tab.querySelector('[data-type="NodeDocument"]')?.__protyle;
      const docId = protyle?.block?.rootID;
      if (!docId) {
        showMessage('无法获取当前文档 id', 2000, 'error');
        return;
      }
      // 让用户选目标 .md 路径
      const target = await pickFile();
      if (!target) return;
      // 如果选的不是 .md，提醒但允许
      if (!target.toLowerCase().endsWith('.md')) {
        showMessage('目标不是 .md 文件，继续导出', 2000);
      }
      await sync.exportDocToFile(docId, target);
    },
  });

  plugin.addCommand({
    langKey: 'cmdReconcile',
    hotkey: '',
    callback: async () => {
      const n = await sync.reconcile();
      showMessage(`${t('reconcileDone')}: ${n}`, 2000);
    },
  });

  plugin.addCommand({
    langKey: 'cmdForcePull',
    hotkey: '',
    callback: async () => {
      let n = 0;
      for (const info of Object.values(state.mappings || {})) {
        if (info?.docId) {
          await sync.pullFromSiyuan(info.docId);
          n++;
        }
      }
      showMessage(`${t('forcePullDone')}: ${n}`, 2000);
    },
  });

  plugin.addCommand({
    langKey: 'cmdCleanIal',
    hotkey: '',
    callback: async () => {
      const fs = require('fs/promises');
      const crypto = require('crypto');
      const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
      const strip = (txt) => txt.replace(/^[ \t]*\{:[^}]*\}[ \t]*\r?\n?/gm, '').replace(/\{:[^}]*\}/g, '').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
      let n = 0;
      for (const absPath of state.allPaths()) {
        try {
          const orig = await fs.readFile(absPath, 'utf-8');
          const cleaned = strip(orig);
          if (cleaned !== orig) {
            await fs.writeFile(absPath, cleaned, 'utf-8');
            // 只更新 mdHash，instances 保留
            const m = state.get(absPath);
            if (m) m.mdHash = sha(cleaned);
            n++;
          }
        } catch (e) { /* 文件可能被删了 */ }
      }
      await state.save();
      showMessage(`${t('cleanIalDone')}: ${n}`, 2000);
    },
  });
}
