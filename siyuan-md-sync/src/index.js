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

      if (this.state.folders?.length && this.state.importOnChange) {
        this.startWatcher();
      }

      if (!this.state.notebookId) {
        showMessage(t('firstRunHint'), 5000, 'info');
      } else {
        this.notify(t('pluginLoaded'));
      }

      this.log('plugin loaded');
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

    setting.addItem({
      title: t('targetNotebook'),
      direction: 'row',
      description: t('targetNotebookDesc'),
      createActionElement: () => {
        const sel = document.createElement('select');
        sel.className = 'b3-select';
        const current = this.state.notebookId;
        if (!this.notebooks.some(nb => nb.id === current)) {
          if (current) {
            const opt = document.createElement('option');
            opt.value = current;
            opt.textContent = `(不可用) ${current.slice(0, 8)}…`;
            opt.selected = true;
            sel.appendChild(opt);
          }
        }
        this.notebooks.forEach(nb => {
          const opt = document.createElement('option');
          opt.value = nb.id;
          opt.textContent = nb.closed ? `${nb.name}（已关闭）` : nb.name;
          if (nb.id === current) opt.selected = true;
          sel.appendChild(opt);
        });
        sel.addEventListener('change', () => {
          this.state.notebookId = sel.value;
        });
        return sel;
      },
    });

    const hpathInput = document.createElement('input');
    hpathInput.className = 'b3-text-field fn__size200';
    hpathInput.value = this.state.rootHpath;
    hpathInput.addEventListener('change', () => {
      this.state.rootHpath = hpathInput.value || '/inbox';
    });
    setting.addItem({
      title: t('rootHpath'),
      direction: 'row',
      description: t('rootHpathHint'),
      actionElement: hpathInput,
    });

    const folderContainer = document.createElement('div');
    const renderFolders = () => {
      folderContainer.innerHTML = '';
      const list = document.createElement('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
      this.state.folders.forEach((f, i) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:4px;align-items:center;';
        const span = document.createElement('span');
        span.textContent = f.path;
        span.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        const btn = document.createElement('button');
        btn.textContent = '✕';
        btn.className = 'b3-button b3-button--outline fn__size100';
        btn.addEventListener('click', async () => {
          this.state.folders.splice(i, 1);
          await this.state.save();
          renderFolders();
        });
        row.appendChild(span);
        row.appendChild(btn);
        list.appendChild(row);
      });
      const addBtn = document.createElement('button');
      addBtn.textContent = '+ ' + t('addFolder');
      addBtn.className = 'b3-button b3-button--outline fn__size200';
      addBtn.addEventListener('click', async () => {
        const p = await inputDialog(t('addFolderTitle'), t('addFolderPrompt'), '/Users/me/notes');
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
      title: t('watchedFolders'),
      direction: 'row',
      description: t('noFolders'),
      actionElement: folderContainer,
    });

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
