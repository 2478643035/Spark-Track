import { normalizePath, TFile } from "obsidian";
import { CONTROLLED_BLOCKS, TRACKER_STATUS_META } from "../constants";
import type NexusCommandPlugin from "../main";
import type {
  AgedBlocker,
  GoalIndexFrontmatter,
  GoalReviewMetric,
  GoalSummary,
  GoalTrackerStatus,
  HeatmapCell,
  NexusSuggestion,
  ReviewAction,
  ReviewHeatDay,
  WeeklyReviewSummary,
  TrackerEntry
} from "../types";
import { readBlock, replaceBlock } from "../utils/blocks";
import {
  createTrackerId,
  formatTimelineLabel,
  getDateStamp,
  getDateTimeStamp,
  getDaysSince,
  getTimeStamp,
  parseDateStamp,
  trackerAnchor
} from "../utils/date";
import { parseFrontmatter, replaceFrontmatter } from "../utils/frontmatter";
import { basenameWithoutExtension, sanitizeFileName } from "../utils/paths";
import { assertSafeFolderPath } from "../utils/safe-write-paths";
import { parseTaskLines } from "../utils/tasks";
import { ensureFolder, ensureMarkdownFile } from "../utils/vault";

export class GoalService {
  constructor(private readonly plugin: NexusCommandPlugin) {}

  async listGoals(): Promise<GoalSummary[]> {
    const rootFolder = normalizePath(
      assertSafeFolderPath(this.plugin.app, this.plugin.settings.goalRootFolder, "目标根目录")
    );

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

    await ensureFolder(
      this.plugin.app,
      assertSafeFolderPath(this.plugin.app, this.plugin.settings.goalRootFolder, "目标根目录")
    );

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

  async completeWeeklyReview(note: string): Promise<void> {
    const goals = (await this.listGoals()).filter((goal) => goal.status === "active");
    const reviewedAt = getDateTimeStamp(new Date());
    const reviewNote = note.trim();

    await Promise.all(
      goals.map((goal) =>
        this.plugin.app.vault.process(goal.indexFile, (content) => {
          const parsed = this.parseGoalDocument(goal.indexFile, content);
          if (!parsed || parsed.frontmatter.status !== "active") {
            return content;
          }

          const nextFrontmatter: GoalIndexFrontmatter = {
            ...parsed.frontmatter,
            reviewed_at: parsed.frontmatter.reviewed_at ?? reviewedAt,
            last_reviewed_at: reviewedAt,
            ...(reviewNote ? { review_notes: reviewNote } : {})
          };

          return this.renderGoalIndex(content, nextFrontmatter);
        })
      )
    );
  }

  async readGoalSummaryByPath(goalIndexPath: string): Promise<GoalSummary | null> {
    const file = this.plugin.app.vault.getAbstractFileByPath(goalIndexPath);
    if (!(file instanceof TFile)) {
      return null;
    }

    return this.readGoalSummary(file);
  }

  buildAgedBlockers(goals: GoalSummary[]): AgedBlocker[] {
    return goals
      .filter((goal) => goal.status === "active")
      .flatMap((goal) =>
        goal.trackerData
          .filter((entry) => entry.status === "red" && !entry.resolved_by)
          .map((entry) => {
            const daysOpen = getDaysSince(entry.date);
            return {
              trackerId: entry.id,
              goalIndexPath: goal.indexPath,
              goalName: goal.name,
              date: entry.date,
              daysOpen,
              severity: daysOpen >= 7 ? "hot" : "warm"
            } satisfies AgedBlocker;
          })
      )
      .sort((left, right) => right.daysOpen - left.daysOpen || left.goalName.localeCompare(right.goalName));
  }

  buildSuggestions(goals: GoalSummary[], blockers: AgedBlocker[]): NexusSuggestion[] {
    const suggestions: NexusSuggestion[] = [];

    for (const blocker of blockers) {
      suggestions.push({
        id: `blocker-${blocker.trackerId}`,
        kind: "blocker",
        title: `先处理「${blocker.goalName}」的卡点`,
        detail: blocker.daysOpen === 0 ? "今天已经卡住，优先写下破局方案。" : `已卡 ${blocker.daysOpen} 天，先解决这个阻碍。`,
        goalIndexPath: blocker.goalIndexPath,
        blockerId: blocker.trackerId
      });

      if (suggestions.length >= 3) {
        return suggestions;
      }
    }

    const activeGoals = goals.filter((goal) => goal.status === "active");
    for (const goal of activeGoals) {
      const nextTask = goal.goalTasks.find((task) => !task.completed);
      if (!nextTask) {
        continue;
      }

      suggestions.push({
        id: `task-${nextTask.id}`,
        kind: "goal-task",
        title: `推进「${goal.name}」`,
        detail: nextTask.text,
        goalIndexPath: goal.indexPath
      });

      if (suggestions.length >= 3) {
        return suggestions;
      }
    }

    const staleGoals = activeGoals
      .map((goal) => {
        const pivotDate = goal.latestActivityDate ?? goal.createdAt;
        return {
          goal,
          quietDays: getDaysSince(pivotDate)
        };
      })
      .filter(({ quietDays }) => quietDays >= 3)
      .sort((left, right) => right.quietDays - left.quietDays);

    for (const entry of staleGoals) {
      suggestions.push({
        id: `stale-${entry.goal.indexPath}`,
        kind: "stale-goal",
        title: `补一笔「${entry.goal.name}」的进度`,
        detail: `${entry.quietDays} 天没有新的提交记录了。`,
        goalIndexPath: entry.goal.indexPath
      });

      if (suggestions.length >= 3) {
        break;
      }
    }

    return suggestions;
  }

  buildWeeklyReview(
    goals: GoalSummary[],
    blockers: AgedBlocker[],
    suggestions: NexusSuggestion[]
  ): WeeklyReviewSummary {
    const now = new Date();
    const windowDays = this.createRecentDateStamps(now, 7);
    const windowStart = windowDays[0] ?? getDateStamp(now);
    const windowEnd = windowDays[windowDays.length - 1] ?? getDateStamp(now);
    const windowDaySet = new Set(windowDays);
    const activeGoals = goals.filter((goal) => goal.status === "active");
    const lastReviewedAt = this.findLatestReviewStamp(activeGoals);
    const weeklyEntries = activeGoals.flatMap((goal) =>
      goal.trackerData
        .filter((entry) => windowDaySet.has(entry.date))
        .map((entry) => ({
          goal,
          entry
        }))
    );
    const statusCounts: Record<GoalTrackerStatus, number> = {
      yellow: 0,
      green: 0,
      red: 0
    };

    for (const { entry } of weeklyEntries) {
      statusCounts[entry.status] += 1;
    }

    const openedBlockers = weeklyEntries.filter(({ entry }) => entry.status === "red");
    const resolvedBlockerCount = openedBlockers.filter(({ entry }) => Boolean(entry.resolved_by)).length;
    const goalMetrics = activeGoals
      .map((goal) => this.buildGoalReviewMetric(goal, windowDaySet))
      .sort((left, right) => left.healthScore - right.healthScore || right.quietDays - left.quietDays);
    const archiveCandidates = this.buildArchiveCandidates(goalMetrics);

    return {
      generatedAt: getDateTimeStamp(now),
      windowStart,
      windowEnd,
      activeGoalCount: activeGoals.length,
      archivedGoalCount: goals.filter((goal) => goal.status === "archived").length,
      weeklyCommitCount: weeklyEntries.length,
      statusCounts,
      openedBlockerCount: openedBlockers.length,
      resolvedBlockerCount,
      blockerResolutionRate: openedBlockers.length === 0 ? 1 : resolvedBlockerCount / openedBlockers.length,
      reviewedThisWindow:
        activeGoals.length > 0 &&
        activeGoals.every((goal) => this.isReviewStampInWindow(goal.lastReviewedAt ?? goal.reviewedAt, windowStart, windowEnd)),
      lastReviewedAt,
      staleGoalCount: goalMetrics.filter((metric) => metric.quietDays >= 3).length,
      heat: windowDays.map((date) => this.buildReviewHeatDay(date, weeklyEntries.map(({ entry }) => entry))),
      goalMetrics,
      nextActions: this.buildReviewNextActions(activeGoals, blockers, suggestions, goalMetrics),
      archiveCandidates
    };
  }

  private buildGoalReviewMetric(goal: GoalSummary, windowDaySet: Set<string>): GoalReviewMetric {
    const weeklyCommits = goal.trackerData.filter((entry) => windowDaySet.has(entry.date)).length;
    const openBlockers = goal.trackerData.filter((entry) => entry.status === "red" && !entry.resolved_by).length;
    const completedTasks = goal.goalTasks.filter((task) => task.completed).length;
    const openTasks = goal.goalTasks.length - completedTasks;
    const latestActivityDate = goal.latestActivityDate ?? goal.createdAt ?? null;
    const quietDays = latestActivityDate ? getDaysSince(latestActivityDate) : 999;
    const healthScore = this.clamp(
      100 -
        Math.min(45, openBlockers * 22) -
        Math.min(35, Math.max(0, quietDays - 2) * 5) +
        Math.min(18, weeklyCommits * 6) -
        Math.min(10, openTasks * 2),
      0,
      100
    );

    let healthLevel: GoalReviewMetric["healthLevel"] = "good";
    if (openBlockers > 0) {
      healthLevel = "blocked";
    } else if (quietDays >= 7) {
      healthLevel = "stale";
    } else if (healthScore < 70 || quietDays >= 3) {
      healthLevel = "watch";
    }

    return {
      goalIndexPath: goal.indexPath,
      goalName: goal.name,
      healthScore,
      healthLevel,
      latestActivityDate,
      quietDays,
      weeklyCommits,
      openBlockers,
      completedTasks,
      openTasks,
      reason: this.describeGoalHealth(healthLevel, {
        openBlockers,
        quietDays,
        weeklyCommits,
        openTasks
      })
    };
  }

  private buildReviewNextActions(
    activeGoals: GoalSummary[],
    blockers: AgedBlocker[],
    suggestions: NexusSuggestion[],
    goalMetrics: GoalReviewMetric[]
  ): ReviewAction[] {
    const actions: ReviewAction[] = [];
    const seen = new Set<string>();

    for (const suggestion of suggestions) {
      const action = this.convertSuggestionToReviewAction(suggestion);
      if (!action || seen.has(action.id)) {
        continue;
      }

      actions.push(action);
      seen.add(action.id);
      if (actions.length >= 4) {
        return actions;
      }
    }

    for (const blocker of blockers) {
      const action: ReviewAction = {
        id: `review-blocker-${blocker.trackerId}`,
        kind: "resolve-blocker",
        title: `优先破局：${blocker.goalName}`,
        detail: blocker.daysOpen === 0 ? "今天出现的新卡点，下周前先写清解决方案。" : `已卡 ${blocker.daysOpen} 天，不建议继续堆新任务。`,
        goalIndexPath: blocker.goalIndexPath,
        blockerId: blocker.trackerId
      };

      if (!seen.has(action.id)) {
        actions.push(action);
        seen.add(action.id);
      }

      if (actions.length >= 4) {
        return actions;
      }
    }

    const metricByPath = new Map(goalMetrics.map((metric) => [metric.goalIndexPath, metric]));
    const goalsByRisk = [...activeGoals].sort((left, right) => {
      const leftMetric = metricByPath.get(left.indexPath);
      const rightMetric = metricByPath.get(right.indexPath);
      return (leftMetric?.healthScore ?? 100) - (rightMetric?.healthScore ?? 100);
    });

    for (const goal of goalsByRisk) {
      const task = goal.goalTasks.find((entry) => !entry.completed);
      if (!task) {
        continue;
      }

      const action: ReviewAction = {
        id: `review-task-${task.id}`,
        kind: "advance-task",
        title: `推进：${goal.name}`,
        detail: task.text,
        goalIndexPath: goal.indexPath
      };

      if (!seen.has(action.id)) {
        actions.push(action);
        seen.add(action.id);
      }

      if (actions.length >= 4) {
        return actions;
      }
    }

    for (const metric of goalMetrics.filter((entry) => entry.quietDays >= 3)) {
      const action: ReviewAction = {
        id: `review-stale-${metric.goalIndexPath}`,
        kind: "refresh-stale",
        title: `复盘停滞：${metric.goalName}`,
        detail: `${metric.quietDays} 天无推进，补一条进展或决定归档。`,
        goalIndexPath: metric.goalIndexPath
      };

      if (!seen.has(action.id)) {
        actions.push(action);
        seen.add(action.id);
      }

      if (actions.length >= 4) {
        break;
      }
    }

    return actions;
  }

  private buildArchiveCandidates(goalMetrics: GoalReviewMetric[]): ReviewAction[] {
    return goalMetrics
      .filter(
        (metric) =>
          (metric.quietDays >= 14 && metric.weeklyCommits === 0 && metric.openTasks === 0 && metric.openBlockers === 0) ||
          metric.quietDays >= 21
      )
      .sort((left, right) => right.quietDays - left.quietDays || left.healthScore - right.healthScore)
      .slice(0, 4)
      .map((metric) => ({
        id: `archive-${metric.goalIndexPath}`,
        kind: "archive-candidate",
        title: `考虑砍掉或归档：${metric.goalName}`,
        detail:
          metric.openTasks === 0
            ? `${metric.quietDays} 天无推进且没有未完成任务。`
            : `${metric.quietDays} 天无推进，先确认这个目标是否还值得占位。`,
        goalIndexPath: metric.goalIndexPath
      }));
  }

  private buildReviewHeatDay(date: string, entries: TrackerEntry[]): ReviewHeatDay {
    const dayEntries = entries.filter((entry) => entry.date === date).sort((left, right) => left.id.localeCompare(right.id));
    const latest = dayEntries[dayEntries.length - 1] ?? null;

    return {
      date,
      label: date.slice(5),
      count: dayEntries.length,
      dominantStatus: latest?.status ?? null
    };
  }

  private convertSuggestionToReviewAction(suggestion: NexusSuggestion): ReviewAction | null {
    if (suggestion.kind === "blocker" && suggestion.goalIndexPath && suggestion.blockerId) {
      return {
        id: `review-${suggestion.id}`,
        kind: "resolve-blocker",
        title: suggestion.title,
        detail: suggestion.detail,
        goalIndexPath: suggestion.goalIndexPath,
        blockerId: suggestion.blockerId
      };
    }

    if (suggestion.kind === "goal-task" && suggestion.goalIndexPath) {
      return {
        id: `review-${suggestion.id}`,
        kind: "advance-task",
        title: suggestion.title,
        detail: suggestion.detail,
        goalIndexPath: suggestion.goalIndexPath
      };
    }

    if (suggestion.kind === "stale-goal" && suggestion.goalIndexPath) {
      return {
        id: `review-${suggestion.id}`,
        kind: "refresh-stale",
        title: suggestion.title,
        detail: suggestion.detail,
        goalIndexPath: suggestion.goalIndexPath
      };
    }

    return null;
  }

  private createRecentDateStamps(now: Date, count: number): string[] {
    const today = parseDateStamp(getDateStamp(now));
    const dates: string[] = [];

    for (let offset = count - 1; offset >= 0; offset -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - offset);
      dates.push(getDateStamp(date));
    }

    return dates;
  }

  private findLatestReviewStamp(goals: GoalSummary[]): string | null {
    const stamps = goals
      .map((goal) => goal.lastReviewedAt ?? goal.reviewedAt ?? null)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => right.localeCompare(left));

    return stamps[0] ?? null;
  }

  private isReviewStampInWindow(value: string | null | undefined, windowStart: string, windowEnd: string): boolean {
    if (!value) {
      return false;
    }

    const date = value.slice(0, 10);
    return date >= windowStart && date <= windowEnd;
  }

  private describeGoalHealth(
    healthLevel: GoalReviewMetric["healthLevel"],
    facts: {
      openBlockers: number;
      quietDays: number;
      weeklyCommits: number;
      openTasks: number;
    }
  ): string {
    if (healthLevel === "blocked") {
      return `${facts.openBlockers} 个未解决卡点，先破局再加任务。`;
    }

    if (healthLevel === "stale") {
      return `${facts.quietDays} 天无推进，复盘时决定继续、砍掉或归档。`;
    }

    if (healthLevel === "watch") {
      return facts.weeklyCommits === 0 ? "近 7 天没有提交，至少补一笔真实进展。" : "本周有推进，但节奏或任务堆积需要收敛。";
    }

    return facts.openTasks > 0 ? "节奏健康，下周继续吃掉一个明确任务。" : "节奏健康，可以补充下一步任务或准备归档。";
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, Math.round(value)));
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

    const latestTracker = parsed.frontmatter.tracker_data[parsed.frontmatter.tracker_data.length - 1] ?? null;

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
      latestTrackerId: latestTracker?.id ?? null,
      latestActivityDate: latestTracker?.date ?? parsed.frontmatter.created_at,
      reviewedAt: parsed.frontmatter.reviewed_at ?? null,
      lastReviewedAt: parsed.frontmatter.last_reviewed_at ?? null,
      reviewNotes: parsed.frontmatter.review_notes ?? null,
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

    const reviewFields: Partial<
      Pick<GoalIndexFrontmatter, "reviewed_at" | "last_reviewed_at" | "review_notes">
    > = {};

    if (typeof data.reviewed_at === "string") {
      reviewFields.reviewed_at = data.reviewed_at;
    }

    if (typeof data.last_reviewed_at === "string") {
      reviewFields.last_reviewed_at = data.last_reviewed_at;
    }

    if (typeof data.review_notes === "string") {
      reviewFields.review_notes = data.review_notes;
    }

    return {
      frontmatter: {
        type: "goal_index",
        status: data.status === "archived" ? "archived" : "active",
        created_at: data.created_at,
        goal_name: data.goal_name,
        tracker_data: this.normalizeTrackerEntries(data.tracker_data),
        ...reviewFields
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
    const root = normalizePath(
      assertSafeFolderPath(this.plugin.app, this.plugin.settings.goalRootFolder, "目标根目录")
    );
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
