'use server';

import { db } from '@/lib/db';
import {
  configMapEdits,
  configMapEditHistory,
  type ConfigMapEditSource,
} from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';

export type ConfigMapEditInput = {
  kubeContext: string;
  namespace: string;
  configMapName: string;
  deploymentName?: string | null;
  patch: { set: Record<string, string>; delete: string[] };
  rolloutRestart: boolean;
  /** Where the edit came from — defaults to pods-ui for backward compat */
  source?: ConfigMapEditSource;
  releaseId?: number | null;
  stepId?: number | null;
};

export type ConfigMapHistoryEntry = {
  id: number;
  deploymentName: string | null;
  patch: { set: Record<string, string>; delete: string[] };
  rolloutRestart: boolean;
  source: ConfigMapEditSource;
  releaseId: number | null;
  stepId: number | null;
  editedAt: string;
  setKeys: number;
  deletedKeys: number;
};

/**
 * Persist a ConfigMap edit: append to the audit history and upsert the
 * last-edit cache used by the "Last edited …" line.
 */
export async function recordConfigMapEdit(record: ConfigMapEditInput) {
  const editedAt = new Date();
  const source: ConfigMapEditSource = record.source ?? 'pods-ui';
  const values = {
    kubeContext: record.kubeContext,
    namespace: record.namespace,
    configMapName: record.configMapName,
    deploymentName: record.deploymentName ?? null,
    patch: record.patch,
    rolloutRestart: record.rolloutRestart,
    editedAt,
  };

  await db.insert(configMapEditHistory).values({
    ...values,
    source,
    releaseId: record.releaseId ?? null,
    stepId: record.stepId ?? null,
  });

  await db
    .insert(configMapEdits)
    .values(values)
    .onConflictDoUpdate({
      target: [configMapEdits.kubeContext, configMapEdits.namespace, configMapEdits.configMapName],
      set: {
        deploymentName: values.deploymentName,
        patch: values.patch,
        rolloutRestart: values.rolloutRestart,
        editedAt: values.editedAt,
      },
    });
}

// Returns a plain serializable summary for the "Last edited …" line in the editor
export async function getLastConfigMapEdit(
  kubeContext: string,
  namespace: string,
  configMapName: string
) {
  const row = await db.query.configMapEdits.findFirst({
    where: and(
      eq(configMapEdits.kubeContext, kubeContext),
      eq(configMapEdits.namespace, namespace),
      eq(configMapEdits.configMapName, configMapName)
    ),
  });
  if (!row) return null;

  return {
    deploymentName: row.deploymentName,
    rolloutRestart: row.rolloutRestart,
    editedAt: row.editedAt.toISOString(),
    setKeys: Object.keys(row.patch?.set ?? {}).length,
    deletedKeys: row.patch?.delete?.length ?? 0,
  };
}

/** Newest-first audit history for one ConfigMap. */
export async function getConfigMapEditHistory(
  kubeContext: string,
  namespace: string,
  configMapName: string,
  limit = 50
): Promise<ConfigMapHistoryEntry[]> {
  const rows = await db
    .select()
    .from(configMapEditHistory)
    .where(
      and(
        eq(configMapEditHistory.kubeContext, kubeContext),
        eq(configMapEditHistory.namespace, namespace),
        eq(configMapEditHistory.configMapName, configMapName)
      )
    )
    .orderBy(desc(configMapEditHistory.editedAt), desc(configMapEditHistory.id))
    .limit(Math.min(Math.max(limit, 1), 200));

  return rows.map((row) => ({
    id: row.id,
    deploymentName: row.deploymentName,
    patch: row.patch ?? { set: {}, delete: [] },
    rolloutRestart: row.rolloutRestart,
    source: row.source,
    releaseId: row.releaseId,
    stepId: row.stepId,
    editedAt: row.editedAt.toISOString(),
    setKeys: Object.keys(row.patch?.set ?? {}).length,
    deletedKeys: row.patch?.delete?.length ?? 0,
  }));
}
