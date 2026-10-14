import { uniqueName } from '../domain/plans';
import { useCollabStore } from '../store/collabStore';
import { createSharedPlan, openSharedPlan } from '../store/sharedPlanStore';
import { useUIStore } from '../store/uiStore';

/** Asks for a name and creates an empty plan in the shared workspace, then opens it. */
export async function createSharedPlanInteractively() {
  const { plans, toast } = useCollabStore.getState();
  const name = window.prompt('Name for the new (empty) plan:', uniqueName('New plan', plans.map((p) => p.name)))?.trim();
  if (!name) return;
  try {
    const plan = await createSharedPlan(name);
    openSharedPlan(plan.id);
    useUIStore.getState().resetFilters();
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
}
