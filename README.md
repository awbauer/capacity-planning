# Capacity Planner

A browser-based planner for allocating people (resources) to projects by % per week.

- **Projects view**: one row per project, expandable to the people on it. Type a % into the weekly cells. Badges flag overallocated people, skill mismatches and capabilities nobody on the project has.
- **Resources view**: one row per person, showing their total load per week as a heat map (red means over the threshold). Expand a person to edit their allocations project by project.
- **Zoom**: Week, Month or Quarter. In month and quarter view a cell shows the *average* for the period, and is flagged red if *any* week in it is over capacity. Typing into an aggregated cell sets every week in that period.
- **Conflicts panel**: lists current and upcoming overallocations, at-risk weeks and skill gaps. Click an item to jump to the row.
- **Presales vs. delivery, pipeline vs. won**:
  - Each project has a status: *Pipeline*, *Won* or *Lost*.
  - Each person's row on a project is either *Presales* or *Delivery*. A person can have one of each on the same project. Click the chip on the row to switch it.
  - **Presales** time always counts toward load, whether or not the deal is won.
  - **Delivery** time counts once the project is *Won*. While the project is *Pipeline* it is **tentative**: shown with a dashed outline in the grid and as a small `+N` in the Resources view. On a *Lost* project it isn't counted.
  - **Red / overallocated**: committed work alone is over the threshold.
  - **Amber / at risk**: the person is only over the threshold if pipeline delivery work is won.
  - There's deliberately no win-probability %. A per-person "140% weighted" load isn't something anyone can act on.
- **Capability tags** go on both resources and projects. Create them from Manage → Capabilities, or by typing a new name into any capability picker.
- **Sellers** are attached to projects. They are not allocatable.

## Editing allocations

| Action | How |
| --- | --- |
| Set one week | Click a cell, type a number, press Enter |
| Fill a range | Drag across cells (or click, then Shift+click), type a number, press Enter |
| Clear | Select, then press Delete or Backspace |
| Edit an existing value | Double-click, Enter or F2 |
| Move | Arrow keys, Tab / Shift+Tab |
| Put someone on a project for a date range | **+ Person** on a project row (or **+ Project** on a resource row). Pick Presales or Delivery; pipeline projects default to Presales. Candidates are ranked by matching capabilities and show their peak load before and after the change. |
| Undo / redo | Ctrl/⌘+Z, Ctrl/⌘+Shift+Z |

## Data storage

Everything is stored in your browser's `localStorage`. There is no server.

- Data is **per browser**. It doesn't sync between machines or people.
- Clearing site data wipes it.

Use **Export** to save a JSON backup, and **Import** to restore it or move it to another browser. The toolbar shows when you last exported and whether there are unexported changes.

The first launch loads a sample plan. Replace it under Manage → Settings & data → *Start empty*.

## Development

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (Vitest)
npm run lint     # oxlint
npm run build    # typecheck + production build into dist/
```

`dist/` is a static site and can be hosted anywhere.

### Layout

- `src/domain/`: pure logic, unit-tested.
  - `weeks.ts`: week keys and week/month/quarter buckets. A week belongs to the month that contains its Wednesday.
  - `aggregate.ts`: load totals, plus average and peak per bucket.
  - `load.ts`: classifies each allocation as committed, tentative or excluded.
  - `conflicts.ts`: overallocation, at-risk and skill checks.
  - `schema.ts`: validates imported files.
- `src/store/`: Zustand stores.
  - `planStore.ts`: the plan itself. Persisted, with undo history.
  - `uiStore.ts`: view state.
- `src/components/`: React UI. `grid/TimeGrid.tsx` is the shared spreadsheet-style grid.

See [BACKLOG.md](BACKLOG.md) for deferred features.
