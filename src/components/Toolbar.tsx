import { useMemo, useRef, useState } from 'react';
import { isOpenThread } from '../domain/comments';
import { allWorkstreamsCsv, slug } from '../domain/csv';
import { hashString } from '../domain/hash';
import { STATUS_LABELS } from '../domain/labels';
import { serializePlan } from '../domain/plans';
import { parsePlanFile } from '../domain/schema';
import { WIN_PROBABILITIES, type ProjectStatus, type Zoom } from '../domain/types';
import { LOOKAHEAD_WEEKS } from '../domain/utilization';
import { issueCounts, openRoleDemand } from '../domain/capacity';
import { formatWeekRange, shiftAnchor, type Bucket } from '../domain/weeks';
import { findPlanByName, redo, undo, useHistory, usePlan, usePlanMeta, usePlanStore } from '../store/planStore';
import { useUIStore, type View } from '../store/uiStore';
import { useDerived } from '../store/useDerived';
import { downloadText, today } from './download';
import { Pie } from './grid/Pie';
import { MenuItem, Popover } from './Popover';
import { ProjectDialog } from './ProjectDialog';
import { PlanSwitcher } from './PlanSwitcher';
import { apiDownload } from '../api/client';
import { PresenceBar } from '../collab/PresenceBar';
import { uniqueName } from '../domain/plans';
import { useCollabStore } from '../store/collabStore';
import { isLocalOverride, isShared } from '../store/mode';
import { createSharedPlan, openSharedPlan, showComments } from '../store/sharedPlanStore';
import { useCan } from '../store/useCan';
import { Toggle } from './Toggle';

const VIEWS: { id: View; label: string; sharedOnly?: boolean }[] = [
  { id: 'projects', label: 'Workstreams' },
  { id: 'resources', label: 'Resources' },
  { id: 'demand', label: 'Demand' },
  { id: 'activity', label: 'Activity', sharedOnly: true },
  { id: 'mentions', label: 'Mentions', sharedOnly: true },
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

  const shared = isShared();
  const can = useCan();
  const mentionCounts = useCollabStore((s) => s.mentionCounts);
  const comments = useCollabStore((s) => s.comments);
  const openThreads = useCollabStore((s) => Object.values(s.threads).filter(isOpenThread).length);
  // The "unsaved changes" hint is for this browser's plans; shared plans are saved as you go.
  const planHash = useMemo(() => (shared ? '' : hashString(JSON.stringify(plan))), [plan, shared]);
  const lastExport = ui.exports[meta.id];
  const dirty = lastExport?.hash !== planHash;
  const [creating, setCreating] = useState(false);
  const visibleWeeks = useMemo(() => buckets.flatMap((b) => b.weeks), [buckets]);
  const issues = useMemo(
    () => issueCounts(d.overallocations, openRoleDemand(plan, visibleWeeks), visibleWeeks),
    [d.overallocations, plan, visibleWeeks],
  );
  const skillCount = d.skillIssues.length;
  const isGrid = ui.view === 'projects' || ui.view === 'resources';

  const exportPlan = () => {
    if (shared) {
      apiDownload(`/api/plans/${meta.id}/export`, `${slug(meta.name)}-v${meta.revision}-${today()}.json`).catch((e: Error) =>
        useCollabStore.getState().toast(e.message),
      );
      return;
    }
    const next = bumpRevision();
    downloadText(`${slug(next.name)}-v${next.revision}-${today()}.json`, serializePlan(next, plan), 'application/json');
    ui.markExported(next.id, planHash);
  };

  const exportCsv = () => downloadText(`staffing-all-workstreams-${today()}.csv`, allWorkstreamsCsv(plan), 'text/csv');

  /** Shared mode: a file always becomes a new shared plan (replacing a shared plan wholesale isn't offered). */
  const importShared = async (file: File) => {
    const { plans, toast } = useCollabStore.getState();
    try {
      const incoming = parsePlanFile(JSON.parse(await file.text()));
      const name = uniqueName(incoming.name, plans.map((p) => p.name));
      if (!window.confirm(`Import ${file.name} into the shared workspace as a new plan "${name}"?`)) return;
      const created = await createSharedPlan(name, incoming.plan, `(imported from ${file.name})`);
      openSharedPlan(created.id);
      ui.resetFilters();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  };

  const onImportFile = async (file: File) => {
    if (shared) return importShared(file);
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

  const rangeLabel = buckets.length ? formatWeekRange(buckets[0].weeks[0], buckets[buckets.length - 1].weeks.at(-1)!) : '';
  const activeFilters = [ui.filters.tagId, ui.filters.status, ui.filters.sellerId, ui.filters.minWinProbability].filter(
    (v) => v !== null && v !== '',
  ).length;
  const issueParts = [
    issues.conflicts > 0 && { n: issues.conflicts, label: issues.conflicts === 1 ? 'conflict' : 'conflicts', cls: 'danger' },
    issues.risks > 0 && { n: issues.risks, label: 'at risk', cls: 'risk' },
    issues.openRoles > 0 && { n: issues.openRoles, label: issues.openRoles === 1 ? 'open role' : 'open roles', cls: 'open' },
  ].filter((x): x is { n: number; label: string; cls: string } => !!x);

  return (
    <header className="toolbar">
      <div className="toolbar-row app-header">
        <h1 className="brand">Capacity Planner</h1>
        <PlanSwitcher />
        <nav className="tabs-nav" aria-label="View">
          {VIEWS.filter((v) => shared || !v.sharedOnly).map((v) => (
            <button key={v.id} type="button" aria-pressed={ui.view === v.id} onClick={() => ui.setView(v.id)}>
              {v.label}
              {v.id === 'mentions' && mentionCounts.unreadOpen > 0 && (
                <span className="count count-alert" title={`${mentionCounts.unreadOpen} unresolved thread(s) mentioning you have something new`}>
                  {mentionCounts.unreadOpen}
                </span>
              )}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        {shared ? (
          <PresenceBar />
        ) : (
          <>
            {isLocalOverride() && (
              <span className="mode-badge mode-local" title="The shared workspace is switched on but couldn't be used; you're on this browser's plans for this session.">
                Local (this session)
              </span>
            )}
            <span className={dirty ? 'export-status dirty' : 'export-status'} title="Data lives only in this browser. Export regularly.">
              {lastExport ? `v${meta.revision} exported ${relative(lastExport.at)}` : 'Never exported'}
              {dirty && ' · unsaved changes'}
            </span>
          </>
        )}
        <button
          type="button"
          className="btn"
          onClick={undo}
          disabled={!canUndo}
          title={shared ? 'Undo your last change (Ctrl+Z). Later changes by others are kept.' : 'Undo (Ctrl+Z)'}
        >
          ↶ Undo
        </button>
        <button type="button" className="btn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
          ↷ Redo
        </button>
        <button type="button" className="btn btn-icon" aria-label="Help" onClick={() => ui.setShowHelp(true)} title="Interactions and shortcuts (?)">
          ?
        </button>
        <Popover className="btn btn-icon" label="⋯" ariaLabel="More" title="Export, CSV and import">
          <MenuItem
            onClick={exportPlan}
            title={
              shared
                ? `Download "${meta.name}" as JSON (a backup, or to use in a browser-only plan)`
                : `Download "${meta.name}" as v${meta.revision + 1} (JSON). Each export increments the version.`
            }
          >
            Export plan (JSON)
          </MenuItem>
          <MenuItem
            onClick={exportCsv}
            title="Staffing for every workstream as one CSV (one line per person per week). Each workstream also has its own CSV download."
          >
            Export staffing (CSV)
          </MenuItem>
          <MenuItem
            onClick={() => fileRef.current?.click()}
            disabled={shared && !can.edit}
            title={
              shared
                ? 'Import a JSON export as a new plan in the shared workspace.'
                : 'Import a JSON export. It overwrites the plan with the same name, or becomes a new plan.'
            }
          >
            Import plan…
          </MenuItem>
        </Popover>
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
        <div className="toolbar-row planner-bar">
          <nav className="segmented" aria-label="Zoom">
            {ZOOMS.map((z) => (
              <button key={z.id} type="button" aria-pressed={ui.zoom === z.id} onClick={() => ui.setZoom(z.id)}>
                {z.label}
              </button>
            ))}
          </nav>
          {ui.zoom !== 'week' && (
            <nav className="segmented" aria-label="Rollup" title="What a month or quarter column shows">
              <button type="button" aria-pressed={ui.rollup === 'avg'} title="Average of the period's weeks" onClick={() => ui.setRollup('avg')}>
                Avg
              </button>
              <button type="button" aria-pressed={ui.rollup === 'peak'} title="The period's busiest week" onClick={() => ui.setRollup('peak')}>
                Peak
              </button>
            </nav>
          )}
          <div className="nav-group">
            <button type="button" className="btn btn-icon" aria-label="Earlier" title="Earlier" onClick={() => ui.setAnchor(shiftAnchor(ui.zoom, ui.anchor, -1))}>
              ‹
            </button>
            <button type="button" className="btn" onClick={ui.goToToday}>
              Today
            </button>
            <button type="button" className="btn btn-icon" aria-label="Later" title="Later" onClick={() => ui.setAnchor(shiftAnchor(ui.zoom, ui.anchor, 1))}>
              ›
            </button>
            <span className="range-label">{rangeLabel}</span>
          </div>
          <span className="spacer" />
          <input
            type="search"
            className="search"
            aria-label="Search"
            placeholder={ui.view === 'projects' ? 'Search workstreams, clients, people…' : 'Search people…'}
            value={ui.filters.text}
            onChange={(e) => ui.setFilters({ text: e.target.value })}
          />
          <Popover
            kind="dialog"
            className={activeFilters ? 'btn has-filters' : 'btn'}
            ariaLabel="Filters"
            label={
              <>
                Filters{activeFilters > 0 && <span className="count">{activeFilters}</span>}
              </>
            }
          >
            <div className="filter-form">
              <label>
                Capability
                <select aria-label="Filter by capability" value={ui.filters.tagId ?? ''} onChange={(e) => ui.setFilters({ tagId: e.target.value || null })}>
                  <option value="">All capabilities</option>
                  {[...plan.tags]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Stage
                <select
                  aria-label="Filter by status"
                  disabled={ui.view === 'projects' && ui.filters.pipelineOnly}
                  title={ui.view === 'projects' && ui.filters.pipelineOnly ? 'Turn off Pipeline only to filter by another stage' : undefined}
                  value={ui.filters.status ?? ''}
                  onChange={(e) => ui.setFilters({ status: (e.target.value || null) as ProjectStatus | null })}
                >
                  <option value="">All stages</option>
                  {(Object.keys(STATUS_LABELS) as ProjectStatus[]).map((st) => (
                    <option key={st} value={st}>
                      {STATUS_LABELS[st]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Seller
                <select aria-label="Filter by seller" value={ui.filters.sellerId ?? ''} onChange={(e) => ui.setFilters({ sellerId: e.target.value || null })}>
                  <option value="">All sellers</option>
                  {[...plan.sellers]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </label>
              {ui.view === 'projects' && (
                <label>
                  Win %
                  <select
                    aria-label="Filter by win probability"
                    title="Pipeline workstreams at least this likely to be won (won and lost ones aren't affected)"
                    value={ui.filters.minWinProbability ?? ''}
                    onChange={(e) => ui.setFilters({ minWinProbability: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">Any</option>
                    {WIN_PROBABILITIES.map((n) => (
                      <option key={n} value={n}>
                        {n}% or more
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                type="button"
                className="btn btn-small"
                disabled={!activeFilters}
                onClick={() => ui.setFilters({ tagId: null, status: null, sellerId: null, minWinProbability: null })}
              >
                Reset filters
              </button>
            </div>
          </Popover>
          {ui.view === 'projects' ? (
            <Toggle
              label="Pipeline only"
              checked={ui.filters.pipelineOnly}
              title="Show only workstreams still in the pipeline (turn off to see won and lost ones too)"
              onChange={(pipelineOnly) => ui.setFilters({ pipelineOnly })}
            />
          ) : (
            <Toggle
              label="Issues only"
              checked={ui.filters.conflictsOnly}
              title="Show only people with an issue: over capacity or at risk in the visible weeks, or a skill mismatch"
              onChange={(conflictsOnly) => ui.setFilters({ conflictsOnly })}
            />
          )}
          {ui.view === 'resources' && (
            <Toggle
              label="Underutilized"
              checked={ui.filters.underutilized}
              title={`Show only people whose committed work (presales + won delivery) averages under their level's utilization target over the next ${LOOKAHEAD_WEEKS} weeks (targets: Manage → Settings)`}
              onChange={(underutilized) => ui.setFilters({ underutilized })}
            />
          )}
          <button
            type="button"
            className="issue-chip"
            aria-pressed={ui.showConflicts}
            title={`Issues in the visible weeks across the whole plan, whatever the filters show${skillCount ? `, plus ${skillCount} skill issue${skillCount === 1 ? '' : 's'}` : ''}. Click to open the list.`}
            onClick={ui.toggleConflicts}
          >
            {issueParts.length === 0 ? (
              <span className="issue-none">No issues</span>
            ) : (
              issueParts.map((p) => (
                <span key={p.cls} className={`issue-part issue-${p.cls}`}>
                  <strong>{p.n}</strong> {p.label}
                </span>
              ))
            )}
          </button>
          <nav className="segmented" aria-label="Cell display">
            <button
              type="button"
              aria-pressed={ui.cellStyle === 'bars'}
              aria-label="Bars"
              title="Bars, labelled in FTE where they start or change"
              onClick={() => ui.setCellStyle('bars')}
            >
              <span className="bars-icon" aria-hidden />
            </button>
            <button
              type="button"
              aria-pressed={ui.cellStyle === 'pie'}
              aria-label="Circles"
              title="Circles in every week, filled to its %"
              onClick={() => ui.setCellStyle('pie')}
            >
              <Pie value={50} />
            </button>
            <button
              type="button"
              aria-pressed={ui.cellStyle === 'number'}
              aria-label="Numbers"
              title="Show every week's %"
              onClick={() => ui.setCellStyle('number')}
            >
              %
            </button>
          </nav>
          <button
            type="button"
            className="btn"
            aria-pressed={ui.showInspector}
            title="Details of the selected week: booking, the person's load and issues (I)"
            onClick={() => ui.toggleInspector()}
          >
            Details
          </button>
          {shared && (
            <button
              type="button"
              className="btn"
              aria-pressed={!!comments}
              title="Comment threads in this plan (right-click a cell or press M to comment on it)"
              onClick={() => (comments ? useCollabStore.getState().set({ comments: null }) : showComments())}
            >
              Comments {openThreads > 0 && <span className="count">{openThreads}</span>}
            </button>
          )}
          {ui.view === 'projects' && (
            <>
              <button
                type="button"
                className="btn"
                aria-pressed={ui.showUtilization}
                title={`Team capacity over the next ${LOOKAHEAD_WEEKS} weeks, in FTE-weeks`}
                onClick={ui.toggleUtilization}
              >
                ▥ Capacity
              </button>
              <button type="button" className="btn btn-primary edit-only" onClick={() => setCreating(true)}>
                + Workstream
              </button>
            </>
          )}
        </div>
      )}
      {creating && <ProjectDialog onClose={() => setCreating(false)} />}
    </header>
  );
}
