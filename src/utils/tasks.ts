import type { ManagedTask, TaskBlockType } from "../types";

const TASK_PATTERN =
  /^- \[( |x)\] (.*?)(?:\s*(?:<!--\s*nexus:task-id=([A-Za-z0-9-]+)\s*-->|(\^[A-Za-z0-9-]+)))?\s*$/;

export function renderTaskLine(input: {
  completed?: boolean;
  text: string;
  taskId: string;
}): string {
  const marker = input.completed ? "x" : " ";
  return `- [${marker}] ${input.text.trim()} ^${input.taskId}`;
}

export function parseTaskLines(input: {
  body: string;
  targetPath: string;
  blockType: TaskBlockType;
  goalName?: string;
}): ManagedTask[] {
  const tasks: ManagedTask[] = [];

  for (const rawLine of input.body.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const match = line.match(TASK_PATTERN);
    const taskId = match?.[3] ?? match?.[4]?.slice(1);
    if (!match || !taskId) {
      continue;
    }

    tasks.push({
      id: taskId,
      text: match[2].trim(),
      completed: match[1] === "x",
      targetPath: input.targetPath,
      blockType: input.blockType,
      goalName: input.goalName
    });
  }

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
