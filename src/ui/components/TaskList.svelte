<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { ManagedTask } from "../../types";

  export let tasks: ManagedTask[] = [];
  export let emptyText = "鏆傛棤浠诲姟";
  export let reorderable = false;
  export let deletable = false;
  export let autoSort = false;
  export let showSequence = false;
  export let collapsibleText = false;

  let draggingTaskId: string | null = null;
  let dropTargetId: string | null = null;
  let dropPosition: "before" | "after" = "after";
  let expandedTaskIds = new Set<string>();

  const dispatch = createEventDispatcher<{
    toggle: {
      task: ManagedTask;
      completed: boolean;
    };
    delete: {
      task: ManagedTask;
    };
    reorder: {
      tasks: ManagedTask[];
    };
  }>();

  function clearDragState() {
    draggingTaskId = null;
    dropTargetId = null;
    dropPosition = "after";
  }

  function moveTask(
    list: ManagedTask[],
    draggingId: string,
    targetId: string,
    position: "before" | "after"
  ): ManagedTask[] {
    const next = [...list];
    const draggingIndex = next.findIndex((task) => task.id === draggingId);
    if (draggingIndex === -1) {
      return list;
    }

    const [draggingTask] = next.splice(draggingIndex, 1);
    const targetIndex = next.findIndex((task) => task.id === targetId);
    if (targetIndex === -1) {
      return list;
    }

    next.splice(position === "before" ? targetIndex : targetIndex + 1, 0, draggingTask);
    return next;
  }

  function handleDragStart(task: ManagedTask, event: DragEvent) {
    if (!reorderable) {
      return;
    }

    draggingTaskId = task.id;
    event.dataTransfer?.setData("text/plain", task.id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
    }
  }

  function handleDragOver(task: ManagedTask, event: DragEvent) {
    if (!reorderable || !draggingTaskId || draggingTaskId === task.id) {
      return;
    }

    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    dropTargetId = task.id;
    dropPosition = event.clientY < rect.top + rect.height / 2 ? "before" : "after";

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
  }

  function handleDrop(task: ManagedTask, event: DragEvent) {
    if (!reorderable || !draggingTaskId || draggingTaskId === task.id) {
      clearDragState();
      return;
    }

    event.preventDefault();
    dispatch("reorder", {
      tasks: moveTask(tasks, draggingTaskId, task.id, dropPosition)
    });
    clearDragState();
  }

  function handleDelete(task: ManagedTask) {
    dispatch("delete", { task });
  }

  function isLongTask(task: ManagedTask): boolean {
    return task.text.length > 96 || task.text.includes("\n");
  }

  function toggleTaskExpansion(taskId: string) {
    const next = new Set(expandedTaskIds);
    if (next.has(taskId)) {
      next.delete(taskId);
    } else {
      next.add(taskId);
    }

    expandedTaskIds = next;
  }

  function taskSortKey(task: ManagedTask, fallbackIndex: number): number {
    const token = task.id.match(/^t-([a-z0-9]+)$/i)?.[1];
    if (!token) {
      return Number.MAX_SAFE_INTEGER + fallbackIndex;
    }

    const parsed = Number.parseInt(token, 36);
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER + fallbackIndex;
  }

  function orderedTasks() {
    const indexedTasks = tasks.map((task, index) => ({
      task,
      index,
      sortKey: taskSortKey(task, index),
      sequence: index + 1
    }));
    const sequenceByTaskId = new Map(
      [...indexedTasks]
        .sort((left, right) => left.sortKey - right.sortKey || left.index - right.index)
        .map((item, index) => [item.task.id, index + 1])
    );
    const sequencedTasks = indexedTasks.map((item) => ({
      ...item,
      sequence: sequenceByTaskId.get(item.task.id) ?? item.sequence
    }));

    if (!autoSort) {
      return sequencedTasks;
    }

    return sequencedTasks.sort(
      (left, right) =>
        Number(left.task.completed) - Number(right.task.completed) ||
        left.sortKey - right.sortKey ||
        left.index - right.index
    );
  }

  $: displayTasks = orderedTasks();
</script>

{#if tasks.length === 0}
  <p class="task-list__empty">{emptyText}</p>
{:else}
  <div class="task-list" role="list">
    {#each displayTasks as item (item.task.id)}
      <div
        class:done={item.task.completed}
        class:dragging={draggingTaskId === item.task.id}
        class:drag-over-before={dropTargetId === item.task.id && dropPosition === "before"}
        class:drag-over-after={dropTargetId === item.task.id && dropPosition === "after"}
        class="task-list__row"
        role="listitem"
        on:dragover={(event) => handleDragOver(item.task, event)}
        on:drop={(event) => handleDrop(item.task, event)}
      >
        {#if reorderable}
          <button
            class="task-list__drag"
            draggable="true"
            type="button"
            aria-label="拖动排序"
            on:dragstart={(event) => handleDragStart(item.task, event)}
            on:dragend={clearDragState}
          >
            ⋮⋮
          </button>
        {/if}

        {#if showSequence}
          <span class="task-list__sequence" aria-label={`添加顺序 ${item.sequence}`}>
            {item.sequence}
          </span>
        {/if}

        <label class="task-list__main">
          <input
            type="checkbox"
            checked={item.task.completed}
            on:change={(event) =>
              dispatch("toggle", {
                task: item.task,
                completed: (event.currentTarget as HTMLInputElement).checked
              })}
          />

          <span class="task-list__content">
            <span
              class:task-list__text--folded={collapsibleText && isLongTask(item.task) && !expandedTaskIds.has(item.task.id)}
            >
              {item.task.text}
            </span>
            {#if item.task.goalName}
              <small>{item.task.goalName}</small>
            {/if}
          </span>
        </label>

        {#if collapsibleText && isLongTask(item.task)}
          <button class="task-list__toggle" type="button" on:click={() => toggleTaskExpansion(item.task.id)}>
            {expandedTaskIds.has(item.task.id) ? "收起" : "展开"}
          </button>
        {/if}

        {#if deletable}
          <button class="task-list__delete" type="button" aria-label="删除任务" on:click={() => handleDelete(item.task)}>
            删除
          </button>
        {/if}
      </div>
    {/each}
  </div>
{/if}
