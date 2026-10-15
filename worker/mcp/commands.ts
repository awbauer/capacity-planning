import { cellCount, changesPast } from './changes';
import { diffPlans } from '../../src/domain/diff';
import { makePlanActions } from '../../src/store/actions';
import { applyOp, flattenOps, type Op } from '../../src/domain/ops';
import { parseOp } from '../../src/domain/opSchema';
import type { Assignment, PlanData, Project } from '../../src/domain/types';
import { addWeeks, weeksApart, weeksBetween } from '../../src/domain/weeks';
import { defaultRange, rangeNote, toRanges } from '../../src/domain/staffing';
import type { User } from '../roomEngine';
import { checkRange, type Command } from './inputs';
import { person, resolve, role, seller, workstream } from './resolve';

/** Called synchronously inside the room, against its current plan. */
export function buildCommand(plan: PlanData, cmd: Command, thisWeek: string, user: User) {
  try {
    let working = plan;
    const ops: Op[] = [];
    const warnings: string[] = [];
    let dates: { from: string; to?: string } | undefined;
    const actions = makePlanActions(
      () => working,
      (op) => {
        ops.push(...flattenOps(op));
        working = applyOp(working, op);
      },
    );
    const capabilities = (names: string[], create = false) =>
      names.map((name) => {
        if (create && !working.tags.some((t) => t.id === name || t.name.toLowerCase() === name.toLowerCase()))
          return actions.addTag(name).id;
        return resolve(working.tags, name, 'capability').id;
      });
    const patchProject = (a: Extract<Command, { tool: 'create_workstream' | 'update_workstream' }>['args']) => {
      const patch: Partial<Omit<Project, 'id'>> = {};
      for (const k of ['name', 'client', 'externalId', 'winProbability', 'startWeek', 'endWeek', 'notes'] as const) {
        if (k in a)
          Object.assign(patch, {
            [k]: a[k] === null || a[k] === '' ? undefined : a[k],
          });
      }
      if (a.stage !== undefined) patch.status = a.stage;
      if (a.capabilities) patch.tagIds = capabilities(a.capabilities, a.createMissing);
      if (a.seller !== undefined) {
        patch.sellerId =
          a.seller === null
            ? null
            : a.createMissing &&
                !working.sellers.some(
                  (s) =>
                    s.id === a.seller ||
                    s.name.toLowerCase() === a.seller!.toLowerCase() ||
                    s.email?.toLowerCase() === a.seller!.toLowerCase(),
                )
              ? actions.addSeller(a.seller).id
              : seller(working, a.seller, user).id;
      }
      return patch;
    };
    const range = (p: Project, a: { from?: string; to?: string }) => {
      const defaults = defaultRange(p, thisWeek);
      const from = a.from ?? (defaults.from < thisWeek ? thisWeek : defaults.from);
      const to = a.to ?? (defaults.to >= from ? defaults.to : addWeeks(from, 11));
      checkRange(from, to);
      if (user.role !== 'admin' && from < thisWeek) throw new Error(`Past weeks are locked; use from ≥ ${thisWeek}.`);
      warnings.push(rangeNote(p, weeksBetween(from, to)));
      if (p.endWeek && to > p.endWeek) warnings.push(`Allocation extends after ${p.name}'s end date (${p.endWeek}).`);
      if (p.status === 'lost') warnings.push(`Workstream ${p.name} is lost; delivery is not counted.`);
      dates = { from, to };
      return { from, to };
    };
    // Preserve historic attribution. Only future weeks are removed/recreated.
    const split = (
      r: Assignment,
      from: string,
      nextPerson: string | null,
      destination = r.projectId,
      keep = true,
      pct?: number,
    ) => {
      if (user.role !== 'admin' && from < thisWeek) throw new Error(`Past weeks are locked; use from ≥ ${thisWeek}.`);
      dates = { from };
      const future = Object.fromEntries(Object.entries(r.weekly).filter(([w]) => w >= from));
      const past = Object.keys(r.weekly).some((w) => w < from);
      if (past) actions.setAllocations([{ assignmentId: r.id, weeks: Object.keys(future), percent: 0 }]);
      else actions.removeAssignment(r.id);
      if (!keep) return;
      const next = actions.addRole(destination, {
        name: r.name,
        level: r.level,
        tagIds: r.tagIds,
        resourceId: nextPerson,
      });
      for (const run of toRanges(future))
        actions.setAllocations([
          {
            assignmentId: next.id,
            weeks: weeksBetween(run.from, run.to),
            percent: pct ?? run.percent,
          },
        ]);
    };
    let label: string = cmd.tool.replaceAll('_', ' ');
    switch (cmd.tool) {
      case 'create_workstream': {
        const a = cmd.args;
        actions.addProject({
          name: a.name,
          status: 'pipeline',
          sellerId: null,
          tagIds: [],
          ...patchProject(a),
        });
        label = `Created workstream “${a.name}”`;
        break;
      }
      case 'update_workstream': {
        const a = cmd.args,
          p = workstream(working, a.workstream),
          patch = patchProject(a);
        const shift =
          a.shiftStaffing && p.startWeek && patch.startWeek
            ? {
                from: p.startWeek,
                weeks: weeksApart(p.startWeek, patch.startWeek),
              }
            : undefined;
        if (shift && p.endWeek && !('endWeek' in patch)) patch.endWeek = addWeeks(p.endWeek, shift.weeks);
        actions.updateProject(p.id, patch, shift);
        label = `Updated workstream “${p.name}”`;
        break;
      }
      case 'delete_workstream': {
        const p = workstream(working, cmd.args.workstream);
        if (cmd.args.confirmName !== p.name) throw new Error(`confirmName must equal “${p.name}”.`);
        actions.deleteProject(p.id);
        label = `Deleted workstream “${p.name}”`;
        break;
      }
      case 'upsert_person': {
        const a = cmd.args,
          r = a.person ? person(working, a.person, user) : undefined;
        const patch = {
          ...(a.name !== undefined ? { name: a.name } : {}),
          ...(a.email !== undefined ? { email: a.email } : {}),
          ...(a.title !== undefined ? { role: a.title } : {}),
          ...(a.level !== undefined ? { level: a.level } : {}),
          ...(a.capabilities ? { tagIds: capabilities(a.capabilities) } : {}),
        };
        if (r) actions.updateResource(r.id, patch);
        else {
          if (!a.name) throw new Error('A new person needs a name.');
          actions.addResource({ name: a.name, tagIds: [], ...patch });
        }
        label = `${r ? 'Updated' : 'Created'} person “${a.name ?? r?.name}”`;
        break;
      }
      case 'add_open_role': {
        const a = cmd.args,
          p = workstream(working, a.workstream);
        actions.addRole(
          p.id,
          {
            name: a.name,
            level: a.level,
            tagIds: capabilities(a.capabilities),
          },
          { ...range(p, a), percent: a.percent },
        );
        label = `Added open role “${a.name}” on “${p.name}”`;
        break;
      }
      case 'set_allocation': {
        const a = cmd.args,
          p = workstream(working, a.workstream),
          dates = range(p, a);
        const r = a.person ? person(working, a.person, user) : undefined;
        let seat: Assignment;
        if (a.fillOpenRole) {
          seat = role(working, p.id, a.fillOpenRole);
          if (!r || seat.resourceId !== null) throw new Error('fillOpenRole needs a person and an open role.');
          split(seat, dates.from, r.id);
          seat = working.assignments.at(-1)!;
        } else if (a.role) {
          seat = role(working, p.id, a.role);
          if (r && seat.resourceId !== r.id) throw new Error('That person is not in this role. Use assign_role.');
        } else {
          if (!r) throw new Error('Specify person or role.');
          const existing = working.assignments.filter((x) => x.projectId === p.id && x.resourceId === r.id);
          seat = existing.length ? role(working, p.id, undefined, r.id) : actions.addAssignment(p.id, r.id);
        }
        actions.setAllocations([
          {
            assignmentId: seat.id,
            weeks: weeksBetween(dates.from, dates.to),
            percent: a.percent,
          },
        ]);
        label = `Set ${r?.name ?? working.resources.find((x) => x.id === seat.resourceId)?.name ?? seat.name ?? 'open role'} on “${p.name}” to ${a.percent}%, ${dates.from} to ${dates.to}`;
        break;
      }
      case 'remove_from_workstream':
      case 'move_person': {
        const a = cmd.args,
          p = workstream(working, a.workstream);
        const r = a.person ? person(working, a.person, user) : undefined;
        const seat = role(working, p.id, a.role, r?.id);
        if (!seat.resourceId) throw new Error('Specify a filled role.');
        const from = a.from ?? thisWeek;
        if (cmd.tool === 'move_person') {
          const destination = workstream(working, cmd.args.toWorkstream);
          if (destination.id === p.id) throw new Error('Choose a different destination workstream.');
          split(seat, from, seat.resourceId, destination.id, true, cmd.args.percent);
          label = `Moved ${r?.name ?? seat.name} from “${p.name}” to “${destination.name}” from ${from}`;
          warnings.push(
            rangeNote(
              destination,
              Object.keys(seat.weekly).filter((w) => w >= from),
            ),
          );
        } else {
          split(seat, from, null, p.id, cmd.args.keepAsOpenRole);
          label = `Removed ${r?.name ?? seat.name} from “${p.name}” from ${from}`;
        }
        break;
      }
      case 'assign_role': {
        const a = cmd.args,
          p = workstream(working, a.workstream),
          r = person(working, a.person, user),
          seat = role(working, p.id, a.role);
        if (seat.resourceId === r.id) throw new Error('That person is already in this role.');
        split(seat, a.from ?? thisWeek, r.id);
        label = `Assigned ${r.name} to “${seat.name || 'role'}” on “${p.name}” from ${a.from ?? thisWeek}`;
        break;
      }
      default:
        throw new Error('Not a plan command.');
    }
    for (const p of working.projects)
      if (p.startWeek && p.endWeek && p.startWeek > p.endWeek)
        throw new Error(`End must be on or after start for ${p.name}.`);
    const summary = `${label.slice(0, 188)} (via agent)`;
    const op: Op = {
      t: 'group',
      label: summary,
      ops: ops as Exclude<Op, { t: 'group' }>[],
    };
    const parsed = parseOp(op);
    if ('error' in parsed) throw new Error(parsed.error);
    // Count changed cells including added/deleted roles and project cascades.
    const changes = diffPlans(plan, working);
    const cells = cellCount(changes);
    if (user.role !== 'admin' && changesPast(changes, plan, thisWeek))
      throw new Error(`Past weeks are locked; use from ≥ ${thisWeek}.`);
    if (cells > 20_000) throw new Error('Too many cells in one edit (max 20000).');
    return {
      op,
      label: summary,
      warnings: [...new Set(warnings)],
      dates,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
