import type { ProjectStatus } from './types';

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  pipeline: 'Pipeline',
  won: 'Won',
  lost: 'Lost',
};
