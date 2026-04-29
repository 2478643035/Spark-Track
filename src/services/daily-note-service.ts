import { TFile, normalizePath } from "obsidian";
import type { App } from "obsidian";
import { CONTROLLED_BLOCKS } from "../constants";
import { CAPTURE_LIMIT, CAPTURE_LOOKBACK_DAYS } from "../runtime-constants";
import type NexusCommandPlugin from "../main";
import type { CaptureEntry, CaptureTriageStatus } from "../types";
import { readBlock, replaceBlock } from "../utils/blocks";
import { parseCaptureEntries, renderCaptureEntry } from "../utils/captures";
import { createCaptureId, formatDateToken, getDateTimeStamp } from "../utils/date";
import { assertSafeFolderPath } from "../utils/safe-write-paths";
import { ensureMarkdownFile } from "../utils/vault";

type DailyNoteConfig = {
  folder: string;
  format: string;
};

const DAILY_LIFE_TASK_FILE_NAME = "日常任务.md";

export class DailyNoteService {
  constructor(private readonly plugin: NexusCommandPlugin) {}

  getPreferredPath(date: Date = new Date()): string {
    const config = this.resolveDailyNoteConfig();
    const fileName = `${formatDateToken(date, config.format)}.md`;
    const safeFolder = config.folder
      ? assertSafeFolderPath(this.plugin.app, config.folder, "Daily Note 文件夹")
      : "";
    return normalizePath(safeFolder ? `${safeFolder}/${fileName}` : fileName);
  }

  getDailyLifeTaskPath(): string {
    return normalizePath(`${this.getDailyLifeTaskFolder()}/${DAILY_LIFE_TASK_FILE_NAME}`);
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

  async getDailyLifeTaskFile(create = false): Promise<TFile | null> {
    const path = this.getDailyLifeTaskPath();
    const existing = this.plugin.app.vault.getAbstractFileByPath(path);

    if (existing instanceof TFile) {
      return existing;
    }

    if (!create) {
      return null;
    }

    return ensureMarkdownFile(this.plugin.app, path, "");
  }

  async listRecentDailyLifeTaskFiles(): Promise<TFile[]> {
    const files: TFile[] = [];
    const seenPaths = new Set<string>();

    const singleTaskFile = await this.getDailyLifeTaskFile(false);
    if (singleTaskFile) {
      files.push(singleTaskFile);
      seenPaths.add(singleTaskFile.path);
    }

    for (let offset = 0; offset < CAPTURE_LOOKBACK_DAYS; offset += 1) {
      const date = this.shiftDate(new Date(), -offset);
      const datedTaskFile = await this.getDatedDailyLifeTaskFile(date, false);
      if (datedTaskFile && !seenPaths.has(datedTaskFile.path)) {
        files.push(datedTaskFile);
        seenPaths.add(datedTaskFile.path);
      }

      const dailyFile = await this.getDailyNoteFile(date, false);
      if (dailyFile && !seenPaths.has(dailyFile.path)) {
        files.push(dailyFile);
        seenPaths.add(dailyFile.path);
      }
    }

    return files;
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
    const entry: CaptureEntry = {
      id: createCaptureId(),
      timestamp: getDateTimeStamp(new Date()),
      chipLabels,
      text: normalizedText,
      triageStatus: "pending",
      sourcePath: file.path
    };

    await this.plugin.app.vault.process(file, (content) => {
      const existingEntries = parseCaptureEntries(readBlock(content, CONTROLLED_BLOCKS.capture) ?? "", file.path);
      const nextEntries = [...existingEntries, entry];

      return replaceBlock(
        content,
        CONTROLLED_BLOCKS.capture,
        nextEntries.map((capture) => renderCaptureEntry(capture)).join("\n\n")
      );
    });
  }

  async listRecentCaptures(): Promise<CaptureEntry[]> {
    const captures: CaptureEntry[] = [];

    for (let offset = 0; offset < CAPTURE_LOOKBACK_DAYS; offset += 1) {
      const file = await this.getDailyNoteFile(this.shiftDate(new Date(), -offset), false);
      if (!file) {
        continue;
      }

      const content = await this.plugin.app.vault.read(file);
      const blockBody = readBlock(content, CONTROLLED_BLOCKS.capture);
      if (!blockBody) {
        continue;
      }

      captures.push(...parseCaptureEntries(blockBody, file.path));
    }

    return captures
      .map((capture) => ({
        ...capture,
        triageStatus: this.plugin.getCaptureTriageStatus(capture.id) ?? capture.triageStatus
      }))
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
      .slice(0, CAPTURE_LIMIT);
  }

  async updateCaptureStatus(
    capture: Pick<CaptureEntry, "id" | "sourcePath">,
    triageStatus: CaptureTriageStatus
  ): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(capture.sourcePath);
    if (!(file instanceof TFile)) {
      throw new Error("闪念来源文件不存在。");
    }

    await this.plugin.app.vault.process(file, (content) => {
      const blockBody = readBlock(content, CONTROLLED_BLOCKS.capture);
      if (!blockBody) {
        return content;
      }

      const entries = parseCaptureEntries(blockBody, file.path).map((entry) =>
        entry.id === capture.id ? { ...entry, triageStatus } : entry
      );

      return replaceBlock(
        content,
        CONTROLLED_BLOCKS.capture,
        entries.map((entry) => renderCaptureEntry(entry)).join("\n\n")
      );
    });

    await this.plugin.setCaptureTriageStatus(capture.id, triageStatus);
  }

  async deleteCapture(capture: Pick<CaptureEntry, "id" | "sourcePath">): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(capture.sourcePath);
    if (!(file instanceof TFile)) {
      throw new Error("闪念来源文件不存在。");
    }

    await this.plugin.app.vault.process(file, (content) => {
      const blockBody = readBlock(content, CONTROLLED_BLOCKS.capture);
      if (!blockBody) {
        return content;
      }

      const entries = parseCaptureEntries(blockBody, file.path).filter((entry) => entry.id !== capture.id);

      return replaceBlock(
        content,
        CONTROLLED_BLOCKS.capture,
        entries.map((entry) => renderCaptureEntry(entry)).join("\n\n")
      );
    });

    await this.plugin.setCaptureTriageStatus(capture.id, "pending");
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

  private shiftDate(date: Date, offsetDays: number): Date {
    const shifted = new Date(date);
    shifted.setDate(shifted.getDate() + offsetDays);
    return shifted;
  }

  private getDailyLifeTaskFolder(): string {
    const config = this.resolveDailyNoteConfig();
    const safeFolder = config.folder
      ? assertSafeFolderPath(this.plugin.app, config.folder, "Daily task folder")
      : "";
    return safeFolder ? `${safeFolder}/Actions` : "Actions";
  }

  private getDatedDailyLifeTaskPath(date: Date): string {
    const config = this.resolveDailyNoteConfig();
    const fileName = `${formatDateToken(date, config.format)}-actions.md`;
    return normalizePath(`${this.getDailyLifeTaskFolder()}/${fileName}`);
  }

  private async getDatedDailyLifeTaskFile(date: Date, create = false): Promise<TFile | null> {
    const path = this.getDatedDailyLifeTaskPath(date);
    const existing = this.plugin.app.vault.getAbstractFileByPath(path);

    if (existing instanceof TFile) {
      return existing;
    }

    if (!create) {
      return null;
    }

    return ensureMarkdownFile(this.plugin.app, path, "");
  }
}
