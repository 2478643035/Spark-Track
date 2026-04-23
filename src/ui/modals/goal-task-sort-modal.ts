import { Modal } from "obsidian";
import type { SvelteComponent } from "svelte";
import type { GoalSummary, ManagedTask, NexusState, NexusViewController } from "../../types";
import TaskSortModal from "../components/TaskSortModal.svelte";

type GoalTaskSortModalOptions = {
  controller: NexusViewController;
  goalIndexPath: string;
  goalName: string;
  goalTasks: ManagedTask[];
};

export class GoalTaskSortModal extends Modal {
  private component: SvelteComponent | null = null;
  private unsubscribe: (() => void) | null = null;
  private latestGoalName: string;

  constructor(app: Modal["app"], private readonly options: GoalTaskSortModalOptions) {
    super(app);
    this.latestGoalName = options.goalName;
  }

  onOpen(): void {
    this.modalEl.addClass("spark-track-sort-modal");
    this.contentEl.empty();
    this.contentEl.addClass("spark-track-sort-modal__content");

    this.component = new TaskSortModal({
      target: this.contentEl,
      props: {
        goalName: this.options.goalName,
        tasks: this.options.goalTasks,
        onSave: async (tasks: ManagedTask[]) => {
          await this.options.controller.reorderTasks(tasks);
          this.close();
        },
        onToggle: async (task: ManagedTask, completed: boolean) => {
          await this.options.controller.toggleTask(task, completed);
        },
        onDelete: async (task: ManagedTask) => {
          await this.options.controller.deleteTask(task);
        },
        onCancel: () => this.close()
      }
    });

    this.unsubscribe = this.options.controller.state.subscribe((state) => {
      const nextGoal = this.findGoal(state);
      const nextTasks = nextGoal?.goalTasks ?? [];
      const nextGoalName = nextGoal?.name ?? this.latestGoalName;
      this.latestGoalName = nextGoalName;

      this.component?.$set({
        goalName: nextGoalName,
        tasks: nextTasks
      });
    });
  }

  onClose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;

    this.component?.$destroy();
    this.component = null;

    this.contentEl.empty();
    this.contentEl.removeClass("spark-track-sort-modal__content");
    this.modalEl.removeClass("spark-track-sort-modal");
  }

  private findGoal(state: NexusState): GoalSummary | null {
    return state.goals.find((goal) => goal.indexPath === this.options.goalIndexPath) ?? null;
  }
}
