import { useState } from 'react';
import { TAG_COLORS } from '../../domain/ids';
import { normalizeWeek } from '../../domain/weeks';
import { usePlan, usePlanStore } from '../../store/planStore';
import { useDerived } from '../../store/useDerived';
import { SellerPicker } from '../SellerPicker';
import { StatusSelect } from '../StatusControls';
import { TagPicker } from '../TagPicker';
import { AddRow, InlineText } from './InlineText';

type Tab = 'resources' | 'projects' | 'tags' | 'sellers' | 'settings';
const TABS: { id: Tab; label: string }[] = [
  { id: 'resources', label: 'Resources' },
  { id: 'projects', label: 'Workstreams' },
  { id: 'tags', label: 'Capabilities' },
  { id: 'sellers', label: 'Sellers' },
  { id: 'settings', label: 'Settings & data' },
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function ManagePage() {
  const [tab, setTab] = useState<Tab>('resources');
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
      {tab === 'settings' && <SettingsPanel />}
    </div>
  );
}

function ResourcesTable() {
  const plan = usePlan();
  const d = useDerived();
  const s = usePlanStore();
  const resources = [...plan.resources].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <section>
      <p className="muted">People who can be allocated to workstreams. Capabilities drive skill-mismatch warnings.</p>
      <AddRow placeholder="New resource name…" onAdd={(name) => s.addResource({ name, tagIds: [] })} />
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
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

function SettingsPanel() {
  const plan = usePlan();
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
      <div className="callout">
        <strong>Your data lives only in this browser.</strong> Clearing site data or switching browsers loses it. Use
        Export in the toolbar to save a JSON backup, and Import to restore or move it.
      </div>
      <div className="button-row">
        <button
          type="button"
          className="btn"
          onClick={() => window.confirm('Replace everything with the sample plan? You can undo.') && s.resetToSample()}
        >
          Load sample data
        </button>
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => window.confirm('Delete all workstreams, people, sellers and capabilities? You can undo.') && s.clearAll()}
        >
          Start empty
        </button>
      </div>
    </section>
  );
}
