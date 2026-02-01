'use server';

import { db } from '@/lib/db';
import { 
  customerSteps, 
  customers, 
  clusters,
  type StepCategory, 
  type StepType 
} from '@/lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export type CustomStepInput = {
  name: string;
  category: StepCategory;
  type: StepType;
  content: string;
  orderIndex: number;
};

export async function getCustomerSteps(releaseId: number, customerId: number) {
  return db.query.customerSteps.findMany({
    where: and(
      eq(customerSteps.releaseId, releaseId),
      eq(customerSteps.customerId, customerId)
    ),
    orderBy: [customerSteps.category, asc(customerSteps.orderIndex)],
    with: { template: true },
  });
}

export async function overrideStepContent(stepId: number, newContent: string) {
  const [step] = await db
    .update(customerSteps)
    .set({ 
      content: newContent, 
      isOverridden: true,
      updatedAt: new Date()
    })
    .where(eq(customerSteps.id, stepId))
    .returning();
  revalidatePath(`/releases/${step.releaseId}`);
  return step;
}

export async function addCustomStep(
  releaseId: number,
  customerId: number,
  data: CustomStepInput
) {
  const [step] = await db.insert(customerSteps).values({
    ...data,
    releaseId,
    customerId,
    templateId: null,
    status: 'pending',
    isCustom: true,
    isOverridden: false,
  }).returning();
  revalidatePath(`/releases/${releaseId}`);
  return step;
}

export async function markStepDone(stepId: number, notes?: string) {
  const [step] = await db
    .update(customerSteps)
    .set({ 
      status: 'done',
      executedAt: new Date(),
      notes: notes || null,
      updatedAt: new Date()
    })
    .where(eq(customerSteps.id, stepId))
    .returning();
  revalidatePath(`/releases/${step.releaseId}`);
  return step;
}

export async function markStepReverted(stepId: number, reason?: string) {
  const [step] = await db
    .update(customerSteps)
    .set({ 
      status: 'reverted',
      notes: reason || null,
      updatedAt: new Date()
    })
    .where(eq(customerSteps.id, stepId))
    .returning();
  revalidatePath(`/releases/${step.releaseId}`);
  return step;
}

export async function skipStep(stepId: number, reason: string) {
  const [step] = await db
    .update(customerSteps)
    .set({ 
      status: 'skipped',
      skipReason: reason,
      updatedAt: new Date()
    })
    .where(eq(customerSteps.id, stepId))
    .returning();
  revalidatePath(`/releases/${step.releaseId}`);
  return step;
}

export async function bulkMarkDone(stepIds: number[]) {
  for (const id of stepIds) {
    await markStepDone(id);
  }
}

export async function resetToTemplate(stepId: number) {
  const step = await db.query.customerSteps.findFirst({
    where: eq(customerSteps.id, stepId),
    with: { template: true },
  });
  
  if (!step?.template) throw new Error('No template found');
  
  const [updated] = await db
    .update(customerSteps)
    .set({ 
      content: step.template.content,
      name: step.template.name,
      isOverridden: false,
      updatedAt: new Date()
    })
    .where(eq(customerSteps.id, stepId))
    .returning();
  revalidatePath(`/releases/${step.releaseId}`);
  return updated;
}

export async function deleteCustomStep(stepId: number) {
  const step = await db.query.customerSteps.findFirst({
    where: eq(customerSteps.id, stepId),
  });
  
  if (!step) return;
  if (!step.isCustom) throw new Error('Cannot delete non-custom steps');
  
  await db.delete(customerSteps).where(eq(customerSteps.id, stepId));
  revalidatePath(`/releases/${step.releaseId}`);
}

export async function getReleaseStepsGroupedByCluster(releaseId: number) {
  const steps = await db.query.customerSteps.findMany({
    where: eq(customerSteps.releaseId, releaseId),
    with: {
      customer: {
        with: { cluster: true },
      },
      template: true,
    },
    orderBy: [customerSteps.category, asc(customerSteps.orderIndex)],
  });

  // Group by cluster
  const grouped = steps.reduce((acc, step) => {
    const clusterId = step.customer.cluster?.id || 0;
    const clusterName = step.customer.cluster?.name || 'Unknown';
    
    if (!acc[clusterId]) {
      acc[clusterId] = {
        cluster: step.customer.cluster,
        customers: {},
      };
    }
    
    const customerId = step.customer.id;
    if (!acc[clusterId].customers[customerId]) {
      acc[clusterId].customers[customerId] = {
        customer: step.customer,
        steps: [],
      };
    }
    
    acc[clusterId].customers[customerId].steps.push(step);
    return acc;
  }, {} as Record<number, {
    cluster: typeof steps[0]['customer']['cluster'];
    customers: Record<number, {
      customer: typeof steps[0]['customer'];
      steps: typeof steps;
    }>;
  }>);

  return grouped;
}

export async function getReleaseStepsByCustomer(releaseId: number) {
  const steps = await db.query.customerSteps.findMany({
    where: eq(customerSteps.releaseId, releaseId),
    with: {
      customer: {
        with: { cluster: true },
      },
      template: true,
    },
    orderBy: [customerSteps.category, asc(customerSteps.orderIndex)],
  });

  const grouped = steps.reduce((acc, step) => {
    const customerId = step.customer.id;
    if (!acc[customerId]) {
      acc[customerId] = {
        customer: step.customer,
        steps: [],
      };
    }
    acc[customerId].steps.push(step);
    return acc;
  }, {} as Record<number, {
    customer: typeof steps[0]['customer'];
    steps: typeof steps;
  }>);

  return grouped;
}

export async function getStepStats(releaseId: number) {
  const allSteps = await db.query.customerSteps.findMany({
    where: eq(customerSteps.releaseId, releaseId),
  });

  const total = allSteps.length;
  const done = allSteps.filter(s => s.status === 'done').length;
  const skipped = allSteps.filter(s => s.status === 'skipped').length;
  const pending = allSteps.filter(s => s.status === 'pending').length;
  const reverted = allSteps.filter(s => s.status === 'reverted').length;

  return {
    total,
    done,
    skipped,
    pending,
    reverted,
    percentage: total > 0 ? Math.round(((done + skipped) / total) * 100) : 0,
  };
}
