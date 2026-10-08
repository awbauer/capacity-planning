import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProjectStatus, WeekKey, Zoom } from '../domain/types';
import { DEFAULT_PLAN_ID } from '../domain/plans';
import { addWeeks, currentWeek } from '../domain/weeks';

export type View = 'projects' | 'resources' | 'demand' | 'manage';

/** The workstream or person whose details modal is open. */
export type DetailsTarget = { kind: 'project'; id: string } | { kind: 'resource'; id: string };

export type ManageTab = 'resources' | 'projects' | 'tags' | 'sellers' | 'plans' | 'settings';

/** How allocation cells render: Harvey-ball circles or plain numbers. */
export type CellStyle = 'pie' | 'number';

export interface Filters {
  text: string;
  tagId: string | null;
  sellerId: string | null;
  status: ProjectStatus | null;
  /** Show only people / workstreams that have a conflict. */
  conflictsOnly: boolean;
  /** Resources view: show only people under capacity over the next 10 weeks. */
  underutilized: boolean;
}

export const NO_FILTERS: Filters = {
  text: '',
  tagId: null,
  sellerId: null,
  status: null,
  conflictsOnly: false,
  underutilized: false,
};

/**
 * Row keys: `p:<projectId>` (workstreams), `c:<client>` (client groups),
 * `r:<resourceId>` (people), `g:<level>` (level groups).
 */
export type RowKey = string;

export const levelGroupKey = (level: string | undefined): RowKey => `g:${level ?? 'none'}`;
/** Clients are grouped case-insensitively; workstreams without one share a group. */
export const clientGroupKey = (client: string | undefined): RowKey => `c:${client?.trim().toLowerCase() || ''}`;

export interface ExportRecord {
  at: string;
  hash: string;
}

interface UIState {
  view: View;
  manageTab: ManageTab;
  zoom: Zoom;
  anchor: WeekKey;
  filters: Filters;
  /** Explicit expand/collapse choices; rows without one use the view's default. */
  expanded: Record<RowKey, boolean>;
  showConflicts: boolean;
  /** Workstreams view: next-10-weeks utilization sidebar. */
  showUtilization: boolean;
  /** Workstreams view: group workstreams under their client. */
  groupByClient: boolean;
  showHelp: boolean;
  details: DetailsTarget | null;
  cellStyle: CellStyle;
  /** Row to scroll to and highlight once it renders. */
  focusRow: RowKey | null;
  /** Last export per plan id (drives the "unsaved changes" hint). */
  exports: Record<string, ExportRecord>;

  setView: (view: View) => void;
  openManage: (tab: ManageTab) => void;
  setZoom: (zoom: Zoom) => void;
  setAnchor: (anchor: WeekKey) => void;
  goToToday: () => void;
  setFilters: (patch: Partial<Filters>) => void;
  setExpanded: (key: RowKey, expanded: boolean) => void;
  setAllExpanded: (keys: RowKey[], expanded: boolean) => void;
  toggleConflicts: () => void;
  toggleUtilization: () => void;
  setGroupByClient: (on: boolean) => void;
  resetFilters: () => void;
  setShowHelp: (show: boolean) => void;
  showDetails: (target: DetailsTarget | null) => void;
  setCellStyle: (style: CellStyle) => void;
  /** Opens a view on a row, expanding it and any `parents` (its group rows). */
  jumpTo: (view: View, row: RowKey, week?: WeekKey, parents?: RowKey[]) => void;
  clearFocusRow: () => void;
  markExported: (planId: string, hash: string) => void;
}

/** Shows two weeks of history before the current week. */
export const todayAnchor = () => addWeeks(currentWeek(), -2);

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      view: 'projects',
      manageTab: 'resources',
      zoom: 'week',
      anchor: todayAnchor(),
      filters: NO_FILTERS,
      expanded: {},
      showConflicts: true,
      showUtilization: false,
      groupByClient: true,
      showHelp: false,
      details: null,
      cellStyle: 'pie',
      focusRow: null,
      exports: {},

      setView: (view) => set({ view }),
      openManage: (manageTab) => set({ view: 'manage', manageTab }),
      setZoom: (zoom) => set({ zoom }),
      setAnchor: (anchor) => set({ anchor }),
      goToToday: () => set({ anchor: todayAnchor() }),
      setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
      setExpanded: (key, expanded) => set((s) => ({ expanded: { ...s.expanded, [key]: expanded } })),
      setAllExpanded: (keys, expanded) =>
        set((s) => ({
          expanded: { ...s.expanded, ...Object.fromEntries(keys.map((k) => [k, expanded])) },
        })),
      toggleConflicts: () => set((s) => ({ showConflicts: !s.showConflicts })),
      toggleUtilization: () => set((s) => ({ showUtilization: !s.showUtilization })),
      setGroupByClient: (groupByClient) => set({ groupByClient }),
      resetFilters: () => set({ filters: NO_FILTERS }),
      setShowHelp: (showHelp) => set({ showHelp }),
      showDetails: (details) => set({ details }),
      setCellStyle: (cellStyle) => set({ cellStyle }),
      jumpTo: (view, row, week, parents = []) =>
        set((s) => ({
          view,
          focusRow: row,
          expanded: { ...s.expanded, [row]: true, ...Object.fromEntries(parents.map((k) => [k, true])) },
          filters: NO_FILTERS,
          anchor: week ? addWeeks(week, -2) : s.anchor,
        })),
      clearFocusRow: () => set({ focusRow: null }),
      markExported: (planId, hash) =>
        set((s) => ({ exports: { ...s.exports, [planId]: { at: new Date().toISOString(), hash } } })),
    }),
    {
      name: 'capacity-ui:v1',
      // v2: export tracking per plan.
      version: 2,
      partialize: (s) => ({
        view: s.view,
        manageTab: s.manageTab,
        zoom: s.zoom,
        expanded: s.expanded,
        showConflicts: s.showConflicts,
        showUtilization: s.showUtilization,
        groupByClient: s.groupByClient,
        cellStyle: s.cellStyle,
        exports: s.exports,
      }),
      migrate: (persisted) => {
        const { lastExportedAt, lastExportedHash, ...rest } = persisted as Record<string, unknown> & {
          lastExportedAt?: string | null;
          lastExportedHash?: string | null;
        };
        // The single pre-v2 plan is the "Default" plan.
        const exports: Record<string, ExportRecord> =
          lastExportedAt && lastExportedHash ? { [DEFAULT_PLAN_ID]: { at: lastExportedAt, hash: lastExportedHash } } : {};
        return { ...rest, exports } as unknown as UIState;
      },
    },
  ),
);

/**
 * Default expansion: workstreams open (to show who's on them), level and
 * client groups open, people closed (to show load).
 */
export function isExpanded(expanded: Record<RowKey, boolean>, key: RowKey): boolean {
  return expanded[key] ?? (key.startsWith('p:') || key.startsWith('g:') || key.startsWith('c:'));
}
