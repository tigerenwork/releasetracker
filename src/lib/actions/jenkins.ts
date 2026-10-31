'use server';

import { db } from '@/lib/db';
import { customerExecutionConfigs, customerSteps, stepExecutions } from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import type { DeployStatus } from '@/lib/jenkins/client';

type JenkinsMapping = {
  view?: string;
  job?: string;
  serviceParam?: string;
  branchParam?: string;
  /** Jenkins service name -> k8s app name (pod name prefix), for pod status after deploy */
  servicePodMap?: Record<string, string>;
};

// ==================== Per-customer mapping ====================

export async function getCustomerJenkinsConfig(customerId: number): Promise<JenkinsMapping | null> {
  const row = await db.query.customerExecutionConfigs.findFirst({
    where: eq(customerExecutionConfigs.customerId, customerId),
  });
  return row?.jenkinsConfig || null;
}

// Trim keys/values, drop empty entries; undefined when nothing is left
function cleanServicePodMap(map: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!map) return undefined;
  const entries = Object.entries(map)
    .map(([service, app]) => [service.trim(), app.trim()] as const)
    .filter(([service, app]) => service && app);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export async function updateCustomerJenkinsConfig(customerId: number, config: JenkinsMapping) {
  const cleaned: JenkinsMapping = {
    view: config.view?.trim() || undefined,
    job: config.job?.trim() || undefined,
    serviceParam: config.serviceParam?.trim() || undefined,
    branchParam: config.branchParam?.trim() || undefined,
    servicePodMap: cleanServicePodMap(config.servicePodMap),
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

// ==================== Execution records (DB only — Jenkins HTTP is via agent) ====================

export async function recordJenkinsDeploy(input: {
  customerStepId: number;
  service: string;
  branch: string;
  jobPath: string;
  buildParams: Record<string, string>;
  queueUrl: string;
}) {
  const step = await db.query.customerSteps.findFirst({
    where: eq(customerSteps.id, input.customerStepId),
  });
  if (!step) throw new Error('Step not found');

  const [execution] = await db.insert(stepExecutions).values({
    stepId: step.id,
    customerId: step.customerId,
    releaseId: step.releaseId,
    type: 'jenkins',
    status: 'running',
    request: {
      job: input.jobPath,
      service: input.service,
      branch: input.branch,
      params: input.buildParams,
    },
    restResult: { queueUrl: input.queueUrl },
    startedAt: new Date(),
  }).returning();

  return { executionId: execution.id, queueUrl: input.queueUrl };
}

export async function updateJenkinsDeployStatus(
  executionId: number,
  status: DeployStatus & { queueUrl?: string; buildUrl?: string }
) {
  const execution = await db.query.stepExecutions.findFirst({
    where: eq(stepExecutions.id, executionId),
  });
  if (!execution) throw new Error('Execution not found');

  const prev = (execution.restResult || {}) as {
    queueUrl?: string;
    buildUrl?: string;
    result?: string;
  };

  const restResult = {
    ...prev,
    ...(status.queueUrl ? { queueUrl: status.queueUrl } : {}),
    ...(status.buildUrl ? { buildUrl: status.buildUrl } : {}),
    ...(status.result != null ? { result: status.result } : {}),
  };

  if (status.state === 'queued' || status.state === 'running') {
    await db.update(stepExecutions)
      .set({ status: 'running', restResult })
      .where(eq(stepExecutions.id, executionId));
    return;
  }

  await db.update(stepExecutions)
    .set({
      status: status.state === 'completed' ? 'completed' : 'failed',
      completedAt: new Date(),
      duration: status.duration ?? null,
      restResult,
    })
    .where(eq(stepExecutions.id, executionId));
}

// Latest jenkins execution for a customer step — lets the executor restore the
// last deploy (with its Jenkins build link) after the panel is closed/reopened
export async function getLastDeploy(customerStepId: number) {
  const execution = await db.query.stepExecutions.findFirst({
    where: and(eq(stepExecutions.stepId, customerStepId), eq(stepExecutions.type, 'jenkins')),
    orderBy: desc(stepExecutions.createdAt),
  });
  if (!execution) return null;

  const meta = (execution.restResult || {}) as {
    buildUrl?: string;
    result?: string;
    queueUrl?: string;
  };
  const request = (execution.request || {}) as { service?: string; branch?: string };
  return {
    executionId: execution.id,
    service: request.service || null,
    branch: request.branch || null,
    state: execution.status,
    result: meta.result || null,
    buildUrl: meta.buildUrl || null,
    queueUrl: meta.queueUrl || null,
    duration: execution.duration ?? null,
  };
}
