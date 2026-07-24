// Server-only Jenkins API client. Only import from server code (server actions).
import { db } from '@/lib/db';

export type JenkinsConfig = {
  baseUrl: string;
  username: string;
  apiToken: string;
};

export type JenkinsJob = {
  name: string;
  url: string;
};

export type JenkinsParameter = {
  name: string;
  type: string;
  choices?: string[];
  default?: string;
};

const REQUEST_TIMEOUT_MS = 15000;

// Resolve connection settings: DB settings row first, env vars as fallback
export async function resolveJenkinsConfig(): Promise<JenkinsConfig> {
  const row = await db.query.jenkinsSettings.findFirst();

  const baseUrl = row?.baseUrl || process.env.JENKINS_URL;
  const username = row?.username || process.env.JENKINS_USER || '';
  const apiToken = row?.apiToken || process.env.JENKINS_TOKEN;

  if (!baseUrl || !apiToken) {
    throw new Error('Jenkins is not configured. Set it up on the /jenkins settings page (or JENKINS_URL/JENKINS_TOKEN env vars).');
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ''), username, apiToken };
}

async function jenkinsFetch(config: JenkinsConfig, path: string, init?: RequestInit): Promise<Response> {
  const auth = Buffer.from(`${config.username}:${config.apiToken}`).toString('base64');
  const res = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${auth}`,
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Jenkins request failed: ${res.status} ${res.statusText} (${path})`);
  }
  return res;
}

// Encode a possibly nested job path: 'a/b' -> '/job/a/job/b'
export function encodeJobPath(jobPath: string): string {
  return jobPath
    .split('/')
    .filter(Boolean)
    .map((segment) => `/job/${encodeURIComponent(segment)}`)
    .join('');
}

// Derive a job path ('a/b') back from a full job URL or path. Extracts every
// /job/<name> segment so it works regardless of context path, view prefixes,
// or a missing leading slash: 'https://h/job/a/job/b/' -> 'a/b'
export function jobPathFromUrl(url: string): string {
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // Not a full URL — treat it as a path
  }
  const segments: string[] = [];
  const re = /\/job\/([^/]+)/g;
  let match;
  while ((match = re.exec(pathname)) !== null) {
    segments.push(decodeURIComponent(match[1]));
  }
  return segments.join('/');
}

// Normalize user-entered job identifiers: full URLs and 'job/a/job/b' paths
// become 'a/b'; plain 'a/b' paths pass through (trimmed of slashes)
export function normalizeJobPath(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed) || /(^|\/)job\//.test(trimmed)) {
    return jobPathFromUrl(trimmed);
  }
  return trimmed.replace(/^\/+/, '');
}

export async function testConnection(config?: JenkinsConfig) {
  const cfg = config || (await resolveJenkinsConfig());
  const res = await jenkinsFetch(cfg, '/api/json');
  const data = await res.json();
  return { ok: true as const, nodeName: data.nodeName as string | undefined, version: res.headers.get('x-jenkins') || undefined };
}

export async function listJobs(viewName: string, config?: JenkinsConfig): Promise<JenkinsJob[]> {
  const cfg = config || (await resolveJenkinsConfig());
  const res = await jenkinsFetch(cfg, `/view/${encodeURIComponent(viewName)}/api/json?tree=jobs[name,url]`);
  const data = await res.json();
  return (data.jobs || []) as JenkinsJob[];
}

export async function getJobParameters(jobPath: string, config?: JenkinsConfig): Promise<JenkinsParameter[]> {
  const cfg = config || (await resolveJenkinsConfig());
  const tree = 'property[parameterDefinitions[name,type,choices,defaultParameterValue[value]]]';
  const res = await jenkinsFetch(cfg, `${encodeJobPath(jobPath)}/api/json?tree=${encodeURIComponent(tree)}`);
  const data = await res.json();

  const params: JenkinsParameter[] = [];
  for (const prop of data.property || []) {
    for (const def of prop.parameterDefinitions || []) {
      params.push({
        name: def.name,
        type: def.type,
        choices: Array.isArray(def.choices) ? def.choices : undefined,
        default: def.defaultParameterValue?.value,
      });
    }
  }
  return params;
}

// Trigger a parameterized build; returns the queue item URL from the Location header
export async function triggerBuild(jobPath: string, params: Record<string, string>, config?: JenkinsConfig): Promise<string> {
  const cfg = config || (await resolveJenkinsConfig());
  const body = new URLSearchParams(params);
  const res = await jenkinsFetch(cfg, `${encodeJobPath(jobPath)}/buildWithParameters`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const queueUrl = res.headers.get('Location');
  if (!queueUrl) {
    throw new Error('Jenkins did not return a queue item location');
  }
  return queueUrl;
}

// Poll a queue item; returns the executable build once Jenkins schedules it
export async function getQueueItem(queueUrl: string, config?: JenkinsConfig) {
  const cfg = config || (await resolveJenkinsConfig());
  const res = await jenkinsFetch(cfg, `${queueUrl.replace(/\/+$/, '')}/api/json`);
  const data = await res.json();
  return {
    blocked: !!data.blocked,
    stuck: !!data.stuck,
    cancelled: !!data.cancelled,
    why: data.why as string | undefined,
    executable: data.executable
      ? { number: data.executable.number as number, url: data.executable.url as string }
      : null,
  };
}

export async function getBuildStatus(buildUrl: string, config?: JenkinsConfig) {
  const cfg = config || (await resolveJenkinsConfig());
  const res = await jenkinsFetch(cfg, `${buildUrl.replace(/\/+$/, '')}/api/json`);
  const data = await res.json();
  return {
    number: data.number as number,
    url: data.url as string,
    building: !!data.building,
    result: data.result as string | null, // SUCCESS, FAILURE, ABORTED, ... (null while building)
    duration: data.duration as number, // ms, 0 while building
    timestamp: data.timestamp as number,
  };
}
