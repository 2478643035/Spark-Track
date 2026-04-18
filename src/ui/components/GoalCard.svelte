<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { TRACKER_STATUS_META } from "../../constants";
  import type { GoalSummary, HeatmapCell, ManagedTask } from "../../types";
  import TaskList from "./TaskList.svelte";

  export let goal: GoalSummary;
  export let open = false;

  let taskText = "";

  const dispatch = createEventDispatcher<{
    toggle: void;
    addTask: {
      goalIndexPath: string;
      text: string;
    };
    toggleTask: {
      task: ManagedTask;
      completed: boolean;
    };
    deleteTask: {
      task: ManagedTask;
    };
    reorderTasks: {
      tasks: ManagedTask[];
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
    if (!taskText.trim()) {
      return;
    }

    dispatch("addTask", {
      goalIndexPath: goal.indexPath,
      text: taskText
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
  $: folderSummary = folderName === goal.name ? goal.folderPath : `${folderName} · ${goal.folderPath}`;
</script>

<article class:archived={goal.status === "archived"} class="goal-card">
  <button class="goal-card__header" type="button" on:click={() => dispatch("toggle")}>
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
              title={`${cell.date} · ${TRACKER_STATUS_META[cell.status].label}`}
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
          🟡 小修补
        </button>
        <button type="button" on:click={() => dispatch("tracker", { goalIndexPath: goal.indexPath, status: "green" })}>
          🟢 核心突破
        </button>
        <button type="button" on:click={() => dispatch("tracker", { goalIndexPath: goal.indexPath, status: "red" })}>
          🔴 遇到阻碍
        </button>
      </div>

      <div class="goal-card__task-creator">
        <input bind:value={taskText} placeholder="新增目标任务" type="text" />
        <button type="button" on:click={submitTask}>添加</button>
      </div>

      <TaskList
        tasks={goal.goalTasks}
        reorderable={true}
        deletable={true}
        emptyText="这个目标还没有待办"
        on:toggle={(event) => dispatch("toggleTask", event.detail)}
        on:delete={(event) => dispatch("deleteTask", event.detail)}
        on:reorder={(event) => dispatch("reorderTasks", event.detail)}
      />

      <button
        class="goal-card__archive"
        type="button"
        on:click={() => dispatch("archive", { goalIndexPath: goal.indexPath })}
      >
        归档目标
      </button>
    </div>
  {/if}
</article>
