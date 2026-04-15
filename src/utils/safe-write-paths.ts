import { normalizePath } from "obsidian";
import type { App } from "obsidian";
import type { NexusSettings } from "../types";

const ALWAYS_BLOCKED_PREFIXES = [".git", ".obsidian/plugins", "node_modules"];
const DEV_WORKSPACE_BLOCKED_TOP_LEVEL = ["src", "dist", "scripts"];
const BLOCKED_SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".svelte",
  ".css",
  ".json",
  ".mjs",
  ".cjs"
];

function normalizeCandidate(rawPath: string): string {
  return normalizePath(rawPath).replace(/^\/+/, "").trim();
}

function isDevWorkspace(app: App): boolean {
  return Boolean(app.vault.getAbstractFileByPath("package.json") && app.vault.getAbstractFileByPath("src"));
}

function matchesBlockedPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function assertNotBlockedPath(app: App, path: string, label: string): void {
  for (const prefix of ALWAYS_BLOCKED_PREFIXES) {
    if (matchesBlockedPrefix(path, prefix)) {
      throw new Error(`${label} 不能写到 ${prefix}。`);
    }
  }

  if (isDevWorkspace(app)) {
    const topLevel = path.split("/")[0];
    if (DEV_WORKSPACE_BLOCKED_TOP_LEVEL.includes(topLevel)) {
      throw new Error(`${label} 不能写到源码目录 ${topLevel}/。请改到普通笔记目录。`);
    }
  }
}

function hasBlockedSourceExtension(path: string): boolean {
  const lower = path.toLowerCase();
  return BLOCKED_SOURCE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export function assertSafeFolderPath(app: App, rawPath: string, label: string): string {
  const normalized = normalizeCandidate(rawPath);
  if (!normalized) {
    throw new Error(`${label} 不能为空。`);
  }

  if (hasBlockedSourceExtension(normalized)) {
    throw new Error(`${label} 不能指向源码文件。`);
  }

  assertNotBlockedPath(app, normalized, label);
  return normalized;
}

export function assertSafeMarkdownPath(app: App, rawPath: string, label: string): string {
  const normalized = normalizeCandidate(rawPath);
  if (!normalized) {
    throw new Error(`${label} 不能为空。`);
  }

  if (hasBlockedSourceExtension(normalized)) {
    throw new Error(`${label} 必须是 Markdown 路径，不能是源码文件。`);
  }

  const markdownPath = normalized.toLowerCase().endsWith(".md") ? normalized : `${normalized}.md`;
  assertNotBlockedPath(app, markdownPath, label);
  return normalizePath(markdownPath);
}

export function normalizeSettingsWritePaths(
  app: App,
  settings: NexusSettings,
  defaults: NexusSettings
): { settings: NexusSettings; correctedFields: string[] } {
  const correctedFields: string[] = [];
  const normalized: NexusSettings = { ...settings };

  try {
    normalized.dailyNoteFolder = assertSafeFolderPath(app, settings.dailyNoteFolder, "Daily Note 文件夹");
  } catch {
    normalized.dailyNoteFolder = defaults.dailyNoteFolder;
    correctedFields.push("dailyNoteFolder");
  }

  try {
    normalized.globalTodoPath = assertSafeMarkdownPath(app, settings.globalTodoPath, "全局待办路径");
  } catch {
    normalized.globalTodoPath = defaults.globalTodoPath;
    correctedFields.push("globalTodoPath");
  }

  try {
    normalized.goalRootFolder = assertSafeFolderPath(app, settings.goalRootFolder, "目标根目录");
  } catch {
    normalized.goalRootFolder = defaults.goalRootFolder;
    correctedFields.push("goalRootFolder");
  }

  return {
    settings: normalized,
    correctedFields
  };
}
