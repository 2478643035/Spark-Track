<script lang="ts">
  import { createEventDispatcher, onDestroy } from "svelte";
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
  let dragPointerId: number | null = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragActive = false;
  let taskListElement: HTMLDivElement | null = null;
  let touchIdentifier: number | null = null;
  let touchLongPressTimer: number | null = null;
  let touchWindowListenersActive = false;
  let expandedTaskIds = new Set<string>();

  const POINTER_DRAG_THRESHOLD = 6;
  const TOUCH_LONG_PRESS_DELAY = 250;
  const TOUCH_CANCEL_THRESHOLD = 8;

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
    dragPointerId = null;
    dragStartX = 0;
    dragStartY = 0;
    dragActive = false;
    touchIdentifier = null;
    clearTouchLongPressTimer();
    removeTouchWindowListeners();
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

  function suppressNativeDrag(event: Event) {
    if (event.cancelable) {
      event.preventDefault();
    }
  }

  function clearTouchLongPressTimer() {
    if (touchLongPressTimer !== null) {
      window.clearTimeout(touchLongPressTimer);
      touchLongPressTimer = null;
    }
  }

  function findTrackedTouch(touches: TouchList): Touch | null {
    if (touchIdentifier === null) {
      return null;
    }

    for (let index = 0; index < touches.length; index += 1) {
      const touch = touches.item(index);
      if (touch?.identifier === touchIdentifier) {
        return touch;
      }
    }

    return null;
  }

  function addTouchWindowListeners() {
    if (touchWindowListenersActive) {
      return;
    }

    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", finishTouchDrag);
    window.addEventListener("touchcancel", cancelTouchDrag);
    touchWindowListenersActive = true;
  }

  function removeTouchWindowListeners() {
    if (!touchWindowListenersActive) {
      return;
    }

    window.removeEventListener("touchmove", handleTouchMove);
    window.removeEventListener("touchend", finishTouchDrag);
    window.removeEventListener("touchcancel", cancelTouchDrag);
    touchWindowListenersActive = false;
  }

  function taskRowFromPoint(clientX: number, clientY: number): HTMLElement | null {
    const element = document.elementFromPoint(clientX, clientY);
    const row = element?.closest<HTMLElement>(".task-list__row[data-task-id]") ?? null;
    return row && taskListElement?.contains(row) ? row : null;
  }

  function updateDropTarget(clientX: number, clientY: number) {
    if (!draggingTaskId) {
      return;
    }

    const row = taskRowFromPoint(clientX, clientY);
    const targetId = row?.dataset.taskId;
    if (!row || !targetId || targetId === draggingTaskId) {
      dropTargetId = null;
      return;
    }

    const rect = row.getBoundingClientRect();
    dropTargetId = targetId;
    dropPosition = clientY < rect.top + rect.height / 2 ? "before" : "after";
  }

  function handlePointerDown(task: ManagedTask, event: PointerEvent) {
    if (!reorderable || event.pointerType !== "mouse" || event.button !== 0) {
      return;
    }

    suppressNativeDrag(event);
    draggingTaskId = task.id;
    dragPointerId = event.pointerId;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    dragActive = false;

    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  function handleTouchStart(task: ManagedTask, event: TouchEvent) {
    if (!reorderable || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches.item(0);
    if (!touch) {
      return;
    }

    clearDragState();
    draggingTaskId = task.id;
    touchIdentifier = touch.identifier;
    dragStartX = touch.clientX;
    dragStartY = touch.clientY;
    dragActive = false;
    addTouchWindowListeners();

    touchLongPressTimer = window.setTimeout(() => {
      touchLongPressTimer = null;
      if (draggingTaskId === task.id && touchIdentifier === touch.identifier) {
        dragActive = true;
        updateDropTarget(touch.clientX, touch.clientY);
      }
    }, TOUCH_LONG_PRESS_DELAY);
  }

  function handleTouchMove(event: TouchEvent) {
    const touch = findTrackedTouch(event.touches);
    if (!touch || !draggingTaskId) {
      return;
    }

    const distance = Math.hypot(touch.clientX - dragStartX, touch.clientY - dragStartY);
    if (!dragActive && distance > TOUCH_CANCEL_THRESHOLD) {
      clearDragState();
      return;
    }

    if (!dragActive) {
      return;
    }

    suppressNativeDrag(event);
    updateDropTarget(touch.clientX, touch.clientY);
  }

  function finishTouchDrag(event: TouchEvent) {
    const touch = findTrackedTouch(event.changedTouches);
    if (!touch) {
      return;
    }

    if (dragActive) {
      suppressNativeDrag(event);
    }

    if (dragActive && draggingTaskId && dropTargetId && draggingTaskId !== dropTargetId) {
      dispatch("reorder", {
        tasks: moveTask(tasks, draggingTaskId, dropTargetId, dropPosition)
      });
    }

    clearDragState();
  }

  function cancelTouchDrag(event: TouchEvent) {
    const touch = findTrackedTouch(event.changedTouches);
    if (!touch) {
      return;
    }

    if (dragActive) {
      suppressNativeDrag(event);
    }

    clearDragState();
  }

  function handlePointerMove(event: PointerEvent) {
    if (dragPointerId !== event.pointerId || !draggingTaskId) {
      return;
    }

    suppressNativeDrag(event);
    const distance = Math.hypot(event.clientX - dragStartX, event.clientY - dragStartY);
    if (!dragActive && distance < POINTER_DRAG_THRESHOLD) {
      return;
    }

    dragActive = true;
    updateDropTarget(event.clientX, event.clientY);
  }

  function finishPointerDrag(event: PointerEvent) {
    if (dragPointerId !== event.pointerId) {
      return;
    }

    suppressNativeDrag(event);
    if (dragActive && draggingTaskId && dropTargetId && draggingTaskId !== dropTargetId) {
      dispatch("reorder", {
        tasks: moveTask(tasks, draggingTaskId, dropTargetId, dropPosition)
      });
    }

    clearDragState();
  }

  function cancelPointerDrag(event: PointerEvent) {
    if (dragPointerId !== event.pointerId) {
      return;
    }

    suppressNativeDrag(event);
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

  onDestroy(clearDragState);
</script>

<svelte:window
  on:pointermove={handlePointerMove}
  on:pointerup={finishPointerDrag}
  on:pointercancel={cancelPointerDrag}
/>

{#if tasks.length === 0}
  <p class="task-list__empty">{emptyText}</p>
{:else}
  <div bind:this={taskListElement} class:task-list--reorderable={reorderable} class="task-list" role="list">
    {#each displayTasks as item (item.task.id)}
      <div
        class:done={item.task.completed}
        class:dragging={dragActive && draggingTaskId === item.task.id}
        class:drag-over-before={dropTargetId === item.task.id && dropPosition === "before"}
        class:drag-over-after={dropTargetId === item.task.id && dropPosition === "after"}
        class="task-list__row"
        data-task-id={item.task.id}
        role="listitem"
        on:dragstart={suppressNativeDrag}
        on:drop={suppressNativeDrag}
      >
        {#if reorderable}
          <button
            class="task-list__drag"
            draggable="false"
            type="button"
            aria-label="拖动排序"
            on:pointerdown={(event) => handlePointerDown(item.task, event)}
            on:touchstart={(event) => handleTouchStart(item.task, event)}
            on:dragstart={suppressNativeDrag}
            on:contextmenu={suppressNativeDrag}
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
