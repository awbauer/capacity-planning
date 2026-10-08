import { useMemo, useRef } from 'react';
import { allWorkstreamsCsv, slug } from '../domain/csv';
import { hashString } from '../domain/hash';
import { STATUS_LABELS } from '../domain/labels';
import { serializePlan } from '../domain/plans';
import { parsePlanFile } from '../domain/schema';
import type { ProjectStatus, Zoom } from '../domain/types';
import { LOOKAHEAD_WEEKS } from '../domain/utilization';
import { currentWeek, shiftAnchor, type Bucket } from '../domain/weeks';
import { findPlanByName, redo, undo, useHistory, usePlan, usePlanMeta, usePlanStore } from '../store/planStore';
import { useUIStore, type View } from '../store/uiStore';
import { useDerived } from '../store/useDerived';
import { downloadText, today } from './download';
import { Pie } from './grid/Pie';
import { PlanSwitcher } from './PlanSwitcher';

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
  const meta = usePlanMeta();
  const d = useDerived();
  const importPlanFile = usePlanStore((s) => s.importPlanFile);
  const bumpRevision = usePlanStore((s) => s.bumpRevision);
  const { canUndo, canRedo } = useHistory();
  const ui = useUIStore();
  const fileRef = useRef<HTMLInputElement>(null);

  const planHash = useMemo(() => hashString(JSON.stringify(plan)), [plan]);
  const lastExport = ui.exports[meta.id];
  const dirty = lastExport?.hash !== planHash;
  const thisWeek = currentWeek();
  const conflictCount =
    d.overallocations.filter((o) => o.to >= thisWeek).length + d.skillIssues.length + d.upcomingRoles.length;
  const isGrid = ui.view !== 'manage';

  const exportPlan = () => {
    const next = bumpRevision();
    downloadText(`${slug(next.name)}-v${next.revision}-${today()}.json`, serializePlan(next, plan), 'application/json');
    ui.markExported(next.id, planHash);
  };

  const exportCsv = () => downloadText(`staffing-all-workstreams-${today()}.csv`, allWorkstreamsCsv(plan), 'text/csv');

  const onImportFile = async (file: File) => {
    try {
      const incoming = parsePlanFile(JSON.parse(await file.text()));
      const size = (p: typeof plan) => `${p.projects.length} workstreams, ${p.resources.length} resources`;
      const target = findPlanByName(usePlanStore.getState(), incoming.name);
      let msg: string;
      if (!target) {
        msg = `Import ${file.name} as a new plan "${incoming.name}" (v${incoming.revision}, ${size(incoming.plan)})?`;
      } else {
        const isOpen = target.meta.id === meta.id;
        const warnings = [
          incoming.revision < target.meta.revision &&
            `⚠ The file is OLDER (v${incoming.revision}) than your copy (v${target.meta.revision}).`,
          ui.exports[target.meta.id]?.hash !== hashString(JSON.stringify(target.plan)) &&
            `⚠ Your copy has changes that were never exported; they will be lost.`,
        ].filter(Boolean);
        msg = [
          `Overwrite plan "${target.meta.name}" (v${target.meta.revision}, ${size(target.plan)}) ` +
            `with ${file.name} (v${incoming.revision}, ${size(incoming.plan)})?`,
          ...warnings,
          isOpen ? 'You can undo with Ctrl+Z.' : "This can't be undone.",
        ].join('\n\n');
      }
      if (window.confirm(msg)) {
        const { meta: imported, outcome } = importPlanFile(incoming);
        ui.markExported(imported.id, hashString(JSON.stringify(incoming.plan)));
        if (outcome !== 'replaced-open') ui.resetFilters();
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
        <PlanSwitcher />
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
          {lastExport ? `v${meta.revision} exported ${relative(lastExport.at)}` : 'Never exported'}
          {dirty && ' · unsaved changes'}
        </span>
        <button type="button" className="btn" onClick={() => ui.setShowHelp(true)} title="Interactions and shortcuts (?)">
          ? Help
        </button>
        <button
          type="button"
          className="btn"
          onClick={exportPlan}
          title={`Download "${meta.name}" as v${meta.revision + 1} (JSON). Each export increments the version.`}
        >
          Export
        </button>
        <button
          type="button"
          className="btn"
          onClick={exportCsv}
          title="Staffing for every workstream as one CSV (one line per person per week). Each workstream row also has its own CSV download."
        >
          CSV
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => fileRef.current?.click()}
          title="Import a JSON export. It overwrites the plan with the same name, or becomes a new plan."
        >
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
            className="btn"
            aria-pressed={ui.filters.conflictsOnly}
            title={
              ui.view === 'projects'
                ? 'Show only workstreams with a conflict: someone over/at risk in the visible weeks, a skill mismatch, an uncovered capability or an open role to fill'
                : 'Show only people with a conflict: over/at risk in the visible weeks, or a skill mismatch'
            }
            onClick={() => ui.setFilters({ conflictsOnly: !ui.filters.conflictsOnly })}
          >
            ⚠ Conflicts only
          </button>
          {ui.view === 'resources' && (
            <button
              type="button"
              className="btn"
              aria-pressed={ui.filters.underutilized}
              title={`Show only people whose committed work (presales + won delivery) averages under their level's utilization target over the next ${LOOKAHEAD_WEEKS} weeks (targets: Manage → Settings)`}
              onClick={() => ui.setFilters({ underutilized: !ui.filters.underutilized })}
            >
              Underutilized
            </button>
          )}
          {ui.view === 'projects' && (
            <button
              type="button"
              className="btn"
              aria-pressed={ui.showUtilization}
              title={`Everyone's projected utilization over the next ${LOOKAHEAD_WEEKS} weeks, split into delivery and pipeline`}
              onClick={ui.toggleUtilization}
            >
              Utilization
            </button>
          )}
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
