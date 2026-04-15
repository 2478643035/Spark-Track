import { normalizePath } from "obsidian";
import type { App } from "obsidian";

async function ensureNoMediaFile(app: App, rawFolderPath: string): Promise<void> {
  const folderPath = normalizePath(rawFolderPath).replace(/\/+$/, "");
  if (!folderPath) {
    return;
  }

  if (!(await app.vault.adapter.exists(folderPath))) {
    return;
  }

  const markerPath = `${folderPath}/.nomedia`;
  if (await app.vault.adapter.exists(markerPath)) {
    return;
  }

  await app.vault.adapter.write(markerPath, "");
}

export async function ensurePluginNoMediaShield(app: App, pluginDir?: string): Promise<void> {
  if (!pluginDir) {
    return;
  }

  const folders = [pluginDir, `${pluginDir}/src`, `${pluginDir}/dist`];
  const seen = new Set<string>();

  for (const folder of folders) {
    const normalized = normalizePath(folder);
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    await ensureNoMediaFile(app, normalized);
  }
}
