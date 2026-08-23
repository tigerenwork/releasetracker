/**
 * Auto-runner: unattended execution of release steps.
 *
 * Runs one customer's steps sequentially (deploy category first, then verify),
 * and multiple customers in parallel via a simple promise pool. k8s-backed step
 * types (bash/sql/script/rest/configmap) go through the browser extension
 * bridge to the local agent; jenkins steps run through the server actions.
 *
 * Run policy:
 *  - a failed step marks the step 'failed' and stops that customer's run;
 *    other customers in the pool keep going;
 *  - a `text` step, or a step without a resolvable target, pauses the run —
 *    the user handles it manually (and optionally saves a target override),
 *    then resumes; resume re-fetches the plan and continues from the first
 *    non-finished step.
 *
 * Client-only: uses `agentBridge`, which exists only in the browser.
 */

import { agentBridge, type ExecutionContext, type ExecutionResult, type PodInfo } from './agent-bridge';
import { buildSqlScript, type SqlClient } from '@/lib/sql-script';
import { parseConfigMapContent } from '@/lib/configmap-content';
import { appFromPodName } from '@/lib/grafana';
import {
  getCustomerRunPlan,
  markStepRunning,
  markStepDone,
  markStepFailed,
} from '@/lib/actions/customer-steps';
import {
  getLastScriptExecution,
  saveScriptExecution,
} from '@/lib/actions/step-executions';
import { triggerDeploy, getDeployStatus, getLastDeploy } from '@/lib/actions/jenkins';
import type { StepType } from '@/lib/db/schema';

export type RunPlan = Awaited<ReturnType<typeof getCustomerRunPlan>>;
export type RunPlanStep = RunPlan['steps'][number];

export type PauseReason = 'manual-step' | 'missing-target';

export type CustomerRunStatus = 'done' | 'failed' | 'paused' | 'cancelled';

export interface CustomerRunResult {
  customerId: number;
  status: CustomerRunStatus;
  executed: number;
  failedStep?: RunPlanStep;
  pausedStep?: RunPlanStep;
  pauseReason?: PauseReason;
  error?: string;
}

export interface RunHooks {
  onStepStart?(customerId: number, step: RunPlanStep): void;
  onStepDone?(customerId: number, step: RunPlanStep): void;
  onStepFailed?(customerId: number, step: RunPlanStep, error: string): void;
  onPause?(customerId: number, step: RunPlanStep, reason: PauseReason): void;
  onCustomerFinished?(result: CustomerRunResult): void;
}

/** Shared cancel flag for a whole run (all customers). Checked between steps. */
export interface RunControl {
  cancelled: boolean;
}

// Resolved execution target for one step
interface ResolvedTarget {
  podSelector?: string;
  podName?: string;
  deployment?: string;
  containerName?: string;
  // sql extras
  envVar?: string;
  sqlClient?: SqlClient;
  sqlSchema?: string;
  // jenkins
  jenkinsService?: string;
  jenkinsBranch?: string;
}

const NEEDS_POD: StepType[] = ['bash', 'sql', 'script', 'rest', 'configmap'];

const JENKINS_POLL_INTERVAL_MS = 4000;
const JENKINS_MAX_WAIT_MS = 30 * 60 * 1000;
const ROLLOUT_POLL_INTERVAL_MS = 5000;
const ROLLOUT_MAX_WAIT_MS = 10 * 60 * 1000;

function isPodReady(p: PodInfo): boolean {
  const [ready, total] = p.ready.split('/').map(Number);
  return p.status === 'Running' && total > 0 && ready === total;
}

/** Steps that still need to be executed by the runner. */
function isRunnable(step: RunPlanStep): boolean {
  return step.status === 'pending' || step.status === 'failed' || step.status === 'running' || step.status === 'reverted';
}

/**
 * Target resolution order:
 *   per-customer step override → template executionConfig → last manual run.
 * Returns null when no usable target exists (the run pauses there).
 */
async function resolveTarget(step: RunPlanStep, plan: RunPlan): Promise<ResolvedTarget | null> {
  const overrideKey = String(step.templateId ?? step.id);
  const override = plan.executionConfig?.stepOverrides?.[overrideKey];
  const tplConfig = step.template?.executionConfig;

  let last: Record<string, unknown> | null = null;
  try {
    if (step.type === 'jenkins') {
      const d = await getLastDeploy(step.id);
      if (d) last = { service: d.service, branch: d.branch };
    } else if (step.type === 'bash' || step.type === 'script' || step.type === 'sql') {
      const e = await getLastScriptExecution(step.id, step.type === 'sql' ? 'sql' : 'script');
      if (e) last = e.request;
    }
  } catch {
    // A missing history row must not block resolution
  }

  const rawSqlClient =
    (last?.client as string) ?? plan.executionConfig?.sqlConfig?.sqlClient ?? 'auto';
  const sqlClient: SqlClient = (['auto', 'mysql', 'psql'] as const).includes(rawSqlClient as SqlClient)
    ? (rawSqlClient as SqlClient)
    : 'auto';

  let podSelector = override?.podSelector ?? tplConfig?.target?.podSelector ?? undefined;
  let deployment = override?.deployment ?? tplConfig?.target?.deployment ?? undefined;
  // A bare word is not a useful label selector — users mean the deployment name
  if (podSelector && !podSelector.includes('=') && !deployment) {
    deployment = podSelector;
    podSelector = undefined;
  }

  const target: ResolvedTarget = {
    podSelector,
    deployment,
    // The last-run pod name is only a fallback when nothing stable is
    // configured — pod names change on every rollout, a deployment/selector
    // must always win over it
    podName: deployment || podSelector ? undefined : (last?.podName as string) ?? undefined,
    containerName:
      override?.containerName ??
      tplConfig?.target?.containerName ??
      (last?.containerName as string) ??
      undefined,
    envVar:
      (last?.envVar as string) ??
      plan.executionConfig?.sqlConfig?.connectionEnvVar ??
      'CRM_DB',
    sqlClient,
    sqlSchema: (last?.schema as string) ?? undefined,
    jenkinsService:
      override?.jenkinsService ?? tplConfig?.jenkins?.service ?? (last?.service as string) ?? undefined,
    jenkinsBranch:
      override?.jenkinsBranch ?? tplConfig?.jenkins?.branch ?? (last?.branch as string) ?? undefined,
  };

  // jenkinsConfig.servicePodMap maps Jenkins job name -> k8s app name. Let users
  // configure the step with the k8s name (e.g. "aldebaran") and reverse-map it
  // to the Jenkins job ("aptsell-aldebaran-test-deploy"). A value that is
  // already a mapped job name, or unknown to the map, is passed through as-is.
  const servicePodMap = plan.executionConfig?.jenkinsConfig?.servicePodMap;
  if (target.jenkinsService && servicePodMap && !(target.jenkinsService in servicePodMap)) {
    const jobName = Object.keys(servicePodMap).find(
      (job) => servicePodMap[job] === target.jenkinsService
    );
    if (jobName) target.jenkinsService = jobName;
  }

  if (NEEDS_POD.includes(step.type) && !target.deployment && !target.podSelector && !target.podName) return null;
  if (step.type === 'jenkins' && !target.jenkinsService) return null;
  return target;
}

/**
 * Resolve the target to a concrete pod name where possible:
 *  - an explicit podName (last manual run) is used as-is;
 *  - a deployment name is resolved by listing the namespace's pods and matching
 *    `appFromPodName(pod) === deployment`, preferring a Running, fully-ready pod;
 *  - otherwise undefined — the agent resolves the label selector itself.
 */
async function resolvePodName(
  plan: RunPlan,
  step: RunPlanStep,
  target: ResolvedTarget
): Promise<{ podName?: string; error?: string }> {
  if (target.podName) return { podName: target.podName };
  if (!target.deployment) return {};

  const result = await agentBridge!.getPods(buildContext(plan, step, { ...target, podSelector: '' }));
  if (!result.success) {
    return { error: result.error?.message ?? 'Failed to list pods' };
  }
  const matches = (result.pods?.items ?? []).filter(
    (p) => appFromPodName(p.name) === target.deployment
  );
  if (matches.length === 0) {
    return {
      error: `No pods found for deployment "${target.deployment}" in namespace ${plan.customer.namespace}`,
    };
  }
  return { podName: (matches.find(isPodReady) ?? matches[0]).name };
}

function buildContext(plan: RunPlan, step: RunPlanStep, target: ResolvedTarget): ExecutionContext {
  return {
    customerId: plan.customer.id,
    clusterId: plan.customer.clusterId,
    kubeContext: plan.customer.cluster?.name,
    namespace: plan.customer.namespace,
    podSelector: target.podSelector ?? '',
    podName: target.podName,
    containerName: target.containerName,
    stepId: step.id,
    releaseId: step.releaseId,
  };
}

function resultError(result: ExecutionResult): string {
  if (result.error?.message) return result.error.message;
  const stderr = result.script?.stderr ?? result.stderr ?? '';
  const tail = stderr.trim().split('\n').slice(-3).join('\n');
  return tail || `Exited with code ${result.exitCode ?? result.script?.exitCode ?? 'unknown'}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ==================== Per-type executors ====================

async function runScriptLike(
  plan: RunPlan,
  step: RunPlanStep,
  target: ResolvedTarget,
  script: { interpreter: 'sh' | 'bash' | 'python' | 'node'; content: string },
  persistType: 'script' | 'sql'
): Promise<{ ok: boolean; error?: string }> {
  if (!agentBridge) return { ok: false, error: 'Agent bridge unavailable (not in a browser)' };
  const resolved = await resolvePodName(plan, step, target);
  if (resolved.error) return { ok: false, error: resolved.error };
  const effectiveTarget = { ...target, podName: resolved.podName };
  const result = await agentBridge.executeScript(buildContext(plan, step, effectiveTarget), script);
  try {
    await saveScriptExecution({
      stepId: step.id,
      customerId: plan.customer.id,
      releaseId: step.releaseId,
      type: persistType,
      request: {
        deployment: target.deployment,
        podSelector: target.podSelector,
        podName: resolved.podName,
        containerName: target.containerName,
        kubeContext: plan.customer.cluster?.name,
        namespace: plan.customer.namespace,
      },
      success: result.success,
      exitCode: result.exitCode ?? result.script?.exitCode,
      duration: result.duration,
      stdout: result.script?.stdout,
      stderr: result.script?.stderr,
      errorMessage: result.error?.message,
    });
  } catch (err) {
    console.error('Failed to save auto-run execution:', err);
  }
  return result.success ? { ok: true } : { ok: false, error: resultError(result) };
}

async function runRest(
  plan: RunPlan,
  step: RunPlanStep,
  target: ResolvedTarget
): Promise<{ ok: boolean; error?: string }> {
  if (!agentBridge) return { ok: false, error: 'Agent bridge unavailable (not in a browser)' };
  // The agent's REST executor only resolves pods via a label selector
  if (!target.podSelector) {
    return { ok: false, error: 'REST steps need a label pod selector (e.g. app=my-service); deployment-name targets are not supported for REST' };
  }
  let rest: Parameters<typeof agentBridge.executeREST>[1];
  try {
    rest = JSON.parse(step.content);
  } catch {
    return { ok: false, error: 'REST step content is not valid JSON ({method, url, ...})' };
  }
  const result = await agentBridge.executeREST(buildContext(plan, step, target), rest);
  return result.success
    ? { ok: true }
    : { ok: false, error: result.error?.message ?? `HTTP ${result.rest?.statusCode ?? 'error'}` };
}

/**
 * A successful Jenkins build only means the deploy was triggered — k8s still
 * needs to create the new pods, shift traffic and terminate the old ones
 * before later steps (e.g. an update script) may touch the deployment.
 *
 * Waits until every pod of the deployed app was created after the deploy
 * started and is Running+ready. The app name comes from the customer's
 * jenkinsConfig.servicePodMap (Jenkins job -> k8s app); without a mapping
 * there is nothing to verify against and the wait is skipped.
 */
async function waitForRollout(
  plan: RunPlan,
  step: RunPlanStep,
  target: ResolvedTarget,
  control: RunControl,
  deployStartedAt: number
): Promise<{ ok: boolean; error?: string }> {
  const appName = plan.executionConfig?.jenkinsConfig?.servicePodMap?.[target.jenkinsService!];
  if (!appName || !agentBridge) return { ok: true };

  const ctx = buildContext(plan, step, { ...target, podSelector: '' });
  const deadline = Date.now() + ROLLOUT_MAX_WAIT_MS;

  while (Date.now() < deadline) {
    if (control.cancelled) return { ok: false, error: 'Cancelled' };
    await sleep(ROLLOUT_POLL_INTERVAL_MS);

    const result = await agentBridge.getPods(ctx);
    if (!result.success) continue; // transient kubectl error — keep polling

    const pods = (result.pods?.items ?? []).filter((p) => appFromPodName(p.name) === appName);
    // Small skew allowance: pod creationTimestamp is cluster-clock based
    const isNew = (p: PodInfo) => new Date(p.createdAt).getTime() >= deployStartedAt - 15000;
    const newPods = pods.filter(isNew);
    const oldPods = pods.filter((p) => !isNew(p));

    if (newPods.length > 0 && oldPods.length === 0 && newPods.every(isPodReady)) {
      return { ok: true };
    }
  }

  return {
    ok: false,
    error: `Jenkins deploy finished but the rollout of "${appName}" did not settle within 10 minutes — check the pods, then retry or mark the step done manually`,
  };
}

async function runJenkins(
  plan: RunPlan,
  step: RunPlanStep,
  target: ResolvedTarget,
  control: RunControl
): Promise<{ ok: boolean; error?: string }> {
  const deployStartedAt = Date.now();
  const { executionId } = await triggerDeploy(step.id, target.jenkinsService!, target.jenkinsBranch ?? '');
  const deadline = Date.now() + JENKINS_MAX_WAIT_MS;

  while (Date.now() < deadline) {
    if (control.cancelled) return { ok: false, error: 'Cancelled' };
    await sleep(JENKINS_POLL_INTERVAL_MS);
    const status = await getDeployStatus(executionId);
    if (status.state === 'completed') {
      return waitForRollout(plan, step, target, control, deployStartedAt);
    }
    if (status.state === 'failed') {
      return { ok: false, error: `Jenkins build failed${status.result ? `: ${status.result}` : ''}` };
    }
  }
  return { ok: false, error: 'Timed out waiting for the Jenkins build to finish' };
}

async function runConfigMap(
  plan: RunPlan,
  step: RunPlanStep,
  target: ResolvedTarget
): Promise<{ ok: boolean; error?: string }> {
  if (!agentBridge) return { ok: false, error: 'Agent bridge unavailable (not in a browser)' };

  const parsed = parseConfigMapContent(step.content);
  if (parsed.invalid.length > 0) {
    return { ok: false, error: `Invalid ConfigMap content: ${parsed.invalid[0].line} (${parsed.invalid[0].reason})` };
  }

  const ctx = buildContext(plan, step, target);

  // Deployment comes from the target when configured, otherwise it is derived
  // from the resolved pod name, same as the manual executor
  let deployment = target.deployment;
  if (!deployment) {
    const resolved = await resolvePodName(plan, step, target);
    if (resolved.error) return { ok: false, error: resolved.error };
    let podName = resolved.podName;
    if (!podName) {
      // Only a label selector is configured — the agent resolves it for us
      const pods = await agentBridge.getPods(ctx);
      const first = pods.pods?.items?.[0];
      if (!pods.success || !first) {
        return { ok: false, error: pods.error?.message ?? 'No pod found for the step target' };
      }
      podName = first.name;
    }
    deployment = appFromPodName(podName);
  }

  let configMapName = step.template?.executionConfig?.configmap?.configMapName;
  if (!configMapName) {
    const described = await agentBridge.configDescribe(ctx, deployment);
    const refs = described.config?.configMaps ?? [];
    if (!described.success) return { ok: false, error: described.error?.message ?? 'Failed to describe deployment' };
    if (refs.length !== 1) {
      return {
        ok: false,
        error: `Deployment "${deployment}" has ${refs.length} ConfigMaps; set configmap.configMapName in the step's execution config`,
      };
    }
    configMapName = refs[0].name;
  }

  const applied = await agentBridge.configApply(ctx, configMapName, { set: parsed.set, delete: parsed.delete });
  if (!applied.success) {
    return { ok: false, error: applied.error?.message ?? 'ConfigMap apply failed' };
  }

  if (step.template?.executionConfig?.configmap?.rolloutRestart) {
    const restarted = await agentBridge.rolloutRestart(ctx, deployment);
    if (!restarted.success) {
      return { ok: false, error: restarted.error?.message ?? 'Rollout restart failed' };
    }
  }
  return { ok: true };
}

async function executeStep(
  plan: RunPlan,
  step: RunPlanStep,
  target: ResolvedTarget,
  control: RunControl
): Promise<{ ok: boolean; error?: string }> {
  switch (step.type) {
    case 'bash':
      return runScriptLike(plan, step, target, { interpreter: 'bash', content: step.content }, 'script');
    case 'script':
      return runScriptLike(
        plan,
        step,
        target,
        { interpreter: step.template?.executionConfig?.script?.interpreter ?? 'sh', content: step.content },
        'script'
      );
    case 'sql':
      return runScriptLike(
        plan,
        step,
        target,
        { interpreter: 'sh', content: buildSqlScript(target.envVar!, target.sqlClient!, target.sqlSchema ?? '', step.content) },
        'sql'
      );
    case 'rest':
      return runRest(plan, step, target);
    case 'jenkins':
      return runJenkins(plan, step, target, control);
    case 'configmap':
      return runConfigMap(plan, step, target);
    default:
      return { ok: false, error: `Step type "${step.type}" cannot be auto-executed` };
  }
}

// ==================== Sequential per-customer runner ====================

export async function runCustomerSteps(
  plan: RunPlan,
  hooks: RunHooks = {},
  control: RunControl = { cancelled: false }
): Promise<CustomerRunResult> {
  const customerId = plan.customer.id;
  let executed = 0;

  for (const step of plan.steps) {
    if (control.cancelled) {
      return { customerId, status: 'cancelled', executed };
    }
    if (!isRunnable(step)) continue;

    // Manual-only step: pause and let the user handle it via the panel
    if (step.type === 'text') {
      hooks.onPause?.(customerId, step, 'manual-step');
      return { customerId, status: 'paused', executed, pausedStep: step, pauseReason: 'manual-step' };
    }

    const target = await resolveTarget(step, plan);
    if (!target) {
      hooks.onPause?.(customerId, step, 'missing-target');
      return { customerId, status: 'paused', executed, pausedStep: step, pauseReason: 'missing-target' };
    }

    hooks.onStepStart?.(customerId, step);
    await markStepRunning(step.id);

    let outcome: { ok: boolean; error?: string };
    try {
      outcome = await executeStep(plan, step, target, control);
    } catch (err) {
      outcome = { ok: false, error: err instanceof Error ? err.message : 'Execution failed' };
    }

    if (outcome.ok) {
      await markStepDone(step.id, 'auto-run');
      executed++;
      hooks.onStepDone?.(customerId, step);
    } else {
      if (outcome.error === 'Cancelled') {
        // Leave the step pending-ish so a later resume can retry it
        await markStepFailed(step.id, 'auto-run cancelled');
        return { customerId, status: 'cancelled', executed, failedStep: step };
      }
      const message = outcome.error ?? 'Execution failed';
      await markStepFailed(step.id, message.slice(0, 500));
      hooks.onStepFailed?.(customerId, step, message);
      return { customerId, status: 'failed', executed, failedStep: step, error: message };
    }
  }

  return { customerId, status: 'done', executed };
}

// ==================== Parallel pool across customers ====================

/**
 * Run several customers with a bounded concurrency. One customer's failure or
 * pause never blocks the others. Resolves when every queued customer has
 * reached a terminal state (done/failed/paused) or the run was cancelled.
 */
export async function runCustomerPool(
  plans: RunPlan[],
  options: { concurrency: number; hooks?: RunHooks; control?: RunControl }
): Promise<CustomerRunResult[]> {
  const { concurrency, hooks = {}, control = { cancelled: false } } = options;
  const queue = [...plans];
  const results: CustomerRunResult[] = [];

  const worker = async () => {
    while (queue.length > 0 && !control.cancelled) {
      const plan = queue.shift()!;
      const result = await runCustomerSteps(plan, hooks, control);
      results.push(result);
      hooks.onCustomerFinished?.(result);
    }
  };

  const workerCount = Math.max(1, Math.min(concurrency, plans.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
