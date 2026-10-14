import { useEffect, useState, type ReactNode } from 'react';
import { setPreferredMode, workLocallyThisSession } from '../store/mode';
import { readLocalPlans } from '../store/localPlanStore';
import { useCollabStore } from '../store/collabStore';
import { bootShared, openSharedPlan, readPrefs, RECENT_MS } from '../store/sharedPlanStore';
import { useCan } from '../store/useCan';
import { ROLE_LABELS } from '../domain/permissions';
import { weekInZone } from '../domain/weeks';
import { createSharedPlanInteractively } from './sharedPlanActions';
import { UploadLocalPlansDialog } from './UploadLocalPlansDialog';

function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="gate">
      <div className="gate-card">
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

const LocalButtons = () => (
  <>
    <button type="button" className="btn" onClick={workLocallyThisSession} title="Use the plans saved in this browser for now">
      Work locally this session
    </button>
    <button type="button" className="btn" onClick={() => setPreferredMode('local')} title="Turn the shared workspace off in this browser">
      Turn shared workspace off
    </button>
  </>
);

/**
 * Shared mode's front door: signs in, opens a plan, and covers every state
 * where the shared workspace can't be used (never quietly falling back to
 * this browser's plans).
 */
export function SharedGate({ children }: { children: ReactNode }) {
  const status = useCollabStore((s) => s.status);
  const statusMsg = useCollabStore((s) => s.statusMsg);
  const loaded = useCollabStore((s) => s.loaded);
  const plans = useCollabStore((s) => s.plans);
  const can = useCan();
  const me = useCollabStore((s) => s.me);
  const [upload, setUpload] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [hasLocal] = useState(() => readLocalPlans().some((p) => p.plan.projects.length + p.plan.resources.length > 0));

  useEffect(() => {
    void bootShared();
  }, []);

  // Offer this browser's plans once, the first time someone who can edit gets in.
  const offer = !dismissed && hasLocal && (status === 'live' || status === 'no-plan') && can.edit && !readPrefs().uploadOffered;

  // Forget "recently changed by" markers once they're old, and keep "this week" current over a Monday.
  useEffect(() => {
    const t = setInterval(() => {
      const { recent, set, timeZone, thisWeek } = useCollabStore.getState();
      const cutoff = Date.now() - RECENT_MS;
      const kept = Object.fromEntries(Object.entries(recent).filter(([, v]) => v.ts > cutoff));
      if (Object.keys(kept).length !== Object.keys(recent).length) set({ recent: kept });
      const week = weekInZone(timeZone);
      if (week !== thisWeek) set({ thisWeek: week });
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  const dialog = (upload || offer) && (
    <UploadLocalPlansDialog
      onClose={() => {
        setUpload(false);
        setDismissed(true);
      }}
    />
  );

  switch (status) {
    case 'booting':
      return <Screen title="Connecting to the shared workspace…">{null}</Screen>;
    case 'signed-out':
      return (
        <Screen title="Sign in again">
          <p>{statusMsg ?? 'Your sign-in has expired.'} Edits you hadn’t sent yet are kept and go out once you’re back.</p>
          <div className="gate-actions">
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              Sign in
            </button>
            <LocalButtons />
          </div>
        </Screen>
      );
    case 'forbidden':
      return (
        <Screen title="No access to the shared workspace">
          <p>{statusMsg ?? 'Ask a workspace admin to give you access.'}</p>
          <div className="gate-actions">
            <LocalButtons />
          </div>
        </Screen>
      );
    case 'unreachable':
      return (
        <Screen title="Can’t reach the shared workspace">
          <p>{statusMsg}</p>
          <p className="muted small">
            If this is a new deployment, an admin needs to finish setting it up (Cloudflare Access, TEAM_DOMAIN and POLICY_AUD; see the README).
          </p>
          <div className="gate-actions">
            <button type="button" className="btn btn-primary" onClick={() => void bootShared()}>
              Retry
            </button>
            <LocalButtons />
          </div>
        </Screen>
      );
    case 'reload':
      return (
        <Screen title="The app was updated">
          <p>Reload to get the new version. Edits you hadn’t sent yet are kept.</p>
          <div className="gate-actions">
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </Screen>
      );
    case 'no-plan':
    case 'archived':
      return (
        <Screen title={status === 'archived' ? 'This plan was archived' : 'No plans in the shared workspace yet'}>
          {plans.length > 0 && (
            <>
              <p>Open a plan:</p>
              <ul className="gate-plans">
                {plans.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="link" onClick={() => openSharedPlan(p.id)}>
                      {p.name}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {can.edit ? (
            <div className="gate-actions">
              <button type="button" className="btn btn-primary" onClick={() => void createSharedPlanInteractively()}>
                New plan…
              </button>
              <button type="button" className="btn" onClick={() => setUpload(true)}>
                Upload plans from this browser…
              </button>
            </div>
          ) : (
            <div className="callout gate-viewer">
              <p>
                You’re signed in as <strong>{me?.email ?? 'unknown'}</strong> with view-only access
                {me ? ` (${ROLE_LABELS[me.role]})` : ''}, so you can’t create plans.
              </p>
              <p className="muted small">
                A workspace admin can make you an editor under Manage → People &amp; access. If nobody is an admin yet,
                add your email to the Worker’s <code>OWNER_EMAILS</code> variable in Cloudflare (Settings → Variables and
                secrets), then reload this page.
              </p>
            </div>
          )}
          {dialog}
        </Screen>
      );
  }

  if (!loaded) return <Screen title="Opening the plan…">{null}</Screen>;
  const readOnlyOffline = status === 'offline' && !can.edit;
  return (
    <>
      {status === 'offline' && (
        <div className={readOnlyOffline ? 'conn-banner bad' : 'conn-banner'} role="status">
          {readOnlyOffline
            ? 'Disconnected from the shared workspace. The plan is read-only until the connection is back; reconnecting…'
            : 'Reconnecting… edits you make now are sent when the connection is back.'}
        </div>
      )}
      {children}
      {dialog}
    </>
  );
}

/** Pop-up notices (rejections, undo results, role changes). */
export function Toasts() {
  const toasts = useCollabStore((s) => s.toasts);
  const dismiss = useCollabStore((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span>{t.msg}</span>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
