'use server';

import { db } from '@/lib/db';
import { jenkinsSettings, customerExecutionConfigs, customerSteps, stepExecutions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import {
  resolveJenkinsConfig,
  testConnection,
  listJobs,
  getJobParameters,
  triggerBuild,
  getQueueItem,
  getBuildStatus,
  jobPathFromUrl,
  normalizeJobPath,
  type JenkinsParameter,
} from '@/lib/jenkins/client';

type JenkinsMapping = {
  view?: string;
  job?: string;
  serviceParam?: string;
  branchParam?: string;
};

// ==================== Settings ====================

// Never returns the API token itself — only whether one is stored
export async function getJenkinsSettings() {
  const row = await db.query.jenkinsSettings.findFirst();
  if (!row) return null;
  return {
    id: row.id,
    baseUrl: row.baseUrl,
    username: row.username || '',
    hasApiToken: !!row.apiToken,
  };
}

export async function upsertJenkinsSettings(data: { baseUrl: string; username?: string; apiToken?: string }) {
  const existing = await db.query.jenkinsSettings.findFirst();
  const values = {
    baseUrl: data.baseUrl.replace(/\/+$/, ''),
    username: data.username || '',
    // Only overwrite the token when a new value is entered
    apiToken: data.apiToken || existing?.apiToken || '',
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(jenkinsSettings).set(values).where(eq(jenkinsSettings.id, existing.id));
  } else {
    await db.insert(jenkinsSettings).values(values);
  }
  revalidatePath('/jenkins');
}

export async function testJenkinsConnection() {
  return testConnection();
}

// ==================== Per-customer mapping ====================

export async function getCustomerJenkinsConfig(customerId: number): Promise<JenkinsMapping | null> {
  const row = await db.query.customerExecutionConfigs.findFirst({
    where: eq(customerExecutionConfigs.customerId, customerId),
  });
  return row?.jenkinsConfig || null;
}

export async function updateCustomerJenkinsConfig(customerId: number, config: JenkinsMapping) {
  const cleaned: JenkinsMapping = {
    view: config.view?.trim() || undefined,
    job: config.job?.trim() || undefined,
    serviceParam: config.serviceParam?.trim() || undefined,
    branchParam: config.branchParam?.trim() || undefined,
  };

  const existing = await db.query.customerExecutionConfigs.findFirst({
    where: eq(customerExecutionConfigs.customerId, customerId),
  });

  if (existing) {
    await db.update(customerExecutionConfigs)
      .set({ jenkinsConfig: cleaned, updatedAt: new Date() })
      .where(eq(customerExecutionConfigs.id, existing.id));
  } else {
    await db.insert(customerExecutionConfigs).values({ customerId, jenkinsConfig: cleaned });
  }
  revalidatePath(`/customers/${customerId}/edit`);
}

async function requireCustomerMapping(customerId: number): Promise<JenkinsMapping> {
  const mapping = await getCustomerJenkinsConfig(customerId);
  if (!mapping || (!mapping.view && !mapping.job)) {
    throw new Error('No Jenkins view or job is mapped to this customer. Configure it on the customer edit page.');
  }
  return mapping;
}

function findParam(params: JenkinsParameter[], configuredName: string | undefined, fallback: RegExp) {
  if (configuredName) return params.find((p) => p.name === configuredName) || null;
  return params.find((p) => fallback.test(p.name)) || null;
}

// Resolve the job path for a deploy: view -> the selected job, or the configured job
async function resolveJobPath(mapping: JenkinsMapping, service: string): Promise<string> {
  if (mapping.job) return normalizeJobPath(mapping.job);

  const cfg = await resolveJenkinsConfig();
  const jobs = await listJobs(mapping.view!, cfg);
  const job = jobs.find((j) => j.name === service);
  if (!job) {
    throw new Error(`Job "${service}" not found in Jenkins view "${mapping.view}"`);
  }
  return jobPathFromUrl(job.url);
}

// ==================== Executor-facing actions ====================

// Services the operator can pick: jobs in the mapped view, or the values of the
// mapped job's "service" choice parameter (falling back to the job itself)
export async function listServices(customerId: number): Promise<string[]> {
  const mapping = await requireCustomerMapping(customerId);
  const cfg = await resolveJenkinsConfig();

  if (mapping.view) {
    const jobs = await listJobs(mapping.view, cfg);
    return jobs.map((j) => j.name);
  }

  const jobPath = normalizeJobPath(mapping.job!);
  const params = await getJobParameters(jobPath, cfg);
  const serviceParam = findParam(params, mapping.serviceParam, /service/i);
  if (serviceParam?.choices?.length) return serviceParam.choices;

  const jobName = jobPath.split('/').filter(Boolean).pop()!;
  return [jobName];
}

// Branch parameter of the deploy job: configured name or auto-detected /branch/i
export async function getDeployParams(customerId: number, service: string) {
  const mapping = await requireCustomerMapping(customerId);
  const jobPath = await resolveJobPath(mapping, service);
  const params = await getJobParameters(jobPath);
  const branchParam = findParam(params, mapping.branchParam, /branch/i);

  return {
    branchParam: branchParam?.name || null,
    type: branchParam?.type || null,
    choices: branchParam?.choices || null,
    default: branchParam?.default,
  };
}

export async function triggerDeploy(customerStepId: number, service: string, branch: string) {
  const step = await db.query.customerSteps.findFirst({
    where: eq(customerSteps.id, customerStepId),
  });
  if (!step) throw new Error('Step not found');

  const mapping = await requireCustomerMapping(step.customerId);
  const jobPath = await resolveJobPath(mapping, service);
  const params = await getJobParameters(jobPath);

  const buildParams: Record<string, string> = {};
  // In single-job mode the service selection is passed as a build parameter
  if (mapping.job) {
    const serviceParam = findParam(params, mapping.serviceParam, /service/i);
    if (serviceParam && service) buildParams[serviceParam.name] = service;
  }
  const branchParam = findParam(params, mapping.branchParam, /branch/i);
  if (branchParam && branch) buildParams[branchParam.name] = branch;

  const queueUrl = await triggerBuild(jobPath, buildParams);

  const [execution] = await db.insert(stepExecutions).values({
    stepId: step.id,
    customerId: step.customerId,
    releaseId: step.releaseId,
    type: 'jenkins',
    status: 'running',
    request: { job: jobPath, service, branch, params: buildParams },
    // Jenkins build metadata is tracked in the generic rest_result JSON column
    restResult: { queueUrl },
    startedAt: new Date(),
  }).returning();

  return { executionId: execution.id, queueUrl };
}

export type DeployStatus = {
  state: 'queued' | 'running' | 'completed' | 'failed';
  result?: string | null;
  buildUrl?: string;
  duration?: number;
};

export async function getDeployStatus(executionId: number): Promise<DeployStatus> {
  const execution = await db.query.stepExecutions.findFirst({
    where: eq(stepExecutions.id, executionId),
  });
  if (!execution) throw new Error('Execution not found');

  const meta = (execution.restResult || {}) as { queueUrl?: string; buildUrl?: string; result?: string };

  // Terminal state already recorded — no need to poll Jenkins again
  if (execution.status === 'completed' || execution.status === 'failed') {
    return { state: execution.status, result: meta.result, buildUrl: meta.buildUrl, duration: execution.duration ?? undefined };
  }

  // Still in the Jenkins queue — try to resolve the build URL
  if (!meta.buildUrl) {
    const item = await getQueueItem(meta.queueUrl!);
    if (item.cancelled) {
      await db.update(stepExecutions)
        .set({ status: 'cancelled', completedAt: new Date() })
        .where(eq(stepExecutions.id, executionId));
      return { state: 'failed', result: 'CANCELLED' };
    }
    if (!item.executable) {
      return { state: 'queued' };
    }
    meta.buildUrl = item.executable.url;
    await db.update(stepExecutions)
      .set({ restResult: { ...meta } })
      .where(eq(stepExecutions.id, executionId));
  }

  const build = await getBuildStatus(meta.buildUrl);
  if (build.building) {
    return { state: 'running', buildUrl: build.url };
  }

  const status = build.result === 'SUCCESS' ? 'completed' : 'failed';
  await db.update(stepExecutions)
    .set({
      status,
      completedAt: new Date(),
      duration: build.duration,
      restResult: { ...meta, buildUrl: build.url, result: build.result, buildNumber: build.number },
    })
    .where(eq(stepExecutions.id, executionId));

  return { state: status, result: build.result, buildUrl: build.url, duration: build.duration };
}
