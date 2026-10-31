/**
 * Jenkins API helpers (transport-agnostic).
 *
 * Outbound HTTP is injected by the caller — the browser uses the local agent
 * (Netbird-capable Mac); the server no longer talks to Jenkins directly.
 */

export type JenkinsTransportResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

export type JenkinsTransport = {
  fetch(
    path: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }
  ): Promise<JenkinsTransportResponse>;
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

export type DeployStatus = {
  state: 'queued' | 'running' | 'completed' | 'failed';
  result?: string | null;
  buildUrl?: string;
  duration?: number;
};

async function jenkinsFetch(
  transport: JenkinsTransport,
  path: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }
): Promise<JenkinsTransportResponse> {
  const res = await transport.fetch(path, init);
  if (res.status < 200 || res.status >= 300) {
    // 201/302 from buildWithParameters still need Location — treat 3xx as ok when Location present
    if (res.status >= 300 && res.status < 400 && (res.headers.location || res.headers.Location)) {
      return res;
    }
    throw new Error(`Jenkins request failed: ${res.status} (${path})`);
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

// Derive a job path ('a/b') back from a full job URL or path.
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

export function normalizeJobPath(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed) || /(^|\/)job\//.test(trimmed)) {
    return jobPathFromUrl(trimmed);
  }
  return trimmed.replace(/^\/+/, '');
}

export async function testConnection(transport: JenkinsTransport) {
  const res = await jenkinsFetch(transport, '/api/json');
  const data = JSON.parse(res.body);
  return {
    ok: true as const,
    nodeName: data.nodeName as string | undefined,
    version: res.headers['x-jenkins'] || undefined,
  };
}

export async function listJobs(transport: JenkinsTransport, viewName: string): Promise<JenkinsJob[]> {
  const res = await jenkinsFetch(
    transport,
    `/view/${encodeURIComponent(viewName)}/api/json?tree=jobs[name,url]`
  );
  const data = JSON.parse(res.body);
  return (data.jobs || []) as JenkinsJob[];
}

export async function getJobParameters(
  transport: JenkinsTransport,
  jobPath: string
): Promise<JenkinsParameter[]> {
  const tree = 'property[parameterDefinitions[name,type,choices,defaultParameterValue[value]]]';
  const res = await jenkinsFetch(
    transport,
    `${encodeJobPath(jobPath)}/api/json?tree=${encodeURIComponent(tree)}`
  );
  const data = JSON.parse(res.body);

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

export async function getGitParameterValues(
  transport: JenkinsTransport,
  jobPath: string,
  paramName: string
): Promise<{ choices: string[]; default?: string } | null> {
  const descriptor = 'net.uaznia.lukanus.hudson.plugins.gitparameter.GitParameterDefinition';
  const res = await jenkinsFetch(
    transport,
    `${encodeJobPath(jobPath)}/descriptorByName/${descriptor}/fillValueItems?param=${encodeURIComponent(paramName)}`,
    { method: 'POST' }
  );
  const data = JSON.parse(res.body);
  const values: { value?: string; selected?: boolean }[] = data.values || [];
  const choices = values.map((v) => v.value).filter((v): v is string => !!v);
  if (!choices.length) return null;
  return { choices, default: values.find((v) => v.selected)?.value };
}

/** Trigger a parameterized build; returns the queue item URL from the Location header */
export async function triggerBuild(
  transport: JenkinsTransport,
  jobPath: string,
  params: Record<string, string>
): Promise<string> {
  const body = new URLSearchParams(params).toString();
  const res = await transport.fetch(`${encodeJobPath(jobPath)}/buildWithParameters`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  // Jenkins typically responds 201 with Location
  if (res.status >= 400) {
    throw new Error(`Jenkins request failed: ${res.status} (buildWithParameters)`);
  }
  const queueUrl = res.headers.location || res.headers.Location;
  if (!queueUrl) {
    throw new Error('Jenkins did not return a queue item location');
  }
  return queueUrl;
}

export async function getQueueItem(transport: JenkinsTransport, queueUrl: string) {
  const res = await jenkinsFetch(transport, `${queueUrl.replace(/\/+$/, '')}/api/json`);
  const data = JSON.parse(res.body);
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

export async function getBuildStatus(transport: JenkinsTransport, buildUrl: string) {
  const res = await jenkinsFetch(transport, `${buildUrl.replace(/\/+$/, '')}/api/json`);
  const data = JSON.parse(res.body);
  return {
    number: data.number as number,
    url: data.url as string,
    building: !!data.building,
    result: data.result as string | null,
    duration: data.duration as number,
    timestamp: data.timestamp as number,
  };
}
