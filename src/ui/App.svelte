<script lang="ts">
  import { onDestroy } from "svelte";
  import { ACTION_PANEL_OPTIONS, TRACKER_STATUS_META } from "../constants";
  import type {
    ActionPanelMode,
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
  let actionOpen = false;
  let goalsOpen = false;
  let expandedGoals = new Set<string>();
  let trackerModal:
    | {
        goalIndexPath: string;
        status: GoalTrackerStatus;
      }
    | null = null;
  let resolveModal:
    | {
        goalIndexPath: string;
        blockerId: string;
      }
    | null = null;
  let goalModalOpen = false;
  let modalText = "";
  let goalNameText = "";
  let busy = false;

  const unsubscribe = controller.state.subscribe((value) => {
    state = value;

    if (!selectedGoalIndexPath && value.goals.length > 0) {
      const firstActiveGoal = value.goals.find((goal) => goal.status === "active");
      selectedGoalIndexPath = firstActiveGoal?.indexPath ?? "";
    }
  });

  onDestroy(unsubscribe);

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

  async function submitTrackerModal() {
    if (!trackerModal || !modalText.trim()) {
      return;
    }

    const payload = trackerModal;
    const note = modalText;

    await run(async () => {
      await controller.submitGoalTracker({
        goalIndexPath: payload.goalIndexPath,
        status: payload.status,
        note
      });
      trackerModal = null;
      modalText = "";
    });
  }

  async function submitResolveModal() {
    if (!resolveModal || !modalText.trim()) {
      return;
    }

    const payload = resolveModal;
    const note = modalText;

    await run(async () => {
      await controller.resolveBlocker({
        goalIndexPath: payload.goalIndexPath,
        blockerId: payload.blockerId,
        note
      });
      resolveModal = null;
      modalText = "";
    });
  }

  function openTrackerModal(goalIndexPath: string, status: GoalTrackerStatus) {
    trackerModal = {
      goalIndexPath,
      status
    };
    resolveModal = null;
    modalText = "";
  }

  function openResolveModal(goalIndexPath: string, blockerId: string) {
    resolveModal = {
      goalIndexPath,
      blockerId
    };
    trackerModal = null;
    modalText = "";
  }

  function closeModal() {
    trackerModal = null;
    resolveModal = null;
    goalModalOpen = false;
    modalText = "";
  }

  const actionLabel = (status: GoalTrackerStatus) => TRACKER_STATUS_META[status].label;
</script>

{#if !state}
  <div class="nexus-shell">正在初始化…</div>
{:else}
  <div class="nexus-shell">
    <header class="nexus-header">
      <div>
        <small>Nexus Command</small>
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
          placeholder="在这里写下灵感、复盘或一句现场判断"
          rows="4"
        ></textarea>

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

        <button class="primary" disabled={busy} type="button" on:click={submitCapture}>
          发送到 Daily Note
        </button>
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
          <select bind:value={selectedGoalIndexPath}>
            <option value="">选择目标</option>
            {#each state.goals.filter((goal) => goal.status === "active") as goal (goal.indexPath)}
              <option value={goal.indexPath}>{goal.name}</option>
            {/each}
          </select>
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
      count={state.goals.filter((goal) => goal.status === "active").length}
      open={goalsOpen}
      on:toggle={() => (goalsOpen = !goalsOpen)}
    >
      <div class="goal-list">
        {#if state.goals.length === 0}
          <p class="task-list__empty">还没有战略目标，先创建一个。</p>
        {:else}
          {#each state.goals as goal (goal.indexPath)}
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

{#if trackerModal}
  <div class="modal-backdrop" role="presentation" on:click={closeModal}>
    <div
      class="modal-card"
      role="dialog"
      tabindex="-1"
      on:click|stopPropagation
      on:keydown|stopPropagation={() => undefined}
    >
      <h2>{actionLabel(trackerModal.status)}</h2>
      <textarea bind:value={modalText} placeholder="写下这次提交的备注" rows="5"></textarea>
      <div class="modal-actions">
        <button type="button" on:click={closeModal}>取消</button>
        <button class="primary" disabled={busy} type="button" on:click={submitTrackerModal}>提交</button>
      </div>
    </div>
  </div>
{/if}

{#if resolveModal}
  <div class="modal-backdrop" role="presentation" on:click={closeModal}>
    <div
      class="modal-card"
      role="dialog"
      tabindex="-1"
      on:click|stopPropagation
      on:keydown|stopPropagation={() => undefined}
    >
      <h2>记录破局方案</h2>
      <textarea bind:value={modalText} placeholder="写下这次解决阻碍的方法" rows="5"></textarea>
      <div class="modal-actions">
        <button type="button" on:click={closeModal}>取消</button>
        <button class="primary" disabled={busy} type="button" on:click={submitResolveModal}>确认解决</button>
      </div>
    </div>
  </div>
{/if}
