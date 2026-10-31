/**
 * Browser-side Jenkins client.
 *
 * All Jenkins HTTP goes: web → extension → local agent → Jenkins.
 * Credentials stay on the agent (configured in the extension popup).
 */

import { agentBridge } from '@/lib/services/agent-bridge';
import {
  listJobs,
  getJobParameters,
  getGitParameterValues,
  triggerBuild,
  getQueueItem,
  getBuildStatus,
  jobPathFromUrl,
  normalizeJobPath,
  type JenkinsTransport,
  type JenkinsParameter,
  type DeployStatus,
} from './client';

export type { DeployStatus };

export type JenkinsMapping = {
  view?: string;
  job?: string;
  serviceParam?: string;
  branchParam?: string;
  servicePodMap?: Record<string, string>;
};

function requireBridge() {
  if (!agentBridge?.isAvailable()) {
    throw new Error(
      'Agent extension not available. Install the Release Tracker extension and start the local agent.'
    );
  }
  if (typeof window.rtAgent?.jenkinsRequest !== 'function') {
    throw new Error(
      'Extension does not support Jenkins proxy — reload/update the Release Tracker extension (v1.2+).'
    );
  }
  return agentBridge;
}

export function createAgentTransport(): JenkinsTransport {
  const bridge = requireBridge();
  return {
    async fetch(path, init) {
      return bridge.jenkinsRequest({
        path,
        method: init?.method,
        headers: init?.headers,
        body: init?.body,
        timeoutMs: init?.timeoutMs,
      });
    },
  };
}

export async function getAgentJenkinsSettings() {
  const bridge = requireBridge();
  return bridge.getJenkinsSettings();
}

export async function testAgentJenkinsConnection() {
  const bridge = requireBridge();
  return bridge.testJenkinsConnection();
}

function findParam(params: JenkinsParameter[], configuredName: string | undefined, fallback: RegExp) {
  if (configuredName) return params.find((p) => p.name === configuredName) || null;
  return params.find((p) => fallback.test(p.name)) || null;
}

async function resolveJobPath(
  transport: JenkinsTransport,
  mapping: JenkinsMapping,
  service: string
): Promise<string> {
  if (mapping.job) return normalizeJobPath(mapping.job);

  if (!mapping.view) {
    throw new Error('No Jenkins view or job is mapped to this customer. Configure it on the customer edit page.');
  }

  const jobs = await listJobs(transport, mapping.view);
  const job = jobs.find((j) => j.name === service);
  if (!job) {
    throw new Error(`Job "${service}" not found in Jenkins view "${mapping.view}"`);
  }
  return jobPathFromUrl(job.url);
}

export async function listServices(mapping: JenkinsMapping): Promise<string[]> {
  if (!mapping.view && !mapping.job) {
    throw new Error('No Jenkins view or job is mapped to this customer. Configure it on the customer edit page.');
  }

  const transport = createAgentTransport();

  if (mapping.view) {
    const jobs = await listJobs(transport, mapping.view);
    return jobs.map((j) => j.name);
  }

  const jobPath = normalizeJobPath(mapping.job!);
  const params = await getJobParameters(transport, jobPath);
  const serviceParam = findParam(params, mapping.serviceParam, /service/i);
  if (serviceParam?.choices?.length) return serviceParam.choices;

  const jobName = jobPath.split('/').filter(Boolean).pop()!;
  return [jobName];
}

export async function getDeployParams(mapping: JenkinsMapping, service: string) {
  const transport = createAgentTransport();
  const jobPath = await resolveJobPath(transport, mapping, service);
  const params = await getJobParameters(transport, jobPath);
  const branchParam = findParam(params, mapping.branchParam, /branch/i);

  let choices = branchParam?.choices || null;
  let defaultValue = branchParam?.default;

  if (branchParam && !choices && branchParam.type && /git/i.test(branchParam.type)) {
    const gitValues = await getGitParameterValues(transport, jobPath, branchParam.name);
    if (gitValues) {
      choices = gitValues.choices;
      defaultValue = gitValues.default || defaultValue;
    }
  }

  return {
    branchParam: branchParam?.name || null,
    type: branchParam?.type || null,
    choices,
    default: defaultValue,
  };
}

export async function triggerJenkinsBuild(
  mapping: JenkinsMapping,
  service: string,
  branch: string
): Promise<{ queueUrl: string; jobPath: string; buildParams: Record<string, string> }> {
  if (!mapping.view && !mapping.job) {
    throw new Error('No Jenkins view or job is mapped to this customer. Configure it on the customer edit page.');
  }

  const transport = createAgentTransport();
  const jobPath = await resolveJobPath(transport, mapping, service);
  const params = await getJobParameters(transport, jobPath);

  const buildParams: Record<string, string> = {};
  if (mapping.job) {
    const serviceParam = findParam(params, mapping.serviceParam, /service/i);
    if (serviceParam && service) buildParams[serviceParam.name] = service;
  }
  const branchParam = findParam(params, mapping.branchParam, /branch/i);
  if (branchParam && branch) buildParams[branchParam.name] = branch;

  const queueUrl = await triggerBuild(transport, jobPath, buildParams);
  return { queueUrl, jobPath, buildParams };
}

/** Poll queue → build until a terminal state or one snapshot while still running. */
export async function pollDeployStatus(meta: {
  queueUrl?: string;
  buildUrl?: string;
}): Promise<DeployStatus & { queueUrl?: string; buildUrl?: string }> {
  const transport = createAgentTransport();
  let buildUrl = meta.buildUrl;
  const queueUrl = meta.queueUrl;

  if (!buildUrl) {
    if (!queueUrl) throw new Error('Missing queue URL for Jenkins deploy');
    const item = await getQueueItem(transport, queueUrl);
    if (item.cancelled) {
      return { state: 'failed', result: 'CANCELLED', queueUrl };
    }
    if (!item.executable) {
      return { state: 'queued', queueUrl };
    }
    buildUrl = item.executable.url;
  }

  const build = await getBuildStatus(transport, buildUrl);
  if (build.building) {
    return { state: 'running', buildUrl: build.url, queueUrl };
  }

  return {
    state: build.result === 'SUCCESS' ? 'completed' : 'failed',
    result: build.result,
    buildUrl: build.url,
    duration: build.duration,
    queueUrl,
  };
}
