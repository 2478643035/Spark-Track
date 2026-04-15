import { ItemView } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import type { SvelteComponent } from "svelte";
import { VIEW_TITLE, VIEW_TYPE } from "../constants";
import type { NexusViewController } from "../types";
import App from "../ui/App.svelte";

export class NexusCommandView extends ItemView {
  private component: SvelteComponent | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly controller: NexusViewController) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return VIEW_TITLE;
  }

  getIcon(): string {
    return "blocks";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("spark-track-view");
    this.component = new App({
      target: this.contentEl,
      props: {
        controller: this.controller
      }
    });
  }

  async onClose(): Promise<void> {
    this.component?.$destroy();
    this.component = null;
  }
}
