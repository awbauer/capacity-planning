# Capacity Planner

A browser-based planner for allocating people (resources) to workstreams by % per week. A workstream is any body of work someone can be allocated to: a sold project, or a pursuit still in presales.

- **Workstreams view**: one row per workstream, expandable to its **roles**. Every row under a workstream is a role (a seat) with the person in it, shown as *Role › Person*, or *Role › Open* when nobody's been chosen yet. A person is always in a role, even if it's just a shell named after their title. Double-click a weekly cell to cycle 0 → 25 → 50 → 100%. Badges flag overallocated people (red/orange/yellow counts), skill mismatches and capability gaps (hover a badge for details).
  - **By client** (switch in the corner, on by default) groups workstreams under their client (case-insensitive), with workstreams that have no client last. A client row shows total FTE per period and how many of its workstreams have a conflict. **Clients only** collapses to one row per client.
  - **Roles**:
    - **+ Role** adds a role: a name (e.g. "Agentforce Architect"), an optional level, the capabilities it needs (defaults to the workstream's), a % over dates, and optionally who's in it. Leave the person out for an **open role**: demand you haven't picked anyone for.
    - **+ Person** is the quick way to staff someone: each person goes into a role named after their title (or the role they already have there), which you can rename later.
    - Click a **role name** to rename it or change its level and capabilities. Skill mismatches are checked against the role's capabilities when it has its own, otherwise the workstream's.
    - Click a **person** to swap someone else into the role, or **Leave open** to free them and keep the role and its weeks as demand. **Fill…** on an open role does the same. Candidates are ranked by matching capabilities, closeness to the role's level, then free capacity. The role keeps its weeks and name; one undo step.
    - **×** removes the role. Deleting a person under Manage leaves their roles behind as open roles.
    - A person can hold more than one role on a workstream, e.g. presales lead then delivery architect.
    - An open role is nobody's load, so it never causes an overallocation. Its weeks follow the workstream's presales/delivery and pipeline/won rules.
    - Open roles show as an *Open N* badge on the workstream, a `+N` on its FTE total and a list in the Conflicts panel. *Conflicts only* includes workstreams that have them. A capability an open role covers no longer counts as a gap.
  - **Deal slips**: move the workstream's start date and keep *Move the delivery staffing too* ticked. Every role's weeks from the old start date on move by the same number of weeks, and so does the end date unless you changed it. Presales weeks before the old start stay where they are. Unticked, only the date moves, and staffed weeks before the new start become presales, which counts as committed.
  - **Utilization** (toolbar) opens a sidebar with everyone's average allocation over the **next 10 weeks**, from the current week regardless of scrolling, as two numbers. *Delivery* is work on *Won* workstreams. *Pipeline* is work on *Pipeline* workstreams: presales effort, plus delivery that only happens if the deal is won. The team figure averages over everyone, so idle people count as 0%.
    - Each person shows *vs tgt*: committed utilization minus their level's target, furthest below target first. The bar's tick marks the target.
    - **Open demand vs bench** compares, per capability, open-role FTE (won / pipeline) with the free FTE of people who have that capability (100% minus committed work). It's red where demand exceeds free capacity. People and roles with several capabilities count under each.
- **Resources view**: one row per person, showing their total load per week as a heat map (red means over the threshold). Expand a person to edit their allocations workstream by workstream.
  - People are grouped by career level: D, SM, M, SA, A, then anyone without a level. Each group can be collapsed.
  - A group's row shows its people's average % per week, plus `+N` for pipeline work. **Levels only** collapses the view to one row per level.
  - Set levels under Manage → Resources.
  - **Underutilized** (switch in the toolbar) shows only people whose *committed* work (presales + won delivery) averages under **their career level's utilization target** over the next 10 weeks, with a `45% / 80% target` badge. Default targets are D 40%, SM 60%, M 80%, SA 90%, A 90%, and 100% for people without a level. Change them under Manage → Settings & data; they're saved with the plan. Pipeline delivery doesn't count, because it might not happen. Each week is capped at 100% per person before averaging, so a 150% week can't offset an idle one (150% then 50% averages 75%). The Delivery/Pipeline numbers in the sidebar are not capped.
- **Details**: click a workstream's name (Workstreams view or Demand) or a person's name (Resources view, Demand, or a details window) for a summary. Edit from there.
  - **Workstream**: status, client, seller, dates and stage (presales until…, in delivery, ended); roles filled, staffed and open FTE over the next 10 weeks; a **checklist** with warnings first, then the checks that pass; and its **filled** and **open** roles with phase, dates and average %. Open roles have **Fill…**. *Edit workstream*, *⤓ CSV* and *Show in grid* are in the footer, and saving an edit returns to the details.
    - Checks: has a seller; has start and end dates; and for live workstreams, all upcoming roles filled, required capabilities covered, everyone has a skill their role needs, nobody on it over capacity or at risk if pipeline is won (next 10 weeks), no staffing after the end date, someone supporting a pursuit that hasn't started (pipeline), and delivery staffing named.
  - **Person**: level, title, capabilities; committed utilization against their level target, delivery and pipeline %, and their peak week; a checklist (not over capacity, not at risk, at or above target, skills match their roles, has a level and capabilities); their current roles; and **open roles they could fill**, each with a *Fill* button.
- **Demand view**: live workstreams from this week on, split into **Pipeline** and **Won**. Each section has totals (FTE demand, staffed FTE, open FTE and roles, people involved), then one row per workstream showing who's **supporting** the pursuit (people with presales time), who's **staffed** for delivery (as *Person / Role* chips), its **open roles**, and FTE averaged over the next 10 weeks. Click anything for its details. Lost workstreams, and ended ones with nothing left, are left out.
- **Zoom**: Week, Month or Quarter. In month and quarter view a cell shows the *average* for the period, and is flagged red if *any* week in it is over capacity. Typing into an aggregated cell sets every week in that period.
- **Conflicts panel**: lists current and upcoming overallocations, at-risk weeks and skill gaps. Click an item to jump to the row.
  - **Conflicts only** (switch in the toolbar) shows just the people on the Resources tab, or the workstreams on the Workstreams tab, that have a conflict: someone over or at risk in the visible weeks, a skill mismatch, or (workstreams) an uncovered capability. It combines with the other filters.
- **Presales vs. delivery, pipeline vs. won**:
  - Each workstream has a status: *Pipeline*, *Won* or *Lost*.
  - A role runs across the workstream's whole life on one row. The workstream's start date decides what each week is:
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
  - one row per role (role, person or *Open*, level, capabilities needed), with a column per week holding 0/25/50/100
  - a *Phase* row marking each week as Presales or Delivery
  - a *Total FTE* row for staffed roles, and an *Open FTE* row when there are open roles
- **Everything:** click **CSV** in the toolbar. The file is one long table, with one line per role per allocated week and columns for workstream, client, seller, status, role, person (or *Open*), level, week, phase and %. It's ready for a pivot table.

Files are UTF-8 with a byte-order mark, so Excel opens names with accents correctly.

## Data storage

By default everything is stored in your browser's `localStorage`:

- Data is **per browser**. It doesn't sync between machines or people.
- Clearing site data wipes it.

To share plans with others, turn on the [shared workspace](#shared-workspace) (per browser, opt-in).

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

## Shared workspace

An opt-in mode where plans live on the server and several people edit them at once. Each person turns it on in **their own browser**: Manage → Settings & data → *Use the shared workspace in this browser*. It's off by default; with it off the app works exactly as described above and makes no server calls. Switching never changes the plans saved in your browser. The first time you switch, you're offered an upload of them as new shared plans; after that the two copies are separate. The toolbar shows **Shared**.

What you get in shared mode:

- **Live editing.** Edits show at once and reach everyone else within a second. People with the plan open appear as avatars in the toolbar, and their selected cells are outlined in their colour. Cells someone else changed in the last 10 minutes get a coloured corner (hover for who and when). If two people change the same cell, the later change wins; the cell's history shows both.
- **Undo** (Ctrl+Z) undoes *your* last change only. Anything someone else changed since is kept, and you're told how many changes were kept.
- **Cell history.** Right-click a cell (or select it and press **H**) → *History*: every change to those weeks, who made it and when, with *Restore* and *Undo this change*. A workstream's or person's details have a History section too.
- **Freeze locks.** Right-click a cell → lock the selected cells, the role, or the whole workstream, with an optional note ("SOW signed"). Locked cells are hatched with 🔒. Only the person who set a lock can change what it covers; admins can remove anyone's lock. A lock freezes staffing (who's in a role, its weeks, a workstream's dates and status), not names or capabilities. An edit that would change locked staffing indirectly, such as deleting a person who's in a locked role, is refused with the reason. Admins can also *Lock past weeks* (Manage → Settings): only admins can then change weeks before the current one.
- **Activity** (toolbar tab): one log of every change in every plan. Filter by plan, person, workstream or person affected, dates or text. Expand an entry to see each cell and field before → after, jump to it, or undo it. *Export CSV* downloads the filtered log. Admins also see workspace events (role changes, plans created, renamed or archived).
- **Roles**, one per person, for every plan:

  | | Viewer | Editor | Admin |
  |---|---|---|---|
  | See plans, history, Activity; export | ✓ | ✓ | ✓ |
  | Edit plans; undo; set and remove own locks; create or upload plans | | ✓ | ✓ |
  | Thresholds and targets; rename or archive plans; People & access; remove anyone's lock; lock past weeks | | | ✓ |

  Viewers get a read-only app. Admins manage people under Manage → *People & access*: change roles (they apply live, even to open tabs), remove access, add people before they sign in, and choose what first-time sign-ins get (viewer by default, or no access). Emails in `OWNER_EMAILS` are always admins.
- **Plans** are archived, never deleted, so their history is kept. Archived plans can be restored.
- **Connection.** If the connection drops, edits keep working for 30 seconds and are sent once it's back; after that the plan is read-only until it reconnects. If your Cloudflare Access sign-in expires you're asked to sign in again. Edits you hadn't sent are kept in the tab and go out afterwards. If the shared workspace can't be reached, you can work on this browser's plans for the session; you're never switched silently.

### How it works

- **Cloudflare Access** in front of the Worker signs people in. The Worker verifies the Access token (`Cf-Access-Jwt-Assertion`) on every `/api/*` request against your team's keys and the application's AUD tag. It also rejects cross-site requests and WebSocket upgrades.
- **One Durable Object per plan** (`PlanRoom`, SQLite storage) holds the plan and applies everyone's edits one at a time.
  - Each edit is checked against the person's role and any locks, using its actual effect (cascades included).
  - It's stored with every changed field and week (before → after, who, when) in the same transaction.
  - It's then sent to everyone over hibernating WebSockets, so idle plans cost nothing.
- **A Workspace Durable Object** holds people and roles, the plan list, and the index behind the Activity log.
- Edits are small deterministic operations (`src/domain/ops.ts`). The browser and the server run the same reducer, so local mode and shared mode share all the editing code.
- Durable Object storage has 30-day point-in-time recovery for disaster recovery. Don't use it to undo edits: it would also roll back the audit trail. Use Undo and Activity instead.

### Setting it up

1. **Deploy** as usual (Workers Builds runs `npm run build` and `npx wrangler deploy`). The two Durable Objects are created on the first deploy; nothing else needs provisioning.
2. **Protect the Worker with Cloudflare Access.** In the dashboard: Workers & Pages → the Worker → Settings → Domains & Routes → enable Cloudflare Access (or protect your custom domain with an Access application). Allow the people who should get in.
   - Access protects the whole site, so local mode needs a sign-in to load the page too.
   - Set the Access application's cookie to SameSite **Lax** and HttpOnly.
3. **Set the variables** (Worker → Settings → Variables; `wrangler.jsonc` has `keep_vars`, so deploys keep them):
   - `TEAM_DOMAIN`: `https://<your-team>.cloudflareaccess.com`
   - `POLICY_AUD`: the Access application's *Application Audience (AUD) Tag*
   - `OWNER_EMAILS`: comma-separated emails that are always admins (at least yours)
   - `TIMEZONE` (in `wrangler.jsonc`, default `America/New_York`): decides when "this week" starts for the past-weeks lock.
4. Open the app, turn on the shared workspace, and upload your plans.

Until steps 2–3 are done, turning the shared workspace on shows "Can't reach the shared workspace" with a way back to local mode.

## Development

```sh
npm install
npm run dev      # http://localhost:5173 (app + Worker + Durable Objects, locally)
npm test         # unit tests (Vitest), including the server engines on Node's SQLite
npm run lint     # oxlint
npm run build    # typecheck + production build into dist/ (dist/client is the static app)
```

The shared workspace runs locally too, with local Durable Object storage in `.wrangler/state`. To sign in without Cloudflare Access, copy `.dev.vars.example` to `.dev.vars` and open `http://localhost:5173/api/dev/login?as=you@example.com`. This dev sign-in is only accepted on localhost and only when `DEV_AUTH=1` is set in `.dev.vars`, which is never deployed.

End-to-end tests (Playwright; run `npx playwright install chromium` once):

```sh
npm run test:e2e:serve   # fresh dev server, then both suites
npm run test:e2e         # against a running `npm run dev` (or BASE_URL)
```

`e2e/local.e2e.cjs` covers local mode. `e2e/shared-workspace.e2e.cjs` drives three people through the shared workspace. CI (`.github/workflows/ci.yml`) runs the typecheck, lint, unit tests, build and both e2e suites on every pull request. `worker/convergence.test.ts` simulates several browsers editing, undoing and dropping their connections against the real server engine; `SYNC_SEEDS=500 npx vitest run worker/convergence.test.ts` runs it longer.

Code layout: `src/domain` is pure logic shared by browser and server (`ops.ts`, `diff.ts`, `revert.ts`, `locks.ts`, `permissions.ts`, `protocol.ts`). `src/sync/syncCore.ts` is the browser's side of syncing (confirmed plan, pending edits, undo), with no socket or UI. `src/store` has the local store, the shared store (`sharedPlanStore.ts`: the socket and UI around SyncCore) and the mode switch. `src/collab` is the shared-mode UI. `worker/` is the Worker, the Durable Objects and their storage engines (`roomEngine.ts`, `workspaceEngine.ts`).

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
