import { TFile, Vault, MetadataCache, Notice } from "obsidian";
import { ImaApi, ImaApiError } from "./api";
import { ObsidianToIMASettings } from "./settings";

export interface SyncRecord {
  noteId: string;
  mediaId?: string;
  syncedAt: number;
  fileMtime: number;
}

export type SyncStatusType = "unsynced" | "synced" | "modified" | "error" | "syncing";

export interface FileSyncStatus {
  path: string;
  status: SyncStatusType;
  error?: string;
  record?: SyncRecord;
}

export interface PluginData {
  syncedNotes: Record<string, SyncRecord>;
}

type SyncProgressCallback = (current: number, total: number, filePath: string) => void;

export class SyncEngine {
  private api: ImaApi;
  private vault: Vault;
  private metadataCache: MetadataCache;
  private settings: ObsidianToIMASettings;
  private data: PluginData;
  private saveDataFn: (data: PluginData) => Promise<void>;
  private loadDataFn: () => Promise<PluginData | undefined>;

  constructor(
    api: ImaApi,
    vault: Vault,
    metadataCache: MetadataCache,
    settings: ObsidianToIMASettings,
    saveDataFn: (data: PluginData) => Promise<void>,
    loadDataFn: () => Promise<PluginData | undefined>
  ) {
    this.api = api;
    this.vault = vault;
    this.metadataCache = metadataCache;
    this.settings = settings;
    this.saveDataFn = saveDataFn;
    this.loadDataFn = loadDataFn;
    this.data = { syncedNotes: {} };
  }

  async loadData(): Promise<void> {
    const raw = await this.loadDataFn();
    this.data = raw || { syncedNotes: {} };
  }

  async saveData(): Promise<void> {
    await this.saveDataFn(this.data);
  }

  updateSettings(settings: ObsidianToIMASettings): void {
    this.settings = settings;
    this.api.updateConfig({
      clientId: settings.clientId,
      apiKey: settings.apiKey,
    });
  }

  getSyncStatus(file: TFile): SyncStatusType {
    if (file.extension !== "md") return "unsynced";
    const record = this.data.syncedNotes[file.path];
    if (!record) return "unsynced";
    if (record.fileMtime < file.stat.mtime) return "modified";
    return "synced";
  }

  getFileSyncStatus(file: TFile): FileSyncStatus {
    return {
      path: file.path,
      status: this.getSyncStatus(file),
      record: this.data.syncedNotes[file.path],
    };
  }

  getAllFilesSyncStatus(): FileSyncStatus[] {
    const files = this.vault.getMarkdownFiles();
    return files
      .filter((f) => !this.isExcluded(f.path))
      .map((f) => this.getFileSyncStatus(f));
  }

  isExcluded(path: string): boolean {
    return this.settings.excludeFolders.some((folder) => {
      if (folder.endsWith("/")) return path.startsWith(folder);
      return path.startsWith(folder + "/") || path === folder;
    });
  }

  async syncFile(
    file: TFile,
    onProgress?: SyncProgressCallback
  ): Promise<FileSyncStatus> {
    try {
      onProgress?.(0, 1, file.path);

      const content = await this.vault.read(file);
      const title = file.basename;
      const record = this.data.syncedNotes[file.path];

      if (!record) {
        const result = await this.api.importDoc(content);
        let mediaId: string | undefined;

        if (this.settings.knowledgeBaseId) {
          try {
            const kbResult = await this.api.addKnowledge(
              result.note_id,
              title,
              this.settings.knowledgeBaseId
            );
            mediaId = kbResult.media_id;
          } catch (kbErr) {
            new Notice(
              `Note created but failed to add to KB: ${kbErr instanceof ImaApiError ? kbErr.message : "Unknown error"}`
            );
          }
        }

        this.data.syncedNotes[file.path] = {
          noteId: result.note_id,
          mediaId,
          syncedAt: Date.now(),
          fileMtime: file.stat.mtime,
        };
      } else {
        const prefix = this.settings.appendVersionPrefix
          ? `${this.settings.appendVersionPrefix} `
          : "";
        const now = new Date();
        const ts =
          `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ` +
          `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
        const appendContent = `\n\n---\n## ${prefix}Updated at ${ts}\n\n${content}`;

        await this.api.appendDoc(record.noteId, appendContent);

        this.data.syncedNotes[file.path] = {
          ...record,
          syncedAt: Date.now(),
          fileMtime: file.stat.mtime,
        };
      }

      await this.saveData();
      onProgress?.(1, 1, file.path);
      return { path: file.path, status: "synced", record: this.data.syncedNotes[file.path] };
    } catch (err) {
      const msg = err instanceof ImaApiError ? err.message : "Network error";
      onProgress?.(1, 1, file.path);
      return { path: file.path, status: "error", error: msg };
    }
  }

  async syncFiles(
    files: TFile[],
    onProgress?: SyncProgressCallback
  ): Promise<FileSyncStatus[]> {
    const results: FileSyncStatus[] = [];
    for (let i = 0; i < files.length; i++) {
      const result = await this.syncFile(files[i], onProgress);
      results.push(result);
    }
    return results;
  }

  async syncAll(onProgress?: SyncProgressCallback): Promise<FileSyncStatus[]> {
    const files = this.vault
      .getMarkdownFiles()
      .filter((f) => !this.isExcluded(f.path) && this.getSyncStatus(f) !== "synced");
    return this.syncFiles(files, onProgress);
  }

  getSyncStats(): { total: number; synced: number; modified: number; unsynced: number } {
    const files = this.vault
      .getMarkdownFiles()
      .filter((f) => !this.isExcluded(f.path));
    let synced = 0;
    let modified = 0;
    let unsynced = 0;

    for (const f of files) {
      const status = this.getSyncStatus(f);
      if (status === "synced") synced++;
      else if (status === "modified") modified++;
      else unsynced++;
    }

    return { total: files.length, synced, modified, unsynced };
  }

  removeRecord(path: string): void {
    delete this.data.syncedNotes[path];
    this.saveData();
  }
}
