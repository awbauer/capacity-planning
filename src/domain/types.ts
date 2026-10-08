/** Monday of a week as a local calendar date, 'yyyy-MM-dd'. */
export type WeekKey = string;

export type Zoom = 'week' | 'month' | 'quarter';

/** Pipeline = not yet won; delivery staffing on it is tentative. */
export type ProjectStatus = 'pipeline' | 'won' | 'lost';

/**
 * Presales vs delivery is not stored: it's decided per week by the
 * workstream's start date (see weekKind in load.ts).
 */
export type AllocationKind = 'presales' | 'delivery';

export interface CapabilityTag {
  id: string;
  name: string;
  color: string;
}

/** A person who sells projects. Not allocatable. */
export interface Seller {
  id: string;
  name: string;
  email?: string;
}

/** Career levels, most senior first. */
export const CAREER_LEVELS = ['D', 'SM', 'M', 'SA', 'A'] as const;
export type CareerLevel = (typeof CAREER_LEVELS)[number];

/** A person who can be allocated to projects. */
export interface Resource {
  id: string;
  name: string;
  role?: string;
  level?: CareerLevel;
  tagIds: string[];
}

export interface Project {
  id: string;
  name: string;
  client?: string;
  sellerId: string | null;
  status: ProjectStatus;
  /** Capabilities the project needs. */
  tagIds: string[];
  startWeek?: WeekKey;
  endWeek?: WeekKey;
  notes?: string;
}

/**
 * A role (seat) on a workstream, stored as an Assignment: what's needed
 * (name, level, capabilities) and the weekly %, plus the person in it. A
 * person is always in a role, even a bare shell named after their title; a
 * role with no person is open demand ("Data Cloud Architect at 50% from
 * January") that is nobody's load until filled. Weeks before the workstream's
 * start date are presales, weeks from it delivery.
 */
export interface Assignment {
  id: string;
  projectId: string;
  /** The person in the role; null while it's open. */
  resourceId: string | null;
  /** What the role is, e.g. "Solution Architect". May be empty (a shell). */
  name: string;
  /** Level the role calls for (the person keeps their own). */
  level?: CareerLevel;
  /** Capabilities the role needs; empty means the workstream's. */
  tagIds: string[];
  weekly: Record<WeekKey, number>;
}

/** A role someone is in. */
export type FilledAssignment = Assignment & { resourceId: string };

export function isFilled(a: Assignment): a is FilledAssignment {
  return a.resourceId !== null;
}

export interface PlanSettings {
  /** Committed weekly load above this % is flagged yellow ("stretched"). */
  overallocationThreshold: number;
  /** Committed weekly load above this % is flagged red ("overallocated"). */
  criticalThreshold: number;
  /** Expected utilization % by career level; missing levels use the defaults (see utilization.ts). */
  utilizationTargets?: Partial<Record<CareerLevel, number>>;
}

export interface PlanData {
  /** 4: every row is a role with an optional person (open roles folded into assignments). */
  version: 4;
  tags: CapabilityTag[];
  sellers: Seller[];
  resources: Resource[];
  projects: Project[];
  assignments: Assignment[];
  settings: PlanSettings;
}
