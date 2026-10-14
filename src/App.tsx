import { useEffect, useMemo, useState } from 'react';
import { CapacityPanel } from './components/CapacityPanel';
import { ConflictsPanel } from './components/ConflictsPanel';
import { DemandView } from './components/DemandView';
import { DetailsModal } from './components/DetailsModal';
import { HelpDialog } from './components/HelpDialog';
import { InspectorPanel } from './components/InspectorPanel';
import { ActivityView } from './collab/ActivityView';
import { CommentsPanel } from './collab/CommentsPanel';
import { MentionsView } from './collab/MentionsView';
import { Modal } from './components/Modal';
import { SharedGate, Toasts } from './collab/SharedGate';
import { ManagePage } from './components/manage/ManagePage';
import { ProjectView } from './components/ProjectView';
import { ResourceView } from './components/ResourceView';
import { Toolbar } from './components/Toolbar';
import { buckets as makeBuckets } from './domain/weeks';
import { useCollabStore } from './store/collabStore';
import { isShared, setPreferredMode } from './store/mode';
import { commentLink } from './store/sharedPlanStore';
import { redo, undo } from './store/planStore';
import { useUIStore } from './store/uiStore';
import { useCan } from './store/useCan';

function isTextInput(el: EventTarget | null): boolean {
  return (
    el instanceof HTMLElement &&
    (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
  );
}

/** Shared mode goes through the sign-in / plan gate first; local mode is the app as it always was. */
export function App() {
  if (!isShared()) {
    return (
      <>
        <PlannerApp />
        <CommentLinkPrompt />
      </>
    );
  }
  return (
    <>
      <SharedGate>
        <PlannerApp />
      </SharedGate>
      <Toasts />
    </>
  );
}

/** A comment link (from a mention email) opened in a browser using its own plans: offer the shared workspace. */
function CommentLinkPrompt() {
  const [link, setLink] = useState(commentLink);
  if (!link) return null;
  const stay = () => {
    history.replaceState(null, '', location.pathname + location.search);
    setLink(null);
  };
  return (
    <Modal
      title="Open a shared comment?"
      onClose={stay}
      footer={
        <>
          <button type="button" className="btn" onClick={stay}>
            Stay on this browser’s plans
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setPreferredMode('shared')}>
            Use the shared workspace
          </button>
        </>
      }
    >
      <p>This link opens a comment in the shared workspace, but this browser is set to use its own plans.</p>
      <p className="muted small">You can switch back any time under Manage → Settings.</p>
    </Modal>
  );
}

function PlannerApp() {
  const view = useUIStore((s) => s.view);
  const zoom = useUIStore((s) => s.zoom);
  const anchor = useUIStore((s) => s.anchor);
  const showConflicts = useUIStore((s) => s.showConflicts);
  const showUtilization = useUIStore((s) => s.showUtilization);
  const showInspector = useUIStore((s) => s.showInspector);
  const density = useUIStore((s) => s.density);
  const showHelp = useUIStore((s) => s.showHelp);
  const setShowHelp = useUIStore((s) => s.setShowHelp);
  const buckets = useMemo(() => makeBuckets(zoom, anchor), [zoom, anchor]);
  const can = useCan();
  const shared = isShared();
  const commentsOpen = useCollabStore((s) => s.comments !== null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTextInput(e.target)) return;
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        useUIStore.getState().setShowHelp(true);
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={['app', can.edit ? '' : 'view-only', density === 'compact' ? 'density-compact' : ''].filter(Boolean).join(' ')}>
      <Toolbar buckets={buckets} />
      {view === 'manage' ? (
        <main className="main main-scroll">
          <ManagePage />
        </main>
      ) : view === 'demand' ? (
        <main className="main main-scroll">
          <DemandView />
        </main>
      ) : view === 'activity' ? (
        <main className="main main-scroll">
          <ActivityView />
        </main>
      ) : view === 'mentions' ? (
        <main className="main main-scroll">
          <MentionsView />
        </main>
      ) : (
        <>
          <main className="main">
            <div className="grid-area">
              {view === 'projects' ? <ProjectView buckets={buckets} /> : <ResourceView buckets={buckets} />}
            </div>
            {view === 'projects' && showUtilization && <CapacityPanel buckets={buckets} />}
            {showInspector && <InspectorPanel />}
            {shared && <CommentsPanel />}
            {showConflicts && !(shared && commentsOpen) && <ConflictsPanel />}
          </main>
          <footer className="legend">
            <span className="legend-keys" aria-label="Key">
              <span className="legend-title">Key</span>
              <span className="legend-item">
                <i className="swatch swatch-confirmed" /> Confirmed
              </span>
              <span className="legend-item" title="Delivery on a pipeline workstream: counts only if it's won">
                <i className="swatch swatch-tentative" /> Tentative
              </span>
              <span className="legend-item">
                <i className="swatch swatch-open" /> Open role
              </span>
              <span className="legend-item" title="Committed work over capacity in these weeks">
                <i className="swatch swatch-conflict" /> Conflict
              </span>
              <span className="legend-item" title="Over capacity if pipeline work is won">
                <i className="swatch swatch-potential" /> At risk
              </span>
              <span className="legend-item" title="Over capacity only if pipeline work under 75% likely to be won comes through">
                <i className="swatch swatch-potential low" /> Low risk
              </span>
              <span className="legend-item">
                <i className="swatch swatch-today" /> This week
              </span>
            </span>
            <span>
              Double-click a week to cycle 0 → 25 → 50 → 100%. Drag a bar’s end to resize it, Alt+drag to move it. I shows details.{' '}
              <button type="button" className="link-inline" onClick={() => setShowHelp(true)}>
                All shortcuts (?)
              </button>
            </span>
          </footer>
        </>
      )}
      {showHelp && <HelpDialog onClose={() => setShowHelp(false)} />}
      <DetailsModal />
    </div>
  );
}
