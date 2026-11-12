// The hub's view data, pure: what the Continue button says and opens. It reads the one
// "what to play next" rule (lib/unlock.mjs nextUp) and only words it; it never picks a level.
import { actCounts, isActComplete, isActUnlocked, isCompleted, levelState, nextUp } from './unlock.mjs';

// {levelId, label} for the Continue button, or null (debug, every act complete, no acts).
// "Start: ..." until anything is completed anywhere, "Tend to the incident: ..." for a boss,
// else "Continue: {no} {name}" (no number: "Continue: {name}").
export function continueView(registry, progress, { debug = false } = {}) {
  if (debug === true) return null;
  const next = nextUp(registry, progress);
  if (next === null) return null;
  const level = registry.levels[next.levelId];
  if (level.kind === 'boss') return { levelId: level.id, label: `Tend to the incident: ${level.name}` };
  const started = Object.keys(registry.levels).some((id) => isCompleted(progress, id));
  const what = level.no ? `${level.no} ${level.name}` : level.name;
  return { levelId: level.id, label: `${started ? 'Continue' : 'Start'}: ${what}` };
}

// One row per act, in registry order, for the folded act lines: {id, status, done, total, line,
// expanded}. Status: saved (complete, folded), incident (boss open, unfolded), locked (not yet
// unlocked, folded), open (unfolded). `overrides` (act id -> boolean, the player's choice) beat the
// default; debug unfolds every act by default but keeps the real statuses. Counts are actCounts.
export function hubActs(registry, progress, { debug = false, overrides = {} } = {}) {
  return registry.acts.map((act, index) => {
    const { done, total } = actCounts(act, progress);
    let status = 'open';
    if (isActComplete(act, progress)) status = 'saved';
    else if (act.bossId != null && levelState(act.bossId, progress, registry) === 'open') status = 'incident';
    else if (!isActUnlocked(index, progress, registry)) status = 'locked';
    const title = `Act ${act.no}: ${act.name}`;
    // Debug opens every act, so a locked one reads as open there; `status` stays the real one.
    const words = { saved: ', saved', incident: ', incident open', locked: debug === true ? ', open in debug' : ', locked', open: '' }[status];
    const chosen = Object.hasOwn(overrides, act.id) && typeof overrides[act.id] === 'boolean' ? overrides[act.id] : null;
    const expanded = chosen ?? (debug === true || status === 'open' || status === 'incident');
    return { id: act.id, status, done, total, line: `${title}${words}, ${done} of ${total}`, expanded };
  });
}
