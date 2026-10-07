/** Monday of a week as a local calendar date, 'yyyy-MM-dd'. */
export type WeekKey = string;

export type Zoom = 'week' | 'month' | 'quarter';

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
  /** Capabilities the project needs. */
  tagIds: string[];
  startWeek?: WeekKey;
  endWeek?: WeekKey;
  notes?: string;
}

/** One resource on one project, with a % allocation per week (absent week = 0). */
export interface Assignment {
  id: string;
  projectId: string;
  resourceId: string;
  weekly: Record<WeekKey, number>;
}

export interface PlanSettings {
  /** A resource whose weekly total exceeds this % is overallocated. */
  overallocationThreshold: number;
}

export interface PlanData {
  version: 1;
  tags: CapabilityTag[];
  sellers: Seller[];
  resources: Resource[];
  projects: Project[];
  assignments: Assignment[];
  settings: PlanSettings;
}
