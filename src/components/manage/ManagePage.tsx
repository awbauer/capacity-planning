import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { hashString } from '../../domain/hash';
import { TAG_COLORS } from '../../domain/ids';
import { CAREER_LEVELS, type CareerLevel, type Resource } from '../../domain/types';
import { DEFAULT_TARGETS, LOOKAHEAD_WEEKS, NO_LEVEL_TARGET, utilizationTarget } from '../../domain/utilization';
import { normalizeWeek } from '../../domain/weeks';
import { allPlans, usePlan, usePlanMeta, usePlanStore } from '../../store/planStore';
import { useUIStore, type ManageTab } from '../../store/uiStore';
import { useDerived } from '../../store/useDerived';
import { createPlanInteractively } from '../planActions';
import { SellerPicker } from '../SellerPicker';
import { StatusSelect } from '../StatusControls';
import { TagPicker } from '../TagPicker';
import { AddRow, InlineText } from './InlineText';

const TABS: { id: ManageTab; label: string }[] = [
  { id: 'resources', label: 'Resources' },
  { id: 'projects', label: 'Workstreams' },
  { id: 'tags', label: 'Capabilities' },
  { id: 'sellers', label: 'Sellers' },
  { id: 'plans', label: 'Plans' },
  { id: 'settings', label: 'Settings & data' },
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function ManagePage() {
  const tab = useUIStore((s) => s.manageTab);
  const setTab = useUIStore((s) => s.openManage);
  return (
    <div className="manage">
      <nav className="tabs" aria-label="Manage">
        {TABS.map((t) => (
          <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'resources' && <ResourcesTable />}
      {tab === 'projects' && <ProjectsTable />}
      {tab === 'tags' && <TagsTable />}
      {tab === 'sellers' && <SellersTable />}
      {tab === 'plans' && <PlansTable />}
      {tab === 'settings' && <SettingsPanel />}
    </div>
  );
}

function ResourcesTable() {
  const plan = usePlan();
  const d = useDerived();
  const s = usePlanStore();
  // Most senior level first, then by name; people without a level last.
  const rank = (r: Resource) => (r.level ? CAREER_LEVELS.indexOf(r.level) : CAREER_LEVELS.length);
  const resources = [...plan.resources].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return (
    <section>
      <p className="muted">People who can be allocated to workstreams. Capabilities drive skill-mismatch warnings.</p>
      <AddRow placeholder="New resource name…" onAdd={(name) => s.addResource({ name, tagIds: [] })} />
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Level</th>
            <th>Role</th>
            <th>Capabilities</th>
            <th>Workstreams</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {resources.map((r) => {
            const n = d.assignmentsByResource.get(r.id)?.length ?? 0;
            return (
              <tr key={r.id}>
                <td>
                  <InlineText ariaLabel="Name" required value={r.name} onCommit={(name) => s.updateResource(r.id, { name })} />
                </td>
                <td>
                  <select
                    aria-label="Career level"
                    value={r.level ?? ''}
                    onChange={(e) => s.updateResource(r.id, { level: (e.target.value || undefined) as CareerLevel | undefined })}
                  >
                    <option value="">—</option>
                    {CAREER_LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <InlineText ariaLabel="Role" value={r.role ?? ''} placeholder="Role" onCommit={(role) => s.updateResource(r.id, { role: role || undefined })} />
                </td>
                <td className="wide">
                  <TagPicker value={r.tagIds} onChange={(tagIds) => s.updateResource(r.id, { tagIds })} />
                </td>
                <td>{n}</td>
                <td>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Delete ${r.name}`}
                    onClick={() => {
                      if (window.confirm(`Delete ${r.name}${n ? ` and remove them from ${plural(n, 'workstream')}` : ''}?`)) {
                        s.deleteResource(r.id);
                      }
                    }}
                  >
                    ×
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function ProjectsTable() {
  const plan = usePlan();
  const d = useDerived();
  const s = usePlanStore();
  const projects = [...plan.projects].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <section>
      <p className="muted">Required capabilities are compared against assigned people. Dates mark the start and end on the grid.</p>
      <AddRow placeholder="New workstream name…" onAdd={(name) => s.addProject({ name, sellerId: null, status: 'pipeline', tagIds: [] })} />
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Client</th>
            <th>Seller</th>
            <th>Status</th>
            <th>Required capabilities</th>
            <th>Start</th>
            <th>End</th>
            <th>People</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => {
            const n = d.assignmentsByProject.get(p.id)?.length ?? 0;
            return (
              <tr key={p.id}>
                <td>
                  <InlineText ariaLabel="Name" required value={p.name} onCommit={(name) => s.updateProject(p.id, { name })} />
                </td>
                <td>
                  <InlineText ariaLabel="Client" value={p.client ?? ''} placeholder="Client" onCommit={(client) => s.updateProject(p.id, { client: client || undefined })} />
                </td>
                <td>
                  <SellerPicker value={p.sellerId} onChange={(sellerId) => s.updateProject(p.id, { sellerId })} />
                </td>
                <td>
                  <StatusSelect value={p.status} onChange={(status) => s.updateProject(p.id, { status })} />
                </td>
                <td className="wide">
                  <TagPicker value={p.tagIds} onChange={(tagIds) => s.updateProject(p.id, { tagIds })} />
                </td>
                <td>
                  <input
                    type="date"
                    aria-label="Start week"
                    value={p.startWeek ?? ''}
                    onChange={(e) => s.updateProject(p.id, { startWeek: e.target.value ? normalizeWeek(e.target.value) : undefined })}
                  />
                </td>
                <td>
                  <input
                    type="date"
                    aria-label="End week"
                    value={p.endWeek ?? ''}
                    onChange={(e) => s.updateProject(p.id, { endWeek: e.target.value ? normalizeWeek(e.target.value) : undefined })}
                  />
                </td>
                <td>{n}</td>
                <td>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Delete ${p.name}`}
                    onClick={() => {
                      if (window.confirm(`Delete ${p.name}${n ? ` and its ${plural(n, 'assignment')}` : ''}?`)) {
                        s.deleteProject(p.id);
                      }
                    }}
                  >
                    ×
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function TagsTable() {
  const plan = usePlan();
  const s = usePlanStore();
  const tags = [...plan.tags].sort((a, b) => a.name.localeCompare(b.name));
  const usage = (id: string) => ({
    resources: plan.resources.filter((r) => r.tagIds.includes(id)).length,
    projects: plan.projects.filter((p) => p.tagIds.includes(id)).length,
  });
  return (
    <section>
      <p className="muted">Capabilities can also be created on the fly from any resource or workstream capability picker.</p>
      <AddRow placeholder="New capability (e.g. Data Cloud)…" onAdd={(name) => s.addTag(name)} />
      <table className="table">
        <thead>
          <tr>
            <th>Color</th>
            <th>Name</th>
            <th>Resources</th>
            <th>Workstreams</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tags.map((t) => {
            const u = usage(t.id);
            return (
              <tr key={t.id}>
                <td>
                  <select
                    className="color-select"
                    aria-label="Color"
                    value={t.color}
                    style={{ color: t.color }}
                    onChange={(e) => s.updateTag(t.id, { color: e.target.value })}
                  >
                    {(TAG_COLORS.includes(t.color) ? TAG_COLORS : [t.color, ...TAG_COLORS]).map((c) => (
                      <option key={c} value={c} style={{ color: c }}>
                        ● {c}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <InlineText ariaLabel="Name" required value={t.name} onCommit={(name) => s.updateTag(t.id, { name })} />
                </td>
                <td>{u.resources}</td>
                <td>{u.projects}</td>
                <td>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Delete ${t.name}`}
                    onClick={() => {
                      const used = u.resources + u.projects;
                      if (
                        window.confirm(
                          used
                            ? `Delete ${t.name}? It will be removed from ${plural(u.resources, 'resource')} and ${plural(u.projects, 'workstream')}.`
                            : `Delete ${t.name}?`,
                        )
                      ) {
                        s.deleteTag(t.id);
                      }
                    }}
                  >
                    ×
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function SellersTable() {
  const plan = usePlan();
  const s = usePlanStore();
  const sellers = [...plan.sellers].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <section>
      <p className="muted">Sellers own workstreams but aren't allocatable.</p>
      <AddRow placeholder="New seller name…" onAdd={(name) => s.addSeller(name)} />
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Workstreams</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sellers.map((seller) => {
            const n = plan.projects.filter((p) => p.sellerId === seller.id).length;
            return (
              <tr key={seller.id}>
                <td>
                  <InlineText ariaLabel="Name" required value={seller.name} onCommit={(name) => s.updateSeller(seller.id, { name })} />
                </td>
                <td>
                  <InlineText
                    ariaLabel="Email"
                    type="email"
                    value={seller.email ?? ''}
                    placeholder="Email"
                    onCommit={(email) => s.updateSeller(seller.id, { email: email || undefined })}
                  />
                </td>
                <td>{n}</td>
                <td>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Delete ${seller.name}`}
                    onClick={() => {
                      if (window.confirm(`Delete ${seller.name}?${n ? ` ${plural(n, 'workstream')} will have no seller.` : ''}`)) {
                        s.deleteSeller(seller.id);
                      }
                    }}
                  >
                    ×
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function PlansTable() {
  const { plan: openPlan, meta: openMeta, library } = usePlanStore(
    useShallow((s) => ({ plan: s.plan, meta: s.meta, library: s.library })),
  );
  const plans = allPlans({ plan: openPlan, meta: openMeta, library });
  const activeId = openMeta.id;
  const s = usePlanStore();
  const ui = useUIStore();
  // Bumped to reset a name input after a rejected rename.
  const [resets, setResets] = useState(0);
  return (
    <section>
      <p className="muted">
        Plans saved in this browser. Export saves the open plan as JSON and increments its version; importing a file
        overwrites the plan with the same name, or adds a new plan.
      </p>
      <div className="button-row">
        <button type="button" className="btn btn-primary" onClick={createPlanInteractively}>
          + New plan
        </button>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Version</th>
            <th>Workstreams</th>
            <th>People</th>
            <th>Last export</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {plans.map(({ meta, plan }) => {
            const open = meta.id === activeId;
            const exp = ui.exports[meta.id];
            const empty = plan.projects.length + plan.resources.length === 0;
            const unsaved = !empty && exp?.hash !== hashString(JSON.stringify(plan));
            return (
              <tr key={meta.id} className={open ? 'current' : undefined}>
                <td>
                  <InlineText
                    key={`${meta.id}-${resets}`}
                    ariaLabel="Plan name"
                    required
                    value={meta.name}
                    onCommit={(name) => {
                      if (!s.renamePlan(meta.id, name)) {
                        window.alert(`A plan called "${name}" already exists.`);
                        setResets((n) => n + 1);
                      }
                    }}
                  />
                </td>
                <td>v{meta.revision}</td>
                <td>{plan.projects.length}</td>
                <td>{plan.resources.length}</td>
                <td>
                  {exp ? new Date(exp.at).toLocaleString() : <span className="muted">Never</span>}
                  {unsaved && <span className="muted small"> · unsaved changes</span>}
                </td>
                <td className="actions">
                  {open ? (
                    <span className="badge">Open</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => {
                        s.switchPlan(meta.id);
                        ui.resetFilters();
                      }}
                    >
                      Open
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Delete plan ${meta.name}`}
                    title={plans.length === 1 ? "The only plan can't be deleted" : 'Delete plan'}
                    disabled={plans.length === 1}
                    onClick={() => {
                      const warn = unsaved ? ' It has changes that were never exported.' : '';
                      if (window.confirm(`Delete plan "${meta.name}"?${warn} This can't be undone.`)) {
                        s.deletePlan(meta.id);
                        if (open) ui.resetFilters();
                      }
                    }}
                  >
                    ×
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function SettingsPanel() {
  const plan = usePlan();
  const meta = usePlanMeta();
  const s = usePlanStore();
  return (
    <section className="settings">
      <label>
        Yellow above (%)
        <input
          type="number"
          min={1}
          max={999}
          value={plan.settings.overallocationThreshold}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (v > 0) s.setThresholds({ overallocationThreshold: v });
          }}
        />
        <span className="muted small">
          Committed weekly load above this is flagged yellow (stretched). Pipeline delivery that would push someone over
          it is flagged amber (at risk).
        </span>
      </label>
      <label>
        Red above (%)
        <input
          type="number"
          min={1}
          max={999}
          value={plan.settings.criticalThreshold}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (v > 0) s.setThresholds({ criticalThreshold: v });
          }}
        />
        <span className="muted small">Committed weekly load above this is flagged red (overallocated).</span>
      </label>
      <fieldset className="targets">
        <legend>Utilization targets by level (%)</legend>
        <p className="muted small">
          Expected committed utilization (presales + won delivery) for each career level. People under their target over
          the next {LOOKAHEAD_WEEKS} weeks show as Underutilized. People without a level use {NO_LEVEL_TARGET}%.
        </p>
        <div className="targets-row">
          {CAREER_LEVELS.map((level) => (
            <label key={level}>
              {level}
              <input
                type="number"
                min={0}
                max={100}
                step={5}
                aria-label={`Target for ${level}`}
                value={utilizationTarget(plan.settings, level)}
                onChange={(e) => {
                  if (e.target.value === '') return;
                  s.setUtilizationTarget(level, Number(e.target.value));
                }}
              />
            </label>
          ))}
          <button
            type="button"
            className="btn btn-small"
            disabled={!plan.settings.utilizationTargets || Object.keys(plan.settings.utilizationTargets).length === 0}
            onClick={() => CAREER_LEVELS.forEach((l) => s.setUtilizationTarget(l, null))}
            title={`Defaults: ${CAREER_LEVELS.map((l) => `${l} ${DEFAULT_TARGETS[l]}%`).join(', ')}`}
          >
            Reset to defaults
          </button>
        </div>
      </fieldset>
      <div className="callout">
        <strong>Your data lives only in this browser.</strong> Clearing site data or switching browsers loses it. Use
        Export in the toolbar to save a JSON backup of the open plan, and Import to restore or move it. Thresholds
        and the buttons below apply to the open plan only.
      </div>
      <div className="button-row">
        <button
          type="button"
          className="btn"
          onClick={() => window.confirm(`Replace the contents of plan "${meta.name}" with the sample data? You can undo.`) && s.resetToSample()}
        >
          Load sample data
        </button>
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => window.confirm(`Delete all workstreams, people, sellers and capabilities from plan "${meta.name}"? You can undo.`) && s.clearAll()}
        >
          Start empty
        </button>
      </div>
    </section>
  );
}
