import { Plugin, Setting, Dialog, showMessage } from 'siyuan';
import { Api } from './api.js';
import { State } from './state.js';
import { Sync } from './sync.js';
import { Watcher } from './watcher.js';
import { registerCommands } from './commands.js';
import { t } from './i18n.js';

function inputDialog(title, message, placeholder = '', defaultValue = '') {
  return new Promise((resolve) => {
    const dialog = new Dialog({
      title,
      content: `<div class="b3-dialog__content">
  <div>${message}</div>
  <div class="fn__hr"></div>
  <input class="b3-text-field fn__block" placeholder="${placeholder}" value="${defaultValue.replace(/"/g, '&quot;')}" />
</div>
<div class="b3-dialog__action">
  <button class="b3-button b3-button--cancel">${t('cancel')}</button><div class="fn__space"></div>
  <button class="b3-button b3-button--text">${t('confirm')}</button>
</div>`,
      width: '520px',
    });
    const input = dialog.element.querySelector('input');
    const [cancelBtn, confirmBtn] = dialog.element.querySelectorAll('.b3-button');
    setTimeout(() => input.focus(), 0);
    dialog.bindInput(input, () => confirmBtn.click());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cancelBtn.click();
    });
    cancelBtn.addEventListener('click', () => { dialog.destroy(); resolve(null); });
    confirmBtn.addEventListener('click', () => {
      const v = input.value.trim();
      dialog.destroy();
      resolve(v || null);
    });
  });
}

export default class extends Plugin {
  async onload() {
    this.log = (...args) => console.log('[siyuan-md-sync]', ...args);
    this.notify = (msg, type) => showMessage(msg, 3000, type || 'info');

    try {
      this.api = new Api();

      this.state = new State(this);
      await this.state.load();

      this.notebooks = [];
      await this.refreshNotebooks();

      this.sync = new Sync(this.api, this.state, {
        notify: this.notify,
        log: this.log,
      });

      this.watcher = new Watcher(this.sync, this.state, {
        notify: this.notify,
        log: this.log,
      });

      this.initSettings();

      this.eventBus.on('opened-notebook', () => this.refreshNotebooks());
      this.eventBus.on('closed-notebook', () => this.refreshNotebooks());

      this.eventBus.on('ws-main', (e) => {
        this.sync.onWebSocketMessage(e?.detail);
      });

      registerCommands(this);

      if (this.state.allWatched().length && this.state.importOnChange) {
        this.startWatcher();
      }

      if (!this.state.activeNotebookId) {
        showMessage(t('firstRunHint'), 5000, 'info');
      } else {
        this.notify(t('pluginLoaded'));
      }

      this.log('plugin loaded');

      if (typeof window !== 'undefined') {
        window.__mdSync = {
          plugin: this,
          sync: this.sync,
          state: this.state,
          api: this.api,
          forcePull: (docId) => this.sync.pullFromSiyuan(docId),
          forcePullAll: async () => {
            const ids = new Set();
            for (const m of Object.values(this.state.mappings || {})) {
              for (const inst of m.instances || []) {
                if (inst?.docId) ids.add(inst.docId);
              }
            }
            const results = [];
            for (const id of ids) {
              try { await this.sync.pullFromSiyuan(id); results.push({ id, ok: true }); }
              catch (e) { results.push({ id, ok: false, err: e.message }); }
            }
            return results;
          },
          simulateWsEvent: (docId) => this.sync.schedulePull(docId),
          reconcile: () => this.sync.reconcile(),
          dump: () => ({
            activeNotebookId: this.state.activeNotebookId,
            notebooks: this.state.notebooks,
            mappings: this.state.mappings,
          }),
        };
        this.log('window.__mdSync ready (debug)');
      }
    } catch (e) {
      this.log('load failed', e);
      showMessage(`${t('error')}: ${e.message}`, 5000, 'error');
    }
  }

  async refreshNotebooks() {
    try {
      this.notebooks = await this.api.listNotebooks();
    } catch (e) {
      this.log('refreshNotebooks failed', e);
    }
  }

  async onunload() {
    try {
      await this.stopWatcher();
      await this.state.save();
      this.log('plugin unloaded');
    } catch (e) {
      this.log('unload error', e);
    }
  }

  initSettings() {
    const setting = new Setting({
      confirmCallback: () => this.state.save(),
    });

    // ============================================================
    // 笔记本下拉框（决定下面的文件夹列表跟哪个笔记本挂钩）
    // ============================================================
    setting.addItem({
      title: t('targetNotebook'),
      direction: 'row',
      description: t('targetNotebookDesc'),
      createActionElement: () => {
        const sel = document.createElement('select');
        sel.className = 'b3-select';
        this._renderNotebookSelect(sel);
        sel.addEventListener('change', async () => {
          this.state.setActive(sel.value);
          await this.state.save();
          // 切换笔记本：刷新下面的文件夹列表 + 根 hpath 输入框
          this._renderFolderList();
          this._renderRootHpathInput();
          // 重新启动 watcher 监听新笔记本的文件夹
          await this.stopWatcher();
          if (this.state.allWatched().length && this.state.importOnChange) {
            this.startWatcher();
          }
        });
        return sel;
      },
    });

    // ============================================================
    // 根 hpath（per-notebook，跟着 activeNotebookId 走）
    // ============================================================
    this._hpathInput = document.createElement('input');
    this._hpathInput.className = 'b3-text-field fn__size200';
    this._renderRootHpathInput();
    setting.addItem({
      title: t('rootHpath'),
      direction: 'row',
      description: t('rootHpathHint'),
      actionElement: this._hpathInput,
    });

    // ============================================================
    // 监听文件夹列表（per-notebook，跟着 activeNotebookId 走）
    // ============================================================
    this._folderContainer = document.createElement('div');
    this._renderFolderList();
    setting.addItem({
      title: t('watchedFolders'),
      direction: 'row',
      description: t('noFolders'),
      actionElement: this._folderContainer,
    });

    // ============================================================
    // 全局开关
    // ============================================================
    const ialCheckbox = document.createElement('input');
    ialCheckbox.type = 'checkbox';
    ialCheckbox.className = 'b3-switch fn__flex-center';
    ialCheckbox.checked = this.state.writeBackIAL;
    ialCheckbox.addEventListener('change', () => {
      this.state.writeBackIAL = ialCheckbox.checked;
    });
    setting.addItem({
      title: t('writeBackIAL'),
      direction: 'row',
      description: t('writeBackIALHint'),
      actionElement: ialCheckbox,
    });

    const bidiCheckbox = document.createElement('input');
    bidiCheckbox.type = 'checkbox';
    bidiCheckbox.className = 'b3-switch fn__flex-center';
    bidiCheckbox.checked = this.state.bidirectional !== false;
    bidiCheckbox.addEventListener('change', () => {
      this.state.bidirectional = bidiCheckbox.checked;
    });
    setting.addItem({
      title: t('bidirectional'),
      direction: 'row',
      description: t('bidirectionalHint'),
      actionElement: bidiCheckbox,
    });

    this.setting = setting;
  }

  _renderNotebookSelect(sel) {
    sel.innerHTML = '';
    const current = this.state.activeNotebookId;
    // 如果当前 active 不在可见列表里，给个 (不可用) 占位项，避免 dropdown 空着
    if (current && !this.notebooks.some(nb => nb.id === current)) {
      const opt = document.createElement('option');
      opt.value = current;
      opt.textContent = `(不可用) ${current.slice(0, 8)}…`;
      opt.selected = true;
      sel.appendChild(opt);
    }
    // 如果没有任何 active，强制显示一个空选项 + 提示文案
    if (!current) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '— 请先选择一个笔记本 —';
      opt.selected = true;
      sel.appendChild(opt);
    }
    for (const nb of this.notebooks) {
      const opt = document.createElement('option');
      opt.value = nb.id;
      opt.textContent = nb.closed ? `${nb.name}（已关闭）` : nb.name;
      if (nb.id === current) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  _renderRootHpathInput() {
    const cfg = this.state.getActive();
    // 空字符串合法：表示「直接存到笔记本根目录」。placeholder 提示用户。
    this._hpathInput.value = cfg?.rootHpath || '';
    this._hpathInput.placeholder = t('rootHpathPlaceholder');
    this._hpathInput.onchange = () => {
      const cur = this.state.ensureActive();
      if (cur) {
        // 不强制默认值；空字符串 = 笔记本根目录
        cur.rootHpath = this._hpathInput.value.trim();
        this._hpathInput.value = cur.rootHpath;
        this.state.save();
      }
    };
  }

  _renderFolderList() {
    if (!this._folderContainer) return;
    this._folderContainer.innerHTML = '';
    const cfg = this.state.getActive();
    const folders = cfg?.folders || [];
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
    folders.forEach((f, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:4px;align-items:center;';
      const span = document.createElement('span');
      span.textContent = f.path;
      span.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      const btn = document.createElement('button');
      btn.textContent = '✕';
      btn.className = 'b3-button b3-button--outline fn__size100';
      btn.addEventListener('click', async () => {
        const cur = this.state.ensureActive();
        cur.folders.splice(i, 1);
        await this.state.save();
        this._renderFolderList();
        // 重新启动 watcher
        await this.stopWatcher();
        if (this.state.allWatched().length && this.state.importOnChange) {
          this.startWatcher();
        }
      });
      row.appendChild(span);
      row.appendChild(btn);
      list.appendChild(row);
    });
    const addBtn = document.createElement('button');
    addBtn.textContent = '+ ' + t('addFolder');
    addBtn.className = 'b3-button b3-button--outline fn__size200';
    addBtn.addEventListener('click', async () => {
      const cur = this.state.ensureActive();
      if (!cur) {
        this.notify('请先在上方下拉框中选择一个笔记本', 'error');
        return;
      }
      const p = await inputDialog(t('addFolderTitle'), t('addFolderPrompt'), '/Users/me/notes');
      if (p) {
        cur.folders.push({ path: p, label: p });
        await this.state.save();
        this._renderFolderList();
        // 启动 watcher 监听新文件夹
        if (this.state.importOnChange) {
          await this.stopWatcher();
          this.startWatcher();
        }
      }
    });
    list.appendChild(addBtn);

    // 统计行
    const stats = document.createElement('div');
    stats.style.cssText = 'font-size:12px;color:var(--b3-theme-on-surface-light);margin-top:4px;';
    const updateStats = () => {
      const cfg = this.state.getActive();
      const folderCount = cfg?.folders?.length || 0;
      const fileCount = Object.values(this.state.mappings).filter(m =>
        m.instances.some(i => i.notebookId === this.state.activeNotebookId)
      ).length;
      stats.textContent = `当前笔记本：${folderCount} 个文件夹，已映射 ${fileCount} 个 .md`;
    };
    updateStats();

    // "立即对账" 按钮
    const reconcileBtn = document.createElement('button');
    reconcileBtn.textContent = '🔄 ' + t('cmdReconcile');
    reconcileBtn.className = 'b3-button b3-button--outline fn__size200';
    reconcileBtn.style.marginTop = '8px';
    reconcileBtn.addEventListener('click', async () => {
      reconcileBtn.disabled = true;
      reconcileBtn.textContent = '⏳ ' + t('reconciling');
      try {
        await this.sync.reconcile();
        updateStats();
      } finally {
        reconcileBtn.disabled = false;
        reconcileBtn.textContent = '🔄 ' + t('cmdReconcile');
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
}
