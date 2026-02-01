'use server';

import { db } from '@/lib/db';
import { 
  releases, 
  stepTemplates, 
  customerSteps, 
  customers,
  type ReleaseType,
  type ReleaseStatus,
} from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export type ReleaseInput = {
  name: string;
  type: ReleaseType;
  versionNumber?: string;
  releaseDate?: Date;
  description?: string;
};

export async function createRelease(data: ReleaseInput) {
  const [release] = await db.insert(releases).values({
    ...data,
    releaseDate: data.releaseDate || null,
    status: 'draft',
  }).returning();
  revalidatePath('/releases');
  return release;
}

export async function updateRelease(id: number, data: Partial<ReleaseInput>) {
  const [release] = await db
    .update(releases)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(releases.id, id))
    .returning();
  revalidatePath('/releases');
  revalidatePath(`/releases/${id}`);
  return release;
}

export async function activateRelease(id: number) {
  const release = await db.query.releases.findFirst({
    where: eq(releases.id, id),
    with: { templates: true },
  });
  
  if (!release) throw new Error('Release not found');
  if (release.status !== 'draft') throw new Error('Release is not in draft status');
  
  const activeCustomers = await db.query.customers.findMany({
    where: eq(customers.isActive, true),
  });
  
  // Create customer steps from templates
  const customerStepsToInsert = activeCustomers.flatMap(customer => 
    release.templates.map(template => ({
      releaseId: id,
      customerId: customer.id,
      templateId: template.id,
      name: template.name,
      category: template.category,
      type: template.type,
      content: template.content,
      orderIndex: template.orderIndex,
      status: 'pending' as const,
      isCustom: false,
      isOverridden: false,
    }))
  );
  
  if (customerStepsToInsert.length > 0) {
    await db.insert(customerSteps).values(customerStepsToInsert);
  }
  
  await db.update(releases)
    .set({ status: 'active', updatedAt: new Date() })
    .where(eq(releases.id, id));
  
  revalidatePath('/releases');
  revalidatePath(`/releases/${id}`);
}

export async function archiveRelease(id: number) {
  await db.update(releases)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(eq(releases.id, id));
  revalidatePath('/releases');
  revalidatePath(`/releases/${id}`);
}

export async function deleteRelease(id: number) {
  await db.delete(releases).where(eq(releases.id, id));
  revalidatePath('/releases');
}

export async function listReleases() {
  return db.query.releases.findMany({
    orderBy: desc(releases.createdAt),
  });
}

export async function getReleaseById(id: number) {
  return db.query.releases.findFirst({
    where: eq(releases.id, id),
    with: {
      templates: {
        orderBy: [stepTemplates.category, stepTemplates.orderIndex],
      },
    },
  });
}

export async function getActiveReleases() {
  return db.query.releases.findMany({
    where: eq(releases.status, 'active'),
    orderBy: desc(releases.createdAt),
  });
}

export async function cloneRelease(id: number, newName: string) {
  const original = await db.query.releases.findFirst({
    where: eq(releases.id, id),
    with: { templates: true },
  });
  
  if (!original) throw new Error('Release not found');
  
  // Create new release
  const [newRelease] = await db.insert(releases).values({
    name: newName,
    type: original.type,
    status: 'draft',
    versionNumber: original.versionNumber,
    description: `Cloned from: ${original.name}\n\n${original.description || ''}`,
  }).returning();
  
  // Clone templates
  if (original.templates.length > 0) {
    await db.insert(stepTemplates).values(
      original.templates.map(t => ({
        releaseId: newRelease.id,
        name: t.name,
        category: t.category,
        type: t.type,
        content: t.content,
        orderIndex: t.orderIndex,
        description: t.description,
      }))
    );
  }
  
  revalidatePath('/releases');
  return newRelease;
}

export async function getReleaseStats() {
  const allReleases = await db.query.releases.findMany();
  const activeReleases = allReleases.filter(r => r.status === 'active');
  
  // Count total customer steps that are pending
  const pendingSteps = await db
    .select({ count: { value: customerSteps.id } })
    .from(customerSteps)
    .where(eq(customerSteps.status, 'pending'));
  
  const doneSteps = await db
    .select({ count: { value: customerSteps.id } })
    .from(customerSteps)
    .where(eq(customerSteps.status, 'done'));
  
  const skippedSteps = await db
    .select({ count: { value: customerSteps.id } })
    .from(customerSteps)
    .where(eq(customerSteps.status, 'skipped'));

  return {
    totalReleases: allReleases.length,
    activeReleases: activeReleases.length,
    pendingSteps: pendingSteps[0]?.count?.value || 0,
    doneSteps: doneSteps[0]?.count?.value || 0,
    skippedSteps: skippedSteps[0]?.count?.value || 0,
  };
}
