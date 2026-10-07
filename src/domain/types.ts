/** Monday of a week as a local calendar date, 'yyyy-MM-dd'. */
export type WeekKey = string;

export type Zoom = 'week' | 'month' | 'quarter';

/** Pipeline = not yet won; delivery staffing on it is tentative. */
export type ProjectStatus = 'pipeline' | 'won' | 'lost';

/**
 * Presales effort is real time spent whatever the outcome, so it always
 * counts. Delivery effort counts once the project is won, is tentative while
 * it's in the pipeline, and drops out if it's lost.
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
 * One resource on one project for one kind of work, with a % allocation per
 * week (absent week = 0). A person can have both a presales and a delivery
 * row on the same project.
 */
export interface Assignment {
  id: string;
  projectId: string;
  resourceId: string;
  kind: AllocationKind;
  weekly: Record<WeekKey, number>;
}

export interface PlanSettings {
  /** A resource whose committed weekly total exceeds this % is overallocated. */
  overallocationThreshold: number;
}

export interface PlanData {
  version: 2;
  tags: CapabilityTag[];
  sellers: Seller[];
  resources: Resource[];
  projects: Project[];
  assignments: Assignment[];
  settings: PlanSettings;
}
