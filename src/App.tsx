import { useEffect, useMemo, useState } from 'react';
import { ConflictsPanel } from './components/ConflictsPanel';
import { DemandView } from './components/DemandView';
import { DetailsModal } from './components/DetailsModal';
import { HelpDialog } from './components/HelpDialog';
import { ActivityView } from './collab/ActivityView';
import { CommentsPanel } from './collab/CommentsPanel';
import { MentionsView } from './collab/MentionsView';
import { Modal } from './components/Modal';
import { SharedGate, Toasts } from './collab/SharedGate';
import { ManagePage } from './components/manage/ManagePage';
import { ProjectView } from './components/ProjectView';
import { ResourceView } from './components/ResourceView';
import { Toolbar } from './components/Toolbar';
import { UtilizationPanel } from './components/UtilizationPanel';
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
    <div className={can.edit ? 'app' : 'app view-only'}>
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
            {view === 'projects' && showUtilization && <UtilizationPanel />}
            {shared && <CommentsPanel />}
            {showConflicts && !(shared && commentsOpen) && <ConflictsPanel />}
          </main>
          <footer className="legend">
            <span>
              Double-click a cell to cycle 0 → 25 → 50 → 100%.{' '}
              <button type="button" className="link-inline" onClick={() => setShowHelp(true)}>
                All shortcuts (?)
              </button>
            </span>
            <span className="legend-keys">
              <span className="swatch swatch-presales" /> presales
              <span className="swatch swatch-edge" /> workstream start / end
              <span className="swatch swatch-over" /> overallocated (150%+, incl. pipeline)
              <span className="swatch swatch-stretch" /> stretched (101–149%) or at risk (pipeline)
              <span className="swatch swatch-tentative" /> tentative (pipeline delivery)
              <span className="swatch swatch-outside" /> outside workstream dates
              <span className="mixed">~</span> varies by week
            </span>
          </footer>
        </>
      )}
      {showHelp && <HelpDialog onClose={() => setShowHelp(false)} />}
      <DetailsModal />
    </div>
  );
}
