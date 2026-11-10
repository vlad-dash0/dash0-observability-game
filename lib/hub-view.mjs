// The hub's view data, pure: what the Continue button says and opens. It reads the one
// "what to play next" rule (lib/unlock.mjs nextUp) and only words it; it never picks a level.
import { isCompleted, nextUp } from './unlock.mjs';

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
