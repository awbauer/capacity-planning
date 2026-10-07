import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { WeekKey, Zoom } from '../domain/types';
import { addWeeks, currentWeek } from '../domain/weeks';

export type View = 'projects' | 'resources' | 'manage';

export interface Filters {
  text: string;
  tagId: string | null;
  sellerId: string | null;
}

/** Row keys: `p:<projectId>` in the project view, `r:<resourceId>` in the resource view. */
export type RowKey = string;

interface UIState {
  view: View;
  zoom: Zoom;
  anchor: WeekKey;
  filters: Filters;
  /** Explicit expand/collapse choices; rows without one use the view's default. */
  expanded: Record<RowKey, boolean>;
  showConflicts: boolean;
  /** Row to scroll to and highlight once it renders. */
  focusRow: RowKey | null;
  lastExportedAt: string | null;
  lastExportedHash: string | null;

  setView: (view: View) => void;
  setZoom: (zoom: Zoom) => void;
  setAnchor: (anchor: WeekKey) => void;
  goToToday: () => void;
  setFilters: (patch: Partial<Filters>) => void;
  setExpanded: (key: RowKey, expanded: boolean) => void;
  setAllExpanded: (keys: RowKey[], expanded: boolean) => void;
  toggleConflicts: () => void;
  jumpTo: (view: View, row: RowKey, week?: WeekKey) => void;
  clearFocusRow: () => void;
  markExported: (hash: string) => void;
}

/** Shows two weeks of history before the current week. */
export const todayAnchor = () => addWeeks(currentWeek(), -2);

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      view: 'projects',
      zoom: 'week',
      anchor: todayAnchor(),
      filters: { text: '', tagId: null, sellerId: null },
      expanded: {},
      showConflicts: true,
      focusRow: null,
      lastExportedAt: null,
      lastExportedHash: null,

      setView: (view) => set({ view }),
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
      jumpTo: (view, row, week) =>
        set((s) => ({
          view,
          focusRow: row,
          expanded: { ...s.expanded, [row]: true },
          filters: { text: '', tagId: null, sellerId: null },
          anchor: week ? addWeeks(week, -2) : s.anchor,
        })),
      clearFocusRow: () => set({ focusRow: null }),
      markExported: (hash) =>
        set({ lastExportedAt: new Date().toISOString(), lastExportedHash: hash }),
    }),
    {
      name: 'capacity-ui:v1',
      version: 1,
      partialize: (s) => ({
        view: s.view,
        zoom: s.zoom,
        expanded: s.expanded,
        showConflicts: s.showConflicts,
        lastExportedAt: s.lastExportedAt,
        lastExportedHash: s.lastExportedHash,
      }),
    },
  ),
);

/** Default expansion: projects open (to show who's on them), resources closed (to show load). */
export function isExpanded(expanded: Record<RowKey, boolean>, key: RowKey): boolean {
  return expanded[key] ?? key.startsWith('p:');
}
