/**
 * The only values a single week of one allocation row can hold, and the order
 * a click cycles through. Totals and month/quarter averages are not rounded.
 * Add 75 here to get quarter steps.
 */
export const CLICK_STEPS = [0, 25, 50, 100] as const;

/**
 * The next click value after `current`: the smallest step above it, wrapping
 * to 0 from the top. Off-step values (e.g. 60) advance to the next step up.
 */
export function nextStep(current: number, steps: readonly number[] = CLICK_STEPS): number {
  const v = Math.round(current);
  return steps.find((s) => s > v) ?? steps[0];
}

/** Rounds a weekly value to the nearest step (ties round up; anything over the top step becomes the top step). */
export function snapToStep(value: number, steps: readonly number[] = CLICK_STEPS): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  let best = steps[0];
  for (const s of steps) {
    if (Math.abs(s - value) <= Math.abs(best - value)) best = s;
  }
  return best;
}

/** Snaps every weekly value, dropping weeks that round to 0. */
export function snapWeekly(weekly: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [w, v] of Object.entries(weekly)) {
    const snapped = snapToStep(v);
    if (snapped) out[w] = snapped;
  }
  return out;
}
