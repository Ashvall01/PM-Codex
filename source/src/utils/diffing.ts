import { useSyncQueueStore, ActionType } from '../store/syncQueueStore';

/**
 * Compares two arrays of objects (which must have an `id` or `projectId` property)
 * and generates Job entries in the syncQueueStore for any changes.
 */
export function trackArrayDifferences(
  entityStore: string, 
  prevArray: any[] | undefined, 
  newArray: any[] | undefined
) {
  const oldArr = prevArray || [];
  const newArr = newArray || [];

  const getId = (item: any) => item.id || item.projectId;

  const oldMap = new Map(oldArr.map(item => [getId(item), item]));
  const addJob = useSyncQueueStore.getState().addJob;

  for (const newItem of newArr) {
    const newId = getId(newItem);
    if (!newId) continue;
    
    if (!oldMap.has(newId)) {
      // It's a CREATE
      addJob(entityStore, newId, 'CREATE', newItem);
    } else {
      // Check if it's an UPDATE by doing a shallow or deep comparison
      const oldItem = oldMap.get(newId);
      // Stores replace only the record that changed, so an untouched record is
      // the very same object. Skipping it saves turning every record of the
      // store into text on each save, which grew with the size of the project.
      if (oldItem === newItem) continue;
      if (JSON.stringify(oldItem) !== JSON.stringify(newItem)) {
        addJob(entityStore, newId, 'UPDATE', newItem);
      }
    }
  }

  // Check for DELETEs
  const newMap = new Map(newArr.map(item => [getId(item), item]));
  for (const oldItem of oldArr) {
    const oldId = getId(oldItem);
    if (oldId && !newMap.has(oldId)) {
      addJob(entityStore, oldId, 'DELETE', null);
    }
  }
}

