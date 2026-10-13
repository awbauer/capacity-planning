import { useShallow } from 'zustand/react/shallow';
import { allPlans, usePlanStore } from '../store/planStore';
import { useUIStore } from '../store/uiStore';
import { createPlanInteractively } from './planActions';
import { createSharedPlanInteractively } from '../collab/sharedPlanActions';
import { useCollabStore } from '../store/collabStore';
import { isShared } from '../store/mode';
import { openSharedPlan } from '../store/sharedPlanStore';
import { useCan } from '../store/useCan';

const NEW = '__new';
const MANAGE = '__manage';

/** Toolbar dropdown listing the plans: this browser's, or the shared workspace's. */
export function PlanSwitcher() {
  return isShared() ? <SharedPlanSwitcher /> : <LocalPlanSwitcher />;
}

function SharedPlanSwitcher() {
  const plans = useCollabStore((s) => s.plans);
  const activeId = usePlanStore((s) => s.meta.id);
  const can = useCan();
  const ui = useUIStore();
  return (
    <select
      className="plan-switcher"
      aria-label="Plan"
      title="Plans in the shared workspace. Manage → Plans to rename or archive."
      value={activeId}
      onChange={(e) => {
        const value = e.target.value;
        if (value === NEW) void createSharedPlanInteractively();
        else if (value === MANAGE) ui.openManage('plans');
        else {
          openSharedPlan(value);
          ui.resetFilters();
        }
      }}
    >
      {plans.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
      <option disabled>──────────</option>
      {can.edit && <option value={NEW}>＋ New plan…</option>}
      <option value={MANAGE}>Manage plans…</option>
    </select>
  );
}

function LocalPlanSwitcher() {
  const plans = usePlanStore(useShallow((s) => allPlans(s).map((p) => p.meta)));
  const activeId = usePlanStore((s) => s.meta.id);
  const switchPlan = usePlanStore((s) => s.switchPlan);
  const ui = useUIStore();

  return (
    <select
      className="plan-switcher"
      aria-label="Plan"
      title="Plans saved in this browser. Rename or delete them under Manage → Plans."
      value={activeId}
      onChange={(e) => {
        const value = e.target.value;
        if (value === NEW) createPlanInteractively();
        else if (value === MANAGE) ui.openManage('plans');
        else {
          switchPlan(value);
          ui.resetFilters();
        }
      }}
    >
      {plans.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name} · v{m.revision}
        </option>
      ))}
      <option disabled>──────────</option>
      <option value={NEW}>＋ New plan…</option>
      <option value={MANAGE}>Manage plans…</option>
    </select>
  );
}
