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
      // 用户从任意位置选的，需把它临时加进 folders 然后立即导入
      // 简化方案：直接调用 importFile，让其匹配监听列表
      if (!state.folders.some(f => filePath.startsWith(f.path + '/') || filePath === f.path)) {
        // 不在监听列表内，临时加
        state.folders.push({ path: path.dirname(filePath), label: '临时' });
        state.save();
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
      // 临时加入监听
      if (!state.folders.some(f => f.path === folderPath)) {
        state.folders.push({ path: folderPath, label: folderPath });
        state.save();
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
}
