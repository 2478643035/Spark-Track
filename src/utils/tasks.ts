import type { ManagedTask, TaskBlockType } from "../types";

const TASK_PATTERN =
  /^- \[( |x)\] (.*?)(?:\s*<!--\s*nexus:task-id=([A-Za-z0-9-]+)\s*-->)?\s*$/;

export function renderTaskLine(input: {
  completed?: boolean;
  text: string;
  taskId: string;
}): string {
  const marker = input.completed ? "x" : " ";
  return `- [${marker}] ${input.text.trim()} <!-- nexus:task-id=${input.taskId} -->`;
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
    if (!match || !match[3]) {
      continue;
    }

    tasks.push({
      id: match[3],
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
