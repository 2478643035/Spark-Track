import { normalizePath, TFile, TFolder } from "obsidian";
import type { App } from "obsidian";

export async function ensureFolder(app: App, rawFolderPath: string): Promise<void> {
  const folderPath = normalizePath(rawFolderPath).replace(/^\/+/, "").trim();
  if (!folderPath) {
    return;
  }

  const segments = folderPath.split("/");
  let currentPath = "";

  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    const existing = app.vault.getAbstractFileByPath(currentPath);

    if (!existing) {
      await app.vault.createFolder(currentPath);
    } else if (!(existing instanceof TFolder)) {
      throw new Error(`路径 ${currentPath} 已存在且不是文件夹。`);
    }
  }
}

export async function ensureMarkdownFile(
  app: App,
  rawPath: string,
  initialContent = ""
): Promise<TFile> {
  const normalizedPath = normalizePath(rawPath);
  const parentPath = normalizedPath.includes("/")
    ? normalizedPath.slice(0, normalizedPath.lastIndexOf("/"))
    : "";

  if (parentPath) {
    await ensureFolder(app, parentPath);
  }

  const existing = app.vault.getAbstractFileByPath(normalizedPath);

  if (existing instanceof TFile) {
    return existing;
  }

  if (existing) {
    throw new Error(`路径 ${normalizedPath} 已被其他类型占用。`);
  }

  return app.vault.create(normalizedPath, initialContent);
}
