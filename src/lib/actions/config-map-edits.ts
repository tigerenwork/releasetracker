'use server';

import { db } from '@/lib/db';
import { configMapEdits } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

export type ConfigMapEditInput = {
  kubeContext: string;
  namespace: string;
  configMapName: string;
  deploymentName?: string | null;
  patch: { set: Record<string, string>; delete: string[] };
  rolloutRestart: boolean;
};

// Upsert the most recent edit per (kubeContext, namespace, configMapName) —
// v1 keeps only the last edit; full history is a future phase.
export async function recordConfigMapEdit(record: ConfigMapEditInput) {
  const values = {
    kubeContext: record.kubeContext,
    namespace: record.namespace,
    configMapName: record.configMapName,
    deploymentName: record.deploymentName ?? null,
    patch: record.patch,
    rolloutRestart: record.rolloutRestart,
    editedAt: new Date(),
  };

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
