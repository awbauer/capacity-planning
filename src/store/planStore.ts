import { create, useStore } from 'zustand';
import { persist } from 'zustand/middleware';
import { temporal } from 'zundo';
import { newId, nextTagColor } from '../domain/ids';
import { createEmptyPlan, createSamplePlan } from '../domain/sampleData';
import { upgradePlan } from '../domain/schema';
import type {
  AllocationKind,
  Assignment,
  CapabilityTag,
  PlanData,
  Project,
  Resource,
  Seller,
  WeekKey,
} from '../domain/types';
import { weeksBetween } from '../domain/weeks';

export interface AllocationEdit {
  assignmentId: string;
  weeks: WeekKey[];
  /** Whole percent. 0 clears the weeks. */
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

  /** Adds the resource to the project for this kind of work (reusing an existing row) and optionally fills a week range. */
  addAssignment: (projectId: string, resourceId: string, kind: AllocationKind, fill?: FillRange) => Assignment;
  /** Switches presales <-> delivery. Returns false if the person already has a row of that kind on the project. */
  setAssignmentKind: (id: string, kind: AllocationKind) => boolean;
  removeAssignment: (id: string) => void;
  /** Applies all edits as a single undo step. */
  setAllocations: (edits: AllocationEdit[]) => void;

  setThreshold: (percent: number) => void;
  importPlan: (plan: PlanData) => void;
  resetToSample: () => void;
  clearAll: () => void;
}

export type PlanState = { plan: PlanData } & PlanActions;

export function clampPercent(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.round(value), 999);
}

function applyFill(weekly: Record<WeekKey, number>, weeks: WeekKey[], percent: number) {
  const next = { ...weekly };
  const pct = clampPercent(percent);
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
          plan: createSamplePlan(),

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

          addAssignment: (projectId, resourceId, kind, fill) => {
            const existing = get().plan.assignments.find(
              (a) => a.projectId === projectId && a.resourceId === resourceId && a.kind === kind,
            );
            const base: Assignment = existing ?? { id: newId(), projectId, resourceId, kind, weekly: {} };
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
          setAssignmentKind: (id, kind) => {
            const { assignments } = get().plan;
            const a = assignments.find((x) => x.id === id);
            if (!a || a.kind === kind) return !!a;
            const clash = assignments.some(
              (x) => x.id !== id && x.projectId === a.projectId && x.resourceId === a.resourceId && x.kind === kind,
            );
            if (clash) return false;
            update((p) => ({
              ...p,
              assignments: p.assignments.map((x) => (x.id === id ? { ...x, kind } : x)),
            }));
            return true;
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

          setThreshold: (percent) =>
            update((p) => ({
              ...p,
              settings: { ...p.settings, overallocationThreshold: Math.max(1, Math.round(percent)) },
            })),
          importPlan: (plan) => set({ plan }),
          resetToSample: () => set({ plan: createSamplePlan() }),
          clearAll: () => set({ plan: createEmptyPlan() }),
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
      version: 2,
      partialize: (s) => ({ plan: s.plan }),
      migrate: (persisted, version) => {
        const state = persisted as { plan: PlanData };
        return version < 2 ? { ...state, plan: upgradePlan(state.plan) } : state;
      },
    },
  ),
);

export function usePlan(): PlanData {
  return usePlanStore((s) => s.plan);
}

export function useHistory() {
  const canUndo = useStore(usePlanStore.temporal, (t) => t.pastStates.length > 0);
  const canRedo = useStore(usePlanStore.temporal, (t) => t.futureStates.length > 0);
  return { canUndo, canRedo };
}

export const undo = () => usePlanStore.temporal.getState().undo();
export const redo = () => usePlanStore.temporal.getState().redo();
