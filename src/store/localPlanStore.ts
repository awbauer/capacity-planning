import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { temporal } from 'zundo';
import { newId } from '../domain/ids';
import { applyOp } from '../domain/ops';
import { defaultMeta, sameName, type PlanFile, type PlanMeta, type StoredPlan } from '../domain/plans';
import { createEmptyPlan } from '../domain/sampleData';
import { upgradePlan } from '../domain/schema';
import type { PlanData } from '../domain/types';
import { makePlanActions, type PlanDataActions } from './actions';

export type ImportOutcome = 'replaced-open' | 'replaced-other' | 'created';

/** The plan library: plans saved in this browser (local mode only). */
export interface LibraryActions {
  /** Saves the open plan to the library and opens a new, empty one. */
  newPlan: (name: string) => PlanMeta;
  switchPlan: (id: string) => void;
  /** Returns false if another plan already has the name. */
  renamePlan: (id: string, name: string) => boolean;
  /** Deletes a plan; deleting the open one opens another. The last plan can't be deleted. */
  deletePlan: (id: string) => void;
  /** Increments the open plan's revision (on export) and returns the new meta. Not undoable. */
  bumpRevision: () => PlanMeta;
  /**
   * Imports a file: a plan with the same name (case-insensitive) is
   * overwritten, otherwise a new plan is created. The imported plan is opened.
   */
  importPlanFile: (file: PlanFile) => { meta: PlanMeta; outcome: ImportOutcome };
}

export interface PlanState extends PlanDataActions, LibraryActions {
  /** The open plan (the only part tracked by undo). */
  plan: PlanData;
  meta: PlanMeta;
  /** Every other saved plan (local mode; empty in shared mode). */
  library: StoredPlan[];
}

/** All saved plans (open one included), by name. */
export function allPlans(s: Pick<PlanState, 'plan' | 'meta' | 'library'>): StoredPlan[] {
  return [{ meta: s.meta, plan: s.plan }, ...s.library].sort((a, b) => a.meta.name.localeCompare(b.meta.name));
}

/** The saved plan with this name (case-insensitive), if any. */
export function findPlanByName(s: Pick<PlanState, 'plan' | 'meta' | 'library'>, name: string): StoredPlan | undefined {
  return allPlans(s).find((p) => sameName(p.meta.name, name));
}

export const LOCAL_PLAN_KEY = 'capacity-plan:v1';
export const LOCAL_PLAN_VERSION = 8;

function createLocalPlanStore() {
  // Undo history belongs to the open plan; a switch starts afresh.
  const clearHistory = () => store.temporal.getState().clear();

  const store = create<PlanState>()(
    persist(
      temporal(
        (set, get) => ({
          plan: createEmptyPlan(),
          meta: defaultMeta(),
          library: [],

          ...makePlanActions(
            () => get().plan,
            (op) => set({ plan: applyOp(get().plan, op) }),
          ),

          newPlan: (name) => {
            const { plan, meta, library } = get();
            const next: PlanMeta = { id: newId(), name: name.trim(), revision: 0 };
            set({ plan: createEmptyPlan(), meta: next, library: [...library, { meta, plan }] });
            clearHistory();
            return next;
          },
          switchPlan: (id) => {
            const { plan, meta, library } = get();
            const target = library.find((p) => p.meta.id === id);
            if (!target) return;
            set({
              plan: target.plan,
              meta: target.meta,
              library: [...library.filter((p) => p.meta.id !== id), { meta, plan }],
            });
            clearHistory();
          },
          renamePlan: (id, name) => {
            const trimmed = name.trim();
            const clash = findPlanByName(get(), trimmed);
            if (!trimmed || (clash && clash.meta.id !== id)) return false;
            const { meta, library } = get();
            if (meta.id === id) set({ meta: { ...meta, name: trimmed } });
            else {
              set({
                library: library.map((p) => (p.meta.id === id ? { ...p, meta: { ...p.meta, name: trimmed } } : p)),
              });
            }
            return true;
          },
          deletePlan: (id) => {
            const { meta, library } = get();
            if (meta.id !== id) {
              set({ library: library.filter((p) => p.meta.id !== id) });
              return;
            }
            const [first, ...rest] = [...library].sort((a, b) => a.meta.name.localeCompare(b.meta.name));
            if (!first) return;
            set({ plan: first.plan, meta: first.meta, library: rest });
            clearHistory();
          },
          bumpRevision: () => {
            const meta = { ...get().meta, revision: get().meta.revision + 1 };
            set({ meta });
            return meta;
          },
          importPlanFile: (file) => {
            const { plan, meta, library } = get();
            const match = findPlanByName(get(), file.name);
            if (match?.meta.id === meta.id) {
              // Undoable, like any other edit to the open plan.
              const next = { ...meta, name: file.name, revision: file.revision };
              set({ plan: file.plan, meta: next });
              return { meta: next, outcome: 'replaced-open' };
            }
            const next: PlanMeta = { id: match?.meta.id ?? newId(), name: file.name, revision: file.revision };
            set({
              plan: file.plan,
              meta: next,
              library: [...library.filter((p) => p.meta.id !== match?.meta.id), { meta, plan }],
            });
            clearHistory();
            return { meta: next, outcome: match ? 'replaced-other' : 'created' };
          },
        }),
        {
          partialize: (s) => ({ plan: s.plan }),
          equality: (a, b) => a.plan === b.plan,
          limit: 200,
        },
      ),
      {
        name: LOCAL_PLAN_KEY,
        // v2: workstream status + allocation kind. v3: weekly values snapped to 0/25/50/100.
        // v4: one row per person per workstream (presales/delivery come from the start date).
        // v5: separate yellow/red thresholds (criticalThreshold).
        // v6: multiple named plans; the existing one becomes "Default".
        // v7: open roles. v8: every row is a role with an optional person (plan format 4).
        version: LOCAL_PLAN_VERSION,
        partialize: (s) => ({ plan: s.plan, meta: s.meta, library: s.library }),
        migrate: (persisted) => {
          const state = persisted as { plan: PlanData; meta?: PlanMeta; library?: StoredPlan[] };
          return {
            ...state,
            plan: upgradePlan(state.plan),
            meta: state.meta ?? defaultMeta(),
            library: (state.library ?? []).map((p) => ({ ...p, plan: upgradePlan(p.plan) })),
          };
        },
      },
    ),
  );
  return store;
}

export type LocalPlanStore = ReturnType<typeof createLocalPlanStore>;

let instance: LocalPlanStore | undefined;

/**
 * The browser-only store. Created on first use, and only in local mode, so
 * shared mode never reads or rewrites this browser's saved plans.
 */
export function getLocalPlanStore(): LocalPlanStore {
  instance ??= createLocalPlanStore();
  return instance;
}

/**
 * Plans saved in this browser, read without opening the local store (for
 * offering them for upload in shared mode). Never writes.
 */
export function readLocalPlans(): StoredPlan[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_PLAN_KEY);
    if (!raw) return [];
    const { state } = JSON.parse(raw) as { state: { plan: unknown; meta?: PlanMeta; library?: StoredPlan[] } };
    const open: StoredPlan = { meta: state.meta ?? defaultMeta(), plan: upgradePlan(state.plan) };
    return [open, ...(state.library ?? []).map((p) => ({ meta: p.meta, plan: upgradePlan(p.plan) }))];
  } catch {
    return [];
  }
}
