// Placeholder; replaced by the shared-workspace store.
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { PlanState } from './localPlanStore';
export type SharedPlanState = PlanState & { undo: () => void; redo: () => void };
let s: UseBoundStore<StoreApi<SharedPlanState>> | undefined;
export function getSharedPlanStore(): UseBoundStore<StoreApi<SharedPlanState>> {
  s ??= create<SharedPlanState>()(() => {
    throw new Error('not implemented');
  });
  return s;
}
export function useSharedHistory() {
  return { canUndo: false, canRedo: false };
}
