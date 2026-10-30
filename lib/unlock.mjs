// Unlock rules, pure: acts open in array order (every earlier act complete), levels in an
// open act open in any order, a boss opens once its act's levels are done, and a completed
// level is always 'done' (imported progress is never hidden). The only home of these rules.
// Spec: docs/FOUNDATION.md §3 Unlock. `registry` is the §2.4 shape, `progress` the §2.5 one.

// Completed = has an own entry, whatever its stars (stars 0 is a completion).
export function isCompleted(progress, id) {
  return Object.hasOwn(progress.levels, id);
}

// All of the act's levels and its boss (if it has one) are completed.
export function isActComplete(act, progress) {
  return (
    act.levelIds.every((id) => isCompleted(progress, id)) &&
    (act.bossId === null || isCompleted(progress, act.bossId))
  );
}

// The first earlier act that is not complete, or null when act `index` is unlocked.
function blockingAct(index, progress, registry) {
  return registry.acts.slice(0, index).find((act) => !isActComplete(act, progress)) ?? null;
}

export function isActUnlocked(index, progress, registry) {
  return blockingAct(index, progress, registry) === null;
}

// Why `id` is locked: {kind:'act', actId} names the earlier act to finish first;
// {kind:'boss', remaining} lists the act's unfinished levels; {kind:'unknown'} for an id
// the registry doesn't have (locked, but there is nothing to finish); null when playable.
export function lockReason(id, progress, registry) {
  if (!Object.hasOwn(registry.levels, id)) return { kind: 'unknown' };
  if (isCompleted(progress, id)) return null;
  const level = registry.levels[id];
  const index = registry.acts.findIndex((act) => act.id === level.actId);
  if (index === -1) return { kind: 'unknown' };
  const blocking = blockingAct(index, progress, registry);
  if (blocking !== null) return { kind: 'act', actId: blocking.id };
  if (level.kind === 'boss') {
    const remaining = registry.acts[index].levelIds.filter((l) => !isCompleted(progress, l));
    if (remaining.length > 0) return { kind: 'boss', remaining };
  }
  return null;
}

// 'locked' | 'open' | 'done'. Unknown ids are locked; completed is done even in a locked act.
export function levelState(id, progress, registry) {
  if (!Object.hasOwn(registry.levels, id)) return 'locked';
  if (isCompleted(progress, id)) return 'done';
  return lockReason(id, progress, registry) === null ? 'open' : 'locked';
}
