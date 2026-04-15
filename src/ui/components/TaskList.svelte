<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import type { ManagedTask } from "../../types";

  export let tasks: ManagedTask[] = [];
  export let emptyText = "暂无任务";

  const dispatch = createEventDispatcher<{
    toggle: {
      task: ManagedTask;
      completed: boolean;
    };
  }>();
</script>

{#if tasks.length === 0}
  <p class="task-list__empty">{emptyText}</p>
{:else}
  <div class="task-list">
    {#each tasks as task (task.id)}
      <label class:done={task.completed} class="task-list__row">
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
    {/each}
  </div>
{/if}
