import { TFile } from "obsidian";
import { CONTROLLED_BLOCKS } from "../constants";
import type NexusCommandPlugin from "../main";
import type { ManagedTask, TaskBlockType } from "../types";
import { appendToBlock, readBlock, replaceBlock } from "../utils/blocks";
import { createTaskId } from "../utils/date";
import { ensureMdExtension } from "../utils/paths";
import { parseTaskLines, renderTaskLine, toggleTaskLine } from "../utils/tasks";
import { ensureMarkdownFile } from "../utils/vault";
import { DailyNoteService } from "./daily-note-service";

export class TaskService {
  constructor(
    private readonly plugin: NexusCommandPlugin,
    private readonly dailyNoteService: DailyNoteService
  ) {}

  async listLifeTasks(): Promise<ManagedTask[]> {
    const file = await this.resolveLifeTaskFile(false);
    if (!file) {
      return [];
    }

    return this.readTasksFromFile(file, "life");
  }

  async createLifeTask(text: string, sourceNoteName: string | null): Promise<void> {
    const normalizedText = text.trim();
    if (!normalizedText) {
      return;
    }

    const file = await this.resolveLifeTaskFile(true);
    if (!file) {
      throw new Error("无法定位日常任务文件。");
    }
    const suffix = sourceNoteName ? ` [来源：[[${sourceNoteName}]]]` : "";
    const line = renderTaskLine({
      text: `${normalizedText}${suffix}`,
      taskId: createTaskId()
    });

    await this.plugin.app.vault.process(file, (content) =>
      appendToBlock(content, CONTROLLED_BLOCKS.lifeTasks, [line])
    );
  }

  async createGoalTask(goalIndexPath: string, text: string): Promise<void> {
    const normalizedText = text.trim();
    if (!normalizedText) {
      return;
    }

    const file = this.plugin.app.vault.getAbstractFileByPath(goalIndexPath);
    if (!(file instanceof TFile)) {
      throw new Error("目标索引文件不存在。");
    }

    const line = renderTaskLine({
      text: normalizedText,
      taskId: createTaskId()
    });

    await this.plugin.app.vault.process(file, (content) =>
      appendToBlock(content, CONTROLLED_BLOCKS.goalTasks, [line])
    );
  }

  async toggleTask(task: ManagedTask, completed: boolean): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(task.targetPath);
    if (!(file instanceof TFile)) {
      return;
    }

    const spec = task.blockType === "life" ? CONTROLLED_BLOCKS.lifeTasks : CONTROLLED_BLOCKS.goalTasks;

    await this.plugin.app.vault.process(file, (content) => {
      const blockBody = readBlock(content, spec);
      if (blockBody === null) {
        return content;
      }

      const updatedLines = blockBody
        .split("\n")
        .map((line) =>
          line.includes(`nexus:task-id=${task.id}`) ? toggleTaskLine(line, completed) : line
        )
        .join("\n");

      return replaceBlock(content, spec, updatedLines);
    });
  }

  readTasksFromFile(
    file: TFile,
    blockType: TaskBlockType,
    goalName?: string
  ): Promise<ManagedTask[]> {
    return this.plugin.app.vault.read(file).then((content) => {
      const spec = blockType === "life" ? CONTROLLED_BLOCKS.lifeTasks : CONTROLLED_BLOCKS.goalTasks;
      const body = readBlock(content, spec) ?? "";
      return parseTaskLines({
        body,
        targetPath: file.path,
        blockType,
        goalName
      });
    });
  }

  private async resolveLifeTaskFile(create: boolean): Promise<TFile | null> {
    if (this.plugin.settings.lifeTaskTarget === "global-file") {
      const targetPath = ensureMdExtension(this.plugin.settings.globalTodoPath);
      const existing = this.plugin.app.vault.getAbstractFileByPath(targetPath);
      if (existing instanceof TFile) {
        return existing;
      }

      if (!create) {
        return null;
      }

      return ensureMarkdownFile(this.plugin.app, targetPath, "");
    }

    return this.dailyNoteService.getDailyNoteFile(new Date(), create);
  }
}
