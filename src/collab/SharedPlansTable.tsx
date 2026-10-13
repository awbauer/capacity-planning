import { useEffect, useState } from 'react';
import { api, apiDownload } from '../api/client';
import { slug } from '../domain/csv';
import { today } from '../components/download';
import { useCollabStore, type ServerPlan } from '../store/collabStore';
import { usePlanMeta } from '../store/planStore';
import { openSharedPlan, refreshPlans } from '../store/sharedPlanStore';
import { useCan } from '../store/useCan';
import { useUIStore } from '../store/uiStore';
import { createSharedPlanInteractively } from './sharedPlanActions';
import { when } from './HistoryPanel';
import { UploadLocalPlansDialog } from './UploadLocalPlansDialog';

/** Manage → Plans in shared mode: every plan in the workspace. */
export function SharedPlansTable() {
  const meta = usePlanMeta();
  const can = useCan();
  const toast = useCollabStore((s) => s.toast);
  const [all, setAll] = useState<ServerPlan[] | null>(null);
  const [upload, setUpload] = useState(false);
  const plans = useCollabStore((s) => s.plans);

  const load = () =>
    api<{ plans: ServerPlan[] }>(`/api/plans${can.admin ? '?archived=1' : ''}`)
      .then((r) => setAll(r.plans))
      .catch((e: Error) => toast(e.message));
  useEffect(() => {
    void load();
    // Reload when the workspace's plan list changes.
  }, [plans, can.admin]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = async (id: string, body: { name?: string; archived?: boolean }) => {
    try {
      await api(`/api/plans/${id}`, { method: 'PATCH', json: body });
      await refreshPlans();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section>
      <p className="muted small">
        Plans in the shared workspace. Everyone with access sees the same plans and each other’s changes live. Editors
        can create plans; admins rename and archive them (archived plans keep their history and can be restored).
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Created</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(all ?? []).map((p) => (
            <tr key={p.id} className={p.archivedAt ? 'archived' : undefined}>
              <td>
                <strong>{p.name}</strong>
                {p.id === meta.id && <span className="badge">open</span>}
                {p.archivedAt && <span className="badge">archived</span>}
              </td>
              <td className="muted small">
                {when(p.createdAt)} by {p.createdBy}
              </td>
              <td className="row-actions">
                {!p.archivedAt && p.id !== meta.id && (
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => {
                      openSharedPlan(p.id);
                      useUIStore.getState().resetFilters();
                    }}
                  >
                    Open
                  </button>
                )}
                {!p.archivedAt && (
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => apiDownload(`/api/plans/${p.id}/export`, `${slug(p.name)}-${today()}.json`).catch((e: Error) => toast(e.message))}
                  >
                    Export JSON
                  </button>
                )}
                {can.admin && (
                  <>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => {
                        const name = window.prompt('New name for the plan:', p.name)?.trim();
                        if (name && name !== p.name) void patch(p.id, { name });
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() =>
                        (p.archivedAt || window.confirm(`Archive “${p.name}”? People with it open are disconnected. Its history is kept and it can be restored.`)) &&
                        void patch(p.id, { archived: !p.archivedAt })
                      }
                    >
                      {p.archivedAt ? 'Restore' : 'Archive'}
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {can.edit && (
        <div className="button-row">
          <button type="button" className="btn" onClick={() => void createSharedPlanInteractively()}>
            New plan…
          </button>
          <button type="button" className="btn" onClick={() => setUpload(true)}>
            Upload plans from this browser…
          </button>
        </div>
      )}
      {upload && <UploadLocalPlansDialog onClose={() => setUpload(false)} />}
    </section>
  );
}
