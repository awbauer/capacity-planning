import { useState } from 'react';
import { Modal } from '../components/Modal';
import { uniqueName } from '../domain/plans';
import { useCollabStore } from '../store/collabStore';
import { readLocalPlans } from '../store/localPlanStore';
import { createSharedPlan, openSharedPlan, writePrefs } from '../store/sharedPlanStore';

const size = (p: { projects: unknown[]; resources: unknown[] }) => `${p.projects.length} workstreams, ${p.resources.length} people`;

/**
 * Copies plans saved in this browser into the shared workspace, as new
 * plans. The browser's copies stay as they are (and drift from here on).
 */
export function UploadLocalPlansDialog({ onClose }: { onClose: () => void }) {
  const serverPlans = useCollabStore((s) => s.plans);
  const toast = useCollabStore((s) => s.toast);
  const [local] = useState(() => readLocalPlans());
  const [rows, setRows] = useState(() => {
    const taken = serverPlans.map((p) => p.name);
    return local.map((p) => {
      const name = uniqueName(p.meta.name, taken);
      taken.push(name);
      return { id: p.meta.id, name, on: p.plan.projects.length + p.plan.resources.length > 0 };
    });
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    writePrefs({ uploadOffered: true });
    onClose();
  };

  const upload = async () => {
    setBusy(true);
    setError(null);
    let first: string | undefined;
    try {
      for (const r of rows.filter((x) => x.on)) {
        const plan = local.find((p) => p.meta.id === r.id)!.plan;
        const created = await createSharedPlan(r.name.trim(), plan, '(uploaded from a browser)');
        first ??= created.id;
      }
      toast(`Uploaded ${rows.filter((x) => x.on).length} plan(s).`, 'info');
      if (first) openSharedPlan(first);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Upload plans from this browser"
      onClose={close}
      footer={
        <>
          <button type="button" className="btn" onClick={close} disabled={busy}>
            Not now
          </button>
          <button type="button" className="btn btn-primary" onClick={upload} disabled={busy || !rows.some((r) => r.on)}>
            {busy ? 'Uploading…' : 'Upload'}
          </button>
        </>
      }
    >
      {local.length === 0 ? (
        <p className="muted">There are no plans saved in this browser.</p>
      ) : (
        <>
          <p>
            Each plan you pick becomes a new plan in the shared workspace, recorded in the activity log as uploaded by you.
            This browser’s copies are kept as they are; after uploading, edit the shared ones.
          </p>
          <table className="table">
            <thead>
              <tr>
                <th />
                <th>Name in the shared workspace</th>
                <th>Contents</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Upload ${r.name}`}
                      checked={r.on}
                      onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))}
                    />
                  </td>
                  <td>
                    <input
                      value={r.name}
                      aria-label="Name"
                      onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    />
                  </td>
                  <td className="muted small">{size(local[i].plan)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {error && <p className="error">{error}</p>}
        </>
      )}
    </Modal>
  );
}
