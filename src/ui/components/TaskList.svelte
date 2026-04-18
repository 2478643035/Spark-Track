<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { ManagedTask } from "../../types";

  export let tasks: ManagedTask[] = [];
  export let emptyText = "鏆傛棤浠诲姟";
  export let reorderable = false;
  export let deletable = false;

  let draggingTaskId: string | null = null;
  let dropTargetId: string | null = null;
  let dropPosition: "before" | "after" = "after";

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
</script>

{#if tasks.length === 0}
  <p class="task-list__empty">{emptyText}</p>
{:else}
  <div class="task-list" role="list">
    {#each tasks as task (task.id)}
      <div
        class:done={task.completed}
        class:dragging={draggingTaskId === task.id}
        class:drag-over-before={dropTargetId === task.id && dropPosition === "before"}
        class:drag-over-after={dropTargetId === task.id && dropPosition === "after"}
        class="task-list__row"
        role="listitem"
        on:dragover={(event) => handleDragOver(task, event)}
        on:drop={(event) => handleDrop(task, event)}
      >
        {#if reorderable}
          <button
            class="task-list__drag"
            draggable="true"
            type="button"
            aria-label="拖动排序"
            on:dragstart={(event) => handleDragStart(task, event)}
            on:dragend={clearDragState}
          >
            ⋮⋮
          </button>
        {/if}

        <label class="task-list__main">
          <input
            type="checkbox"
            checked={task.completed}
            on:change={(event) =>
              dispatch("toggle", {
                task,
                completed: (event.currentTarget as HTMLInputElement).checked
              })}
          />

          <span class="task-list__content">
            <span>{task.text}</span>
            {#if task.goalName}
              <small>{task.goalName}</small>
            {/if}
          </span>
        </label>

        {#if deletable}
          <button class="task-list__delete" type="button" aria-label="删除任务" on:click={() => handleDelete(task)}>
            删除
          </button>
        {/if}
      </div>
    {/each}
  </div>
{/if}
