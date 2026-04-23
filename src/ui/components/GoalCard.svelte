<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { TRACKER_STATUS_META } from "../../constants";
  import { createTaskId } from "../../utils/date";
  import type { GoalSummary, HeatmapCell } from "../../types";

  export let goal: GoalSummary;
  export let open = false;

  let taskText = "";
  let taskInputElement: HTMLInputElement | null = null;

  const dispatch = createEventDispatcher<{
    toggle: void;
    addTask: {
      goalIndexPath: string;
      text: string;
      taskId: string;
    };
    sortTasks: {
      goalIndexPath: string;
    };
    tracker: {
      goalIndexPath: string;
      status: "yellow" | "green" | "red";
    };
    resolve: {
      goalIndexPath: string;
      blockerId: string;
    };
    archive: {
      goalIndexPath: string;
    };
  }>();

  function submitTask() {
    const normalizedText = taskText.trim();
    if (!normalizedText) {
      return;
    }

    taskInputElement?.blur();

    dispatch("addTask", {
      goalIndexPath: goal.indexPath,
      text: normalizedText,
      taskId: createTaskId()
    });
    taskText = "";
  }

  function handleCellClick(cell: HeatmapCell) {
    if (cell.status !== "red" || cell.resolved) {
      return;
    }

    dispatch("resolve", {
      goalIndexPath: goal.indexPath,
      blockerId: cell.trackerId
    });
  }

  $: folderName = goal.folderPath.split("/").pop() ?? goal.folderPath;
  $: folderSummary = folderName === goal.name ? goal.folderPath : `${folderName} 路 ${goal.folderPath}`;
</script>

<article class:archived={goal.status === "archived"} class:open={open} class="goal-card">
  <button
    aria-expanded={open}
    class="goal-card__header"
    type="button"
    on:click={() => dispatch("toggle")}
  >
    <div class="goal-card__title">
      <span class="goal-card__dot" data-status={goal.latestStatus ?? "idle"} aria-hidden="true"></span>
      <div>
        <strong>{goal.name}</strong>
        <small>{goal.status === "archived" ? "已归档" : "活跃目标"}</small>
        <small class="goal-card__path">{folderSummary}</small>
      </div>
    </div>

    <span class="goal-card__count">{goal.trackerData.length}</span>
  </button>

  {#if open}
    <div class="goal-card__body">
      <div class="goal-card__heatmap">
        {#if goal.heatmap.length === 0}
          <p class="task-list__empty">暂无进展热力图</p>
        {:else}
          {#each goal.heatmap as cell (cell.date)}
            <button
              class:resolved={cell.resolved}
              class="goal-card__cell"
              data-status={cell.status}
              title={`${cell.date} 路 ${TRACKER_STATUS_META[cell.status].label}`}
              type="button"
              on:click={() => handleCellClick(cell)}
            >
              <span>{cell.date.slice(5)}</span>
              {#if cell.resolved}
                <em>✓</em>
              {/if}
            </button>
          {/each}
        {/if}
      </div>

      <div class="goal-card__actions">
        <button type="button" on:click={() => dispatch("tracker", { goalIndexPath: goal.indexPath, status: "yellow" })}>
          🟡 小修
        </button>
        <button type="button" on:click={() => dispatch("tracker", { goalIndexPath: goal.indexPath, status: "green" })}>
          🟢 突破
        </button>
        <button type="button" on:click={() => dispatch("tracker", { goalIndexPath: goal.indexPath, status: "red" })}>
          🔴 阻碍
        </button>
      </div>

      <form class="goal-card__task-creator" on:submit|preventDefault={submitTask}>
        <input bind:this={taskInputElement} bind:value={taskText} placeholder="新增目标任务" type="text" />
        <button type="submit">添加</button>
      </form>

      <div class="goal-card__task-header">
        <div class="goal-card__task-heading">
          <strong>任务</strong>
          <small>{goal.goalTasks.length === 0 ? "还没有任务" : `共 ${goal.goalTasks.length} 项`}</small>
        </div>
        <button
          class="goal-card__list-button"
          type="button"
          on:click={() => dispatch("sortTasks", { goalIndexPath: goal.indexPath })}
        >
          任务列表
        </button>
      </div>

      <button
        class="goal-card__archive"
        type="button"
        on:click={() => dispatch("archive", { goalIndexPath: goal.indexPath })}
      >
        归档
      </button>
    </div>
  {/if}
</article>
