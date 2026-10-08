import { useShallow } from 'zustand/react/shallow';
import { allPlans, usePlanStore } from '../store/planStore';
import { useUIStore } from '../store/uiStore';
import { createPlanInteractively } from './planActions';

const NEW = '__new';
const MANAGE = '__manage';

/** Toolbar dropdown listing the plans saved in this browser. */
export function PlanSwitcher() {
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
