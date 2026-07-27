'use server';

import { db } from '@/lib/db';
import { grafanaSettings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export async function getGrafanaSettings() {
  const row = await db.query.grafanaSettings.findFirst();
  if (!row) return null;
  return {
    id: row.id,
    baseUrl: row.baseUrl,
    datasourceUid: row.datasourceUid || '',
  };
}

export async function upsertGrafanaSettings(data: { baseUrl: string; datasourceUid?: string }) {
  const existing = await db.query.grafanaSettings.findFirst();
  const values = {
    baseUrl: data.baseUrl.replace(/\/+$/, ''),
    datasourceUid: data.datasourceUid?.trim() || '',
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(grafanaSettings).set(values).where(eq(grafanaSettings.id, existing.id));
  } else {
    await db.insert(grafanaSettings).values(values);
  }
  revalidatePath('/jenkins');
}
