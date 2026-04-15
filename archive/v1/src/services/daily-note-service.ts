import { TFile, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { CONTROLLED_BLOCKS } from "../constants";
import type NexusCommandPlugin from "../main";
import { appendToBlock } from "../utils/blocks";
import { formatDateToken, getDateTimeStamp } from "../utils/date";
import { ensureMarkdownFile } from "../utils/vault";

type DailyNoteConfig = {
  folder: string;
  format: string;
};

export class DailyNoteService {
  constructor(private readonly plugin: NexusCommandPlugin) {}

  getPreferredPath(date: Date = new Date()): string {
    const config = this.resolveDailyNoteConfig();
    const fileName = `${formatDateToken(date, config.format)}.md`;
    return normalizePath(config.folder ? `${config.folder}/${fileName}` : fileName);
  }

  async getDailyNoteFile(date: Date = new Date(), create = false): Promise<TFile | null> {
    const path = this.getPreferredPath(date);
    const existing = this.plugin.app.vault.getAbstractFileByPath(path);

    if (existing instanceof TFile) {
      return existing;
    }

    if (!create) {
      return null;
    }

    return ensureMarkdownFile(this.plugin.app, path, "");
  }

  async appendCapture(text: string, chipIds: string[]): Promise<void> {
    const normalizedText = text.trim();
    if (!normalizedText) {
      return;
    }

    const file = await this.getDailyNoteFile(new Date(), true);
    if (!file) {
      throw new Error("无法创建当日日记。");
    }
    const chipLabels = chipIds
      .map((chipId) => this.plugin.latestState.captureChips.find((chip) => chip.id === chipId)?.label)
      .filter((chip): chip is string => Boolean(chip));
    const chipString = chipLabels.length > 0 ? chipLabels.join(" ") : "#闪念";
    const calloutLines = [
      `> [!note] ${getDateTimeStamp(new Date())}`,
      `> [${chipString}] ${normalizedText}`
    ];

    await this.plugin.app.vault.process(file, (content) =>
      appendToBlock(content, CONTROLLED_BLOCKS.capture, calloutLines)
    );
  }

  private resolveDailyNoteConfig(): DailyNoteConfig {
    const official = this.resolveOfficialDailyNotes();
    if (official) {
      return official;
    }

    const periodic = this.resolvePeriodicNotes();
    if (periodic) {
      return periodic;
    }

    return {
      folder: this.plugin.settings.dailyNoteFolder,
      format: this.plugin.settings.dailyNoteFormat
    };
  }

  private resolveOfficialDailyNotes(): DailyNoteConfig | null {
    const appWithInternals = this.plugin.app as App & {
      internalPlugins?: {
        getPluginById?: (id: string) => {
          enabled?: boolean;
          instance?: { options?: { folder?: string; format?: string } };
        };
        plugins?: Record<
          string,
          {
            enabled?: boolean;
            instance?: { options?: { folder?: string; format?: string } };
          }
        >;
      };
    };

    const plugin =
      appWithInternals.internalPlugins?.getPluginById?.("daily-notes") ??
      appWithInternals.internalPlugins?.plugins?.["daily-notes"];

    if (!plugin?.enabled || !plugin.instance?.options) {
      return null;
    }

    return {
      folder: plugin.instance.options.folder ?? this.plugin.settings.dailyNoteFolder,
      format: plugin.instance.options.format ?? this.plugin.settings.dailyNoteFormat
    };
  }

  private resolvePeriodicNotes(): DailyNoteConfig | null {
    const appWithPlugins = this.plugin.app as App & {
      plugins?: {
        plugins?: Record<
          string,
          {
            settings?: {
              dailyNotes?: {
                folder?: string;
                format?: string;
              };
            };
          }
        >;
      };
    };

    const plugin = appWithPlugins.plugins?.plugins?.["periodic-notes"];
    const settings = plugin?.settings?.dailyNotes;

    if (!settings) {
      return null;
    }

    return {
      folder: settings.folder ?? this.plugin.settings.dailyNoteFolder,
      format: settings.format ?? this.plugin.settings.dailyNoteFormat
    };
  }
}
