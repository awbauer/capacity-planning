import { useEffect, useMemo } from 'react';
import { ConflictsPanel } from './components/ConflictsPanel';
import { HelpDialog } from './components/HelpDialog';
import { ManagePage } from './components/manage/ManagePage';
import { ProjectView } from './components/ProjectView';
import { ResourceView } from './components/ResourceView';
import { Toolbar } from './components/Toolbar';
import { UtilizationPanel } from './components/UtilizationPanel';
import { buckets as makeBuckets } from './domain/weeks';
import { redo, undo } from './store/planStore';
import { useUIStore } from './store/uiStore';

function isTextInput(el: EventTarget | null): boolean {
  return (
    el instanceof HTMLElement &&
    (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
  );
}

export function App() {
  const view = useUIStore((s) => s.view);
  const zoom = useUIStore((s) => s.zoom);
  const anchor = useUIStore((s) => s.anchor);
  const showConflicts = useUIStore((s) => s.showConflicts);
  const showUtilization = useUIStore((s) => s.showUtilization);
  const showHelp = useUIStore((s) => s.showHelp);
  const setShowHelp = useUIStore((s) => s.setShowHelp);
  const buckets = useMemo(() => makeBuckets(zoom, anchor), [zoom, anchor]);

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
    <div className="app">
      <Toolbar buckets={buckets} />
      {view === 'manage' ? (
        <main className="main main-scroll">
          <ManagePage />
        </main>
      ) : (
        <>
          <main className="main">
            <div className="grid-area">
              {view === 'projects' ? <ProjectView buckets={buckets} /> : <ResourceView buckets={buckets} />}
            </div>
            {view === 'projects' && showUtilization && <UtilizationPanel />}
            {showConflicts && <ConflictsPanel />}
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
    </div>
  );
}
