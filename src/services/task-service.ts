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
    const file = await this.resolveLifeTaskFile(false, { preferActiveNote: true });
    if (!file) {
      return [];
    }

    return this.readTasksFromFile(file, "life");
  }

  async createLifeTask(
    text: string,
    sourceNoteName: string | null,
    taskId = createTaskId()
  ): Promise<ManagedTask | null> {
    const normalizedText = text.trim();
    if (!normalizedText) {
      return null;
    }

    const file = await this.resolveLifeTaskFile(true, { preferActiveNote: true });
    if (!file) {
      throw new Error("无法定位日常任务文件。");
    }

    const suffix = sourceNoteName ? ` [来源：[[${sourceNoteName}]]]` : "";
    const taskText = `${normalizedText}${suffix}`;
    const line = renderTaskLine({
      text: taskText,
      taskId
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

    return {
      id: taskId,
      text: taskText,
      completed: false,
      targetPath: file.path,
      blockType: "life"
    };
  }

  async createGoalTask(goalIndexPath: string, text: string, taskId = createTaskId()): Promise<ManagedTask | null> {
    const normalizedText = text.trim();
    if (!normalizedText) {
      return null;
    }

    const file = this.plugin.app.vault.getAbstractFileByPath(goalIndexPath);
    if (!(file instanceof TFile)) {
      throw new Error("目标索引文件不存在。");
    }

    const line = renderTaskLine({
      text: normalizedText,
      taskId
    });

    await this.plugin.app.vault.process(file, (content) => {
      const existingTasks = parseTaskLines({
        body: readBlock(content, CONTROLLED_BLOCKS.goalTasks) ?? "",
        targetPath: file.path,
        blockType: "goal"
      });
      const nextBody = [
        line,
        ...existingTasks.map((task) =>
          renderTaskLine({
            completed: task.completed,
            text: task.text,
            taskId: task.id
          })
        )
      ].join("\n");

      return replaceBlock(content, CONTROLLED_BLOCKS.goalTasks, nextBody);
    });

    return {
      id: taskId,
      text: normalizedText,
      completed: false,
      targetPath: file.path,
      blockType: "goal"
    };
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

  async deleteTask(task: ManagedTask): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(task.targetPath);
    if (!(file instanceof TFile)) {
      return;
    }

    const spec = this.getSpec(task.blockType);

    await this.plugin.app.vault.process(file, (content) => {
      const existingTasks = parseTaskLines({
        body: readBlock(content, spec) ?? "",
        targetPath: file.path,
        blockType: task.blockType,
        goalName: task.goalName
      });

      const nextBody = this.renderTaskBlock(existingTasks.filter((entry) => entry.id !== task.id));
      return replaceBlock(content, spec, nextBody);
    });
  }

  async reorderTasks(tasks: ManagedTask[]): Promise<void> {
    if (tasks.length === 0) {
      return;
    }

    const [firstTask] = tasks;
    const file = this.plugin.app.vault.getAbstractFileByPath(firstTask.targetPath);
    if (!(file instanceof TFile)) {
      return;
    }

    const sameBlock = tasks.every(
      (task) => task.targetPath === firstTask.targetPath && task.blockType === firstTask.blockType
    );
    if (!sameBlock) {
      throw new Error("任务重排必须在同一个任务区块内完成。");
    }

    const spec = this.getSpec(firstTask.blockType);

    await this.plugin.app.vault.process(file, (content) =>
      replaceBlock(content, spec, this.renderTaskBlock(tasks))
    );
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

  private async resolveLifeTaskFile(
    create: boolean,
    options: { preferActiveNote?: boolean } = {}
  ): Promise<TFile | null> {
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

    if (options.preferActiveNote) {
      const activeFile = await this.resolveActiveLifeTaskFile();
      if (activeFile) {
        return activeFile;
      }
    }

    return this.dailyNoteService.getDailyNoteFile(new Date(), create);
  }

  private async resolveActiveLifeTaskFile(): Promise<TFile | null> {
    const file = this.plugin.getActiveMarkdownFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      return null;
    }

    const preferredPath = this.dailyNoteService.getPreferredPath(new Date());
    if (file.path === preferredPath) {
      return file;
    }

    const content = await this.plugin.app.vault.cachedRead(file);
    return readBlock(content, CONTROLLED_BLOCKS.lifeTasks) === null ? null : file;
  }

  private getSpec(blockType: TaskBlockType) {
    return blockType === "life" ? CONTROLLED_BLOCKS.lifeTasks : CONTROLLED_BLOCKS.goalTasks;
  }

  private renderTaskBlock(tasks: ManagedTask[]): string {
    return tasks
      .map((task) =>
        renderTaskLine({
          completed: task.completed,
          text: task.text,
          taskId: task.id
        })
      )
      .join("\n");
  }
}
