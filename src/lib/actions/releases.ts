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
import { eq, and, desc, inArray } from 'drizzle-orm';
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

export async function activateRelease(id: number, customerIds?: number[]) {
  const release = await db.query.releases.findFirst({
    where: eq(releases.id, id),
    with: { templates: true },
  });
  
  if (!release) throw new Error('Release not found');
  if (release.status !== 'draft') throw new Error('Release is not in draft status');
  
  // If customerIds not provided, use all active customers (backward compatible)
  const targetCustomers = customerIds 
    ? await db.query.customers.findMany({
        where: and(
          eq(customers.isActive, true),
          inArray(customers.id, customerIds)
        ),
      })
    : await db.query.customers.findMany({
        where: eq(customers.isActive, true),
      });
  
  // Create customer steps from templates
  const customerStepsToInsert = targetCustomers.flatMap(customer => 
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

export async function addCustomersToRelease(releaseId: number, customerIds: number[]) {
  const release = await db.query.releases.findFirst({
    where: eq(releases.id, releaseId),
    with: { templates: true },
  });
  
  if (!release) throw new Error('Release not found');
  if (release.status !== 'active') throw new Error('Release must be active to add customers');
  
  // Get existing customer IDs in this release
  const existingSteps = await db.query.customerSteps.findMany({
    where: eq(customerSteps.releaseId, releaseId),
    columns: { customerId: true },
  });
  const existingCustomerIds = new Set(existingSteps.map((s: { customerId: number }) => s.customerId));
  
  // Filter out customers already in the release
  const newCustomerIds = customerIds.filter(id => !existingCustomerIds.has(id));
  
  if (newCustomerIds.length === 0) {
    throw new Error('All selected customers are already in this release');
  }
  
  // Get the new customers
  const newCustomers = await db.query.customers.findMany({
    where: and(
      eq(customers.isActive, true),
      inArray(customers.id, newCustomerIds)
    ),
  });
  
  // Create customer steps from current templates
  const customerStepsToInsert = newCustomers.flatMap(customer => 
    release.templates.map(template => ({
      releaseId: releaseId,
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
  
  revalidatePath(`/releases/${releaseId}`);
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
  
  // Count total customer steps by status
  const allSteps = await db.query.customerSteps.findMany();
  const pendingSteps = allSteps.filter(s => s.status === 'pending').length;
  const doneSteps = allSteps.filter(s => s.status === 'done').length;
  const skippedSteps = allSteps.filter(s => s.status === 'skipped').length;

  return {
    totalReleases: allReleases.length,
    activeReleases: activeReleases.length,
    pendingSteps,
    doneSteps,
    skippedSteps,
  };
}
