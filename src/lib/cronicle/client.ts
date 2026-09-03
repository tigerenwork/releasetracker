/**
 * Cronicle API client (Cronicle v0.9.80).
 *
 * Browser-side only: requests go through the agent bridge — the extension
 * fetches http://127.0.0.1:<port> (a kubectl port-forward managed by the
 * local agent), so this works in both self-hosted and Vercel deployments.
 */

import { agentBridge } from '@/lib/services/agent-bridge';
import type {
  CronicleActiveJobsResponse,
  CronicleCategory,
  CronicleConfig,
  CronicleEvent,
  CronicleHistoryRow,
  CronicleJob,
  CronicleJobResponse,
  CronicleListResponse,
  CronicleOkResponse,
  CronicleRunEventResponse,
} from './types';

export const DEFAULT_CRONICLE_CONFIG: Omit<CronicleConfig, 'apiKey' | 'categoryId'> = {
  namespace: 'cronicle',
  resource: 'service/cronicle',
  localPort: 3012,
  remotePort: 3012,
};

export class CronicleApiError extends Error {
  constructor(
    message: string,
    readonly endpoint: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'CronicleApiError';
  }
}

function requireBridge() {
  if (!agentBridge) {
    throw new CronicleApiError('Agent extension not installed', 'bridge');
  }
  return agentBridge;
}

/**
 * Ensure a ready port-forward to the Cronicle service exists on the agent.
 * Starts one if missing; waits for readiness. Returns the local port.
 */
export async function ensureCronicleForward(
  clusterName: string,
  config: CronicleConfig,
  timeoutMs = 15000
): Promise<number> {
  const bridge = requireBridge();
  const deadline = Date.now() + timeoutMs;

  let started = false;
  for (;;) {
    const forwards = await bridge.listPortForwards();
    const match = forwards.find(
      (f) =>
        f.kubeContext === clusterName &&
        f.namespace === config.namespace &&
        f.resource === config.resource
    );

    if (match?.status === 'ready') return match.localPort;
    if (match?.status === 'failed') {
      throw new CronicleApiError(
        match.error || 'Port-forward to Cronicle failed',
        'portforward'
      );
    }

    if (!match) {
      if (started) {
        throw new CronicleApiError('Port-forward to Cronicle disappeared', 'portforward');
      }
      // The fixed local port may still be held by another cluster's forward
      // (e.g. after switching clusters) — stop it so we can take the port over.
      // Best-effort: the forward may already be gone by the time we stop it.
      const occupying = forwards.find((f) => f.localPort === config.localPort);
      if (occupying) {
        try {
          await bridge.stopPortForward(occupying.id);
        } catch {
          // Already gone — the port is free, carry on
        }
      }
      await bridge.startPortForward({
        kubeContext: clusterName,
        namespace: config.namespace,
        resource: config.resource,
        localPort: config.localPort,
        remotePort: config.remotePort,
      });
      started = true;
    }

    // match.status === 'starting', or we just started it — poll until ready
    if (Date.now() > deadline) {
      throw new CronicleApiError('Timed out waiting for Cronicle port-forward', 'portforward');
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function apiCall<T extends { code: number; description?: string }>(
  clusterName: string,
  config: CronicleConfig,
  endpoint: string,
  params?: Record<string, unknown>
): Promise<T> {
  if (!config.apiKey) {
    throw new CronicleApiError('Cronicle API key not configured', endpoint);
  }
  const port = await ensureCronicleForward(clusterName, config);

  const { status, body } = await requireBridge().proxyRequest({
    url: `http://127.0.0.1:${port}/api/app/${endpoint}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': config.apiKey,
    },
    body: JSON.stringify(params ?? {}),
  });

  let data: T;
  try {
    data = JSON.parse(body) as T;
  } catch {
    throw new CronicleApiError(`Unexpected response (HTTP ${status})`, endpoint, status);
  }

  if (status >= 400 || data.code !== 0) {
    throw new CronicleApiError(
      data.description || `Cronicle request failed (HTTP ${status})`,
      endpoint,
      status
    );
  }
  return data;
}

export function getCategories(
  clusterName: string,
  config: CronicleConfig
): Promise<CronicleListResponse<CronicleCategory>> {
  return apiCall(clusterName, config, 'get_categories', { offset: 0, limit: 0 });
}

export function getSchedule(
  clusterName: string,
  config: CronicleConfig
): Promise<CronicleListResponse<CronicleEvent>> {
  return apiCall(clusterName, config, 'get_schedule', { offset: 0, limit: 0 });
}

export function runEvent(
  clusterName: string,
  config: CronicleConfig,
  id: string,
  params?: Record<string, unknown>
): Promise<CronicleRunEventResponse> {
  return apiCall(clusterName, config, 'run_event', { id, ...params });
}

export async function getActiveJobs(
  clusterName: string,
  config: CronicleConfig
): Promise<CronicleJob[]> {
  const resp = await apiCall<CronicleActiveJobsResponse>(clusterName, config, 'get_active_jobs');
  return Object.values(resp.jobs || {});
}

export function getJobStatus(
  clusterName: string,
  config: CronicleConfig,
  id: string
): Promise<CronicleJobResponse> {
  return apiCall(clusterName, config, 'get_job_status', { id });
}

export function abortJob(
  clusterName: string,
  config: CronicleConfig,
  id: string
): Promise<CronicleOkResponse> {
  return apiCall(clusterName, config, 'abort_job', { id });
}

export interface EventUpdate {
  enabled?: 0 | 1;
  title?: string;
  category?: string;
  /** Replaced wholesale when sent; omit to preserve the existing timing. `false` = on demand */
  timing?: CronicleEvent['timing'] | false;
  /** Replaced wholesale when sent; omit to preserve the existing params */
  params?: Record<string, string>;
}

/**
 * Update an existing scheduled event (requires the `edit_events` privilege).
 * Omitted fields are preserved by Cronicle.
 */
export function updateEvent(
  clusterName: string,
  config: CronicleConfig,
  id: string,
  updates: EventUpdate
): Promise<CronicleOkResponse> {
  return apiCall(clusterName, config, 'update_event', { id, ...updates });
}

/**
 * Delete a scheduled event (requires the `delete_events` privilege).
 * Cronicle refuses to delete events that have active jobs.
 */
export function deleteEvent(
  clusterName: string,
  config: CronicleConfig,
  id: string
): Promise<CronicleOkResponse> {
  return apiCall(clusterName, config, 'delete_event', { id });
}

export function getHistory(
  clusterName: string,
  config: CronicleConfig,
  limit = 50,
  offset = 0
): Promise<CronicleListResponse<CronicleHistoryRow>> {
  return apiCall(clusterName, config, 'get_history', { offset, limit });
}

/**
 * Completed jobs for a single event, latest first (paginated).
 */
export function getEventHistory(
  clusterName: string,
  config: CronicleConfig,
  id: string,
  offset = 0,
  limit = 20
): Promise<CronicleListResponse<CronicleHistoryRow>> {
  return apiCall(clusterName, config, 'get_event_history', { id, offset, limit });
}

/**
 * Fetch a completed job's log as plain text.
 * The endpoint returns gzipped text rather than the JSON envelope;
 * the extension's fetch decompresses it transparently.
 */
export async function getJobLog(
  clusterName: string,
  config: CronicleConfig,
  id: string
): Promise<string> {
  if (!config.apiKey) {
    throw new CronicleApiError('Cronicle API key not configured', 'get_job_log');
  }
  const port = await ensureCronicleForward(clusterName, config);

  const { status, body } = await requireBridge().proxyRequest({
    url: `http://127.0.0.1:${port}/api/app/get_job_log?id=${encodeURIComponent(id)}`,
    method: 'GET',
    headers: { 'X-API-Key': config.apiKey },
  });

  if (status !== 200) {
    throw new CronicleApiError(body.trim() || `Failed to fetch job log (HTTP ${status})`, 'get_job_log', status);
  }
  return body;
}
