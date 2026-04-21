import { MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { writable } from "svelte/store";
import { CAPTURE_CHIPS, DEFAULT_SETTINGS, PLUGIN_ID, VIEW_TITLE, VIEW_TYPE } from "./constants";
import "./styles.css";
import { NexusSettingTab } from "./settings";
import { DailyNoteService } from "./services/daily-note-service";
import { GoalService } from "./services/goal-service";
import { TaskService } from "./services/task-service";
import type {
  CaptureEntry,
  CaptureTriageStatus,
  GoalSummary,
  GoalTrackerStatus,
  ManagedTask,
  NexusPluginData,
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
    suggestions: [],
    review: null
  };
}

function normalizeGoalToken(value: string, locale: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase(locale);
}

export default class NexusCommandPlugin extends Plugin implements NexusViewController {
  settings: NexusSettings = { ...DEFAULT_SETTINGS };
  captureTriage: Record<string, CaptureTriageStatus> = {};
  readonly state = writable<NexusState>(createInitialState(DEFAULT_SETTINGS));
  latestState = createInitialState(DEFAULT_SETTINGS);

  private dailyNoteService!: DailyNoteService;
  private taskService!: TaskService;
  private goalService!: GoalService;
  private refreshTimer: number | null = null;
  private settingsCorrections: string[] = [];
  private activeMarkdownFile: TFile | null = null;

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

    this.updateActiveMarkdownFile();

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.updateActiveMarkdownFile();
        this.scheduleRefresh(80);
      })
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        this.updateActiveMarkdownFile();
        this.scheduleRefresh(80);
      })
    );
    this.registerEvent(this.app.vault.on("create", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("modify", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleRefresh()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleRefresh()));

    if (this.settingsCorrections.length > 0) {
      new Notice("Unsafe write paths were reset to safe defaults.");
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
      const review = this.goalService.buildWeeklyReview(goals, blockers, suggestions);

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
        suggestions,
        review
      });
    } catch (error) {
      console.error(`${PLUGIN_ID}: refresh failed`, error);
      this.pushState({
        ready: true,
        loading: false,
        error: error instanceof Error ? error.message : "Plugin refresh failed."
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
    }, "Capture processing failed.");
  }

  async markCaptureKept(capture: CaptureEntry): Promise<void> {
    await this.runAction(() => this.dailyNoteService.updateCaptureStatus(capture, "kept"), "Capture update failed.");
  }

  async deleteCapture(capture: CaptureEntry): Promise<void> {
    await this.runAction(() => this.dailyNoteService.deleteCapture(capture), "Capture deletion failed.");
  }

  async convertCaptureToLifeTask(capture: CaptureEntry): Promise<void> {
    await this.runAction(async () => {
      await this.taskService.createLifeTask(capture.text, basenameWithoutExtension(capture.sourcePath));
      await this.dailyNoteService.updateCaptureStatus(capture, "life-task");
    }, "Converting capture to life task failed.");
  }

  async convertCaptureToGoalTask(capture: CaptureEntry, goalIndexPath: string): Promise<void> {
    await this.runAction(async () => {
      await this.taskService.createGoalTask(goalIndexPath, capture.text);
      await this.dailyNoteService.updateCaptureStatus(capture, "goal-task");
    }, "Converting capture to goal task failed.");
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
    }, "Converting capture to tracker update failed.");
  }

  async createLifeTask(text: string): Promise<void> {
    await this.runAction(() => this.taskService.createLifeTask(text, this.getActiveNoteName()), "Life task creation failed.");
  }

  async createGoalTask(goalIndexPath: string, text: string): Promise<void> {
    await this.runAction(() => this.taskService.createGoalTask(goalIndexPath, text), "Goal task creation failed.");
  }

  async toggleTask(task: ManagedTask, completed: boolean): Promise<void> {
    await this.runAction(() => this.taskService.toggleTask(task, completed), "Task update failed.");
  }

  async deleteTask(task: ManagedTask): Promise<void> {
    await this.runAction(() => this.taskService.deleteTask(task), "Task deletion failed.");
  }

  async reorderTasks(tasks: ManagedTask[]): Promise<void> {
    await this.runAction(() => this.taskService.reorderTasks(tasks), "Task reorder failed.");
  }

  async createGoal(name: string): Promise<void> {
    await this.runAction(() => this.goalService.createGoal(name), "Goal creation failed.");
  }

  async submitGoalTracker(input: {
    goalIndexPath: string;
    status: GoalTrackerStatus;
    note: string;
  }): Promise<void> {
    await this.runAction(() => this.goalService.submitTracker(input), "Tracker submission failed.");
  }

  async resolveBlocker(input: {
    goalIndexPath: string;
    blockerId: string;
    note: string;
  }): Promise<void> {
    await this.runAction(() => this.goalService.resolveBlocker(input), "Resolving blocker failed.");
  }

  async archiveGoal(goalIndexPath: string): Promise<void> {
    await this.runAction(() => this.goalService.archiveGoal(goalIndexPath), "Archiving goal failed.");
  }

  async completeWeeklyReview(note: string): Promise<void> {
    await this.runAction(() => this.goalService.completeWeeklyReview(note), "Completing weekly review failed.");
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as NexusPluginData | Partial<NexusSettings> | null;
    const loadedSettings =
      loaded && "settings" in loaded ? (loaded.settings ?? {}) : ((loaded ?? {}) as Partial<NexusSettings>);
    const merged = {
      ...DEFAULT_SETTINGS,
      ...loadedSettings
    };
    const normalized = normalizeSettingsWritePaths(this.app, merged, DEFAULT_SETTINGS);
    this.settings = normalized.settings;
    this.captureTriage =
      loaded && "captureTriage" in loaded && loaded.captureTriage ? { ...loaded.captureTriage } : {};
    this.settingsCorrections = normalized.correctedFields;
    this.pushState({
      settings: this.settings
    });
  }

  async saveSettings(): Promise<void> {
    assertSafeFolderPath(this.app, this.settings.dailyNoteFolder, "Daily Note folder");
    assertSafeMarkdownPath(this.app, this.settings.globalTodoPath, "Global todo path");
    assertSafeFolderPath(this.app, this.settings.goalRootFolder, "Goal root folder");
    await this.savePluginData();
    this.pushState({
      settings: this.settings
    });
    this.scheduleRefresh(20);
  }

  getCaptureTriageStatus(captureId: string): CaptureTriageStatus | undefined {
    return this.captureTriage[captureId];
  }

  getActiveMarkdownFile(): TFile | null {
    this.updateActiveMarkdownFile();
    return this.activeMarkdownFile;
  }

  async setCaptureTriageStatus(captureId: string, triageStatus: CaptureTriageStatus): Promise<void> {
    if (triageStatus === "pending") {
      delete this.captureTriage[captureId];
    } else {
      this.captureTriage[captureId] = triageStatus;
    }

    await this.savePluginData();
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

  private async savePluginData(): Promise<void> {
    await this.saveData({
      settings: this.settings,
      captureTriage: this.captureTriage
    } satisfies NexusPluginData);
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
      throw new Error("Command content cannot be empty.");
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
        throw new Error("Tracker note cannot be empty.");
      }

      return {
        type: "tracker",
        status: command.slice(1) as GoalTrackerStatus,
        goalName: goalNamePart,
        note: notePart
      };
    }

    throw new Error("Unknown command. Supported: /todo /goal /note /yellow /green /red");
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
        throw new Error(`Goal name "${goalName}" is ambiguous. Please use the full goal name.`);
      }

      throw new Error(`Goal "${goalName}" was not found.`);
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

    throw new Error("Please select a goal first, or use the format 'goal name | note'.");
  }

  private getActiveNoteName(): string | null {
    return this.getActiveMarkdownFile()?.basename ?? null;
  }

  private updateActiveMarkdownFile(): void {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile instanceof TFile && activeFile.extension === "md") {
      this.activeMarkdownFile = activeFile;
      return;
    }

    const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeMarkdownView?.file instanceof TFile && activeMarkdownView.file.extension === "md") {
      this.activeMarkdownFile = activeMarkdownView.file;
    }
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
