import { normalizePath, TFile } from "obsidian";
import { CONTROLLED_BLOCKS, TRACKER_STATUS_META } from "../constants";
import type NexusCommandPlugin from "../main";
import type {
  GoalIndexFrontmatter,
  GoalSummary,
  GoalTrackerStatus,
  HeatmapCell,
  TrackerEntry
} from "../types";
import { readBlock, replaceBlock } from "../utils/blocks";
import {
  createTrackerId,
  formatTimelineLabel,
  getDateStamp,
  getTimeStamp,
  trackerAnchor
} from "../utils/date";
import { parseFrontmatter, replaceFrontmatter } from "../utils/frontmatter";
import { basenameWithoutExtension, sanitizeFileName } from "../utils/paths";
import { parseTaskLines } from "../utils/tasks";
import { ensureFolder, ensureMarkdownFile } from "../utils/vault";

export class GoalService {
  constructor(private readonly plugin: NexusCommandPlugin) {}

  async listGoals(): Promise<GoalSummary[]> {
    const rootFolder = normalizePath(this.plugin.settings.goalRootFolder);

    return Promise.all(
      this.plugin.app.vault
        .getMarkdownFiles()
        .filter((file) => file.path.startsWith(`${rootFolder}/`) && file.name.startsWith("_Index_"))
        .map((file) => this.readGoalSummary(file))
    ).then((goals) =>
      goals
        .filter((goal): goal is GoalSummary => goal !== null)
        .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
    );
  }

  async createGoal(name: string): Promise<void> {
    const displayName = name.trim();
    if (!displayName) {
      return;
    }

    await ensureFolder(this.plugin.app, this.plugin.settings.goalRootFolder);

    const folderPath = this.createUniqueGoalFolder(displayName);
    await ensureFolder(this.plugin.app, folderPath);

    const indexPath = normalizePath(`${folderPath}/_Index_${sanitizeFileName(displayName)}.md`);
    const frontmatter: GoalIndexFrontmatter = {
      type: "goal_index",
      status: "active",
      created_at: getDateStamp(new Date()),
      goal_name: displayName,
      tracker_data: []
    };

    let body = `# ${displayName} - 战略仪表盘\n`;
    body = replaceBlock(body, CONTROLLED_BLOCKS.goalTasks, "");
    body = replaceBlock(body, CONTROLLED_BLOCKS.timeline, "");
    const content = replaceFrontmatter(body, frontmatter);

    await ensureMarkdownFile(this.plugin.app, indexPath, content);
  }

  async submitTracker(input: {
    goalIndexPath: string;
    status: GoalTrackerStatus;
    note: string;
  }): Promise<TrackerEntry> {
    const file = this.getGoalFile(input.goalIndexPath);
    const content = await this.plugin.app.vault.read(file);
    const parsed = this.parseGoalDocument(file, content);
    if (!parsed) {
      throw new Error("目标索引文件损坏。");
    }
    const now = new Date();
    const trackerId = createTrackerId(now);
    const date = getDateStamp(now);
    const time = getTimeStamp(now);
    const progressFile = await this.ensureDailyProgressNote(parsed.folderPath, date);
    const anchor = trackerAnchor(trackerId);
    const noteLink = `[[${basenameWithoutExtension(progressFile.path)}]]#^${anchor}`;
    const trackerEntry: TrackerEntry = {
      id: trackerId,
      date,
      time,
      status: input.status,
      note: noteLink,
      resolved_by: null
    };

    await this.plugin.app.vault.process(progressFile, (progressContent) => {
      const heading = `## ${time} ${TRACKER_STATUS_META[input.status].label} ^${anchor}`;
      const section = [heading, "", input.note.trim()].join("\n");
      const base = progressContent.trimEnd();
      return `${base}${base ? "\n\n" : ""}${section}\n`;
    });

    const nextFrontmatter: GoalIndexFrontmatter = {
      ...parsed.frontmatter,
      tracker_data: [...parsed.frontmatter.tracker_data, trackerEntry].sort((left, right) =>
        left.id.localeCompare(right.id)
      )
    };

    await this.rewriteGoalIndex(file, content, nextFrontmatter);
    return trackerEntry;
  }

  async resolveBlocker(input: {
    goalIndexPath: string;
    blockerId: string;
    note: string;
  }): Promise<void> {
    const createdTracker = await this.submitTracker({
      goalIndexPath: input.goalIndexPath,
      status: "green",
      note: input.note
    });
    const file = this.getGoalFile(input.goalIndexPath);

    await this.plugin.app.vault.process(file, (content) => {
      const parsed = this.parseGoalDocument(file, content);
      if (!parsed) {
        return content;
      }
      const nextFrontmatter: GoalIndexFrontmatter = {
        ...parsed.frontmatter,
        tracker_data: parsed.frontmatter.tracker_data.map((entry) =>
          entry.id === input.blockerId ? { ...entry, resolved_by: createdTracker.id } : entry
        )
      };

      return this.renderGoalIndex(content, nextFrontmatter);
    });
  }

  async archiveGoal(goalIndexPath: string): Promise<void> {
    const file = this.getGoalFile(goalIndexPath);

    await this.plugin.app.vault.process(file, (content) => {
      const parsed = this.parseGoalDocument(file, content);
      if (!parsed) {
        return content;
      }
      const nextFrontmatter: GoalIndexFrontmatter = {
        ...parsed.frontmatter,
        status: "archived"
      };

      return this.renderGoalIndex(content, nextFrontmatter);
    });
  }

  private async readGoalSummary(file: TFile): Promise<GoalSummary | null> {
    const content = await this.plugin.app.vault.read(file);
    const parsed = this.parseGoalDocument(file, content, false);

    if (!parsed) {
      return null;
    }

    const goalTasks = parseTaskLines({
      body: readBlock(content, CONTROLLED_BLOCKS.goalTasks) ?? "",
      targetPath: file.path,
      blockType: "goal",
      goalName: parsed.frontmatter.goal_name
    });

    const latestTracker =
      parsed.frontmatter.tracker_data[parsed.frontmatter.tracker_data.length - 1] ?? null;

    return {
      name: parsed.frontmatter.goal_name,
      folderPath: parsed.folderPath,
      indexPath: file.path,
      indexFile: file,
      status: parsed.frontmatter.status,
      createdAt: parsed.frontmatter.created_at,
      trackerData: parsed.frontmatter.tracker_data,
      goalTasks,
      latestStatus: latestTracker?.status ?? null,
      heatmap: this.buildHeatmap(parsed.frontmatter.tracker_data)
    };
  }

  private parseGoalDocument(
    file: TFile,
    content: string,
    throwOnMismatch = true
  ):
    | {
        frontmatter: GoalIndexFrontmatter;
        folderPath: string;
      }
    | null {
    const { data } = parseFrontmatter<Partial<GoalIndexFrontmatter>>(content);

    if (!data || data.type !== "goal_index" || !data.goal_name || !data.created_at) {
      if (throwOnMismatch) {
        throw new Error(`文件 ${file.path} 不是合法的目标索引。`);
      }

      return null;
    }

    return {
      frontmatter: {
        type: "goal_index",
        status: data.status === "archived" ? "archived" : "active",
        created_at: data.created_at,
        goal_name: data.goal_name,
        tracker_data: this.normalizeTrackerEntries(data.tracker_data)
      },
      folderPath: file.parent?.path ?? this.plugin.settings.goalRootFolder
    };
  }

  private normalizeTrackerEntries(rawEntries: unknown): TrackerEntry[] {
    if (!Array.isArray(rawEntries)) {
      return [];
    }

    return rawEntries
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }

        const record = entry as Record<string, unknown>;
        const status = record.status;

        if (
          typeof record.id !== "string" ||
          typeof record.date !== "string" ||
          typeof record.time !== "string" ||
          typeof record.note !== "string" ||
          (status !== "yellow" && status !== "green" && status !== "red")
        ) {
          return null;
        }

        return {
          id: record.id,
          date: record.date,
          time: record.time,
          status,
          note: record.note,
          resolved_by: typeof record.resolved_by === "string" ? record.resolved_by : null
        } satisfies TrackerEntry;
      })
      .filter((entry): entry is TrackerEntry => entry !== null)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  private buildHeatmap(entries: TrackerEntry[]): HeatmapCell[] {
    const buckets = new Map<string, TrackerEntry[]>();

    for (const entry of entries) {
      const group = buckets.get(entry.date) ?? [];
      group.push(entry);
      buckets.set(entry.date, group);
    }

    return Array.from(buckets.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, dayEntries]) => {
        const latest = dayEntries[dayEntries.length - 1] as TrackerEntry;
        return {
          date,
          status: latest.status,
          count: dayEntries.length,
          trackerId: latest.id,
          resolved: latest.status === "red" && Boolean(latest.resolved_by)
        };
      });
  }

  private buildTimeline(entries: TrackerEntry[]): string {
    if (entries.length === 0) {
      return "暂无进展记录。";
    }

    const entryMap = new Map(entries.map((entry) => [entry.id, entry]));

    return entries
      .map((entry) => {
        const meta = TRACKER_STATUS_META[entry.status];
        const label = formatTimelineLabel(entry.id);

        if (entry.status === "red" && entry.resolved_by) {
          const resolvedEntry = entryMap.get(entry.resolved_by);
          if (resolvedEntry) {
            return `${meta.icon} ${label} 卡点 已被 ${TRACKER_STATUS_META[resolvedEntry.status].icon} ${formatTimelineLabel(
              resolvedEntry.id
            )} 突破解决。`;
          }
        }

        return `${meta.icon} ${label} ${meta.label} ${entry.note}`;
      })
      .join("\n");
  }

  private renderGoalIndex(content: string, frontmatter: GoalIndexFrontmatter): string {
    const withFrontmatter = replaceFrontmatter(content, frontmatter);
    return replaceBlock(withFrontmatter, CONTROLLED_BLOCKS.timeline, this.buildTimeline(frontmatter.tracker_data));
  }

  private async rewriteGoalIndex(
    file: TFile,
    currentContent: string,
    frontmatter: GoalIndexFrontmatter
  ): Promise<void> {
    await this.plugin.app.vault.process(file, () => this.renderGoalIndex(currentContent, frontmatter));
  }

  private async ensureDailyProgressNote(folderPath: string, date: string): Promise<TFile> {
    const filePath = normalizePath(`${folderPath}/${date}-进展.md`);
    return ensureMarkdownFile(this.plugin.app, filePath, `# ${date} 进展记录\n`);
  }

  private getGoalFile(goalIndexPath: string): TFile {
    const file = this.plugin.app.vault.getAbstractFileByPath(goalIndexPath);
    if (!(file instanceof TFile)) {
      throw new Error("目标索引文件不存在。");
    }

    return file;
  }

  private createUniqueGoalFolder(goalName: string): string {
    const root = normalizePath(this.plugin.settings.goalRootFolder);
    const baseFolderName = sanitizeFileName(goalName) || "新目标";
    let candidate = `${root}/${baseFolderName}`;
    let suffix = 2;

    while (this.plugin.app.vault.getAbstractFileByPath(candidate)) {
      candidate = `${root}/${baseFolderName}-${suffix}`;
      suffix += 1;
    }

    return candidate;
  }
}
