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
 * One resource on one workstream (stored as a project), with a % allocation
 * per week (absent week = 0). There is at most one per person per workstream;
 * weeks before the start date are presales, weeks from it delivery.
 */
export interface Assignment {
  id: string;
  projectId: string;
  resourceId: string;
  weekly: Record<WeekKey, number>;
}

/**
 * Demand on a workstream that no one has been chosen for yet ("Data Cloud
 * Architect at 50% from January"). It's nobody's load until filled.
 */
export interface OpenRole {
  id: string;
  projectId: string;
  /** What the role is, e.g. "Data Cloud Architect". */
  name: string;
  level?: CareerLevel;
  /** Capabilities the person filling it should have. */
  tagIds: string[];
  weekly: Record<WeekKey, number>;
}

/** Either kind of row with weekly allocations on a workstream. */
export type AllocationRow = Assignment | OpenRole;

export function isOpenRole(row: AllocationRow): row is OpenRole {
  return !('resourceId' in row);
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
  version: 3;
  tags: CapabilityTag[];
  sellers: Seller[];
  resources: Resource[];
  projects: Project[];
  assignments: Assignment[];
  roles: OpenRole[];
  settings: PlanSettings;
}
