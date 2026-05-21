import { ItemView, WorkspaceLeaf, TFile, TFolder, Vault, Notice } from "obsidian";

export const VIEW_TYPE = "ima-sync-view";

export class ImaSyncView extends ItemView {
  private vault: Vault;
  private getSyncStatus: (file: TFile) => string;
  private syncFile: (file: TFile) => Promise<void>;
  private syncFiles: (files: TFile[]) => Promise<void>;
  private syncAll: () => Promise<void>;
  private getSyncStats: () => { total: number; synced: number; modified: number; unsynced: number };
  private getAllFilesSyncStatus: () => { path: string; status: string; error?: string }[];
  private isExcluded: (path: string) => boolean;

  private listEl!: HTMLElement;
  private filterInput!: HTMLInputElement;
  private totalEl!: HTMLElement;
  private syncedEl!: HTMLElement;
  private modifiedEl!: HTMLElement;
  private unsyncedEl!: HTMLElement;
  private selectedPaths: Set<string> = new Set();
  private filterText = "";
  private refreshTimeout: number | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    deps: {
      vault: Vault;
      getSyncStatus: (file: TFile) => string;
      syncFile: (file: TFile) => Promise<void>;
      syncFiles: (files: TFile[]) => Promise<void>;
      syncAll: () => Promise<void>;
      getSyncStats: () => { total: number; synced: number; modified: number; unsynced: number };
      getAllFilesSyncStatus: () => { path: string; status: string; error?: string }[];
      isExcluded: (path: string) => boolean;
    }
  ) {
    super(leaf);
    this.vault = deps.vault;
    this.getSyncStatus = deps.getSyncStatus;
    this.syncFile = deps.syncFile;
    this.syncFiles = deps.syncFiles;
    this.syncAll = deps.syncAll;
    this.getSyncStats = deps.getSyncStats;
    this.getAllFilesSyncStatus = deps.getAllFilesSyncStatus;
    this.isExcluded = deps.isExcluded;
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return "IMA Sync";
  }

  getIcon(): string {
    return "upload-cloud";
  }

  async onOpen(): Promise<void> {
    this.render();
    this.refresh();
  }

  scheduleRefresh(): void {
    if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
    this.refreshTimeout = window.setTimeout(() => this.refresh(), 300);
  }

  private render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("ima-sync-container");

    container.createEl("div", { cls: "ima-sync-header" }, (header) => {
      header.createEl("h3", { text: "🔄 IMA Sync" });

      this.filterInput = header.createEl("input", {
        cls: "ima-sync-filter",
        attr: { type: "text", placeholder: "Filter files..." },
      });
      this.filterInput.addEventListener("input", () => {
        this.filterText = this.filterInput.value.toLowerCase();
        this.refresh();
      });
    });

    container.createEl("div", { cls: "ima-sync-stats" }, (stats) => {
      stats.createSpan({ cls: "ima-sync-stat" }, (el) => {
        el.createSpan({ text: "Total: " });
        this.totalEl = el.createSpan({ cls: "stat-value" });
      });
      stats.createSpan({ cls: "ima-sync-stat" }, (el) => {
        el.createSpan({ text: "Synced: " });
        this.syncedEl = el.createSpan({ cls: "stat-value stat-synced" });
      });
      stats.createSpan({ cls: "ima-sync-stat" }, (el) => {
        el.createSpan({ text: "Modified: " });
        this.modifiedEl = el.createSpan({ cls: "stat-value stat-modified" });
      });
      stats.createSpan({ cls: "ima-sync-stat" }, (el) => {
        el.createSpan({ text: "Unsaved: " });
        this.unsyncedEl = el.createSpan({ cls: "stat-value stat-unsynced" });
      });
    });

    this.listEl = container.createDiv({ cls: "ima-sync-list" });

    container.createDiv({ cls: "ima-sync-footer" }, (footer) => {
      const selectedBtn = footer.createEl("button", {
        cls: "ima-sync-btn ima-sync-btn-primary",
        text: "Sync Selected",
      });
      selectedBtn.addEventListener("click", () => {
        this.syncSelectedFiles();
      });

      const allBtn = footer.createEl("button", {
        cls: "ima-sync-btn",
        text: "Sync All",
      });
      allBtn.addEventListener("click", () => {
        this.syncAllNotes();
      });

      footer.createEl("button", {
        cls: "ima-sync-btn ima-sync-btn-secondary",
        text: "Refresh",
      }).addEventListener("click", () => this.refresh());
    });
  }

  refresh(): void {
    this.renderStats();
    this.renderList();
  }

  private renderStats(): void {
    const stats = this.getSyncStats();
    this.totalEl.textContent = String(stats.total);
    this.syncedEl.textContent = String(stats.synced);
    this.modifiedEl.textContent = String(stats.modified);
    this.unsyncedEl.textContent = String(stats.unsynced);
  }

  private renderList(): void {
    this.listEl.empty();

    const items = this.getAllFilesSyncStatus();
    const filtered = items.filter((item) => {
      if (!this.filterText) return true;
      return item.path.toLowerCase().includes(this.filterText);
    });

    const grouped = this.groupByFolder(filtered);

    for (const [folder, files] of Object.entries(grouped)) {
      const folderEl = this.listEl.createDiv({ cls: "ima-sync-folder" });
      const toggleEl = folderEl.createDiv({ cls: "ima-sync-folder-header" });
      const arrow = toggleEl.createSpan({ cls: "ima-sync-folder-arrow", text: "▾" });
      toggleEl.createSpan({ cls: "ima-sync-folder-name", text: folder || "(root)" });
      toggleEl.createSpan({ cls: "ima-sync-folder-count", text: `(${files.length})` });

      const childrenEl = this.listEl.createDiv({ cls: "ima-sync-folder-children" });

      let expanded = true;
      toggleEl.addEventListener("click", () => {
        expanded = !expanded;
        childrenEl.toggleClass("ima-sync-collapsed", !expanded);
        arrow.textContent = expanded ? "▾" : "▸";
      });

      for (const file of files) {
        const itemEl = childrenEl.createDiv({ cls: "ima-sync-item" });
        if (file.status === "error") itemEl.addClass("ima-sync-item-error");

        const checkbox = itemEl.createEl("input", {
          cls: "ima-sync-checkbox",
          attr: { type: "checkbox" },
        });
        if (this.selectedPaths.has(file.path)) {
          checkbox.checked = true;
        }
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) {
            this.selectedPaths.add(file.path);
          } else {
            this.selectedPaths.delete(file.path);
          }
        });

        const nameEl = itemEl.createSpan({ cls: "ima-sync-name" });
        const displayName = file.path.includes("/")
          ? file.path.split("/").slice(1).join("/")
          : file.path;
        nameEl.textContent = displayName;
        nameEl.title = file.path;

        const statusEl = itemEl.createSpan({ cls: "ima-sync-status-icon" });
        const icon = this.statusIcon(file.status);
        statusEl.textContent = icon;

        if (file.error) {
          statusEl.title = file.error;
        }

        const syncBtn = itemEl.createEl("button", {
          cls: "ima-sync-single-btn",
          text: "↻",
          title: "Sync this file",
        });
        syncBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          syncBtn.textContent = "⏳";
          syncBtn.disabled = true;
          const tf = this.vault.getAbstractFileByPath(file.path);
          if (tf instanceof TFile) {
            await this.syncFile(tf);
          }
          this.refresh();
        });
      }
    }

    if (filtered.length === 0) {
      this.listEl.createDiv({
        cls: "ima-sync-empty",
        text: this.filterText
          ? "No files match your filter."
          : "No markdown files found.",
      });
    }
  }

  private groupByFolder(
    items: { path: string; status: string; error?: string }[]
  ): Record<string, { path: string; status: string; error?: string }[]> {
    const groups: Record<string, { path: string; status: string; error?: string }[]> = {};

    for (const item of items) {
      const parts = item.path.split("/");
      const folder = parts.length > 1 ? parts[0] : "(root)";
      if (!groups[folder]) groups[folder] = [];
      groups[folder].push(item);
    }

    const sorted: Record<string, { path: string; status: string; error?: string }[]> = {};
    for (const key of Object.keys(groups).sort()) {
      sorted[key] = groups[key].sort((a, b) => a.path.localeCompare(b.path));
    }
    return sorted;
  }

  private statusIcon(status: string): string {
    switch (status) {
      case "synced":
        return "✅";
      case "modified":
        return "⚠️";
      case "error":
        return "❌";
      case "syncing":
        return "⏳";
      default:
        return "○";
    }
  }

  private async syncSelectedFiles(): Promise<void> {
    if (this.selectedPaths.size === 0) {
      new Notice("No files selected.");
      return;
    }

    const files: TFile[] = [];
    for (const path of this.selectedPaths) {
      const file = this.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) files.push(file);
    }

    if (files.length === 0) {
      new Notice("No valid files to sync.");
      return;
    }

    new Notice(`Syncing ${files.length} file(s)...`);
    await this.syncFiles(files);
    this.selectedPaths.clear();
    this.refresh();
    new Notice(`Sync complete: ${files.length} file(s).`);
  }

  private async syncAllNotes(): Promise<void> {
    new Notice("Syncing all notes...");
    await this.syncAll();
    this.refresh();
    const stats = this.getSyncStats();
    new Notice(`Sync complete. ${stats.synced} files synced.`);
  }
}
