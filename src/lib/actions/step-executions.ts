'use server';

import { db } from '@/lib/db';
import { stepExecutions } from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';

export type ScriptExecutionType = 'script' | 'sql';

export type SaveScriptExecutionInput = {
  stepId: number;
  customerId: number;
  releaseId: number;
  type: ScriptExecutionType;
  /** Pod/container (and SQL opts) chosen at run time — restored next open */
  request: Record<string, unknown>;
  success: boolean;
  exitCode?: number;
  duration: number;
  stdout?: string;
  stderr?: string;
  errorMessage?: string;
};

export type LastScriptExecution = {
  executionId: number;
  success: boolean;
  exitCode?: number | null;
  duration: number;
  stdout: string;
  stderr: string;
  errorMessage?: string;
  request: Record<string, unknown>;
  completedAt: string | null;
};

// Persist a bash/SQL run so reopening the step panel shows the last output
export async function saveScriptExecution(input: SaveScriptExecutionInput) {
  const [execution] = await db
    .insert(stepExecutions)
    .values({
      stepId: input.stepId,
      customerId: input.customerId,
      releaseId: input.releaseId,
      type: input.type,
      status: input.success ? 'completed' : 'failed',
      request: input.request,
      exitCode: input.exitCode ?? null,
      stdout: input.stdout ?? null,
      stderr: input.stderr ?? null,
      scriptResult: {
        stdout: input.stdout ?? '',
        stderr: input.stderr ?? '',
        exitCode: input.exitCode ?? (input.success ? 0 : 1),
        errorMessage: input.errorMessage,
      },
      startedAt: new Date(Date.now() - Math.max(0, input.duration)),
      completedAt: new Date(),
      duration: input.duration,
    })
    .returning();

  return { executionId: execution.id };
}

export async function getLastScriptExecution(
  customerStepId: number,
  type: ScriptExecutionType
): Promise<LastScriptExecution | null> {
  const execution = await db.query.stepExecutions.findFirst({
    where: and(eq(stepExecutions.stepId, customerStepId), eq(stepExecutions.type, type)),
    orderBy: desc(stepExecutions.createdAt),
  });
  if (!execution) return null;

  const scriptResult = (execution.scriptResult || {}) as {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    errorMessage?: string;
  };

  return {
    executionId: execution.id,
    success: execution.status === 'completed',
    exitCode: execution.exitCode ?? scriptResult.exitCode ?? null,
    duration: execution.duration ?? 0,
    stdout: execution.stdout ?? scriptResult.stdout ?? '',
    stderr: execution.stderr ?? scriptResult.stderr ?? '',
    errorMessage: scriptResult.errorMessage,
    request: (execution.request || {}) as Record<string, unknown>,
    completedAt: execution.completedAt ? new Date(execution.completedAt).toISOString() : null,
  };
}
