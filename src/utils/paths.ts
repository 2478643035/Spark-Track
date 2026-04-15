import { normalizePath } from "obsidian";

export function sanitizeFileName(input: string): string {
  return input.replace(/[\\/:*?"<>|#^\[\]]/g, "-").replace(/\s+/g, " ").trim();
}

export function ensureMdExtension(path: string): string {
  return path.endsWith(".md") ? normalizePath(path) : normalizePath(`${path}.md`);
}

export function basenameWithoutExtension(path: string): string {
  return path.replace(/^.*[\\/]/, "").replace(/\.md$/, "");
}
