import type { Writable } from "svelte/store";
import type { TFile } from "obsidian";

export type DailyNoteMode = "dual-fallback";
export type LifeTaskTarget = "daily-note" | "global-file";
export type ActionPanelMode = "life" | "goal";
export type TaskBlockType = "life" | "goal";
export type GoalLifecycleStatus = "active" | "archived";
export type GoalTrackerStatus = "yellow" | "green" | "red";
export type ReviewHealthLevel = "good" | "watch" | "stale" | "blocked";
export type ReviewActionKind = "resolve-blocker" | "advance-task" | "refresh-stale" | "archive-candidate";
export type CaptureTriageStatus =
  | "pending"
  | "kept"
  | "life-task"
  | "goal-task"
  | "tracker-yellow"
  | "tracker-green"
  | "tracker-red";
export type SuggestionKind = "blocker" | "goal-task" | "stale-goal";

export interface NexusSettings {
  dailyNoteMode: DailyNoteMode;
  dailyNoteFolder: string;
  dailyNoteFormat: string;
  lifeTaskTarget: LifeTaskTarget;
  globalTodoPath: string;
  goalRootFolder: string;
  uiLocale: string;
}

export interface CaptureChip {
  id: string;
  label: string;
  icon: string;
  category: "tag" | "mood";
}

export interface ControlledBlockSpec {
  heading?: string;
  leadIn?: string[];
  startMarker: string;
  endMarker: string;
}

export interface ManagedTask {
  id: string;
  text: string;
  completed: boolean;
  targetPath: string;
  blockType: TaskBlockType;
  goalName?: string;
}

export interface CaptureEntry {
  id: string;
  timestamp: string;
  chipLabels: string[];
  text: string;
  triageStatus: CaptureTriageStatus;
  sourcePath: string;
}

export interface NexusPluginData {
  settings?: Partial<NexusSettings> | null;
  captureTriage?: Record<string, CaptureTriageStatus> | null;
}

export interface TrackerEntry {
  id: string;
  date: string;
  time: string;
  status: GoalTrackerStatus;
  note: string;
  resolved_by: string | null;
}

export interface GoalIndexFrontmatter {
  type: "goal_index";
  status: GoalLifecycleStatus;
  created_at: string;
  goal_name: string;
  tracker_data: TrackerEntry[];
  reviewed_at?: string | null;
  last_reviewed_at?: string | null;
  review_notes?: string | null;
}

export interface HeatmapCell {
  date: string;
  status: GoalTrackerStatus;
  count: number;
  trackerId: string;
  resolved: boolean;
}

export interface GoalSummary {
  name: string;
  folderPath: string;
  indexPath: string;
  indexFile: TFile;
  status: GoalLifecycleStatus;
  createdAt: string;
  trackerData: TrackerEntry[];
  goalTasks: ManagedTask[];
  latestStatus: GoalTrackerStatus | null;
  latestTrackerId?: string | null;
  latestActivityDate?: string | null;
  reviewedAt?: string | null;
  lastReviewedAt?: string | null;
  reviewNotes?: string | null;
  heatmap: HeatmapCell[];
}

export interface AgedBlocker {
  trackerId: string;
  goalIndexPath: string;
  goalName: string;
  date: string;
  daysOpen: number;
  severity: "warm" | "hot";
}

export interface NexusSuggestion {
  id: string;
  kind: SuggestionKind;
  title: string;
  detail: string;
  goalIndexPath?: string;
  blockerId?: string;
}

export interface ReviewHeatDay {
  date: string;
  label: string;
  count: number;
  dominantStatus: GoalTrackerStatus | null;
}

export interface GoalReviewMetric {
  goalIndexPath: string;
  goalName: string;
  healthScore: number;
  healthLevel: ReviewHealthLevel;
  latestActivityDate: string | null;
  quietDays: number;
  weeklyCommits: number;
  openBlockers: number;
  completedTasks: number;
  openTasks: number;
  reason: string;
}

export interface ReviewAction {
  id: string;
  kind: ReviewActionKind;
  title: string;
  detail: string;
  goalIndexPath?: string;
  blockerId?: string;
}

export interface WeeklyReviewSummary {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  activeGoalCount: number;
  archivedGoalCount: number;
  weeklyCommitCount: number;
  statusCounts: Record<GoalTrackerStatus, number>;
  openedBlockerCount: number;
  resolvedBlockerCount: number;
  blockerResolutionRate: number;
  reviewedThisWindow: boolean;
  lastReviewedAt: string | null;
  staleGoalCount: number;
  heat: ReviewHeatDay[];
  goalMetrics: GoalReviewMetric[];
  nextActions: ReviewAction[];
  archiveCandidates: ReviewAction[];
}

export interface NexusState {
  ready: boolean;
  loading: boolean;
  error: string | null;
  activeNoteName: string | null;
  captureChips: CaptureChip[];
  settings: NexusSettings;
  lifeTasks: ManagedTask[];
  goalTasks: ManagedTask[];
  goals: GoalSummary[];
  captures?: CaptureEntry[];
  blockers?: AgedBlocker[];
  suggestions?: NexusSuggestion[];
  review?: WeeklyReviewSummary | null;
}

export interface NexusViewController {
  state: Writable<NexusState>;
  openView(): Promise<void>;
  refreshState(): Promise<void>;
  submitCapture(input: {
    text: string;
    chipIds: string[];
    selectedGoalIndexPath?: string | null;
  }): Promise<void>;
  deleteCapture(capture: CaptureEntry): Promise<void>;
  markCaptureKept(capture: CaptureEntry): Promise<void>;
  convertCaptureToLifeTask(capture: CaptureEntry): Promise<void>;
  convertCaptureToGoalTask(capture: CaptureEntry, goalIndexPath: string): Promise<void>;
  convertCaptureToGoalTracker(input: {
    capture: CaptureEntry;
    goalIndexPath: string;
    status: GoalTrackerStatus;
  }): Promise<void>;
  createLifeTask(text: string, taskId?: string): Promise<ManagedTask | null>;
  createGoalTask(goalIndexPath: string, text: string, taskId?: string): Promise<ManagedTask | null>;
  openGoalTaskSort(goalIndexPath: string): Promise<void>;
  toggleTask(task: ManagedTask, completed: boolean): Promise<void>;
  deleteTask(task: ManagedTask): Promise<void>;
  reorderTasks(tasks: ManagedTask[]): Promise<void>;
  createGoal(name: string): Promise<void>;
  submitGoalTracker(input: {
    goalIndexPath: string;
    status: GoalTrackerStatus;
    note: string;
  }): Promise<void>;
  resolveBlocker(input: {
    goalIndexPath: string;
    blockerId: string;
    note: string;
  }): Promise<void>;
  completeWeeklyReview(note: string): Promise<void>;
  archiveGoal(goalIndexPath: string): Promise<void>;
}
