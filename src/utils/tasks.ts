import type { ManagedTask, TaskBlockType } from "../types";

const TASK_PATTERN =
  /^- \[( |x)\] (.*?)(?:\s*(?:<!--\s*nexus:task-id=([A-Za-z0-9-]+)\s*-->|(\^[A-Za-z0-9-]+)))?\s*$/;
const TASK_START_PATTERN = /^- \[( |x)\]\s+/;

function normalizeTaskText(text: string): string {
  return text.trim().replace(/\s*\r?\n\s*/g, " ");
}

export function renderTaskLine(input: {
  completed?: boolean;
  text: string;
  taskId: string;
}): string {
  const marker = input.completed ? "x" : " ";
  return `- [${marker}] ${normalizeTaskText(input.text)} ^${input.taskId}`;
}

export function parseTaskLines(input: {
  body: string;
  targetPath: string;
  blockType: TaskBlockType;
  goalName?: string;
}): ManagedTask[] {
  const tasks: ManagedTask[] = [];
  let pendingLines: string[] = [];

  function flushPendingTask(discardInvalid = false): boolean {
    if (pendingLines.length === 0) {
      return false;
    }

    const joinedLine = pendingLines.map((line) => line.trim()).filter(Boolean).join(" ");

    const match = joinedLine.match(TASK_PATTERN);
    const taskId = match?.[3] ?? match?.[4]?.slice(1);
    if (!match || !taskId) {
      if (discardInvalid) {
        pendingLines = [];
      }
      return false;
    }

    pendingLines = [];
    tasks.push({
      id: taskId,
      text: normalizeTaskText(match[2]),
      completed: match[1] === "x",
      targetPath: input.targetPath,
      blockType: input.blockType,
      goalName: input.goalName
    });
    return true;
  }

  for (const rawLine of input.body.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (TASK_START_PATTERN.test(line)) {
      flushPendingTask(true);
      pendingLines = [line];
      flushPendingTask();
      continue;
    }

    if (pendingLines.length === 0) {
      continue;
    }

    pendingLines.push(line);
    flushPendingTask();
  }

  flushPendingTask(true);

  return tasks;
}

export function toggleTaskLine(line: string, completed: boolean): string {
  return line.replace(/^- \[( |x)\]/, `- [${completed ? "x" : " "}]`);
}

export function hasTaskId(line: string, taskId: string): boolean {
  return (
    line.includes(`nexus:task-id=${taskId}`) ||
    new RegExp(`\\^${taskId}(?:\\s|$)`).test(line)
  );
}
