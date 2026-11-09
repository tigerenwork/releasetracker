'use server';

import { db } from '@/lib/db';
import {
  configMapEdits,
  configMapEditHistory,
  type ConfigMapEditPatch,
  type ConfigMapEditSource,
} from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';

export type ConfigMapEditInput = {
  kubeContext: string;
  namespace: string;
  configMapName: string;
  deploymentName?: string | null;
  patch: { set: Record<string, string>; delete: string[] };
  /**
   * Previous values for keys being set/deleted. Used to show before→after
   * and, when history is empty, to seed an `init` baseline entry.
   */
  before?: Record<string, string>;
  rolloutRestart: boolean;
  /** Where the edit came from — defaults to pods-ui for backward compat */
  source?: ConfigMapEditSource;
  releaseId?: number | null;
  stepId?: number | null;
};

export type ConfigMapHistoryEntry = {
  id: number;
  deploymentName: string | null;
  patch: ConfigMapEditPatch;
  rolloutRestart: boolean;
  source: ConfigMapEditSource;
  releaseId: number | null;
  stepId: number | null;
  editedAt: string;
  setKeys: number;
  deletedKeys: number;
};

/** Pull previous values for keys touched by a patch from a full data map. */
export function beforeValuesFromData(
  data: Record<string, string>,
  patch: { set: Record<string, string>; delete: string[] }
): Record<string, string> {
  const before: Record<string, string> = {};
  for (const key of Object.keys(patch.set)) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      before[key] = data[key];
    }
  }
  for (const key of patch.delete) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      before[key] = data[key];
    }
  }
  return before;
}

/**
 * Persist a ConfigMap edit: append to the audit history and upsert the
 * last-edit cache used by the "Last edited …" line.
 *
 * When this ConfigMap has no history yet and `before` is provided, an
 * `init` baseline row is inserted first so the first real edit has a
 * previous value to compare against.
 */
export async function recordConfigMapEdit(record: ConfigMapEditInput) {
  const editedAt = new Date();
  const source: ConfigMapEditSource = record.source ?? 'pods-ui';
  const before = record.before ?? {};
  const hasBefore = Object.keys(before).length > 0;

  const patch: ConfigMapEditPatch = {
    set: record.patch.set,
    delete: record.patch.delete,
    ...(hasBefore ? { before } : {}),
  };

  const base = {
    kubeContext: record.kubeContext,
    namespace: record.namespace,
    configMapName: record.configMapName,
    deploymentName: record.deploymentName ?? null,
  };

  const existing = await db.query.configMapEditHistory.findFirst({
    where: and(
      eq(configMapEditHistory.kubeContext, record.kubeContext),
      eq(configMapEditHistory.namespace, record.namespace),
      eq(configMapEditHistory.configMapName, record.configMapName)
    ),
    columns: { id: true },
  });

  // Seed a baseline so the first edit has a previous value to show
  if (!existing && hasBefore) {
    await db.insert(configMapEditHistory).values({
      ...base,
      patch: { set: before, delete: [] },
      rolloutRestart: false,
      source: 'init',
      releaseId: null,
      stepId: null,
      // 1ms earlier so newest-first ordering keeps init below the edit
      editedAt: new Date(editedAt.getTime() - 1),
    });
  }

  await db.insert(configMapEditHistory).values({
    ...base,
    patch,
    rolloutRestart: record.rolloutRestart,
    source,
    releaseId: record.releaseId ?? null,
    stepId: record.stepId ?? null,
    editedAt,
  });

  await db
    .insert(configMapEdits)
    .values({
      ...base,
      patch,
      rolloutRestart: record.rolloutRestart,
      editedAt,
    })
    .onConflictDoUpdate({
      target: [configMapEdits.kubeContext, configMapEdits.namespace, configMapEdits.configMapName],
      set: {
        deploymentName: base.deploymentName,
        patch,
        rolloutRestart: record.rolloutRestart,
        editedAt,
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
