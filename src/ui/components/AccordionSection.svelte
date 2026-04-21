<script lang="ts">
  import { createEventDispatcher } from "svelte";

  export let title = "";
  export let open = false;
  export let count: number | null = null;
  export let subtitle = "";
  export let variant: "default" | "review" = "default";

  const dispatch = createEventDispatcher<{ toggle: void }>();
</script>

<section class:open class:accordion--review={variant === "review"} class="accordion">
  <button class="accordion__trigger" type="button" on:click={() => dispatch("toggle")}>
    <div class="accordion__label">
      <strong>{title}</strong>
      {#if subtitle}
        <span>{subtitle}</span>
      {/if}
    </div>

    <div class="accordion__meta">
      {#if count !== null}
        <span class="accordion__count">{count}</span>
      {/if}
      <span class="accordion__chevron">{open ? "-" : "+"}</span>
    </div>
  </button>

  {#if open}
    <div class="accordion__body">
      <slot />
    </div>
  {/if}
</section>
