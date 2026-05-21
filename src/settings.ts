import { PluginSettingTab, Setting, App, Plugin, Notice } from "obsidian";

export interface ObsidianToIMASettings {
  clientId: string;
  apiKey: string;
  knowledgeBaseId: string;
  autoSyncOnSave: boolean;
  excludeFolders: string[];
  appendVersionPrefix: string;
}

export const DEFAULT_SETTINGS: ObsidianToIMASettings = {
  clientId: "",
  apiKey: "",
  knowledgeBaseId: "",
  autoSyncOnSave: false,
  excludeFolders: [],
  appendVersionPrefix: "",
};

export class SettingsTab extends PluginSettingTab {
  private plugin: Plugin & {
    settings: ObsidianToIMASettings;
    testApiConnection: () => Promise<{ ok: boolean; message: string }>;
    listKnowledgeBases: () => Promise<Array<{ id: string; name: string }>>;
    saveSettings: () => Promise<void>;
  };
  private testStatusEl: HTMLElement;
  private kbDropdownEl: HTMLSelectElement | null = null;

  constructor(
    app: App,
    plugin: Plugin & {
      settings: ObsidianToIMASettings;
      testApiConnection: () => Promise<{ ok: boolean; message: string }>;
      listKnowledgeBases: () => Promise<Array<{ id: string; name: string }>>;
      saveSettings: () => Promise<void>;
    }
  ) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Obsidian to IMA Settings" });

    containerEl.createEl("h3", { text: "IMA API Credentials" });

    new Setting(containerEl)
      .setName("Client ID")
      .setDesc("IMA OpenAPI Client ID from https://ima.qq.com/agent-interface")
      .addText((text) =>
        text
          .setPlaceholder("Enter Client ID")
          .setValue(this.plugin.settings.clientId)
          .onChange(async (value) => {
            this.plugin.settings.clientId = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("API Key")
      .setDesc("IMA OpenAPI API Key")
      .addText((text) => {
        text
          .setPlaceholder("Enter API Key")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
      });

    this.testStatusEl = containerEl.createEl("div", {
      cls: "ima-test-status",
    });

    new Setting(containerEl)
      .setName("Test API Connection")
      .setDesc("Verify your Client ID and API Key are valid")
      .addButton((btn) =>
        btn
          .setButtonText("Test Connection")
          .setCta()
          .onClick(async () => {
            btn.setButtonText("Testing...");
            btn.setDisabled(true);
            this.testStatusEl.textContent = "";
            this.testStatusEl.removeClass("ima-test-ok", "ima-test-fail");

            const result = await this.plugin.testApiConnection();

            this.testStatusEl.textContent = result.message;
            this.testStatusEl.addClass(result.ok ? "ima-test-ok" : "ima-test-fail");
            btn.setButtonText("Test Connection");
            btn.setDisabled(false);
          })
      );

    containerEl.createEl("h3", { text: "Sync Target" });

    const kbSetting = new Setting(containerEl)
      .setName("Knowledge Base (optional)")
      .setDesc(
        "Sync notes to this knowledge base. Click Refresh to load the list. Leave empty to only create IMA notes."
      );

    kbSetting.addDropdown((dropdown) => {
      dropdown.addOption("", "— None —");
      dropdown.setValue(this.plugin.settings.knowledgeBaseId || "");
      dropdown.onChange(async (value) => {
        this.plugin.settings.knowledgeBaseId = value;
        await this.plugin.saveSettings();
      });
      this.kbDropdownEl = dropdown.selectEl;
    });

    kbSetting.addButton((btn) =>
      btn
        .setButtonText("Refresh")
        .onClick(async () => {
          btn.setDisabled(true);
          btn.setButtonText("Loading...");
          try {
            const kbs = await this.plugin.listKnowledgeBases();
            const el = this.kbDropdownEl;
            if (!el) return;
            el.empty();
            const noneOpt = el.createEl("option");
            noneOpt.value = "";
            noneOpt.text = "— None —";
            for (const kb of kbs) {
              const opt = el.createEl("option");
              opt.value = kb.id;
              opt.text = kb.name;
            }
            if (this.plugin.settings.knowledgeBaseId) {
              el.value = this.plugin.settings.knowledgeBaseId;
            }
            new Notice(`Found ${kbs.length} knowledge bases.`);
          } catch {
            new Notice("Failed to fetch. Check credentials first.");
          } finally {
            btn.setDisabled(false);
            btn.setButtonText("Refresh");
          }
        })
    );

    containerEl.createEl("h3", { text: "Sync Behavior" });

    new Setting(containerEl)
      .setName("Auto-sync on save")
      .setDesc("Automatically append changes to IMA when a note is saved")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoSyncOnSave)
          .onChange(async (value) => {
            this.plugin.settings.autoSyncOnSave = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Exclude folders")
      .setDesc("Folder paths to exclude from sync (one per line)")
      .addTextArea((text) =>
        text
          .setPlaceholder("templates/\ndaily/\narchive/")
          .setValue(this.plugin.settings.excludeFolders.join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.excludeFolders = value
              .split("\n")
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Append version prefix")
      .setDesc(
        "Text to prepend before the timestamp when appending updates (e.g., 'v2', 'Update')"
      )
      .addText((text) =>
        text
          .setPlaceholder("e.g. v2")
          .setValue(this.plugin.settings.appendVersionPrefix)
          .onChange(async (value) => {
            this.plugin.settings.appendVersionPrefix = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
