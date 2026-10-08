import { create, useStore } from 'zustand';
import { persist } from 'zustand/middleware';
import { temporal } from 'zundo';
import { newId, nextTagColor } from '../domain/ids';
import { defaultMeta, sameName, type PlanFile, type PlanMeta, type StoredPlan } from '../domain/plans';
import { createEmptyPlan, createSamplePlan } from '../domain/sampleData';
import { upgradePlan } from '../domain/schema';
import { snapToStep } from '../domain/steps';
import type {
  Assignment,
  CapabilityTag,
  PlanData,
  PlanSettings,
  Project,
  Resource,
  Seller,
  WeekKey,
} from '../domain/types';
import { weeksBetween } from '../domain/weeks';

export interface AllocationEdit {
  assignmentId: string;
  weeks: WeekKey[];
  /** Percent, snapped to 0/25/50/100. 0 clears the weeks. */
  percent: number;
}

export interface FillRange {
  percent: number;
  from: WeekKey;
  to: WeekKey;
}

interface PlanActions {
  /** Returns the existing tag if one with the same name (case-insensitive) exists. */
  addTag: (name: string) => CapabilityTag;
  updateTag: (id: string, patch: Partial<Omit<CapabilityTag, 'id'>>) => void;
  deleteTag: (id: string) => void;

  addSeller: (name: string) => Seller;
  updateSeller: (id: string, patch: Partial<Omit<Seller, 'id'>>) => void;
  deleteSeller: (id: string) => void;

  addResource: (input: Omit<Resource, 'id'>) => Resource;
  updateResource: (id: string, patch: Partial<Omit<Resource, 'id'>>) => void;
  deleteResource: (id: string) => void;

  addProject: (input: Omit<Project, 'id'>) => Project;
  updateProject: (id: string, patch: Partial<Omit<Project, 'id'>>) => void;
  deleteProject: (id: string) => void;

  /** Adds the resource to the workstream (reusing their existing row) and optionally fills a week range. */
  addAssignment: (projectId: string, resourceId: string, fill?: FillRange) => Assignment;
  removeAssignment: (id: string) => void;
  /** Applies all edits as a single undo step. */
  setAllocations: (edits: AllocationEdit[]) => void;

  setThresholds: (patch: Partial<PlanSettings>) => void;
  /** Replaces the open plan's contents (undoable); keeps its name. */
  importPlan: (plan: PlanData) => void;
  resetToSample: () => void;
  clearAll: () => void;

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

export type ImportOutcome = 'replaced-open' | 'replaced-other' | 'created';

export interface PlanState extends PlanActions {
  /** The open plan (the only part tracked by undo). */
  plan: PlanData;
  meta: PlanMeta;
  /** Every other saved plan. */
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

// Undo history belongs to the open plan; a switch starts afresh.
const clearHistory = () => usePlanStore.temporal.getState().clear();

function applyFill(weekly: Record<WeekKey, number>, weeks: WeekKey[], percent: number) {
  const next = { ...weekly };
  const pct = snapToStep(percent);
  for (const w of weeks) {
    if (pct === 0) delete next[w];
    else next[w] = pct;
  }
  return next;
}

export const usePlanStore = create<PlanState>()(
  persist(
    temporal(
      (set, get) => {
        const update = (fn: (plan: PlanData) => PlanData) => set({ plan: fn(get().plan) });

        return {
          plan: createEmptyPlan(),
          meta: defaultMeta(),
          library: [],

          addTag: (name) => {
            const trimmed = name.trim();
            const existing = get().plan.tags.find(
              (t) => t.name.toLowerCase() === trimmed.toLowerCase(),
            );
            if (existing) return existing;
            const tag: CapabilityTag = {
              id: newId(),
              name: trimmed,
              color: nextTagColor(get().plan.tags.map((t) => t.color)),
            };
            update((p) => ({ ...p, tags: [...p.tags, tag] }));
            return tag;
          },
          updateTag: (id, patch) =>
            update((p) => ({ ...p, tags: p.tags.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
          deleteTag: (id) =>
            update((p) => ({
              ...p,
              tags: p.tags.filter((t) => t.id !== id),
              resources: p.resources.map((r) =>
                r.tagIds.includes(id) ? { ...r, tagIds: r.tagIds.filter((t) => t !== id) } : r,
              ),
              projects: p.projects.map((pr) =>
                pr.tagIds.includes(id) ? { ...pr, tagIds: pr.tagIds.filter((t) => t !== id) } : pr,
              ),
            })),

          addSeller: (name) => {
            const seller: Seller = { id: newId(), name: name.trim() };
            update((p) => ({ ...p, sellers: [...p.sellers, seller] }));
            return seller;
          },
          updateSeller: (id, patch) =>
            update((p) => ({
              ...p,
              sellers: p.sellers.map((s) => (s.id === id ? { ...s, ...patch } : s)),
            })),
          deleteSeller: (id) =>
            update((p) => ({
              ...p,
              sellers: p.sellers.filter((s) => s.id !== id),
              projects: p.projects.map((pr) => (pr.sellerId === id ? { ...pr, sellerId: null } : pr)),
            })),

          addResource: (input) => {
            const resource: Resource = { ...input, id: newId(), name: input.name.trim() };
            update((p) => ({ ...p, resources: [...p.resources, resource] }));
            return resource;
          },
          updateResource: (id, patch) =>
            update((p) => ({
              ...p,
              resources: p.resources.map((r) => (r.id === id ? { ...r, ...patch } : r)),
            })),
          deleteResource: (id) =>
            update((p) => ({
              ...p,
              resources: p.resources.filter((r) => r.id !== id),
              assignments: p.assignments.filter((a) => a.resourceId !== id),
            })),

          addProject: (input) => {
            const project: Project = { ...input, id: newId(), name: input.name.trim() };
            update((p) => ({ ...p, projects: [...p.projects, project] }));
            return project;
          },
          updateProject: (id, patch) =>
            update((p) => ({
              ...p,
              projects: p.projects.map((pr) => (pr.id === id ? { ...pr, ...patch } : pr)),
            })),
          deleteProject: (id) =>
            update((p) => ({
              ...p,
              projects: p.projects.filter((pr) => pr.id !== id),
              assignments: p.assignments.filter((a) => a.projectId !== id),
            })),

          addAssignment: (projectId, resourceId, fill) => {
            const existing = get().plan.assignments.find(
              (a) => a.projectId === projectId && a.resourceId === resourceId,
            );
            const base: Assignment = existing ?? { id: newId(), projectId, resourceId, weekly: {} };
            const assignment: Assignment = fill
              ? { ...base, weekly: applyFill(base.weekly, weeksBetween(fill.from, fill.to), fill.percent) }
              : base;
            update((p) => ({
              ...p,
              assignments: existing
                ? p.assignments.map((a) => (a.id === existing.id ? assignment : a))
                : [...p.assignments, assignment],
            }));
            return assignment;
          },
          removeAssignment: (id) =>
            update((p) => ({ ...p, assignments: p.assignments.filter((a) => a.id !== id) })),
          setAllocations: (edits) => {
            if (edits.length === 0) return;
            const byId = new Map<string, AllocationEdit[]>();
            for (const e of edits) byId.set(e.assignmentId, [...(byId.get(e.assignmentId) ?? []), e]);
            update((p) => ({
              ...p,
              assignments: p.assignments.map((a) => {
                const mine = byId.get(a.id);
                if (!mine) return a;
                let weekly = a.weekly;
                for (const e of mine) weekly = applyFill(weekly, e.weeks, e.percent);
                return { ...a, weekly };
              }),
            }));
          },

          setThresholds: (patch) =>
            update((p) => ({
              ...p,
              settings: {
                ...p.settings,
                ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, Math.max(1, Math.round(v))])),
              },
            })),
          importPlan: (plan) => set({ plan }),
          resetToSample: () => set({ plan: createSamplePlan() }),
          clearAll: () => set({ plan: createEmptyPlan() }),

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
        };
      },
      {
        partialize: (s) => ({ plan: s.plan }),
        equality: (a, b) => a.plan === b.plan,
        limit: 200,
      },
    ),
    {
      name: 'capacity-plan:v1',
      // v2: workstream status + allocation kind. v3: weekly values snapped to 0/25/50/100.
      // v4: one row per person per workstream (presales/delivery come from the start date).
      // v5: separate yellow/red thresholds (criticalThreshold).
      // v6: multiple named plans; the existing one becomes "Default".
      version: 6,
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

export function usePlan(): PlanData {
  return usePlanStore((s) => s.plan);
}

export function usePlanMeta(): PlanMeta {
  return usePlanStore((s) => s.meta);
}

export function useHistory() {
  const canUndo = useStore(usePlanStore.temporal, (t) => t.pastStates.length > 0);
  const canRedo = useStore(usePlanStore.temporal, (t) => t.futureStates.length > 0);
  return { canUndo, canRedo };
}

export const undo = () => usePlanStore.temporal.getState().undo();
export const redo = () => usePlanStore.temporal.getState().redo();
