import { newId, nextTagColor } from '../domain/ids';
import { fillWeekly, toPatch, type Op } from '../domain/ops';
import { createEmptyPlan, createSamplePlan } from '../domain/sampleData';
import type {
  Assignment,
  CapabilityTag,
  CareerLevel,
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

export interface RoleInput {
  name: string;
  level?: CareerLevel;
  tagIds: string[];
  resourceId?: string | null;
}

/** Edits to the open plan. Identical in local and shared mode. */
export interface PlanDataActions {
  /** Returns the existing tag if one with the same name (case-insensitive) exists. */
  addTag: (name: string) => CapabilityTag;
  updateTag: (id: string, patch: Partial<Omit<CapabilityTag, 'id'>>) => void;
  deleteTag: (id: string) => void;

  addSeller: (name: string) => Seller;
  updateSeller: (id: string, patch: Partial<Omit<Seller, 'id'>>) => void;
  deleteSeller: (id: string) => void;

  addResource: (input: Omit<Resource, 'id'>) => Resource;
  updateResource: (id: string, patch: Partial<Omit<Resource, 'id'>>) => void;
  /** Removes a person; the roles they were in stay, as open roles. */
  deleteResource: (id: string) => void;

  addProject: (input: Omit<Project, 'id'>) => Project;
  /**
   * Updates a workstream. With `shift`, also moves its roles'
   * weeks on or after `shift.from` by `shift.weeks` (a slipped deal),
   * as one undo step.
   */
  updateProject: (id: string, patch: Partial<Omit<Project, 'id'>>, shift?: { from: WeekKey; weeks: number }) => void;
  deleteProject: (id: string) => void;

  /**
   * Puts a person on a workstream: reuses a role they're already in there,
   * otherwise adds a role named after their title. Optionally fills a week range.
   */
  addAssignment: (projectId: string, resourceId: string, fill?: FillRange) => Assignment;
  /** Removes a role (and with it, the person's place on the workstream). */
  removeAssignment: (id: string) => void;
  /** Applies all edits as a single undo step. */
  setAllocations: (edits: AllocationEdit[]) => void;

  /** Adds a role, open or with a person in it, optionally filling a week range. */
  addRole: (projectId: string, input: RoleInput, fill?: FillRange) => Assignment;
  updateRole: (id: string, patch: Partial<Omit<RoleInput, 'resourceId'>>) => void;
  /** Puts a person in a role, swaps them, or (null) leaves the role open. Keeps its weeks. */
  assignRole: (id: string, resourceId: string | null) => void;

  setThresholds: (patch: Partial<Pick<PlanSettings, 'overallocationThreshold' | 'criticalThreshold'>>) => void;
  /** null resets the level to its default target. */
  setUtilizationTarget: (level: CareerLevel, percent: number | null) => void;
  /** Replaces the open plan's contents (undoable); keeps its name. */
  importPlan: (plan: PlanData) => void;
  resetToSample: () => void;
  clearAll: () => void;
}

/**
 * The plan-editing actions, as ops. Anything that depends on the current
 * plan (new ids, tag colours, reusing a role) is decided here, so the op
 * itself is deterministic wherever it's applied.
 */
export function makePlanActions(plan: () => PlanData, dispatch: (op: Op) => void): PlanDataActions {
  return {
    addTag: (name) => {
      const trimmed = name.trim();
      const existing = plan().tags.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
      if (existing) return existing;
      const tag: CapabilityTag = { id: newId(), name: trimmed, color: nextTagColor(plan().tags.map((t) => t.color)) };
      dispatch({ t: 'tag.add', tag });
      return tag;
    },
    updateTag: (id, patch) => dispatch({ t: 'tag.update', id, p: toPatch(patch) }),
    deleteTag: (id) => dispatch({ t: 'tag.delete', id }),

    addSeller: (name) => {
      const seller: Seller = { id: newId(), name: name.trim() };
      dispatch({ t: 'seller.add', seller });
      return seller;
    },
    updateSeller: (id, patch) => dispatch({ t: 'seller.update', id, p: toPatch(patch) }),
    deleteSeller: (id) => dispatch({ t: 'seller.delete', id }),

    addResource: (input) => {
      const resource: Resource = { ...input, id: newId(), name: input.name.trim() };
      dispatch({ t: 'resource.add', resource });
      return resource;
    },
    updateResource: (id, patch) => dispatch({ t: 'resource.update', id, p: toPatch(patch) }),
    deleteResource: (id) => dispatch({ t: 'resource.delete', id }),

    addProject: (input) => {
      const project: Project = { ...input, id: newId(), name: input.name.trim() };
      dispatch({ t: 'project.add', project });
      return project;
    },
    updateProject: (id, patch, shift) =>
      dispatch({ t: 'project.update', id, p: toPatch(patch), ...(shift && shift.weeks !== 0 ? { shift } : {}) }),
    deleteProject: (id) => dispatch({ t: 'project.delete', id }),

    addAssignment: (projectId, resourceId, fill) => {
      const existing = plan().assignments.find((a) => a.projectId === projectId && a.resourceId === resourceId);
      const weeks = fill ? weeksBetween(fill.from, fill.to) : [];
      if (existing) {
        if (!fill) return existing;
        dispatch({ t: 'cells.set', edits: [{ roleId: existing.id, weeks, value: fill.percent }] });
        return { ...existing, weekly: fillWeekly(existing.weekly, weeks, fill.percent) };
      }
      const title = plan().resources.find((r) => r.id === resourceId)?.role ?? '';
      const role: Assignment = {
        id: newId(),
        projectId,
        resourceId,
        name: title,
        tagIds: [],
        weekly: fill ? fillWeekly({}, weeks, fill.percent) : {},
      };
      dispatch({ t: 'role.add', role });
      return role;
    },
    removeAssignment: (id) => dispatch({ t: 'role.delete', id }),
    setAllocations: (edits) => {
      if (edits.length === 0) return;
      dispatch({ t: 'cells.set', edits: edits.map((e) => ({ roleId: e.assignmentId, weeks: e.weeks, value: e.percent })) });
    },

    addRole: (projectId, input, fill) => {
      const role: Assignment = {
        id: newId(),
        projectId,
        resourceId: input.resourceId ?? null,
        name: input.name.trim(),
        ...(input.level ? { level: input.level } : {}),
        tagIds: input.tagIds,
        weekly: fill ? fillWeekly({}, weeksBetween(fill.from, fill.to), fill.percent) : {},
      };
      dispatch({ t: 'role.add', role });
      return role;
    },
    updateRole: (id, patch) =>
      dispatch({
        t: 'role.update',
        id,
        p: toPatch(patch.name !== undefined ? { ...patch, name: patch.name.trim() } : patch),
      }),
    assignRole: (id, resourceId) => dispatch({ t: 'role.assign', id, resourceId }),

    setThresholds: (patch) => dispatch({ t: 'settings.update', set: patch }),
    setUtilizationTarget: (level, percent) => dispatch({ t: 'settings.update', targets: { [level]: percent } }),
    importPlan: (next) => dispatch({ t: 'plan.replace', plan: next }),
    resetToSample: () => dispatch({ t: 'plan.replace', plan: createSamplePlan() }),
    clearAll: () => dispatch({ t: 'plan.replace', plan: createEmptyPlan() }),
  };
}
