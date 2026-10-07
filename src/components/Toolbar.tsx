import { useMemo, useRef } from 'react';
import { hashString } from '../domain/hash';
import { STATUS_LABELS } from '../domain/labels';
import { parsePlan } from '../domain/schema';
import type { ProjectStatus, Zoom } from '../domain/types';
import { currentWeek, shiftAnchor, type Bucket } from '../domain/weeks';
import { redo, undo, useHistory, usePlan, usePlanStore } from '../store/planStore';
import { useUIStore, type View } from '../store/uiStore';
import { useDerived } from '../store/useDerived';
import { Pie } from './grid/Pie';

const VIEWS: { id: View; label: string }[] = [
  { id: 'projects', label: 'Workstreams' },
  { id: 'resources', label: 'Resources' },
  { id: 'manage', label: 'Manage' },
];
const ZOOMS: { id: Zoom; label: string }[] = [
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'quarter', label: 'Quarter' },
];

function relative(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function Toolbar({ buckets }: { buckets: Bucket[] }) {
  const plan = usePlan();
  const d = useDerived();
  const importPlan = usePlanStore((s) => s.importPlan);
  const { canUndo, canRedo } = useHistory();
  const ui = useUIStore();
  const fileRef = useRef<HTMLInputElement>(null);

  const planHash = useMemo(() => hashString(JSON.stringify(plan)), [plan]);
  const dirty = ui.lastExportedHash !== planHash;
  const thisWeek = currentWeek();
  const conflictCount = d.overallocations.filter((o) => o.to >= thisWeek).length + d.skillIssues.length;
  const isGrid = ui.view !== 'manage';

  const exportPlan = () => {
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `capacity-plan-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    ui.markExported(planHash);
  };

  const onImportFile = async (file: File) => {
    try {
      const next = parsePlan(JSON.parse(await file.text()));
      const msg =
        `Replace the current plan (${plan.projects.length} workstreams, ${plan.resources.length} resources) ` +
        `with ${file.name} (${next.projects.length} workstreams, ${next.resources.length} resources)? You can undo with Ctrl+Z.`;
      if (window.confirm(msg)) {
        importPlan(next);
        ui.markExported(hashString(JSON.stringify(next)));
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  };

  const rangeLabel = buckets.length
    ? `${buckets[0].label} ${buckets[0].sublabel ?? ''} – ${buckets[buckets.length - 1].label} ${buckets[buckets.length - 1].sublabel ?? ''}`
    : '';

  return (
    <header className="toolbar">
      <div className="toolbar-row">
        <h1 className="brand">Capacity Planner</h1>
        <nav className="segmented" aria-label="View">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" aria-pressed={ui.view === v.id} onClick={() => ui.setView(v.id)}>
              {v.label}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        <button type="button" className="btn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          ↶ Undo
        </button>
        <button type="button" className="btn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
          ↷ Redo
        </button>
        <span className={dirty ? 'export-status dirty' : 'export-status'} title="Data lives only in this browser. Export regularly.">
          {ui.lastExportedAt ? `Exported ${relative(ui.lastExportedAt)}` : 'Never exported'}
          {dirty && ' · unsaved changes'}
        </span>
        <button type="button" className="btn" onClick={exportPlan}>
          Export
        </button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onImportFile(file);
            e.target.value = '';
          }}
        />
      </div>
      {isGrid && (
        <div className="toolbar-row">
          <nav className="segmented" aria-label="Zoom">
            {ZOOMS.map((z) => (
              <button key={z.id} type="button" aria-pressed={ui.zoom === z.id} onClick={() => ui.setZoom(z.id)}>
                {z.label}
              </button>
            ))}
          </nav>
          <nav className="segmented" aria-label="Cell display">
            <button
              type="button"
              aria-pressed={ui.cellStyle === 'pie'}
              aria-label="Circles"
              title="Show allocations as filled circles"
              onClick={() => ui.setCellStyle('pie')}
            >
              <Pie value={50} />
            </button>
            <button
              type="button"
              aria-pressed={ui.cellStyle === 'number'}
              aria-label="Numbers"
              title="Show allocations as numbers"
              onClick={() => ui.setCellStyle('number')}
            >
              %
            </button>
          </nav>
          <div className="nav-group">
            <button type="button" className="btn" aria-label="Earlier" onClick={() => ui.setAnchor(shiftAnchor(ui.zoom, ui.anchor, -1))}>
              ◀
            </button>
            <button type="button" className="btn" onClick={ui.goToToday}>
              Today
            </button>
            <button type="button" className="btn" aria-label="Later" onClick={() => ui.setAnchor(shiftAnchor(ui.zoom, ui.anchor, 1))}>
              ▶
            </button>
            <span className="muted small range-label">{rangeLabel}</span>
          </div>
          <span className="spacer" />
          <input
            type="search"
            className="search"
            placeholder={ui.view === 'projects' ? 'Search workstreams, clients, people…' : 'Search people…'}
            value={ui.filters.text}
            onChange={(e) => ui.setFilters({ text: e.target.value })}
          />
          <select
            aria-label="Filter by capability"
            value={ui.filters.tagId ?? ''}
            onChange={(e) => ui.setFilters({ tagId: e.target.value || null })}
          >
            <option value="">All capabilities</option>
            {[...plan.tags]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
          <select
            aria-label="Filter by status"
            value={ui.filters.status ?? ''}
            onChange={(e) => ui.setFilters({ status: (e.target.value || null) as ProjectStatus | null })}
          >
            <option value="">All statuses</option>
            {(Object.keys(STATUS_LABELS) as ProjectStatus[]).map((st) => (
              <option key={st} value={st}>
                {STATUS_LABELS[st]}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by seller"
            value={ui.filters.sellerId ?? ''}
            onChange={(e) => ui.setFilters({ sellerId: e.target.value || null })}
          >
            <option value="">All sellers</option>
            {[...plan.sellers]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
          <button
            type="button"
            className={conflictCount ? 'btn btn-conflicts has' : 'btn btn-conflicts'}
            aria-pressed={ui.showConflicts}
            onClick={ui.toggleConflicts}
          >
            Conflicts {conflictCount > 0 && <span className="count">{conflictCount}</span>}
          </button>
        </div>
      )}
    </header>
  );
}
