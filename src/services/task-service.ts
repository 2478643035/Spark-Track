import { TFile } from "obsidian";
import { CONTROLLED_BLOCKS } from "../constants";
import type NexusCommandPlugin from "../main";
import type { ManagedTask, TaskBlockType } from "../types";
import { readBlock, replaceBlock } from "../utils/blocks";
import { createTaskId } from "../utils/date";
import { ensureMdExtension } from "../utils/paths";
import { assertSafeMarkdownPath } from "../utils/safe-write-paths";
import { hasTaskId, parseTaskLines, renderTaskLine, toggleTaskLine } from "../utils/tasks";
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

    await this.plugin.app.vault.process(file, (content) => {
      const existingTasks = parseTaskLines({
        body: readBlock(content, CONTROLLED_BLOCKS.lifeTasks) ?? "",
        targetPath: file.path,
        blockType: "life"
      });
      const nextBody = [
        ...existingTasks.map((task) =>
          renderTaskLine({
            completed: task.completed,
            text: task.text,
            taskId: task.id
          })
        ),
        line
      ].join("\n");

      return replaceBlock(content, CONTROLLED_BLOCKS.lifeTasks, nextBody);
    });
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

    await this.plugin.app.vault.process(file, (content) => {
      const existingTasks = parseTaskLines({
        body: readBlock(content, CONTROLLED_BLOCKS.goalTasks) ?? "",
        targetPath: file.path,
        blockType: "goal"
      });
      const nextBody = [
        ...existingTasks.map((task) =>
          renderTaskLine({
            completed: task.completed,
            text: task.text,
            taskId: task.id
          })
        ),
        line
      ].join("\n");

      return replaceBlock(content, CONTROLLED_BLOCKS.goalTasks, nextBody);
    });
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
        .map((line) => (hasTaskId(line, task.id) ? toggleTaskLine(line, completed) : line));
      const normalizedLines = updatedLines
        .map((line) => {
          const trimmed = line.trim();
          const match = trimmed.match(/^- \[( |x)\] (.*?)(?:\s*(?:<!--\s*nexus:task-id=([A-Za-z0-9-]+)\s*-->|(\^[A-Za-z0-9-]+)))?\s*$/);
          if (!match) {
            return line;
          }

          const nextTaskId = match[3] ?? match[4]?.slice(1);
          if (!nextTaskId) {
            return line;
          }

          return renderTaskLine({
            completed: match[1] === "x",
            text: match[2].trim(),
            taskId: nextTaskId
          });
        })
        .join("\n");

      return replaceBlock(content, spec, normalizedLines);
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
      const targetPath = ensureMdExtension(
        assertSafeMarkdownPath(this.plugin.app, this.plugin.settings.globalTodoPath, "全局待办路径")
      );
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
