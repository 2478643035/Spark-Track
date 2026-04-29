import assert from "node:assert/strict";
import { TFile, TFolder, normalizePath } from "obsidian";
import { DEFAULT_SETTINGS } from "../../src/constants";
import { DailyNoteService } from "../../src/services/daily-note-service";
import { TaskService } from "../../src/services/task-service";
import type NexusCommandPlugin from "../../src/main";
import type { NexusSettings } from "../../src/types";
import { formatDateToken } from "../../src/utils/date";

class FakeVault {
  private readonly files = new Map<string, TFile>();
  private readonly folders = new Map<string, TFolder>();
  private readonly contents = new Map<string, string>();

  constructor(initialFiles: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(initialFiles)) {
      this.addFile(path, content);
    }
  }

  getAbstractFileByPath(path: string): TFile | TFolder | null {
    const normalized = normalizePath(path);
    return this.files.get(normalized) ?? this.folders.get(normalized) ?? null;
  }

  async create(path: string, content: string): Promise<TFile> {
    return this.addFile(path, content);
  }

  async createFolder(path: string): Promise<TFolder> {
    const folder = new TFolder(path);
    this.folders.set(folder.path, folder);
    return folder;
  }

  async read(file: TFile): Promise<string> {
    return this.readPath(file.path);
  }

  async cachedRead(file: TFile): Promise<string> {
    return this.read(file);
  }

  async process(file: TFile, update: (content: string) => string): Promise<void> {
    this.contents.set(file.path, update(await this.read(file)));
  }

  hasPath(path: string): boolean {
    return this.files.has(normalizePath(path));
  }

  readPath(path: string): string {
    return this.contents.get(normalizePath(path)) ?? "";
  }

  private addFile(path: string, content: string): TFile {
    const file = new TFile(path);
    this.files.set(file.path, file);
    this.contents.set(file.path, content);
    return file;
  }
}

function createPlugin(input: {
  files?: Record<string, string>;
  activePath?: string | null;
  settings?: Partial<NexusSettings>;
} = {}): NexusCommandPlugin {
  const vault = new FakeVault(input.files);
  const activeFile = input.activePath ? vault.getAbstractFileByPath(input.activePath) : null;

  return {
    app: {
      vault,
      workspace: {
        getActiveFile: () => activeFile,
        getActiveViewOfType: () => null
      }
    },
    settings: {
      ...DEFAULT_SETTINGS,
      ...input.settings
    },
    latestState: {
      captureChips: []
    },
    getActiveMarkdownFile: () => (activeFile instanceof TFile ? activeFile : null)
  } as unknown as NexusCommandPlugin;
}

function createService(plugin: NexusCommandPlugin): { dailyNoteService: DailyNoteService; taskService: TaskService } {
  const dailyNoteService = new DailyNoteService(plugin);
  return {
    dailyNoteService,
    taskService: new TaskService(plugin, dailyNoteService)
  };
}

export async function run(): Promise<void> {
  await doesNotReadLifeTasksFromStaleActiveNote();
  await readsLegacyLifeTasksFromRecentDailyNote();
  await readsLegacyLifeTasksFromRecentDailyActionNote();
  await createsLifeTasksInSingleDailyActionNoteWithTime();
  await togglesCreatedLifeTaskInSingleDailyActionNote();
}

async function doesNotReadLifeTasksFromStaleActiveNote(): Promise<void> {
  const plugin = createPlugin({
    activePath: "Daily/2026-01-01.md",
    files: {
      "Daily/2026-01-01.md": "## Nexus Actions\n\n- [ ] stale task ^t-stale\n"
    }
  });
  const { taskService } = createService(plugin);

  const tasks = await taskService.listLifeTasks();

  assert.deepEqual(tasks, []);
}

async function readsLegacyLifeTasksFromRecentDailyNote(): Promise<void> {
  const todayToken = formatDateToken(new Date(), DEFAULT_SETTINGS.dailyNoteFormat);
  const plugin = createPlugin({
    files: {
      [`Daily/${todayToken}.md`]: "## Nexus Actions\n\n- [ ] legacy task ^t-legacy\n"
    }
  });
  const { taskService } = createService(plugin);

  const tasks = await taskService.listLifeTasks();

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, "t-legacy");
  assert.equal(tasks[0].targetPath, normalizePath(`Daily/${todayToken}.md`));
}

async function readsLegacyLifeTasksFromRecentDailyActionNote(): Promise<void> {
  const todayToken = formatDateToken(new Date(), DEFAULT_SETTINGS.dailyNoteFormat);
  const plugin = createPlugin({
    files: {
      [`Daily/Actions/${todayToken}-actions.md`]: "## Nexus Actions\n\n- [ ] dated action ^t-dated\n"
    }
  });
  const { taskService } = createService(plugin);

  const tasks = await taskService.listLifeTasks();

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, "t-dated");
  assert.equal(tasks[0].targetPath, normalizePath(`Daily/Actions/${todayToken}-actions.md`));
}

async function createsLifeTasksInSingleDailyActionNoteWithTime(): Promise<void> {
  const plugin = createPlugin();
  const { dailyNoteService, taskService } = createService(plugin);
  const expectedTaskPath = normalizePath(`${DEFAULT_SETTINGS.dailyNoteFolder}/Actions/日常任务.md`);

  const created = await taskService.createLifeTask("buy milk", "Inbox", "t-new");

  assert.equal(created?.targetPath, expectedTaskPath);
  assert.equal((plugin.app.vault as unknown as FakeVault).hasPath(dailyNoteService.getPreferredPath(new Date())), false);
  assert.match(
    (plugin.app.vault as unknown as FakeVault).readPath(expectedTaskPath),
    /- \[ \] buy milk \[\d{2}:\d{2}\] .* \^t-new/
  );
}

async function togglesCreatedLifeTaskInSingleDailyActionNote(): Promise<void> {
  const plugin = createPlugin();
  const { taskService } = createService(plugin);
  const expectedTaskPath = normalizePath(`${DEFAULT_SETTINGS.dailyNoteFolder}/Actions/日常任务.md`);

  const created = await taskService.createLifeTask("sync note", null, "t-sync");

  assert.equal(created?.targetPath, expectedTaskPath);
  await taskService.toggleTask(created!, true);

  assert.match(
    (plugin.app.vault as unknown as FakeVault).readPath(expectedTaskPath),
    /- \[x\] sync note \[\d{2}:\d{2}\] \^t-sync/
  );
}
