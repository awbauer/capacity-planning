import { useStore, type StoreApi, type UseBoundStore } from 'zustand';
import type { PlanMeta } from '../domain/plans';
import type { PlanData } from '../domain/types';
import { getLocalPlanStore, type PlanState } from './localPlanStore';
import { isShared } from './mode';
import { getSharedPlanStore, useSharedHistory } from './sharedPlanStore';

export type { AllocationEdit, FillRange, RoleInput } from './actions';
export { allPlans, findPlanByName, type ImportOutcome, type PlanState } from './localPlanStore';

const SHARED = isShared();

/**
 * The open plan and every edit to it. In local mode it's this browser's
 * saved plans; in shared mode it's the plan open in the shared workspace
 * (edits are sent to the server, and other people's arrive live). The mode
 * is fixed for the page's lifetime.
 */
export const usePlanStore: UseBoundStore<StoreApi<PlanState>> = SHARED ? getSharedPlanStore() : getLocalPlanStore();

export function usePlan(): PlanData {
  return usePlanStore((s) => s.plan);
}

export function usePlanMeta(): PlanMeta {
  return usePlanStore((s) => s.meta);
}

function useLocalHistory() {
  const temporal = getLocalPlanStore().temporal;
  const canUndo = useStore(temporal, (t) => t.pastStates.length > 0);
  const canRedo = useStore(temporal, (t) => t.futureStates.length > 0);
  return { canUndo, canRedo };
}

/** Whether undo/redo are available (local: snapshots; shared: your own changes). */
export const useHistory: () => { canUndo: boolean; canRedo: boolean } = SHARED ? useSharedHistory : useLocalHistory;

export const undo = () => (SHARED ? getSharedPlanStore().getState().undo() : getLocalPlanStore().temporal.getState().undo());
export const redo = () => (SHARED ? getSharedPlanStore().getState().redo() : getLocalPlanStore().temporal.getState().redo());
