import type { CaptureChip, ControlledBlockSpec, NexusSettings } from "./types";

export const PLUGIN_ID = "spark-track";
export const VIEW_TYPE = "spark-track-view";
export const VIEW_TITLE = "Spark Track";

export const CAPTURE_CHIPS: CaptureChip[] = [
  { id: "idea", label: "#想法", icon: "💡", category: "tag" },
  { id: "review", label: "#复盘", icon: "🧭", category: "tag" },
  { id: "mood-good", label: "😊", icon: "😊", category: "mood" },
  { id: "mood-bad", label: "😔", icon: "😔", category: "mood" }
];

export const CONTROLLED_BLOCKS: Record<string, ControlledBlockSpec> = {
  capture: {
    heading: "## Nexus Capture",
    startMarker: "<!-- nexus:capture:start -->",
    endMarker: "<!-- nexus:capture:end -->"
  },
  lifeTasks: {
    heading: "## Nexus Actions",
    startMarker: "<!-- nexus:life-tasks:start -->",
    endMarker: "<!-- nexus:life-tasks:end -->"
  },
  goalTasks: {
    heading: "## Goal Tasks",
    startMarker: "<!-- nexus:goal-tasks:start -->",
    endMarker: "<!-- nexus:goal-tasks:end -->"
  },
  timeline: {
    heading: "## Progress Timeline",
    leadIn: ["> [!info] 项目历程自动生成区"],
    startMarker: "<!-- nexus:timeline:start -->",
    endMarker: "<!-- nexus:timeline:end -->"
  }
};

export const DEFAULT_SETTINGS: NexusSettings = {
  dailyNoteMode: "dual-fallback",
  dailyNoteFolder: "Daily",
  dailyNoteFormat: "YYYY-MM-DD",
  lifeTaskTarget: "daily-note",
  globalTodoPath: "全局待办.md",
  goalRootFolder: "Goals",
  uiLocale: "zh-CN"
};

export const ACTION_PANEL_OPTIONS = [
  { id: "life", label: "日常琐事" },
  { id: "goal", label: "进度提醒" }
] as const;

export const TRACKER_STATUS_META = {
  yellow: { icon: "🟡", label: "小修补" },
  green: { icon: "🟢", label: "核心突破" },
  red: { icon: "🔴", label: "遇到阻碍" }
} as const;
