<script lang="ts">
  import { onDestroy } from "svelte";
  import { ACTION_PANEL_OPTIONS, TRACKER_STATUS_META } from "../constants";
  import { CAPTURE_TRIAGE_META, LIGHT_COMMAND_HINTS } from "../runtime-constants";
  import type {
    ActionPanelMode,
    CaptureEntry,
    GoalReviewMetric,
    GoalSummary,
    GoalTrackerStatus,
    NexusState,
    NexusViewController,
    ReviewAction
  } from "../types";
  import AccordionSection from "./components/AccordionSection.svelte";
  import GoalCard from "./components/GoalCard.svelte";
  import TaskList from "./components/TaskList.svelte";

  export let controller: NexusViewController;

  let state: NexusState;
  let captureText = "";
  let selectedChipIds = new Set<string>();
  let actionMode: ActionPanelMode = "life";
  let actionTaskText = "";
  let reviewNoteText = "";
  let selectedGoalIndexPath = "";
  let inboxOpen = true;
  let actionOpen = false;
  let radarOpen = true;
  let reviewOpen = true;
  let goalsOpen = false;
  let expandedGoals = new Set<string>();
  let goalModalOpen = false;
  let goalNameText = "";
  let modalMode: "tracker" | "capture-tracker" | "capture-goal-task" | "resolve" | null = null;
  let modalGoalIndexPath = "";
  let modalTrackerStatus: GoalTrackerStatus = "green";
  let modalCapture: CaptureEntry | null = null;
  let modalBlockerId: string | null = null;
  let modalText = "";
  let expandedCaptureIds = new Set<string>();
  let busy = false;

  const unsubscribe = controller.state.subscribe((value) => {
    state = value;

    const activeGoals = (value.goals ?? []).filter((goal) => goal.status === "active");
    if (!selectedGoalIndexPath && activeGoals.length > 0) {
      selectedGoalIndexPath = activeGoals[0].indexPath;
    }

    if (selectedGoalIndexPath && !activeGoals.some((goal) => goal.indexPath === selectedGoalIndexPath)) {
      selectedGoalIndexPath = activeGoals[0]?.indexPath ?? "";
    }
  });

  onDestroy(unsubscribe);

  $: goals = state?.goals ?? [];
  $: activeGoals = goals.filter((goal) => goal.status === "active");
  $: captures = state?.captures ?? [];
  $: blockers = state?.blockers ?? [];
  $: suggestions = state?.suggestions ?? [];
  $: review = state?.review ?? null;
  $: pendingCaptureCount = captures.filter((capture) => capture.triageStatus === "pending").length;
  $: sortedCaptures = [...captures].sort((left, right) => {
    const leftDone = left.triageStatus === "pending" ? 0 : 1;
    const rightDone = right.triageStatus === "pending" ? 0 : 1;
    return leftDone - rightDone;
  });
  $: selectedGoal = activeGoals.find((goal) => goal.indexPath === selectedGoalIndexPath) ?? null;
  $: modalSelectedGoal = activeGoals.find((goal) => goal.indexPath === modalGoalIndexPath) ?? null;
  $: commandSummary = summarizeCommand(captureText);

  function goalFolderName(goal: GoalSummary): string {
    return goal.folderPath.split("/").pop() ?? goal.folderPath;
  }

  function goalOptionLabel(goal: GoalSummary): string {
    const folderName = goalFolderName(goal);
    return folderName === goal.name ? goal.name : `${goal.name} · ${folderName}`;
  }

  function summarizeCommand(input: string): string {
    const trimmed = input.trim();
    if (!trimmed.startsWith("/")) {
      return "提交后进入收件，稍后分拣。";
    }

    const [commandToken, ...restParts] = trimmed.split(" ");
    const command = commandToken.toLowerCase();
    const rest = restParts.join(" ").trim();

    switch (command) {
      case "/todo":
        return "直接建日常任务。";
      case "/goal":
        return rest ? `新建目标「${rest}」。` : "新建目标。";
      case "/note":
        return "作为笔记保留。";
      case "/yellow":
      case "/green":
      case "/red": {
        const [goalNamePart] = rest.includes("|") ? rest.split("|", 2) : [null];
        const goalName = goalNamePart?.trim();
        return goalName ? `向「${goalName}」写入进展。` : "写入进展；多目标时用「目标 | 内容」。";
      }
      default:
        return "未知命令，支持 /todo /goal /note /yellow /green /red。";
    }
  }

  function toggleChip(chipId: string) {
    const next = new Set(selectedChipIds);
    if (next.has(chipId)) {
      next.delete(chipId);
    } else {
      next.add(chipId);
    }

    selectedChipIds = next;
  }

  function toggleGoal(goalIndexPath: string) {
    const next = new Set(expandedGoals);
    if (next.has(goalIndexPath)) {
      next.delete(goalIndexPath);
    } else {
      next.add(goalIndexPath);
    }

    expandedGoals = next;
  }

  function isLongCapture(capture: CaptureEntry): boolean {
    return capture.text.length > 180 || capture.text.includes("\n");
  }

  function toggleCaptureExpansion(captureId: string) {
    const next = new Set(expandedCaptureIds);
    if (next.has(captureId)) {
      next.delete(captureId);
    } else {
      next.add(captureId);
    }

    expandedCaptureIds = next;
  }

  async function run(action: () => Promise<void>) {
    busy = true;

    try {
      await action();
    } finally {
      busy = false;
    }
  }

  async function submitCapture() {
    if (!captureText.trim()) {
      return;
    }

    await run(async () => {
      await controller.submitCapture({
        text: captureText,
        chipIds: Array.from(selectedChipIds)
      });
      captureText = "";
      selectedChipIds = new Set<string>();
    });
  }

  async function submitActionTask() {
    if (!actionTaskText.trim()) {
      return;
    }

    const text = actionTaskText;

    await run(async () => {
      if (actionMode === "life") {
        await controller.createLifeTask(text);
      } else if (selectedGoalIndexPath) {
        await controller.createGoalTask(selectedGoalIndexPath, text);
      }

      actionTaskText = "";
    });
  }

  async function submitGoalModal() {
    if (!goalNameText.trim()) {
      return;
    }

    await run(async () => {
      await controller.createGoal(goalNameText);
      goalNameText = "";
      goalModalOpen = false;
    });
  }

  function openTrackerModal(goalIndexPath: string, status: GoalTrackerStatus) {
    modalMode = "tracker";
    modalGoalIndexPath = goalIndexPath;
    modalTrackerStatus = status;
    modalCapture = null;
    modalBlockerId = null;
    modalText = "";
  }

  function defaultModalGoalIndexPath(): string {
    return selectedGoalIndexPath || activeGoals[0]?.indexPath || "";
  }

  function openResolveModal(goalIndexPath: string, blockerId: string) {
    modalMode = "resolve";
    modalGoalIndexPath = goalIndexPath;
    modalTrackerStatus = "green";
    modalCapture = null;
    modalBlockerId = blockerId;
    modalText = "";
  }

  function openCaptureTrackerModal(capture: CaptureEntry) {
    modalMode = "capture-tracker";
    modalGoalIndexPath = defaultModalGoalIndexPath();
    modalTrackerStatus = "green";
    modalCapture = capture;
    modalBlockerId = null;
    modalText = capture.text;
  }

  function openCaptureGoalTaskModal(capture: CaptureEntry) {
    modalMode = "capture-goal-task";
    modalGoalIndexPath = defaultModalGoalIndexPath();
    modalTrackerStatus = "green";
    modalCapture = capture;
    modalBlockerId = null;
    modalText = capture.text;
  }

  function closeModal() {
    goalModalOpen = false;
    modalMode = null;
    modalGoalIndexPath = selectedGoalIndexPath;
    modalTrackerStatus = "green";
    modalCapture = null;
    modalBlockerId = null;
    modalText = "";
  }

  async function submitTrackerModal() {
    if (!modalMode || !modalGoalIndexPath || (modalMode !== "capture-goal-task" && !modalText.trim())) {
      return;
    }

    await run(async () => {
      if (modalMode === "tracker") {
        await controller.submitGoalTracker({
          goalIndexPath: modalGoalIndexPath,
          status: modalTrackerStatus,
          note: modalText
        });
      } else if (modalMode === "resolve" && modalBlockerId) {
        await controller.resolveBlocker({
          goalIndexPath: modalGoalIndexPath,
          blockerId: modalBlockerId,
          note: modalText
        });
      } else if (modalMode === "capture-tracker" && modalCapture) {
        await controller.convertCaptureToGoalTracker({
          capture: modalCapture,
          goalIndexPath: modalGoalIndexPath,
          status: modalTrackerStatus
        });
      } else if (modalMode === "capture-goal-task" && modalCapture) {
        await controller.convertCaptureToGoalTask(modalCapture, modalGoalIndexPath);
      }

      closeModal();
    });
  }

  function modalTitle(): string {
    if (modalMode === "resolve") {
      return "记录破局方案";
    }

    if (modalMode === "capture-tracker") {
      return "闪念转进展";
    }

    if (modalMode === "capture-goal-task") {
      return "闪念转目标";
    }

    return TRACKER_STATUS_META[modalTrackerStatus].label;
  }

  function modalSubmitLabel(): string {
    if (modalMode === "resolve") {
      return "确认解决";
    }

    if (modalMode === "capture-tracker") {
      return "写入进展";
    }

    if (modalMode === "capture-goal-task") {
      return "写入目标";
    }

    return "提交";
  }
  function formatReviewPercent(value: number): string {
    return `${Math.round(value * 100)}%`;
  }

  function healthLabel(level: GoalReviewMetric["healthLevel"]): string {
    switch (level) {
      case "blocked":
        return "阻塞";
      case "stale":
        return "停滞";
      case "watch":
        return "观察";
      default:
        return "健康";
    }
  }

  function reviewActionLabel(action: ReviewAction): string {
    if (action.kind === "resolve-blocker") {
      return "破局";
    }

    if (action.kind === "archive-candidate") {
      return "归档";
    }

    return "补进展";
  }

  function runReviewAction(action: ReviewAction) {
    if (action.kind === "resolve-blocker" && action.goalIndexPath && action.blockerId) {
      openResolveModal(action.goalIndexPath, action.blockerId);
      return;
    }

    if (action.goalIndexPath) {
      openTrackerModal(action.goalIndexPath, "green");
    }
  }

  async function archiveReviewCandidate(action: ReviewAction) {
    if (!action.goalIndexPath) {
      return;
    }

    await run(async () => {
      await controller.archiveGoal(action.goalIndexPath!);
    });
  }

  async function submitWeeklyReview() {
    await run(async () => {
      await controller.completeWeeklyReview(reviewNoteText);
      reviewNoteText = "";
    });
  }
</script>

{#if !state}
  <div class="nexus-shell">正在初始化…</div>
{:else}
  <div class="nexus-shell">
    <header class="nexus-header">
      <div>
        <small>Spark Track</small>
        <h1>控制台</h1>
      </div>
      <button type="button" on:click={() => (goalModalOpen = true)}>+ 新目标</button>
    </header>

    {#if state.error}
      <div class="nexus-error">{state.error}</div>
    {/if}

    <AccordionSection
      title="闪念收件"
      subtitle={state.activeNoteName ? `当前笔记：${state.activeNoteName}` : "写入当日日记"}
      count={pendingCaptureCount}
      open={inboxOpen}
      on:toggle={() => (inboxOpen = !inboxOpen)}
    >
      <div class="capture-console">
        <div class="capture-compose">
          <textarea
            bind:value={captureText}
            class="capture-box"
            placeholder="写灵感，或输入 /todo /goal /red ..."
            rows="4"
          ></textarea>

          <p class="capture-command">{commandSummary}</p>

          <div class="chip-row">
            {#each state.captureChips as chip (chip.id)}
              <button
                class:selected={selectedChipIds.has(chip.id)}
                class="chip"
                type="button"
                on:click={() => toggleChip(chip.id)}
              >
                {chip.label}
              </button>
            {/each}
          </div>

          <div class="capture-submit-row">
            <details class="command-hints">
              <summary>指令</summary>
              <div class="command-hints__list">
                {#each LIGHT_COMMAND_HINTS as hint (hint)}
                  <code>{hint}</code>
                {/each}
              </div>
            </details>

            <button class="primary" disabled={busy} type="button" on:click={submitCapture}>
              提交
            </button>
          </div>
        </div>

        <div class="capture-list">
          {#if sortedCaptures.length === 0}
            <p class="task-list__empty">暂无收件。</p>
          {:else}
            {#each sortedCaptures as capture (capture.id)}
              <article class:triaged={capture.triageStatus !== "pending"} class="capture-item">
                <div class="capture-item__meta">
                  <div>
                    <strong>{capture.timestamp}</strong>
                    <small>{capture.chipLabels.join(" ") || "#闪念"}</small>
                  </div>
                  <span
                    class="capture-item__status"
                    data-tone={CAPTURE_TRIAGE_META[capture.triageStatus].tone}
                  >
                    {CAPTURE_TRIAGE_META[capture.triageStatus].label}
                  </span>
                </div>

                <p class="capture-item__text" class:expanded={expandedCaptureIds.has(capture.id)}>{capture.text}</p>

                {#if isLongCapture(capture)}
                  <button
                    class="capture-item__toggle"
                    type="button"
                    on:click={() => toggleCaptureExpansion(capture.id)}
                  >
                    {expandedCaptureIds.has(capture.id) ? "收起" : "展开全文"}
                  </button>
                {/if}

                <div class="capture-item__actions">
                  {#if capture.triageStatus === "pending"}
                    <div class="capture-item__triage">
                      <button type="button" on:click={() => controller.convertCaptureToLifeTask(capture)}>
                        日常
                      </button>
                      <button
                        type="button"
                        disabled={activeGoals.length === 0}
                        on:click={() => openCaptureGoalTaskModal(capture)}
                      >
                        目标
                      </button>
                      <button
                        type="button"
                        disabled={activeGoals.length === 0}
                        on:click={() => openCaptureTrackerModal(capture)}
                      >
                        进展
                      </button>
                      <button type="button" on:click={() => controller.markCaptureKept(capture)}>
                        笔记
                      </button>
                    </div>
                  {/if}
                  <button
                    aria-label="删除闪念"
                    class="capture-item__delete"
                    title="删除闪念"
                    type="button"
                    on:click={() => controller.deleteCapture(capture)}
                  >
                    🗑
                  </button>
                </div>
              </article>
            {/each}
          {/if}
        </div>
      </div>
    </AccordionSection>

    <AccordionSection
      title="雷达"
      subtitle="卡点与建议"
      count={blockers.length}
      open={radarOpen}
      on:toggle={() => (radarOpen = !radarOpen)}
    >
      <div class="radar-grid">
        <section class="radar-card">
          <header>
            <strong>建议</strong>
            <small>卡点、待办、停滞排序</small>
          </header>

          {#if suggestions.length === 0}
            <p class="task-list__empty">今天没有新的推进提示。</p>
          {:else}
            <div class="radar-list">
              {#each suggestions as suggestion (suggestion.id)}
                <article class="radar-item">
                  <div>
                    <strong>{suggestion.title}</strong>
                    <p>{suggestion.detail}</p>
                  </div>

                  {#if suggestion.kind === "blocker" && suggestion.goalIndexPath && suggestion.blockerId}
                    <button
                      type="button"
                      on:click={() => openResolveModal(suggestion.goalIndexPath!, suggestion.blockerId!)}
                    >
                      破局
                    </button>
                  {/if}
                </article>
              {/each}
            </div>
          {/if}
        </section>

        <section class="radar-card">
          <header>
            <strong>卡点</strong>
            <small>2 天以上抬升优先级</small>
          </header>

          {#if blockers.length === 0}
            <p class="task-list__empty">目前没有未解决红点。</p>
          {:else}
            <div class="radar-list">
              {#each blockers as blocker (blocker.trackerId)}
                <article class="radar-item">
                  <div>
                    <strong>{blocker.goalName}</strong>
                    <p>{blocker.daysOpen === 0 ? "今天新出现的卡点" : `${blocker.daysOpen} 天未解决 · ${blocker.date}`}</p>
                  </div>
                  <div class="radar-item__actions">
                    <span class="blocker-pill" data-severity={blocker.severity}>
                      {blocker.severity === "hot" ? "7d+" : "2d+"}
                    </span>
                    <button type="button" on:click={() => openResolveModal(blocker.goalIndexPath, blocker.trackerId)}>
                      破局
                    </button>
                  </div>
                </article>
              {/each}
            </div>
          {/if}
        </section>
      </div>
    </AccordionSection>

    <AccordionSection
      title="复盘"
      variant="review"
      subtitle={review ? `${review.windowStart.slice(5)} - ${review.windowEnd.slice(5)} 周复盘闭环` : "周复盘、健康度、下周动作"}
      count={review ? review.nextActions.length + review.archiveCandidates.length : 0}
      open={reviewOpen}
      on:toggle={() => (reviewOpen = !reviewOpen)}
    >
      {#if !review}
        <p class="task-list__empty">复盘数据还在生成。</p>
      {:else}
        <div class="review-grid">
          <section class="review-card review-hero">
            <div>
              <strong>本周结论</strong>
              <small>
                {review.reviewedThisWindow
                  ? `本周已完成复盘：${review.lastReviewedAt}`
                  : `${review.generatedAt} 生成，尚未完成本周复盘`}
              </small>
            </div>
            <p>
              {review.activeGoalCount} 个活跃目标，近 7 天 {review.weeklyCommitCount} 次推进，
              卡点解决率 {review.openedBlockerCount === 0 ? "无新卡点" : formatReviewPercent(review.blockerResolutionRate)}。
            </p>
          </section>

          <section class="review-stat-strip" aria-label="复盘指标">
            <article class="review-stat">
              <span>活跃目标</span>
              <strong>{review.activeGoalCount}</strong>
            </article>
            <article class="review-stat">
              <span>7 天提交</span>
              <strong>{review.weeklyCommitCount}</strong>
            </article>
            <article class="review-stat">
              <span>待复盘</span>
              <strong>{review.staleGoalCount}</strong>
            </article>
            <article class="review-stat">
              <span>卡点解决</span>
              <strong>{review.resolvedBlockerCount}/{review.openedBlockerCount}</strong>
            </article>
          </section>

          <section class="review-card review-card--primary">
            <header class="review-card__header">
              <strong>下周应该推进什么</strong>
              <small>按卡点、任务、停滞排序</small>
            </header>

            {#if review.nextActions.length === 0}
              <p class="task-list__empty">没有必须推进的动作，可以补一个新目标或归档旧目标。</p>
            {:else}
              <div class="review-action-list">
                {#each review.nextActions as action (action.id)}
                  <article class="review-action">
                    <div>
                      <strong>{action.title}</strong>
                      <p>{action.detail}</p>
                    </div>
                    {#if action.goalIndexPath}
                      <button type="button" on:click={() => runReviewAction(action)}>
                        {reviewActionLabel(action)}
                      </button>
                    {/if}
                  </article>
                {/each}
              </div>
            {/if}
          </section>

          <section class="review-card review-closeout">
            <header class="review-card__header">
              <strong>完成本周复盘</strong>
              <small>写入 active 目标的 optional frontmatter</small>
            </header>
            <textarea
              bind:value={reviewNoteText}
              placeholder="一句话写下下周主线、该砍掉的方向，或本周复盘结论"
              rows="2"
            ></textarea>
            <button class="primary" disabled={busy || review.activeGoalCount === 0} type="button" on:click={submitWeeklyReview}>
              {review.reviewedThisWindow ? "更新复盘记录" : "完成复盘"}
            </button>
          </section>

          <details class="review-card review-disclosure">
            <summary>
              <strong>近 7 天推进热区</strong>
              <small>
                🟡 {review.statusCounts.yellow} · 🟢 {review.statusCounts.green} · 🔴 {review.statusCounts.red}
              </small>
            </summary>
            <div class="review-heat">
              {#each review.heat as day (day.date)}
                <div class="review-day" data-status={day.dominantStatus ?? "idle"}>
                  <span>{day.label}</span>
                  <strong>{day.count}</strong>
                  <small>{day.dominantStatus ? TRACKER_STATUS_META[day.dominantStatus].icon : "·"}</small>
                </div>
              {/each}
            </div>
          </details>

          <details class="review-card review-disclosure" open={review.staleGoalCount > 0 || review.statusCounts.red > 0}>
            <summary>
              <strong>目标健康度</strong>
              <small>分数越低越该复盘</small>
            </summary>

            {#if review.goalMetrics.length === 0}
              <p class="task-list__empty">没有活跃目标。</p>
            {:else}
              <div class="health-list">
                {#each review.goalMetrics.slice(0, 5) as metric (metric.goalIndexPath)}
                  <article class="health-item" data-health={metric.healthLevel}>
                    <div>
                      <strong>{metric.goalName}</strong>
                      <small>{healthLabel(metric.healthLevel)} · {metric.reason}</small>
                    </div>
                    <span>{metric.healthScore}</span>
                  </article>
                {/each}
              </div>
            {/if}
          </details>

          <details class="review-card review-disclosure" open={review.archiveCandidates.length > 0}>
            <summary>
              <strong>该砍什么 / 该归档什么</strong>
              <small>不删除历史，只改 archived</small>
            </summary>

            {#if review.archiveCandidates.length === 0}
              <p class="task-list__empty">暂时没有明确归档候选。</p>
            {:else}
              <div class="review-action-list">
                {#each review.archiveCandidates as candidate (candidate.id)}
                  <article class="review-action">
                    <div>
                      <strong>{candidate.title}</strong>
                      <p>{candidate.detail}</p>
                    </div>
                    {#if candidate.goalIndexPath}
                      <button disabled={busy} type="button" on:click={() => archiveReviewCandidate(candidate)}>
                        归档
                      </button>
                    {/if}
                  </article>
                {/each}
              </div>
            {/if}
          </details>
        </div>
      {/if}
    </AccordionSection>

    <AccordionSection
      title="行动"
      subtitle="日常与目标任务"
      count={actionMode === "life" ? state.lifeTasks.length : state.goalTasks.length}
      open={actionOpen}
      on:toggle={() => (actionOpen = !actionOpen)}
    >
      <div class="panel-stack">
        <div class="mode-toggle">
          {#each ACTION_PANEL_OPTIONS as option (option.id)}
            <button
              class:active={actionMode === option.id}
              type="button"
              on:click={() => (actionMode = option.id)}
            >
              {option.label}
            </button>
          {/each}
        </div>

        {#if actionMode === "goal"}
          <div class="goal-picker">
            <select bind:value={selectedGoalIndexPath}>
              <option value="">选择目标</option>
              {#each activeGoals as goal (goal.indexPath)}
                <option value={goal.indexPath}>{goalOptionLabel(goal)}</option>
              {/each}
            </select>
            {#if selectedGoal}
              <small class="field-path">{selectedGoal.folderPath}</small>
            {/if}
          </div>
        {/if}

        <TaskList
          tasks={actionMode === "life" ? state.lifeTasks : state.goalTasks}
          emptyText={actionMode === "life" ? "还没有日常任务" : "还没有目标提醒"}
          on:toggle={(event) => controller.toggleTask(event.detail.task, event.detail.completed)}
        />

        <div class="task-creator">
          <input bind:value={actionTaskText} placeholder="新建任务" type="text" />
          <button
            class="primary"
            disabled={busy || (actionMode === "goal" && !selectedGoalIndexPath)}
            type="button"
            on:click={submitActionTask}
          >
            添加
          </button>
        </div>
      </div>
    </AccordionSection>

    <AccordionSection
      title="目标"
      subtitle="进展、任务、破局"
      count={activeGoals.length}
      open={goalsOpen}
      on:toggle={() => (goalsOpen = !goalsOpen)}
    >
      <div class="goal-list">
        {#if goals.length === 0}
          <p class="task-list__empty">还没有战略目标，先创建一个。</p>
        {:else}
          {#each goals as goal (goal.indexPath)}
            <GoalCard
              goal={goal}
              open={expandedGoals.has(goal.indexPath)}
              on:toggle={() => toggleGoal(goal.indexPath)}
              on:addTask={(event) => controller.createGoalTask(event.detail.goalIndexPath, event.detail.text)}
              on:toggleTask={(event) => controller.toggleTask(event.detail.task, event.detail.completed)}
              on:deleteTask={(event) => controller.deleteTask(event.detail.task)}
              on:reorderTasks={(event) => controller.reorderTasks(event.detail.tasks)}
              on:tracker={(event) => openTrackerModal(event.detail.goalIndexPath, event.detail.status)}
              on:resolve={(event) => openResolveModal(event.detail.goalIndexPath, event.detail.blockerId)}
              on:archive={(event) => controller.archiveGoal(event.detail.goalIndexPath)}
            />
          {/each}
        {/if}
      </div>
    </AccordionSection>
  </div>
{/if}

{#if goalModalOpen}
  <div class="modal-backdrop" role="presentation" on:click={closeModal}>
    <div
      class="modal-card"
      role="dialog"
      tabindex="-1"
      on:click|stopPropagation
      on:keydown|stopPropagation={() => undefined}
    >
      <h2>新建目标</h2>
      <input bind:value={goalNameText} placeholder="例如：书籍 TTS 工具" type="text" />
      <div class="modal-actions">
        <button type="button" on:click={closeModal}>取消</button>
        <button class="primary" disabled={busy} type="button" on:click={submitGoalModal}>创建</button>
      </div>
    </div>
  </div>
{/if}

{#if modalMode}
  <div class="modal-backdrop" role="presentation" on:click={closeModal}>
    <div
      class="modal-card"
      role="dialog"
      tabindex="-1"
      on:click|stopPropagation
      on:keydown|stopPropagation={() => undefined}
    >
      <h2>{modalTitle()}</h2>

      {#if activeGoals.length > 0}
        <div class="goal-picker">
          <select bind:value={modalGoalIndexPath}>
            {#each activeGoals as goal (goal.indexPath)}
              <option value={goal.indexPath}>{goalOptionLabel(goal)}</option>
            {/each}
          </select>
          {#if modalSelectedGoal}
            <small class="field-path">{modalSelectedGoal.folderPath}</small>
          {/if}
        </div>
      {/if}

      {#if modalMode === "tracker" || modalMode === "capture-tracker"}
        <div class="status-toggle">
          {#each Object.entries(TRACKER_STATUS_META) as [status, meta] (status)}
            <button
              class:active={modalTrackerStatus === status}
              type="button"
              on:click={() => (modalTrackerStatus = status as GoalTrackerStatus)}
            >
              {meta.icon} {meta.label}
            </button>
          {/each}
        </div>
      {/if}

      <textarea
        bind:value={modalText}
        class:modal-textarea--readonly={modalMode === "capture-tracker" || modalMode === "capture-goal-task"}
        readonly={modalMode === "capture-tracker" || modalMode === "capture-goal-task"}
        rows="5"
      ></textarea>

      <div class="modal-actions">
        <button type="button" on:click={closeModal}>取消</button>
        <button
          class="primary"
          disabled={busy || !modalGoalIndexPath || (modalMode !== "capture-goal-task" && !modalText.trim())}
          type="button"
          on:click={submitTrackerModal}
        >
          {modalSubmitLabel()}
        </button>
      </div>
    </div>
  </div>
{/if}
