import { MarkdownView, Notice, Plugin } from "obsidian";
import { writable } from "svelte/store";
import { CAPTURE_CHIPS, DEFAULT_SETTINGS, PLUGIN_ID, VIEW_TITLE, VIEW_TYPE } from "./constants";
import "./styles.css";
import { NexusSettingTab } from "./settings";
import { DailyNoteService } from "./services/daily-note-service";
import { GoalService } from "./services/goal-service";
import { TaskService } from "./services/task-service";
import type {
  CaptureEntry,
  GoalSummary,
  GoalTrackerStatus,
  ManagedTask,
  NexusSettings,
  NexusState,
  NexusViewController
} from "./types";
import { basenameWithoutExtension } from "./utils/paths";
import { ensurePluginNoMediaShield } from "./utils/no-media";
import { assertSafeFolderPath, assertSafeMarkdownPath, normalizeSettingsWritePaths } from "./utils/safe-write-paths";
import { NexusCommandView } from "./view/nexus-view";

type ParsedCaptureCommand =
  | { type: "capture"; text: string }
  | { type: "life-task"; text: string }
  | { type: "goal"; name: string }
  | { type: "tracker"; status: GoalTrackerStatus; goalName: string | null; note: string };

function createInitialState(settings: NexusSettings): NexusState {
  return {
    ready: false,
    loading: false,
    error: null,
    activeNoteName: null,
    captureChips: CAPTURE_CHIPS,
    settings,
    lifeTasks: [],
    goalTasks: [],
    goals: [],
    captures: [],
    blockers: [],
    suggestions: []
  };
}

function normalizeGoalToken(value: string, locale: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase(locale);
}

export default class NexusCommandPlugin extends Plugin implements NexusViewController {
  settings: NexusSettings = { ...DEFAULT_SETTINGS };
  readonly state = writable<NexusState>(createInitialState(DEFAULT_SETTINGS));
  latestState = createInitialState(DEFAULT_SETTINGS);

  private dailyNoteService!: DailyNoteService;
  private taskService!: TaskService;
  private goalService!: GoalService;
  private refreshTimer: number | null = null;
  private settingsCorrections: string[] = [];

  async onload(): Promise<void> {
    await this.loadSettings();

    try {
      await ensurePluginNoMediaShield(this.app, this.manifest.dir);
    } catch (error) {
      console.warn(`${PLUGIN_ID}: failed to create .nomedia shield`, error);
    }

    this.dailyNoteService = new DailyNoteService(this);
    this.taskService = new TaskService(this, this.dailyNoteService);
    this.goalService = new GoalService(this);

    this.registerView(VIEW_TYPE, (leaf) => new NexusCommandView(leaf, this));

    this.addRibbonIcon("blocks", VIEW_TITLE, () => {
      void this.openView();
    });

    this.addCommand({
      id: `${PLUGIN_ID}:open-view`,
      name: "Open Nexus Command",
      callback: () => {
        void this.openView();
      }
    });

    this.addSettingTab(new NexusSettingTab(this.app, this));

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.scheduleRefresh(80)));
    this.registerEvent(this.app.vault.on("create", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("modify", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleRefresh()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleRefresh()));

    if (this.settingsCorrections.length > 0) {
      new Notice("检测到危险写入路径，已自动重置为安全默认目录。");
    }

    await this.refreshState();
  }

  onunload(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  async openView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];

    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(false);
      await leaf.setViewState({
        type: VIEW_TYPE,
        active: true
      });
    }

    this.app.workspace.revealLeaf(leaf);
    await this.refreshState();
  }

  async refreshState(): Promise<void> {
    this.pushState({
      loading: true,
      error: null
    });

    try {
      const [lifeTasks, goals, captures] = await Promise.all([
        this.taskService.listLifeTasks(),
        this.goalService.listGoals(),
        this.dailyNoteService.listRecentCaptures()
      ]);
      const blockers = this.goalService.buildAgedBlockers(goals);
      const suggestions = this.goalService.buildSuggestions(goals, blockers);

      this.pushState({
        ready: true,
        loading: false,
        error: null,
        activeNoteName: this.getActiveNoteName(),
        captureChips: CAPTURE_CHIPS,
        settings: this.settings,
        lifeTasks,
        goalTasks: goals.filter((goal) => goal.status === "active").flatMap((goal) => goal.goalTasks),
        goals,
        captures,
        blockers,
        suggestions
      });
    } catch (error) {
      console.error(`${PLUGIN_ID}: refresh failed`, error);
      this.pushState({
        ready: true,
        loading: false,
        error: error instanceof Error ? error.message : "插件刷新失败。"
      });
    }
  }

  async submitCapture(input: {
    text: string;
    chipIds: string[];
    selectedGoalIndexPath?: string | null;
  }): Promise<void> {
    await this.runAction(async () => {
      const command = this.parseCaptureCommand(input.text);

      if (command.type === "capture") {
        await this.dailyNoteService.appendCapture(command.text, input.chipIds);
        return;
      }

      if (command.type === "life-task") {
        await this.taskService.createLifeTask(command.text, this.getActiveNoteName());
        return;
      }

      if (command.type === "goal") {
        await this.goalService.createGoal(command.name);
        return;
      }

      const goal = this.resolveGoalTarget(command.goalName, input.selectedGoalIndexPath ?? null);
      await this.goalService.submitTracker({
        goalIndexPath: goal.indexPath,
        status: command.status,
        note: command.note
      });
    }, "闪念处理失败。");
  }

  async markCaptureKept(capture: CaptureEntry): Promise<void> {
    await this.runAction(
      () => this.dailyNoteService.updateCaptureStatus(capture, "kept"),
      "闪念状态更新失败。"
    );
  }

  async convertCaptureToLifeTask(capture: CaptureEntry): Promise<void> {
    await this.runAction(async () => {
      await this.taskService.createLifeTask(capture.text, basenameWithoutExtension(capture.sourcePath));
      await this.dailyNoteService.updateCaptureStatus(capture, "life-task");
    }, "闪念转日常任务失败。");
  }

  async convertCaptureToGoalTask(capture: CaptureEntry, goalIndexPath: string): Promise<void> {
    await this.runAction(async () => {
      await this.taskService.createGoalTask(goalIndexPath, capture.text);
      await this.dailyNoteService.updateCaptureStatus(capture, "goal-task");
    }, "闪念转目标任务失败。");
  }

  async convertCaptureToGoalTracker(input: {
    capture: CaptureEntry;
    goalIndexPath: string;
    status: GoalTrackerStatus;
  }): Promise<void> {
    await this.runAction(async () => {
      await this.goalService.submitTracker({
        goalIndexPath: input.goalIndexPath,
        status: input.status,
        note: input.capture.text
      });
      await this.dailyNoteService.updateCaptureStatus(input.capture, `tracker-${input.status}`);
    }, "闪念转进展失败。");
  }

  async createLifeTask(text: string): Promise<void> {
    await this.runAction(
      () => this.taskService.createLifeTask(text, this.getActiveNoteName()),
      "日常任务创建失败。"
    );
  }

  async createGoalTask(goalIndexPath: string, text: string): Promise<void> {
    await this.runAction(() => this.taskService.createGoalTask(goalIndexPath, text), "目标任务创建失败。");
  }

  async toggleTask(task: ManagedTask, completed: boolean): Promise<void> {
    await this.runAction(() => this.taskService.toggleTask(task, completed), "任务状态同步失败。");
  }

  async createGoal(name: string): Promise<void> {
    await this.runAction(() => this.goalService.createGoal(name), "目标创建失败。");
  }

  async submitGoalTracker(input: {
    goalIndexPath: string;
    status: GoalTrackerStatus;
    note: string;
  }): Promise<void> {
    await this.runAction(() => this.goalService.submitTracker(input), "进度提交失败。");
  }

  async resolveBlocker(input: {
    goalIndexPath: string;
    blockerId: string;
    note: string;
  }): Promise<void> {
    await this.runAction(() => this.goalService.resolveBlocker(input), "卡点解决记录失败。");
  }

  async archiveGoal(goalIndexPath: string): Promise<void> {
    await this.runAction(() => this.goalService.archiveGoal(goalIndexPath), "目标归档失败。");
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData();
    const merged = {
      ...DEFAULT_SETTINGS,
      ...(loaded ?? {})
    };
    const normalized = normalizeSettingsWritePaths(this.app, merged, DEFAULT_SETTINGS);
    this.settings = normalized.settings;
    this.settingsCorrections = normalized.correctedFields;
    this.pushState({
      settings: this.settings
    });
  }

  async saveSettings(): Promise<void> {
    assertSafeFolderPath(this.app, this.settings.dailyNoteFolder, "Daily Note 文件夹");
    assertSafeMarkdownPath(this.app, this.settings.globalTodoPath, "全局待办路径");
    assertSafeFolderPath(this.app, this.settings.goalRootFolder, "目标根目录");
    await this.saveData(this.settings);
    this.pushState({
      settings: this.settings
    });
    this.scheduleRefresh(20);
  }

  private pushState(partial: Partial<NexusState>): void {
    this.latestState = {
      ...this.latestState,
      ...partial
    };
    this.state.set(this.latestState);
  }

  private scheduleRefresh(delay = 140): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = window.setTimeout(() => {
      void this.refreshState();
      this.refreshTimer = null;
    }, delay);
  }

  private async runAction(action: () => Promise<unknown>, fallbackMessage: string): Promise<void> {
    try {
      await action();
      await this.refreshState();
    } catch (error) {
      console.error(`${PLUGIN_ID}: action failed`, error);
      const message = error instanceof Error ? error.message : fallbackMessage;
      new Notice(message);
      this.pushState({
        error: message
      });
    }
  }

  private parseCaptureCommand(rawInput: string): ParsedCaptureCommand {
    const input = rawInput.trim();
    if (!input.startsWith("/")) {
      return {
        type: "capture",
        text: input
      };
    }

    const [commandToken, ...restParts] = input.split(" ");
    const command = commandToken.toLowerCase();
    const rest = restParts.join(" ").trim();

    if (!rest) {
      throw new Error("命令需要带内容。");
    }

    if (command === "/note") {
      return {
        type: "capture",
        text: rest
      };
    }

    if (command === "/todo") {
      return {
        type: "life-task",
        text: rest
      };
    }

    if (command === "/goal") {
      return {
        type: "goal",
        name: rest
      };
    }

    if (command === "/yellow" || command === "/green" || command === "/red") {
      const [goalNamePart, notePart] = rest.includes("|")
        ? rest.split("|", 2).map((part) => part.trim())
        : [null, rest];

      if (!notePart) {
        throw new Error("进展命令需要备注内容。");
      }

      return {
        type: "tracker",
        status: command.slice(1) as GoalTrackerStatus,
        goalName: goalNamePart,
        note: notePart
      };
    }

    throw new Error("未知命令。支持 /todo /goal /note /yellow /green /red");
  }

  private resolveGoalTarget(goalName: string | null, selectedGoalIndexPath: string | null): GoalSummary {
    const activeGoals = (this.latestState.goals ?? []).filter((goal) => goal.status === "active");
    const locale = this.settings.uiLocale || "zh-CN";

    if (goalName) {
      const normalized = normalizeGoalToken(goalName, locale);
      const exactMatch = activeGoals.find((goal) =>
        this.getGoalAliases(goal).some((alias) => normalizeGoalToken(alias, locale) === normalized)
      );
      if (exactMatch) {
        return exactMatch;
      }

      const fuzzyMatches = activeGoals.filter((goal) =>
        this.getGoalAliases(goal).some((alias) => {
          const candidate = normalizeGoalToken(alias, locale);
          return candidate.includes(normalized) || normalized.includes(candidate);
        })
      );
      if (fuzzyMatches.length === 1) {
        return fuzzyMatches[0];
      }

      if (fuzzyMatches.length > 1) {
        throw new Error(`目标名「${goalName}」不唯一，请写完整名称。`);
      }

      throw new Error(`未找到目标「${goalName}」。`);
    }

    if (selectedGoalIndexPath) {
      const selectedGoal = activeGoals.find((goal) => goal.indexPath === selectedGoalIndexPath);
      if (selectedGoal) {
        return selectedGoal;
      }
    }

    if (activeGoals.length === 1) {
      return activeGoals[0];
    }

    throw new Error("请先选择目标，或在命令里写成“目标名 | 内容”。");
  }

  private getActiveNoteName(): string | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view?.file?.basename ?? null;
  }

  private getGoalAliases(goal: GoalSummary): string[] {
    const folderName = goal.folderPath.split("/").pop() ?? goal.folderPath;
    const indexBaseName = basenameWithoutExtension(goal.indexPath).replace(/^_Index_/, "");

    return Array.from(
      new Set(
        [goal.name, goal.folderPath, folderName, indexBaseName]
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      )
    );
  }
}
