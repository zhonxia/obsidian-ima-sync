import { Plugin, TFile, Notice, addIcon } from "obsidian";
import { ImaApi } from "./api";
import { ObsidianToIMASettings, DEFAULT_SETTINGS, SettingsTab } from "./settings";
import { SyncEngine, type SyncRecord } from "./sync";
import { ImaSyncView, VIEW_TYPE } from "./view";

const UPLOAD_ICON = `<svg viewBox="0 0 100 100" width="100" height="100">
  <polygon points="50,10 90,60 10,60" fill="currentColor"/>
  <rect x="10" y="70" width="80" height="15" rx="3" fill="currentColor"/>
</svg>`;

interface PersistedData {
  settings?: ObsidianToIMASettings;
  syncedNotes?: Record<string, SyncRecord>;
}

export default class ObsidianToIMAPlugin extends Plugin {
  settings: ObsidianToIMASettings = DEFAULT_SETTINGS;
  private api!: ImaApi;
  private syncEngine!: SyncEngine;

  async onload(): Promise<void> {
    await this.loadAllData();
    this.api = new ImaApi({
      clientId: this.settings.clientId,
      apiKey: this.settings.apiKey,
    });

    this.syncEngine = new SyncEngine(
      this.api,
      this.app.vault,
      this.app.metadataCache,
      this.settings,
      () => this.persistAll()
    );
    this.syncEngine.setSyncData(this._syncedNotes);

    this.registerView(VIEW_TYPE, (leaf) => {
      return new ImaSyncView(leaf, {
        vault: this.app.vault,
        getSyncStatus: (file) => this.syncEngine.getSyncStatus(file),
        syncFile: async (file) => {
          const result = await this.syncEngine.syncFile(file);
          if (result.status === "error") {
            new Notice(`Sync failed: ${result.error}`);
          }
        },
        syncFiles: async (files) => {
          const results = await this.syncEngine.syncFiles(files);
          const errors = results.filter((r) => r.status === "error");
          if (errors.length > 0) {
            new Notice(`${errors.length} file(s) failed to sync.`);
          }
        },
        syncAll: async () => {
          await this.syncEngine.syncAll();
        },
        getSyncStats: () => this.syncEngine.getSyncStats(),
        getAllFilesSyncStatus: () => this.syncEngine.getAllFilesSyncStatus(),
        isExcluded: (path) => this.syncEngine.isExcluded(path),
      });
    });

    addIcon("upload-cloud", UPLOAD_ICON);

    this.addRibbonIcon("upload-cloud", "Open IMA Sync", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-ima-sync-view",
      name: "Open IMA Sync view",
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "sync-current-note",
      name: "Sync current note to IMA",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && file.extension === "md" && !this.syncEngine.isExcluded(file.path)) {
          if (!checking) {
            this.syncCurrentNote();
          }
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: "sync-all-notes",
      name: "Sync all notes to IMA",
      callback: async () => {
        new Notice("Syncing all notes...");
        const results = await this.syncEngine.syncAll(
          (current, total, filePath) => {
            if (current === 0) {
              new Notice(`Syncing ${filePath}...`);
            }
          }
        );
        this.refreshView();
        const success = results.filter((r) => r.status === "synced").length;
        const errors = results.filter((r) => r.status === "error").length;
        new Notice(`Sync complete: ${success} succeeded, ${errors} failed.`);
      },
    });

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (
          file instanceof TFile &&
          file.extension === "md" &&
          this.settings.autoSyncOnSave &&
          !this.syncEngine.isExcluded(file.path)
        ) {
          this.handleAutoSync(file);
        }
        this.refreshView();
      })
    );

    this.registerEvent(
      this.app.vault.on("create", () => this.refreshView())
    );

    this.registerEvent(
      this.app.vault.on("delete", () => this.refreshView())
    );

    this.registerEvent(
      this.app.vault.on("rename", () => this.refreshView())
    );

    this.addSettingTab(new SettingsTab(this.app, this));

    if (this.app.workspace.layoutReady) {
      this.initView();
    } else {
      this.app.workspace.onLayoutReady(() => this.initView());
    }
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async testApiConnection(): Promise<{ ok: boolean; message: string }> {
    return this.api.testConnection();
  }

  async listKnowledgeBases(): Promise<Array<{ id: string; name: string }>> {
    return this.api.listKnowledgeBases();
  }

  private _syncedNotes: Record<string, SyncRecord> = {};

  async loadAllData(): Promise<void> {
    const data = await this.loadData() as PersistedData | undefined;
    if (data?.settings) {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
    }
    if (data?.syncedNotes) {
      this._syncedNotes = data.syncedNotes;
    }
  }

  async persistAll(): Promise<void> {
    const data: PersistedData = {
      settings: this.settings,
      syncedNotes: this.syncEngine?.getSyncData() || this._syncedNotes,
    };
    await this.saveData(data);
  }

  async saveSettings(): Promise<void> {
    await this.persistAll();
    if (this.api) {
      this.api.updateConfig({
        clientId: this.settings.clientId,
        apiKey: this.settings.apiKey,
      });
    }
    if (this.syncEngine) {
      this.syncEngine.updateSettings(this.settings);
    }
  }

  private async activateView(): Promise<void> {
    const { workspace } = this.app;

    let leaf = workspace.getLeavesOfType(VIEW_TYPE).first();
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? undefined;
      if (!leaf) return;
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }

    workspace.revealLeaf(leaf);
  }

  private initView(): void {
    if (this.app.workspace.getLeavesOfType(VIEW_TYPE).length === 0) {
      this.app.workspace.getRightLeaf(false)?.setViewState({
        type: VIEW_TYPE,
        active: false,
      });
    }
  }

  private refreshView(): void {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
      if (leaf.view instanceof ImaSyncView) {
        leaf.view.scheduleRefresh();
      }
    });
  }

  private async syncCurrentNote(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      new Notice("No markdown note is currently open.");
      return;
    }
    if (this.syncEngine.isExcluded(file.path)) {
      new Notice("This file is in an excluded folder.");
      return;
    }

    new Notice(`Syncing ${file.name}...`);
    const result = await this.syncEngine.syncFile(file);
    this.refreshView();
    if (result.status === "synced") {
      new Notice(`${file.name} synced successfully.`);
    } else {
      new Notice(`Sync failed: ${result.error}`);
    }
  }

  private async handleAutoSync(file: TFile): Promise<void> {
    const status = this.syncEngine.getSyncStatus(file);
    if (status === "unsynced") {
      return;
    }
    await this.syncEngine.syncFile(file);
    this.refreshView();
  }
}
