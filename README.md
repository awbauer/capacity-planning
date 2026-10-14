# Capacity Planner

Plan who works on what, week by week. Allocate people to **workstreams** (sold projects or pursuits still in presales) at 0, 25, 50 or 100% per week, and see who's overloaded, who's free, and which roles are still open.

By default it runs entirely in your browser. Optionally, a **shared workspace** on Cloudflare lets a team edit the same plans live, with history, locks, comments and an audit log.

**Try it:** `npm install && npm run dev`, open http://localhost:5173, then Manage → Settings & data → *Load sample data*.

## Concepts

- **Workstream:** anything someone can be allocated to. It has a status (*Pipeline*, *Won* or *Lost*), optional start and end dates, a client, a seller and the capabilities it needs. (The code and saved files call these `projects`.)
- **Role:** a seat on a workstream, such as "Solution Architect", with a weekly % and the person in it. A role with nobody in it is an **open role**: demand that isn't anyone's load yet.
- **Presales vs delivery:** weeks before a workstream's start date are presales; weeks from the start date on are delivery. If a deal slips, move the start date. Keep *Move the delivery staffing too* ticked and the delivery weeks shift with it.
- **Bookings**, drawn as bars across the weeks, labelled in FTE where they start or change (50% = 0.5 FTE):
  - **Confirmed** (solid blue): counts toward load. That's presales, and delivery once the workstream is *Won*.
  - **Tentative** (hatched purple): delivery on a *Pipeline* workstream. Counts only if it's won.
  - **Open role** (dashed outline): demand nobody covers yet.
  - Delivery on a *Lost* workstream isn't counted (grey).
- **Issues**, from a person's total across all their workstreams in a week (an overlap alone isn't one):
  - **Conflict** (red outline over the weeks): committed work over 100%. Past 150% it's critical (stronger red).
  - **At risk** (dashed red outline): committed work fits, but goes over 100% if pipeline work is won.

  Both thresholds are under Manage → Settings & data. There's deliberately no win-probability weighting. Commercial stage (Won / Pipeline, green / amber) is shown on the workstream; red only ever means an issue.
- **Capabilities** (tags) go on people, roles and workstreams. Mismatches and uncovered capabilities are flagged.
- **Levels** (D, SM, M, SA, A) each have a utilization target. Defaults are 40, 60, 80, 90 and 90%, and 100% for people without a level.

## Views

| View | What it shows |
| --- | --- |
| **Workstreams** | One row per workstream (grouped by client by default) with its client, stage, demand in FTE and any issues, and a band showing staffing over time. Expand it to see each person and open role as bars. The row's **•••** menu adds people and open roles, edits the workstream and downloads its CSV; click a person to swap them or leave the role open. |
| **Resources** | One row per person, grouped by level, showing total weekly load as a heat map. Expand a person to edit their allocations. *Underutilized* shows people below their level's target over the next 10 weeks. |
| **Demand** | Live workstreams split into Pipeline and Won: who's supporting each pursuit, who's staffed, open roles and FTE. |
| **Details** | Click a workstream or person name: a summary, a checklist of problems, roles, and open roles a person could fill. |
| **Issues** (panel) | The toolbar's issue counts (conflicts, at risk and open roles in the visible weeks, across the whole plan) open the list: overallocations, at-risk weeks, skill gaps and open roles. Click one to jump to it. |
| **Capacity** (panel) | Team capacity in FTE-weeks for the next 10 weeks or the weeks on screen: won delivery, pipeline and headroom (or overbooked) as shares of the same supply, then people (click one to highlight their rows), open roles and capabilities. Everyone counts as 1.0 FTE a week. |

Zoom between Week, Month and Quarter. At month and quarter zoom a cell shows the period's average, or its busiest week with **Peak** (`~` when its weeks differ; hover for both). Click a month or quarter header to drill down to its weeks and is flagged if any week in it is over. *Issues only* hides workstreams or people without an issue in the visible weeks; *Filters* narrows by capability, stage and seller.

## Editing allocations

| Action | How |
| --- | --- |
| Change one week | Double-click: 0 → 25 → 50 → 100 → 0 |
| Change a range | Drag (or Shift+click), then Space to step, or type 25 / 50 / 100 and Enter |
| Lengthen, shorten or move a booking | Week view: drag a bar's start or end handle; Alt+drag the bar to move it. One undo step, locked weeks left alone |
| See a week's details | Select it and press **I** (or **Details** in the toolbar): the booking, the person's whole load that week, why it's flagged, and the role's actions |
| Clear | Select, then Delete |
| Move around | Arrow keys, Tab / Shift+Tab |
| Staff someone for a date range | **+ Person** on a workstream or **+ Workstream** on a person |
| Undo / redo | Ctrl/⌘+Z, Ctrl/⌘+Shift+Z |

Press **?** in the app for every shortcut. Totals aren't rounded. The bars / % toolbar toggle switches between FTE labels where bars change and every week's %.

## Plans, export and settings

- **Plans:** keep several independent plans (such as scenarios) and switch between them from the dropdown next to the title.
- **Export / Import** (header **⋯** menu): export saves the open plan as versioned JSON. Importing a file with the same plan name overwrites that plan (you're warned if it's older); a new name adds a plan.
- **CSV:** a workstream's **•••** menu → *Download CSV* exports its staffing plan. **⋯** → *Export staffing (CSV)* exports everything as one pivot-ready table.
- **Theme:** Manage → Settings & data → *Appearance*: Auto (follows your system), Light or Dark. Saved in this browser, as is *Density* (Comfortable or Compact rows). Colors are design tokens at the top of `src/styles.css`.

**Storage:** without the shared workspace, everything lives in this browser's `localStorage`. It doesn't sync, and clearing site data wipes it, so export regularly. The toolbar shows when you last exported.

## Shared workspace

Opt-in, per browser: Manage → Settings & data → *Use the shared workspace in this browser*. With it off, the app makes no server calls. Turning it on never changes the plans saved in your browser; the first time, you're offered an upload of them.

### Features

- **Live editing:**
  - Everyone's edits appear within a second.
  - Avatars show who's in the plan, outlines show their selections, and a coloured corner marks cells someone else just changed.
  - If two people change the same cell, the later change wins.
- **Your own undo:** Ctrl+Z undoes your last change only. Other people's later changes are kept.
- **Cell history:** right-click a cell (or press **H**) to see every change, who made it and when. Restore or undo any of them.
- **Freeze locks:** right-click to lock cells, a role or a workstream, with a note. Only the lock's owner (or an admin) can change what it covers. Admins can also lock all past weeks.
- **Comments:**
  - Start one from a cell (right-click → *Comment…*, or **M**) or a row's 💬 button.
  - Threads can be resolved and reopened.
  - The toolbar's *Comments* lists every thread in the plan.
- **@mentions:**
  - Type `@` to mention someone.
  - The **Mentions** tab lists threads that mention you across all plans, with a badge for unread unresolved ones.
  - Mentions can also be emailed (see setup).
- **Activity:** one log of every change in every plan, comments included. Filter it, see exactly what changed, undo a change, or export the log as CSV.
- **Connection:** if the connection drops, edits are queued for 30 seconds, then the plan goes read-only until it's back.
- **Archiving:** plans are archived, never deleted, so their history is kept.

### Roles

| | Viewer | Editor | Admin |
|---|:-:|:-:|:-:|
| See plans, history and Activity; export | ✓ | ✓ | ✓ |
| Comment, resolve, reopen; edit or delete own comments | ✓ | ✓ | ✓ |
| Edit plans, undo, own locks, create or upload plans | | ✓ | ✓ |
| Settings, rename or archive plans, People & access, anyone's locks or comments | | | ✓ |

Admins manage people under Manage → *People & access*. Role changes apply live. Emails in `OWNER_EMAILS` are always admins.

### Setup

No environment variables are required.

1. **Deploy.** Workers Builds runs `npm run build` and `npx wrangler deploy`. The Durable Objects are created on the first deploy.
2. **Turn on Cloudflare Access** for the Worker (Worker → Settings → Domains & Routes → *Enable Cloudflare Access*), for the production URL and Preview URLs, and allow your team. The Worker reads who's signed in from Access (`ctx.access`); a request Access didn't sign in gets no shared workspace.
3. **Optional variables** (Worker → Settings → Variables; deploys keep them):

   | Variable | What it does |
   | --- | --- |
   | `OWNER_EMAILS` | Comma-separated emails that are always admins. Without it, the first person to sign in becomes admin. Everyone else starts as a viewer. |
   | `MAIL_FROM`, `APP_URL` | Turn on mention emails: onboard a sending domain under Email Service → Email Sending (it must use Cloudflare DNS), then set the sender (e.g. `Capacity Planning <mentions@notify.example.com>`) and the app's address. Only people with access are ever emailed. |

4. **Open the app,** turn on the shared workspace, and upload your plans. An admin sets the workspace **time zone** under Manage → Settings (default America/New_York). It decides when "this week" starts for everyone, including the past-weeks lock.

**Previews:** every pull request gets a Preview URL with its own empty workspace (its own Durable Object storage, never production's data). The first person to sign in there is its admin.

### How it works

- **Access:** Cloudflare Access signs people in at the edge. The Worker learns who's signed in from `ctx.access` when Cloudflare provides it, otherwise by asking Access itself (`/cdn-cgi/access/get-identity` on the same hostname), which checks the token against the Access application protecting that hostname, so forged tokens and unprotected URLs get no identity. No configuration is needed. (Deployments that still have `TEAM_DOMAIN` and `POLICY_AUD` set verify the token with them first; they can be deleted.) The Worker serves the app's four built files itself (`worker/assets.ts`), because Workers Static Assets' router doesn't pass `ctx.access` on.
- **One plan, one Durable Object:** each plan is a `PlanRoom` Durable Object (SQLite). It applies edits one at a time and checks them against roles and locks. It records every changed cell and field with who made the change and when, and broadcasts over hibernating WebSockets. Comments are stored here too.
- **The workspace:** a single `Workspace` Durable Object holds people, roles, the plan list, and the indexes behind Activity and Mentions. It sends mention emails through Cloudflare Email Service.
- **Shared editing code:** edits are small deterministic operations (`src/domain/ops.ts`) that the browser and the server apply with the same code.
- **Point-in-time recovery:** Durable Object storage keeps 30 days, for disaster recovery only. Restoring would also roll back the audit trail, so use Undo and Activity instead.

## Development

```sh
npm install
npm run dev              # app + Worker + Durable Objects at http://localhost:5173
npm test                 # unit tests (Vitest), including the server engines
npm run lint             # oxlint
npm run build            # typecheck + production build
npm run test:e2e:serve   # Playwright end-to-end tests on a fresh dev server
```

- **Shared workspace locally:** copy `.dev.vars.example` to `.dev.vars`, then sign in as anyone at `http://localhost:5173/api/dev/login?as=you@example.com`. The dev sign-in only works on localhost with `DEV_AUTH=1`. Mention emails are simulated there and logged instead of sent.
- **Tests:** CI runs the typecheck, lint, unit tests, build and both e2e suites (`e2e/local.e2e.cjs` and `e2e/shared-workspace.e2e.cjs`) on every pull request. `worker/convergence.test.ts` simulates several browsers editing and dropping connections; to run it longer, use `SYNC_SEEDS=500 npx vitest run worker/convergence.test.ts`.

**Code layout**

| Path | What's there |
| --- | --- |
| `src/domain/` | Pure logic shared by browser and server: ops, diff and revert, locks, permissions, comments, protocol, weeks, load and conflicts |
| `src/sync/syncCore.ts` | The browser's side of syncing: confirmed plan, pending edits, undo |
| `src/store/` | Zustand stores: the local store, the shared store (socket and UI around SyncCore), mode, theme |
| `src/components/` | React UI; `grid/TimeGrid.tsx` is the spreadsheet grid |
| `src/collab/` | Shared-workspace UI: history, Activity, comments, Mentions, people |
| `worker/` | The Worker, both Durable Objects and their storage engines, and mention emails |

See [BACKLOG.md](BACKLOG.md) for deferred features.
