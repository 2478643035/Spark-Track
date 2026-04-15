import { Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import type { App } from "obsidian";
import { DEFAULT_SETTINGS } from "./constants";
import type { LifeTaskTarget, NexusSettings } from "./types";

export class NexusSettingTabV11 extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: Plugin & {
      settings: NexusSettings;
      saveSettings(): Promise<void>;
    }
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Nexus Command 设置" });

    new Setting(containerEl)
      .setName("Daily Note 文件夹")
      .setDesc("未启用 Daily Notes / Periodic Notes 时使用这个目录。")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.dailyNoteFolder)
          .setValue(this.plugin.settings.dailyNoteFolder)
          .onChange(async (value) => {
            this.plugin.settings.dailyNoteFolder = value.trim() || DEFAULT_SETTINGS.dailyNoteFolder;
            await this.persist();
          })
      );

    new Setting(containerEl)
      .setName("Daily Note 命名格式")
      .setDesc("回退模式下用于生成日记文件名，例如 YYYY-MM-DD。")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.dailyNoteFormat)
          .setValue(this.plugin.settings.dailyNoteFormat)
          .onChange(async (value) => {
            this.plugin.settings.dailyNoteFormat = value.trim() || DEFAULT_SETTINGS.dailyNoteFormat;
            await this.persist();
          })
      );

    new Setting(containerEl)
      .setName("日常任务默认目标")
      .setDesc("选择写入当日日记，还是独立的全局待办文件。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("daily-note", "Daily Note")
          .addOption("global-file", "全局待办文件")
          .setValue(this.plugin.settings.lifeTaskTarget)
          .onChange(async (value) => {
            this.plugin.settings.lifeTaskTarget = value as LifeTaskTarget;
            await this.persist();
          })
      );

    new Setting(containerEl)
      .setName("全局待办路径")
      .setDesc("必须是普通 Markdown 路径，不能指向源码或插件目录。")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.globalTodoPath)
          .setValue(this.plugin.settings.globalTodoPath)
          .onChange(async (value) => {
            this.plugin.settings.globalTodoPath = value.trim() || DEFAULT_SETTINGS.globalTodoPath;
            await this.persist();
          })
      );

    new Setting(containerEl)
      .setName("战略目标根目录")
      .setDesc("目标文件夹都会创建在这里。请不要填 src/、dist/、.obsidian/plugins/ 这类目录。")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.goalRootFolder)
          .setValue(this.plugin.settings.goalRootFolder)
          .onChange(async (value) => {
            this.plugin.settings.goalRootFolder = value.trim() || DEFAULT_SETTINGS.goalRootFolder;
            await this.persist();
          })
      );

    new Setting(containerEl)
      .setName("界面区域")
      .setDesc("用于日期和时间的本地化展示。")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.uiLocale)
          .setValue(this.plugin.settings.uiLocale)
          .onChange(async (value) => {
            this.plugin.settings.uiLocale = value.trim() || DEFAULT_SETTINGS.uiLocale;
            await this.persist();
          })
      );
  }

  private async persist(): Promise<void> {
    try {
      await this.plugin.saveSettings();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "设置保存失败。");
      this.display();
    }
  }
}
