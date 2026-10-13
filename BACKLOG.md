# Backlog

Deferred from v1. Roughly in priority order.

## Planned

- **Per-person capacity & time off**: part-time FTE (e.g. 80%) and PTO/holiday weeks. Overallocation would then be measured against each person's actual availability instead of a flat threshold.

## Follow-ups

- Fill an open role with more than one person (split it), and roles that aren't tied to a workstream (a hiring plan).
- Per-person utilization targets, if level targets turn out too coarse. Billable vs non-billable work types.
- A "shift ±N weeks" action on a workstream row, for slips that don't change the start date.
- Probability-weighted *team-level* demand forecast, e.g. "Data Cloud FTE needed next quarter". Workstream status and the presales/delivery split are done. Per-person load deliberately doesn't use probability.

- **Duplicate plan** ("Save as…") for what-if scenarios. Today a copy means Export, editing the `name` in the file, then Import.

- Archive resources and workstreams instead of deleting them, so history is kept for people who leave and workstreams that close.
- CSV export of allocations, for sharing with finance or leadership.
- Copy/paste of cell ranges, including from and to spreadsheets.
- Entering hours or days per week as well as %.
- Shared workspace follow-ups:
  - Nightly JSON snapshots of each shared plan to R2, for backups beyond the 30-day point-in-time recovery.
  - "View the plan as of a date" (read-only), and a "what changed since last week" view built on the change log.
  - Per-plan or per-workstream roles, if one workspace-wide role turns out too coarse.
  - Fine-grained merging of concurrent edits to the same list field (e.g. two people adding different capabilities at once; today the later change wins).
- Deploy `dist/` to GitHub Pages (or similar) from CI.
- Virtualized rows if the plan grows past a few hundred rows.
