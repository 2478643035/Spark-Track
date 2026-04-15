import { MarkdownView, Notice, Plugin } from "obsidian";
import { writable } from "svelte/store";
import { CAPTURE_CHIPS, DEFAULT_SETTINGS, PLUGIN_ID, VIEW_TITLE, VIEW_TYPE } from "./constants";
import "./styles.css";
import { DailyNoteService } from "./services/daily-note-service";
import { GoalService } from "./services/goal-service";
import { TaskService } from "./services/task-service";
import { NexusSettingTab } from "./settings";
import type { ManagedTask, NexusSettings, NexusState, NexusViewController } from "./types";
import { NexusCommandView } from "./view/nexus-view";

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
    goals: []
  };
}

export default class NexusCommandPlugin extends Plugin {
  settings: NexusSettings = { ...DEFAULT_SETTINGS };
  readonly state = writable<NexusState>(createInitialState(DEFAULT_SETTINGS));
  latestState = createInitialState(DEFAULT_SETTINGS);

  private dailyNoteService!: DailyNoteService;
  private taskService!: TaskService;
  private goalService!: GoalService;
  private refreshTimer: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.dailyNoteService = new DailyNoteService(this);
    this.taskService = new TaskService(this, this.dailyNoteService);
    this.goalService = new GoalService(this);

    this.registerView(VIEW_TYPE, (leaf) => new NexusCommandView(leaf, this as unknown as NexusViewController));

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
      const [lifeTasks, goals] = await Promise.all([
        this.taskService.listLifeTasks(),
        this.goalService.listGoals()
      ]);

      this.pushState({
        ready: true,
        loading: false,
        error: null,
        activeNoteName: this.getActiveNoteName(),
        captureChips: CAPTURE_CHIPS,
        settings: this.settings,
        lifeTasks,
        goalTasks: goals.filter((goal) => goal.status === "active").flatMap((goal) => goal.goalTasks),
        goals
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

  async submitCapture(input: { text: string; chipIds: string[] }): Promise<void> {
    await this.runAction(() => this.dailyNoteService.appendCapture(input.text, input.chipIds), "闪念写入失败。");
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
    status: "yellow" | "green" | "red";
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
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(loaded ?? {})
    };
    this.pushState({
      settings: this.settings
    });
  }

  async saveSettings(): Promise<void> {
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

  private getActiveNoteName(): string | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view?.file?.basename ?? null;
  }
}
