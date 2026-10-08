import { uniqueName } from '../domain/plans';
import { allPlans, findPlanByName, usePlanStore } from '../store/planStore';
import { useUIStore } from '../store/uiStore';

/** Asks for a new plan's name; returns null if cancelled or already taken. */
export function promptPlanName(message: string, suggestion: string): string | null {
  const name = window.prompt(message, suggestion)?.trim();
  if (!name) return null;
  if (findPlanByName(usePlanStore.getState(), name)) {
    window.alert(`A plan called "${name}" already exists.`);
    return null;
  }
  return name;
}

export function createPlanInteractively() {
  const s = usePlanStore.getState();
  const name = promptPlanName(
    'Name for the new (empty) plan:',
    uniqueName('New plan', allPlans(s).map((p) => p.meta.name)),
  );
  if (!name) return;
  s.newPlan(name);
  useUIStore.getState().resetFilters();
}
