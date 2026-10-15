import { z } from 'zod';
import { normalizeWeek, weeksApart } from '../../src/domain/weeks';
import { CAREER_LEVELS } from '../../src/domain/types';
import { CLICK_STEPS } from '../../src/domain/steps';

export const date = z.iso.date().transform(normalizeWeek);
export const percent = z
  .number()
  .refine((n) => (CLICK_STEPS as readonly number[]).includes(n), 'Allowed allocation values: 0, 25, 50, 100%.');
const ref = z.string().trim().min(1).max(200);
const common = {
  plan: ref.optional(),
  limit: z.number().int().min(1).max(200).default(50),
};
const window = { from: date.optional(), to: date.optional() };
const write = {
  plan: ref.optional(),
  dryRun: z.boolean().default(false),
  idempotencyKey: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,200}$/)
    .optional(),
};
const profile = {
  name: ref.optional(),
  email: z.email().max(200).optional(),
  level: z.enum(CAREER_LEVELS).optional(),
  title: z.string().max(200).optional(),
  capabilities: z.array(ref).max(50).optional(),
};
const project = {
  name: ref.optional(),
  client: z.string().max(200).nullable().optional(),
  externalId: z.string().trim().max(100).nullable().optional(),
  seller: ref.nullable().optional(),
  stage: z.enum(['pipeline', 'won', 'lost']).optional(),
  winProbability: z
    .union([z.literal(25), z.literal(50), z.literal(75), z.literal(90)])
    .nullable()
    .optional(),
  startWeek: date.nullable().optional(),
  endWeek: date.nullable().optional(),
  capabilities: z.array(ref).max(50).optional(),
  notes: z.string().max(5000).nullable().optional(),
  createMissing: z.boolean().default(false),
};
const staffing = {
  ...write,
  workstream: ref,
  person: ref.optional(),
  role: ref.optional(),
  ...window,
};
export const schemas = {
  get_context: z.object({ ...common }),
  list_workstreams: z.object({
    ...common,
    ...window,
    stage: z.enum(['pipeline', 'won', 'lost']).optional(),
    minWinProbability: z.number().min(0).max(100).optional(),
    seller: ref.optional(),
    client: ref.optional(),
    capability: ref.optional(),
    externalId: ref.optional(),
    person: ref.optional(),
    text: ref.optional(),
    hasIssues: z.boolean().optional(),
    totals: z.boolean().default(false),
  }),
  get_workstream: z.object({ ...common, workstream: ref, ...window }),
  list_people: z.object({
    ...common,
    ...window,
    capability: ref.optional(),
    level: z.enum(CAREER_LEVELS).optional(),
    text: ref.optional(),
    availableFrom: date.optional(),
    availableTo: date.optional(),
    minFreePercent: z.number().min(0).max(100).optional(),
    countPipelineAsBooked: z.boolean().default(false),
  }),
  get_person: z.object({ ...common, ...window, person: ref }),
  get_allocations: z.object({
    ...common,
    ...window,
    people: z.array(ref).max(100).optional(),
    workstreams: z.array(ref).max(100).optional(),
    rollup: z.enum(['weekly', 'monthly']).default('weekly'),
  }),
  list_issues: z.object({
    ...common,
    ...window,
    type: z
      .enum(['conflict', 'at-risk', 'low-risk', 'open-role', 'skill-gap', 'uncovered-capability', 'all'])
      .default('all'),
    withCandidates: z.boolean().default(false),
  }),
  get_capacity_summary: z.object({ ...common, ...window }),
  get_activity: z.object({
    ...common,
    workstream: ref.optional(),
    person: ref.optional(),
    mentions: z.boolean().default(false),
    cursor: z.string().max(200).optional(),
  }),
  create_workstream: z.object({ ...write, ...project, name: ref }),
  update_workstream: z.object({
    ...write,
    ...project,
    workstream: ref,
    shiftStaffing: z.boolean().default(false),
  }),
  delete_workstream: z.object({ ...write, workstream: ref, confirmName: ref }),
  set_allocation: z.object({
    ...staffing,
    percent,
    fillOpenRole: ref.optional(),
  }),
  remove_from_workstream: z.object({
    ...staffing,
    keepAsOpenRole: z.boolean().default(false),
  }),
  move_person: z.object({
    ...staffing,
    toWorkstream: ref,
    percent: percent.optional(),
  }),
  add_open_role: z.object({
    ...staffing,
    name: ref,
    level: z.enum(CAREER_LEVELS).optional(),
    capabilities: z.array(ref).max(50).default([]),
    percent,
  }),
  assign_role: z.object({ ...staffing, role: ref, person: ref }),
  upsert_person: z.object({ ...write, ...profile, person: ref.optional() }),
  comment: z.object({
    ...write,
    workstream: ref.optional(),
    person: ref.optional(),
    role: ref.optional(),
    threadId: ref.optional(),
    body: z.string().trim().min(1).max(4000).optional(),
    mentions: z.array(z.email()).max(20).default([]),
    resolved: z.boolean().optional(),
  }),
  undo_change: z.object({ ...write, changeId: ref }),
};
export type ToolName = keyof typeof schemas;
export type Args = { [K in ToolName]: z.infer<(typeof schemas)[K]> }[ToolName];
export type Command = {
  [K in ToolName]: { tool: K; args: z.infer<(typeof schemas)[K]> };
}[ToolName];
export function checkRange(from: string, to: string) {
  if (from > to) throw new Error('from must be on or before to.');
  if (weeksApart(from, to) >= 260) throw new Error('A range may contain at most 260 weeks.');
}
