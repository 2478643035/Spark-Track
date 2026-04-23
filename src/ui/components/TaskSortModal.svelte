<script lang="ts">
  import { onDestroy } from "svelte";
  import type { ManagedTask } from "../../types";

  export let goalName = "";
  export let tasks: ManagedTask[] = [];
  export let onSave: (tasks: ManagedTask[]) => void | Promise<void>;
  export let onToggle: (task: ManagedTask, completed: boolean) => void | Promise<void>;
  export let onDelete: (task: ManagedTask) => void | Promise<void>;
  export let onCancel: () => void;

  let localTasks: ManagedTask[] = [];
  let draggingTaskId: string | null = null;
  let dropTargetId: string | null = null;
  let dropPosition: "before" | "after" = "after";
  let dragPointerId: number | null = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragActive = false;
  let touchIdentifier: number | null = null;
  let listContainerElement: HTMLDivElement | null = null;
  let touchWindowListenersActive = false;
  let saving = false;
  let mutatingTaskIds = new Set<string>();
  let didInitialize = false;
  let lastIncomingSignature = "";
  let hapticFeedbackSent = false;
  let hasUnsavedOrder = false;

  const POINTER_DRAG_THRESHOLD = 6;
  const AUTO_SCROLL_THRESHOLD = 56;
  const AUTO_SCROLL_STEP = 20;

  function cloneTasks(source: ManagedTask[]): ManagedTask[] {
    return source.map((task) => ({ ...task }));
  }

  function syncLocalTasks(source: ManagedTask[]) {
    localTasks = cloneTasks(source);
    lastIncomingSignature = source.map((task) => task.id).join("|");
    didInitialize = true;
    hasUnsavedOrder = false;
    clearDragState();
  }

  function clearDragState() {
    draggingTaskId = null;
    dropTargetId = null;
    dropPosition = "after";
    dragPointerId = null;
    dragStartX = 0;
    dragStartY = 0;
    dragActive = false;
    touchIdentifier = null;
    hapticFeedbackSent = false;
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

  function suppressEvent(event: Event) {
    if (event.cancelable) {
      event.preventDefault();
    }
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

  function taskRowFromPoint(clientX: number, clientY: number): HTMLElement | null {
    const element = document.elementFromPoint(clientX, clientY);
    const row = element?.closest<HTMLElement>(".task-sort-modal__row[data-task-id]") ?? null;
    return row && listContainerElement?.contains(row) ? row : null;
  }

  function maybeAutoScroll(clientY: number) {
    if (!listContainerElement || !dragActive) {
      return;
    }

    const rect = listContainerElement.getBoundingClientRect();
    if (clientY < rect.top + AUTO_SCROLL_THRESHOLD) {
      listContainerElement.scrollTop -= AUTO_SCROLL_STEP;
    } else if (clientY > rect.bottom - AUTO_SCROLL_THRESHOLD) {
      listContainerElement.scrollTop += AUTO_SCROLL_STEP;
    }
  }

  function updateDropTarget(clientX: number, clientY: number) {
    if (!draggingTaskId) {
      return;
    }

    maybeAutoScroll(clientY);

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

  function emitHapticFeedback() {
    if (hapticFeedbackSent) {
      return;
    }

    navigator.vibrate?.(10);
    hapticFeedbackSent = true;
  }

  function activateDrag(clientX: number, clientY: number) {
    if (dragActive) {
      return;
    }

    dragActive = true;
    emitHapticFeedback();
    updateDropTarget(clientX, clientY);
  }

  function commitReorder() {
    if (!dragActive || !draggingTaskId || !dropTargetId || draggingTaskId === dropTargetId) {
      clearDragState();
      return;
    }

    localTasks = moveTask(localTasks, draggingTaskId, dropTargetId, dropPosition);
    hasUnsavedOrder = true;
    clearDragState();
  }

  function markTaskMutating(taskId: string, mutating: boolean) {
    const next = new Set(mutatingTaskIds);
    if (mutating) {
      next.add(taskId);
    } else {
      next.delete(taskId);
    }
    mutatingTaskIds = next;
  }

  async function handleToggle(task: ManagedTask, completed: boolean) {
    if (saving || mutatingTaskIds.has(task.id)) {
      return;
    }

    localTasks = localTasks.map((entry) => (entry.id === task.id ? { ...entry, completed } : entry));
    markTaskMutating(task.id, true);

    try {
      await onToggle(task, completed);
    } finally {
      markTaskMutating(task.id, false);
    }
  }

  async function handleDelete(task: ManagedTask) {
    if (saving || mutatingTaskIds.has(task.id)) {
      return;
    }

    localTasks = localTasks.filter((entry) => entry.id !== task.id);
    markTaskMutating(task.id, true);

    try {
      await onDelete(task);
    } finally {
      markTaskMutating(task.id, false);
    }
  }

  function handlePointerDown(task: ManagedTask, event: PointerEvent) {
    if (event.pointerType !== "mouse" || event.button !== 0) {
      return;
    }

    suppressEvent(event);
    draggingTaskId = task.id;
    dragPointerId = event.pointerId;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    dragActive = false;
    dropTargetId = null;
    dropPosition = "after";
    hapticFeedbackSent = false;

    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  function handleTouchStart(task: ManagedTask, event: TouchEvent) {
    if (event.touches.length !== 1) {
      return;
    }

    const touch = event.touches.item(0);
    if (!touch) {
      return;
    }

    suppressEvent(event);
    clearDragState();
    draggingTaskId = task.id;
    touchIdentifier = touch.identifier;
    dragStartX = touch.clientX;
    dragStartY = touch.clientY;
    addTouchWindowListeners();
    activateDrag(touch.clientX, touch.clientY);
  }

  function handlePointerMove(event: PointerEvent) {
    if (dragPointerId !== event.pointerId || !draggingTaskId) {
      return;
    }

    const distance = Math.hypot(event.clientX - dragStartX, event.clientY - dragStartY);
    if (!dragActive && distance < POINTER_DRAG_THRESHOLD) {
      return;
    }

    suppressEvent(event);
    if (!dragActive) {
      activateDrag(event.clientX, event.clientY);
      return;
    }

    updateDropTarget(event.clientX, event.clientY);
  }

  function finishPointerDrag(event: PointerEvent) {
    if (dragPointerId !== event.pointerId) {
      return;
    }

    if (dragActive) {
      suppressEvent(event);
    }

    commitReorder();
  }

  function cancelPointerDrag(event: PointerEvent) {
    if (dragPointerId !== event.pointerId) {
      return;
    }

    if (dragActive) {
      suppressEvent(event);
    }

    clearDragState();
  }

  function handleTouchMove(event: TouchEvent) {
    const touch = findTrackedTouch(event.touches);
    if (!touch || !draggingTaskId) {
      return;
    }

    if (dragActive) {
      suppressEvent(event);
    }

    updateDropTarget(touch.clientX, touch.clientY);
  }

  function finishTouchDrag(event: TouchEvent) {
    const touch = findTrackedTouch(event.changedTouches);
    if (!touch) {
      return;
    }

    if (dragActive) {
      suppressEvent(event);
    }

    commitReorder();
  }

  function cancelTouchDrag(event: TouchEvent) {
    const touch = findTrackedTouch(event.changedTouches);
    if (!touch) {
      return;
    }

    if (dragActive) {
      suppressEvent(event);
    }

    clearDragState();
  }

  async function handleSave() {
    if (saving || mutatingTaskIds.size > 0 || localTasks.length < 2) {
      return;
    }

    saving = true;
    try {
      await onSave(cloneTasks(localTasks));
      hasUnsavedOrder = false;
    } finally {
      saving = false;
    }
  }

  function closeModal() {
    if (saving || mutatingTaskIds.size > 0) {
      return;
    }

    onCancel();
  }

  $: incomingSignature = tasks.map((task) => `${task.id}:${task.completed ? "1" : "0"}`).join("|");
  $: if (!didInitialize || (!dragActive && !hasUnsavedOrder && incomingSignature !== lastIncomingSignature)) {
    syncLocalTasks(tasks);
  }

  onDestroy(clearDragState);
</script>

<svelte:window
  on:pointermove={handlePointerMove}
  on:pointerup={finishPointerDrag}
  on:pointercancel={cancelPointerDrag}
/>

<div class="task-sort-modal">
  <header class="task-sort-modal__header">
    <div>
      <small>任务列表</small>
      <h2>{goalName}</h2>
    </div>
    <p>{localTasks.length < 2 ? "这里显示全部任务。" : "拖动手柄调整顺序，保存后写回笔记。"}</p>
  </header>

  {#if localTasks.length === 0}
    <div class="task-sort-modal__empty">
      <strong>当前还没有任务</strong>
      <p>可以先回到目标卡片里添加一条任务。</p>
    </div>
  {:else}
    <div bind:this={listContainerElement} class="task-sort-modal__list" role="list">
      {#each localTasks as task, index (task.id)}
        <div
          class:dragging={dragActive && draggingTaskId === task.id}
          class:done={task.completed}
          class:drag-over-before={dropTargetId === task.id && dropPosition === "before"}
          class:drag-over-after={dropTargetId === task.id && dropPosition === "after"}
          class="task-sort-modal__row"
          data-task-id={task.id}
          role="listitem"
        >
          <button
            class="task-sort-modal__handle"
            type="button"
            aria-label={`拖动排序 ${task.text}`}
            on:pointerdown={(event) => handlePointerDown(task, event)}
            on:touchstart={(event) => handleTouchStart(task, event)}
            on:dragstart={suppressEvent}
            on:contextmenu={suppressEvent}
          >
            ⋮⋮
          </button>

          <span class="task-sort-modal__index">{index + 1}</span>

          <div class="task-sort-modal__content">
            <label class="task-sort-modal__toggle">
              <input
                type="checkbox"
                checked={task.completed}
                disabled={saving || mutatingTaskIds.has(task.id)}
                on:change={(event) => handleToggle(task, (event.currentTarget as HTMLInputElement).checked)}
              />
              <strong>{task.text}</strong>
            </label>
            {#if task.goalName}
              <small>{task.goalName}</small>
            {/if}
          </div>

          <button
            class="task-sort-modal__delete"
            type="button"
            disabled={saving || mutatingTaskIds.has(task.id)}
            on:click={() => handleDelete(task)}
          >
            删除
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <footer class="task-sort-modal__footer">
    <button type="button" on:click={closeModal}>
      {localTasks.length === 0 ? "关闭" : "取消"}
    </button>

    {#if localTasks.length > 0}
      <button
        class="primary"
        type="button"
        disabled={saving || mutatingTaskIds.size > 0 || localTasks.length < 2}
        on:click={handleSave}
      >
        {saving ? "保存中..." : "保存"}
      </button>
    {/if}
  </footer>
</div>
