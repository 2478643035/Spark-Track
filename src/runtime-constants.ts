import type { CaptureTriageStatus } from "./types";

export const CAPTURE_TRIAGE_META: Record<CaptureTriageStatus, { label: string; tone: string }> = {
  pending: { label: "待分拣", tone: "pending" },
  kept: { label: "保留为笔记", tone: "kept" },
  "life-task": { label: "已转日常任务", tone: "task" },
  "goal-task": { label: "已转目标任务", tone: "task" },
  "tracker-yellow": { label: "已转黄灯进展", tone: "yellow" },
  "tracker-green": { label: "已转绿灯进展", tone: "green" },
  "tracker-red": { label: "已转红灯进展", tone: "red" }
};

export const LIGHT_COMMAND_HINTS = [
  "/todo 买充电线",
  "/goal 书籍 TTS 工具",
  "/red 书籍 TTS 工具 | API 限流卡住",
  "/green 书籍 TTS 工具 | 今天解决方案说明"
];

export const CAPTURE_LOOKBACK_DAYS = 7;
export const CAPTURE_LIMIT = 12;
