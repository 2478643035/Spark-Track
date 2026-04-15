import { Plugin, PluginSettingTab, Setting } from "obsidian";
import type { App } from "obsidian";
import { DEFAULT_SETTINGS } from "./constants";
import type { NexusSettings } from "./types";
import type { LifeTaskTarget } from "./types";

export class NexusSettingTab extends PluginSettingTab {
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
      .setDesc("当未启用官方 Daily Notes 或 Periodic Notes 时，作为回退目录。")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.dailyNoteFolder)
          .setValue(this.plugin.settings.dailyNoteFolder)
          .onChange(async (value) => {
            this.plugin.settings.dailyNoteFolder = value.trim() || DEFAULT_SETTINGS.dailyNoteFolder;
            await this.plugin.saveSettings();
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
            await this.plugin.saveSettings();
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
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("全局待办路径")
      .setDesc("当日常任务目标设为全局文件时，任务会写入这里。")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.globalTodoPath)
          .setValue(this.plugin.settings.globalTodoPath)
          .onChange(async (value) => {
            this.plugin.settings.globalTodoPath = value.trim() || DEFAULT_SETTINGS.globalTodoPath;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("战略目标根目录")
      .setDesc("所有目标文件夹与索引文件都会创建在此目录下。")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.goalRootFolder)
          .setValue(this.plugin.settings.goalRootFolder)
          .onChange(async (value) => {
            this.plugin.settings.goalRootFolder = value.trim() || DEFAULT_SETTINGS.goalRootFolder;
            await this.plugin.saveSettings();
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
            await this.plugin.saveSettings();
          })
      );
  }
}
