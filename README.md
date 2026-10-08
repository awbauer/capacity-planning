# Capacity Planner

A browser-based planner for allocating people (resources) to workstreams by % per week. A workstream is any body of work someone can be allocated to: a sold project, or a pursuit still in presales.

- **Workstreams view**: one row per workstream, expandable to the people on it. Double-click a weekly cell to cycle 0 → 25 → 50 → 100%. Badges flag overallocated people (red/orange/yellow counts), skill mismatches and capability gaps (hover a badge for details).
  - **By client** (corner, on by default) groups workstreams under their client (case-insensitive), with workstreams that have no client last. A client row shows total FTE per period and how many of its workstreams have a conflict. **Clients only** collapses to one row per client.
  - **Utilization** (toolbar) opens a sidebar with everyone's average allocation over the **next 10 weeks**, from the current week regardless of scrolling, as two numbers. *Delivery* is work on *Won* workstreams. *Pipeline* is work on *Pipeline* workstreams: presales effort, plus delivery that only happens if the deal is won. The team figure averages over everyone, so idle people count as 0%. People are listed least-utilized first.
- **Resources view**: one row per person, showing their total load per week as a heat map (red means over the threshold). Expand a person to edit their allocations workstream by workstream.
  - People are grouped by career level: D, SM, M, SA, A, then anyone without a level. Each group can be collapsed.
  - A group's row shows its people's average % per week, plus `+N` for pipeline work. **Levels only** collapses the view to one row per level.
  - Set levels under Manage → Resources.
  - **Underutilized** (toolbar) shows only people whose *committed* work (presales + won delivery) averages under the yellow threshold (100%) over the next 10 weeks, with that average as a badge. Pipeline delivery doesn't count, because it might not happen. This is an average, so someone at 150% for 3 weeks and idle for the rest still shows up.
- **Zoom**: Week, Month or Quarter. In month and quarter view a cell shows the *average* for the period, and is flagged red if *any* week in it is over capacity. Typing into an aggregated cell sets every week in that period.
- **Conflicts panel**: lists current and upcoming overallocations, at-risk weeks and skill gaps. Click an item to jump to the row.
  - **⚠ Conflicts only** (toolbar) shows just the people on the Resources tab, or the workstreams on the Workstreams tab, that have a conflict: someone over or at risk in the visible weeks, a skill mismatch, or (workstreams) an uncovered capability. It combines with the other filters.
- **Presales vs. delivery, pipeline vs. won**:
  - Each workstream has a status: *Pipeline*, *Won* or *Lost*.
  - Each person has **one row per workstream**. The workstream's start date decides what each week is:
    - Weeks **before the start date** are **presales**.
    - Weeks **from the start date** on are **delivery**.
    - With no start date, a *Pipeline* or *Lost* workstream is all presales and a *Won* one is all delivery.
    - If a deal slips, move its start date.
  - **Presales** time always counts toward load, whether or not the deal is won.
  - **Delivery** time counts once the workstream is *Won*. While the workstream is *Pipeline* it is **tentative**: shown with a dashed outline in the grid and as a small `+N` in the Resources view. On a *Lost* workstream it isn't counted.
  - Flags, based on a person's weekly load:
    - **Red, overallocated:** 150% or more, whether from committed work alone or once pipeline work is counted.
    - **Orange, stretched:** committed work of 101–149%.
    - **At risk:** committed work fits, but goes over 100% if pipeline delivery is won. In the grid these show the same orange text, with the pipeline share shown as `+N` and dashed circles. They have their own yellow "At risk" badge and conflicts-panel section.
  - Both thresholds can be changed under Manage → Settings & data.
  - There's deliberately no win-probability %. A per-person "140% weighted" load isn't something anyone can act on.
- **Capability tags** go on both resources and workstreams. Create them from Manage → Capabilities, or by typing a new name into any capability picker.
- **Sellers** are attached to workstreams. They are not allocatable.

## Editing allocations

Each week of a person's row on a workstream is **0, 25, 50 or 100%**. This is a rough planning tool, not a timesheet. A cell shows a circle filled to the matching level.

- **Totals aren't rounded.** Workstream FTE, a person's total load, and month/quarter averages show whatever the weeks add up to.
- **Colors:**
  - Presales weeks (before the start) are **violet**; delivery weeks are **blue**.
  - A dashed circle is pipeline delivery, which is tentative.
  - Red marks overallocated weeks. Orange text marks stretched and at-risk weeks.
- **Workstream start and end** are drawn as vertical lines across the workstream's rows, labelled on the workstream row.
  - On the workstream row, pre-start weeks that have presales work are tinted violet.
  - Everything after the end is shaded.
- The ◑ / % toggle in the toolbar switches cells between circles and numbers.

| Action | How |
| --- | --- |
| Change one week | Double-click the cell: 0 → 25 → 50 → 100 → 0. A single click only selects it. |
| Change a range | Drag across cells (or click, then Shift+click). Press Space to step them all, or type 25, 50 or 100 and press Enter. Typed values round to the nearest step. |
| Clear | Select, then press Delete or Backspace |
| Move | Arrow keys, Tab / Shift+Tab |
| Month / quarter view | Double-clicking or typing sets every week in that period |
| Put someone on a workstream for a date range | **+ Person** on a workstream row (or **+ Workstream** on a resource row). Pick 25 / 50 / 100% and a date range. A pipeline workstream that hasn't started defaults to now until its start date; the dialog says how many of the weeks are presales and how many delivery. Candidates are ranked by matching capabilities and show their peak load before and after the change. |
| Undo / redo | Ctrl/⌘+Z, Ctrl/⌘+Shift+Z |

Older saved data and imported files with other values (e.g. 60%) are rounded to the nearest step when loaded.

## CSV export

- **One workstream:** click **⤓ CSV** on its row. The file has:
  - a block of details: client, seller, status, dates and required capabilities
  - one row per person, with a column per week holding 0/25/50/100
  - a *Phase* row marking each week as Presales or Delivery
  - a *Total FTE* row
- **Everything:** click **CSV** in the toolbar. The file is one long table, with one line per person per allocated week and columns for workstream, client, seller, status, person, role, week, phase and %. It's ready for a pivot table.

Files are UTF-8 with a byte-order mark, so Excel opens names with accents correctly.

## Data storage

Everything is stored in your browser's `localStorage`. There is no server.

- Data is **per browser**. It doesn't sync between machines or people.
- Clearing site data wipes it.

### Plans

You can keep several independent **plans** (e.g. scenarios) in one browser. Pick one from the dropdown next to the title, or choose *＋ New plan…*. Rename and delete plans under Manage → Plans. Undo history is per plan and starts fresh when you switch.

- Each plan has a **name** (unique, case-insensitive) and a **version**.
- **Export** saves the open plan as JSON (`<name>-v<version>-<date>.json`) and increments its version.
- **Import** matches on the name inside the file:
  - A file with the same name **overwrites** that plan. You're warned if the file's version is older than yours, or if your copy has changes that were never exported. Overwriting the open plan can be undone; overwriting another one can't.
  - A file with a new name is added as a **new plan**.
  - Files exported before plans existed have no name and import as *Default*.
- Data saved before plans existed becomes a plan called **Default**.

The toolbar shows when the open plan was last exported and whether it has unexported changes.

A new browser starts with an empty *Default* plan. To try the app, use Manage → Settings & data → *Load sample data*.

## Development

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (Vitest)
npm run lint     # oxlint
npm run build    # typecheck + production build into dist/
```

`dist/` is a static site and can be hosted anywhere.

### Naming

The UI says *workstream*. The code, saved data and export files still use `Project` / `projects` / `projectId`, so existing data and exports keep working.

### Layout

- `src/domain/`: pure logic, unit-tested.
  - `weeks.ts`: week keys and week/month/quarter buckets. A week belongs to the month that contains its Wednesday.
  - `aggregate.ts`: load totals, plus average and peak per bucket.
  - `load.ts`: classifies each allocation as committed, tentative or excluded.
  - `conflicts.ts`: overallocation, at-risk and skill checks.
  - `schema.ts`: validates imported files.
  - `plans.ts`: plan names, versions and the export format.
  - `utilization.ts`: next-10-weeks delivery/pipeline utilization.
- `src/store/`: Zustand stores.
  - `planStore.ts`: the open plan (persisted, with undo history) and the library of other saved plans.
  - `uiStore.ts`: view state.
- `src/components/`: React UI. `grid/TimeGrid.tsx` is the shared spreadsheet-style grid.

See [BACKLOG.md](BACKLOG.md) for deferred features.
