import { useEffect, useMemo } from 'react';
import { ConflictsPanel } from './components/ConflictsPanel';
import { ManagePage } from './components/manage/ManagePage';
import { ProjectView } from './components/ProjectView';
import { ResourceView } from './components/ResourceView';
import { Toolbar } from './components/Toolbar';
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
  const buckets = useMemo(() => makeBuckets(zoom, anchor), [zoom, anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || isTextInput(e.target)) return;
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
            {showConflicts && <ConflictsPanel />}
          </main>
          <footer className="legend">
            <span>
              Click a cell to cycle 0 → 25 → 50 → 100%. Drag or Shift+click to select a range, then press Space
              to cycle it (or type 25, 50 or 100). Delete clears.
              {zoom !== 'week' && ' In month/quarter view, typing sets every week in the period.'}
            </span>
            <span className="legend-keys">
              <span className="swatch swatch-presales" /> presales
              <span className="swatch swatch-edge" /> workstream start / end
              <span className="swatch swatch-over" /> overallocated
              <span className="swatch swatch-risk" /> at risk if pipeline wins
              <span className="swatch swatch-tentative" /> tentative (pipeline delivery)
              <span className="swatch swatch-outside" /> outside workstream dates
              <span className="mixed">~</span> varies by week
            </span>
          </footer>
        </>
      )}
    </div>
  );
}
