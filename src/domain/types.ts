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

/** A person who can be allocated to projects. */
export interface Resource {
  id: string;
  name: string;
  role?: string;
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

export interface PlanSettings {
  /** Committed weekly load above this % is flagged yellow ("stretched"). */
  overallocationThreshold: number;
  /** Committed weekly load above this % is flagged red ("overallocated"). */
  criticalThreshold: number;
}

export interface PlanData {
  version: 3;
  tags: CapabilityTag[];
  sellers: Seller[];
  resources: Resource[];
  projects: Project[];
  assignments: Assignment[];
  settings: PlanSettings;
}
