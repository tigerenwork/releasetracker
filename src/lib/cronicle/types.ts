/**
 * Cronicle API types (verified against Cronicle v0.9.80).
 *
 * All endpoints live under /api/app/ and return an envelope where
 * `code === 0` means success; otherwise `description` holds the error.
 */

export interface CronicleConfig {
  namespace: string;
  /** e.g. "service/cronicle" */
  resource: string;
  localPort: number;
  remotePort: number;
  /** Cronicle API key (sent as X-API-Key header) */
  apiKey?: string;
  /** Default category filter (category id) */
  categoryId?: string;
}

export interface CronicleCategory {
  id: string;
  title: string;
  enabled?: number;
}

export interface CronicleEvent {
  id: string;
  title: string;
  category: string;
  plugin: string;
  target: string;
  enabled: number;
  timing?: {
    minutes?: number[];
    hours?: number[];
    days?: number[];
    months?: number[];
    weekdays?: number[];
    years?: number[];
  };
  params?: Record<string, string>;
}

export interface CronicleJob {
  id: string;
  event: string;
  event_title?: string;
  category: string;
  hostname?: string;
  /** 0–1, present on active jobs */
  progress?: number;
  time_start: number;
  time_end?: number;
  elapsed?: number;
  /** 1 when the job has finished */
  complete?: number;
  /** exit code on completed jobs; 0 = success */
  code?: number;
  description?: string;
}

export interface CronicleHistoryRow {
  id: string;
  event: string;
  event_title: string;
  category: string;
  time_start: number;
  elapsed: number;
  /** 0 = success */
  code: number;
  description?: string;
  /** present on deleted/stub rows */
  action?: string;
}

export interface CronicleListResponse<T> {
  code: number;
  rows: T[];
  list: { length: number };
}

export interface CronicleRunEventResponse {
  code: number;
  /** launched job ids (absent when queued) */
  ids?: string[];
  /** queue depth when the event was queued instead of launched */
  queue?: number;
  description?: string;
}

export interface CronicleJobResponse {
  code: number;
  job: CronicleJob;
  description?: string;
}

export interface CronicleActiveJobsResponse {
  code: number;
  jobs: Record<string, CronicleJob>;
  description?: string;
}

export interface CronicleOkResponse {
  code: number;
  description?: string;
}
