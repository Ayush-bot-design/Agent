import type { ActivityLogEntry } from './deployment-logic';

export type ActivityLogFilter = 'all' | 'login' | 'status_change' | 'attendance';
export interface ActivityLogQuery {
  pageSize?: number;
  cursor?: string | null;
  eventFilter?: ActivityLogFilter;
  searchQuery?: string;
  startDate?: string;
  endDate?: string;
}
export interface CursorActivityLogPage {
  items: ActivityLogEntry[];
  pageSize: number;
  nextCursor: string | null;
  hasNextPage: boolean;
  syncedWithSupabase: boolean;
}
