<script lang="ts">
  import { onDestroy } from "svelte";
  import { ACTION_PANEL_OPTIONS, TRACKER_STATUS_META } from "../constants";
  import { CAPTURE_TRIAGE_META, LIGHT_COMMAND_HINTS } from "../runtime-constants";
  import type {
    ActionPanelMode,
    CaptureEntry,
    GoalSummary,
    GoalTrackerStatus,
    NexusState,
    NexusViewController
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
  let selectedGoalIndexPath = "";
  let inboxOpen = true;
  let actionOpen = false;
  let radarOpen = true;
  let goalsOpen = false;
  let expandedGoals = new Set<string>();
  let goalModalOpen = false;
  let goalNameText = "";
  let modalMode: "tracker" | "capture-tracker" | "resolve" | null = null;
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
  $: selectedGoal = activeGoals.find((goal) => goal.indexPath === selectedGoalIndexPath) ?? null;
  $: modalSelectedGoal = activeGoals.find((goal) => goal.indexPath === modalGoalIndexPath) ?? null;
  $: commandSummary = summarizeCommand(captureText, selectedGoal ? goalOptionLabel(selectedGoal) : null);

  function goalFolderName(goal: GoalSummary): string {
    return goal.folderPath.split("/").pop() ?? goal.folderPath;
  }

  function goalOptionLabel(goal: GoalSummary): string {
    const folderName = goalFolderName(goal);
    return folderName === goal.name ? goal.name : `${goal.name} · ${folderName}`;
  }

  function summarizeCommand(input: string, fallbackGoalName: string | null): string {
    const trimmed = input.trim();
    if (!trimmed.startsWith("/")) {
      return "普通闪念，提交后进入 Inbox。";
    }

    const [commandToken, ...restParts] = trimmed.split(" ");
    const command = commandToken.toLowerCase();
    const rest = restParts.join(" ").trim();

    switch (command) {
      case "/todo":
        return rest ? "命令会直接创建日常任务。": "命令会直接创建日常任务。";
      case "/goal":
        return rest ? `命令会新建目标「${rest}」。` : "命令会新建一个目标。";
      case "/note":
        return "命令会按普通闪念归档。";
      case "/yellow":
      case "/green":
      case "/red": {
        const [goalNamePart] = rest.includes("|") ? rest.split("|", 2) : [fallbackGoalName ?? "当前选中目标"];
        const goalName = goalNamePart?.trim() || fallbackGoalName || "当前选中目标";
        return `命令会向「${goalName}」提交 ${command.slice(1)} 状态。`;
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
        chipIds: Array.from(selectedChipIds),
        selectedGoalIndexPath
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
    modalGoalIndexPath = selectedGoalIndexPath;
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
    if (!modalMode || !modalGoalIndexPath || !modalText.trim()) {
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

    return TRACKER_STATUS_META[modalTrackerStatus].label;
  }

  function modalSubmitLabel(): string {
    if (modalMode === "resolve") {
      return "确认解决";
    }

    if (modalMode === "capture-tracker") {
      return "写入进展";
    }

    return "提交";
  }
</script>

{#if !state}
  <div class="nexus-shell">正在初始化…</div>
{:else}
  <div class="nexus-shell">
    <header class="nexus-header">
      <div>
        <small>Spark Track</small>
        <h1>侧边控制台</h1>
      </div>
      <button type="button" on:click={() => (goalModalOpen = true)}>+ 新目标</button>
    </header>

    {#if state.error}
      <div class="nexus-error">{state.error}</div>
    {/if}

    <AccordionSection
      title="闪念输入舱"
      subtitle={state.activeNoteName ? `当前笔记：${state.activeNoteName}` : "静默写入当日日记"}
      open={true}
    >
      <div class="panel-stack">
        <textarea
          bind:value={captureText}
          class="capture-box"
          placeholder="写灵感，或直接输入 /todo /goal /red ..."
          rows="4"
        ></textarea>

        <p class="capture-command">{commandSummary}</p>

        {#if activeGoals.length > 0}
          <div class="capture-goal">
            <span>命令 / Inbox 默认目标</span>
            <select bind:value={selectedGoalIndexPath}>
              {#each activeGoals as goal (goal.indexPath)}
                <option value={goal.indexPath}>{goalOptionLabel(goal)}</option>
              {/each}
            </select>
            {#if selectedGoal}
              <small class="field-path">{selectedGoal.folderPath}</small>
            {/if}
          </div>
        {/if}

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

        <div class="command-hints">
          {#each LIGHT_COMMAND_HINTS as hint (hint)}
            <code>{hint}</code>
          {/each}
        </div>

        <button class="primary" disabled={busy} type="button" on:click={submitCapture}>
          提交
        </button>
      </div>
    </AccordionSection>

    <AccordionSection
      title="Inbox"
      subtitle="最近 capture，可二次分拣为任务或进展"
      count={captures.filter((capture) => capture.triageStatus === "pending").length}
      open={inboxOpen}
      on:toggle={() => (inboxOpen = !inboxOpen)}
    >
      <div class="capture-list">
        {#if captures.length === 0}
          <p class="task-list__empty">最近没有 capture。</p>
        {:else}
          {#each captures as capture (capture.id)}
            <article class="capture-item">
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

              {#if capture.triageStatus === "pending"}
                <div class="capture-item__actions">
                  <button type="button" on:click={() => controller.convertCaptureToLifeTask(capture)}>
                    转日常任务
                  </button>
                  <button
                    type="button"
                    disabled={!selectedGoalIndexPath}
                    on:click={() => controller.convertCaptureToGoalTask(capture, selectedGoalIndexPath)}
                  >
                    转目标任务
                  </button>
                  <button
                    type="button"
                    disabled={!selectedGoalIndexPath}
                    on:click={() => openCaptureTrackerModal(capture)}
                  >
                    转进展
                  </button>
                  <button type="button" on:click={() => controller.markCaptureKept(capture)}>
                    保留
                  </button>
                </div>
              {/if}
            </article>
          {/each}
        {/if}
      </div>
    </AccordionSection>

    <AccordionSection
      title="推进雷达"
      subtitle="卡点老化 + 今日推进建议"
      count={blockers.length}
      open={radarOpen}
      on:toggle={() => (radarOpen = !radarOpen)}
    >
      <div class="radar-grid">
        <section class="radar-card">
          <header>
            <strong>今日推进建议</strong>
            <small>按卡点、待办、停滞目标排序</small>
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
            <strong>待破局卡点</strong>
            <small>2 天以上会持续抬升优先级</small>
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
                      记录破局
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
      title="双轨控制台"
      subtitle="任务只同步插件管理区块"
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
      title="战略目标阵列"
      subtitle="目标索引 + 热力图 + 破局闭环"
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

      {#if modalMode !== "resolve"}
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

      <textarea bind:value={modalText} rows="5"></textarea>

      <div class="modal-actions">
        <button type="button" on:click={closeModal}>取消</button>
        <button class="primary" disabled={busy || !modalGoalIndexPath} type="button" on:click={submitTrackerModal}>
          {modalSubmitLabel()}
        </button>
      </div>
    </div>
  </div>
{/if}
