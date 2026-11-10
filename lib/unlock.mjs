// Unlock rules, pure: an act opens when every earlier act is complete or once it is entered
// (any of its levels or its boss completed; opening a level is not recorded and does not
// count), levels in an open act open in any order, a boss opens once its act's levels are
// done, and a completed level is always 'done' (imported progress is never hidden). The only
// home of these rules. Spec: docs/FOUNDATION.md §3 Unlock, docs/M1-DESIGN.md §3.
// `registry` is the §2.4 shape, `progress` the §2.5 one.

// Completed = has an own entry, whatever its stars (stars 0 is a completion).
export function isCompleted(progress, id) {
  return Object.hasOwn(progress.levels, id);
}

// All of the act's levels and its boss (if it has one) are completed.
export function isActComplete(act, progress) {
  return (
    act.levelIds.every((id) => isCompleted(progress, id)) &&
    (act.bossId == null || isCompleted(progress, act.bossId))
  );
}

// Entered = any of the act's levels or its boss completed.
function isActEntered(act, progress) {
  return (
    act.levelIds.some((id) => isCompleted(progress, id)) ||
    (act.bossId != null && isCompleted(progress, act.bossId))
  );
}

// The act chain, in one place: null when act `index` is unlocked (entered, or every earlier
// act complete), else the first earlier act that is not complete.
function blockingAct(index, progress, registry) {
  const act = registry.acts[index];
  if (act !== undefined && isActEntered(act, progress)) return null;
  return registry.acts.slice(0, index).find((act) => !isActComplete(act, progress)) ?? null;
}

export function isActUnlocked(index, progress, registry) {
  return blockingAct(index, progress, registry) === null;
}

// Why `id` is locked: {kind:'act', actId} names the first incomplete earlier act (an act not
// yet entered); {kind:'boss', remaining} lists the act's unfinished levels; {kind:'unknown'}
// for an id the registry doesn't have (locked, but there is nothing to finish); null when
// playable.
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

// The act's levels in play order, then its boss (if it has one).
function playOrder(act) {
  return act.bossId == null ? act.levelIds : [...act.levelIds, act.bossId];
}

// {done, total} over the act's levels and its boss: the one count the globe and the hub share.
export function actCounts(act, progress) {
  const ids = playOrder(act);
  return { done: ids.filter((id) => isCompleted(progress, id)).length, total: ids.length };
}

// What to play next, the one rule behind Continue, Next up and the globe: {actId, levelId} or
// null (every act complete, or no acts; never a made-up default). The lowest act whose boss is
// open (an incident) wins; else the first incomplete act's first open id in play order.
export function nextUp(registry, progress) {
  for (const act of registry.acts) {
    if (act.bossId != null && levelState(act.bossId, progress, registry) === 'open') {
      return { actId: act.id, levelId: act.bossId };
    }
  }
  const act = registry.acts.find((a) => !isActComplete(a, progress));
  if (act === undefined) return null;
  const levelId = playOrder(act).find((id) => levelState(id, progress, registry) === 'open');
  return levelId === undefined ? null : { actId: act.id, levelId };
}
