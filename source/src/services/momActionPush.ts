import { useMomStore, MoMActionItem, normalizeMoMActionItemStatus } from '../store/momStore';
import { useTasksStore } from '../store/tasksStore';

/**
 * PUSHING MEETING ACTION ITEMS TO THE TASK TRACKER
 *
 * An action item lives in the minutes. It reaches the task tracker only when
 * the user pushes it: the push button on one item, or PUSH ALL on the minutes.
 * Signing off a meeting proposal does NOT push anything (decision of 23 Sep
 * 2026 — the automatic push on sign-off was removed).
 *
 * A push creates one task that carries every field the action item has, and
 * writes the new task id back onto the item. That id is the link: the MoM
 * screen then shows the task's values, and edits go to the task.
 */

/** True when this item has no linked task yet. `'pushed'` is an old marker with no real link. */
export function isActionItemUnpushed(item: Pick<MoMActionItem, 'taskId'>): boolean {
  return !item.taskId || item.taskId === 'pushed';
}

/** True when an item is worth a task: not pushed, has a description, not closed. */
export function isActionItemPushable(item: MoMActionItem): boolean {
  if (!isActionItemUnpushed(item)) return false;
  if (!item.description || !item.description.trim()) return false;
  const status = normalizeMoMActionItemStatus(item.status);
  return status !== 'Done' && status !== 'Dropped';
}

/**
 * Push action items of one saved MoM to the task tracker.
 *
 * @param itemIds  the items to push; leave out to push every pushable item.
 * @returns the ids of the tasks it created.
 */
export function pushActionItemsToTracker(momId: string, itemIds?: string[]): string[] {
  const mom = useMomStore.getState().moms.find((m) => m.id === momId);
  if (!mom) return [];

  const addTask = useTasksStore.getState().addTask;
  const updateActionItem = useMomStore.getState().updateActionItem;
  const created: string[] = [];

  for (const item of mom.actionItems || []) {
    if (itemIds && !itemIds.includes(item.id)) continue;
    if (!isActionItemUnpushed(item)) continue;
    if (!item.description || !item.description.trim()) continue;
    // Push all skips closed items; a push of one named item does not.
    if (!itemIds && !isActionItemPushable(item)) continue;

    const taskId = addTask({
      projectId: mom.projectId,
      type: item.type === 'Issue' ? 'Issue' : 'Action Item',
      description: item.description,
      status: normalizeMoMActionItemStatus(item.status),
      owner: item.assignee || 'Unassigned',
      source: mom.title || 'Meeting Minutes',
      priority: item.priority || undefined,
      estimatedResolutionDate: item.estimatedResolutionDate || '',
      remarks: item.remarks || '',
      comments: [],
      linkedActivityIds: item.linkedActivityIds || [],
    });

    updateActionItem(momId, item.id, { taskId });
    created.push(taskId);
  }

  return created;
}
