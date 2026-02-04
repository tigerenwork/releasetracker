'use server';

import { db } from '@/lib/db';
import { stepTemplates, customerSteps, type StepCategory, type StepType } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export type StepTemplateInput = {
  releaseId: number;
  name: string;
  category: StepCategory;
  type: StepType;
  content: string;
  orderIndex: number;
  description?: string;
};

export async function addStepTemplate(data: StepTemplateInput) {
  const [template] = await db.insert(stepTemplates).values(data).returning();
  revalidatePath(`/releases/${data.releaseId}/steps`);
  return template;
}

export async function updateStepTemplate(id: number, data: Partial<StepTemplateInput>) {
  const template = await db.query.stepTemplates.findFirst({
    where: eq(stepTemplates.id, id),
  });
  
  if (!template) throw new Error('Step template not found');
  
  const [updated] = await db
    .update(stepTemplates)
    .set(data)
    .where(eq(stepTemplates.id, id))
    .returning();
  
  // Update pending customer steps
  if (data.content) {
    await db.update(customerSteps)
      .set({ content: data.content })
      .where(and(
        eq(customerSteps.templateId, id),
        eq(customerSteps.status, 'pending'),
        eq(customerSteps.isOverridden, false)
      ));
  }
  
  if (data.name) {
    await db.update(customerSteps)
      .set({ name: data.name })
      .where(and(
        eq(customerSteps.templateId, id),
        eq(customerSteps.status, 'pending'),
        eq(customerSteps.isOverridden, false)
      ));
  }
  
  revalidatePath(`/releases/${template.releaseId}/steps`);
  return updated;
}

export async function deleteStepTemplate(id: number) {
  const template = await db.query.stepTemplates.findFirst({
    where: eq(stepTemplates.id, id),
  });
  
  if (!template) return;
  
  // Delete associated customer steps that haven't been executed
  await db.delete(customerSteps)
    .where(and(
      eq(customerSteps.templateId, id),
      eq(customerSteps.status, 'pending')
    ));
  
  await db.delete(stepTemplates).where(eq(stepTemplates.id, id));
  revalidatePath(`/releases/${template.releaseId}/steps`);
}

export async function reorderSteps(
  releaseId: number, 
  category: StepCategory,
  orderedIds: number[]
) {
  // Two-phase update to avoid unique constraint violations
  // Phase 1: Move all steps to temporary high values (offset by 10000)
  for (let i = 0; i < orderedIds.length; i++) {
    await db.update(stepTemplates)
      .set({ orderIndex: i + 10000 })
      .where(eq(stepTemplates.id, orderedIds[i]));
    
    // Also update customer steps
    await db.update(customerSteps)
      .set({ orderIndex: i + 10000 })
      .where(and(
        eq(customerSteps.templateId, orderedIds[i]),
        eq(customerSteps.category, category)
      ));
  }
  
  // Phase 2: Move to final positions
  for (let i = 0; i < orderedIds.length; i++) {
    await db.update(stepTemplates)
      .set({ orderIndex: i })
      .where(eq(stepTemplates.id, orderedIds[i]));
    
    // Also update customer steps
    await db.update(customerSteps)
      .set({ orderIndex: i })
      .where(and(
        eq(customerSteps.templateId, orderedIds[i]),
        eq(customerSteps.category, category)
      ));
  }
  
  revalidatePath(`/releases/${releaseId}/steps`);
}

export async function getStepTemplatesByRelease(releaseId: number) {
  return db.query.stepTemplates.findMany({
    where: eq(stepTemplates.releaseId, releaseId),
    orderBy: [stepTemplates.category, stepTemplates.orderIndex],
  });
}

export async function getStepTemplatesByCategory(releaseId: number, category: StepCategory) {
  return db.query.stepTemplates.findMany({
    where: and(
      eq(stepTemplates.releaseId, releaseId),
      eq(stepTemplates.category, category)
    ),
    orderBy: stepTemplates.orderIndex,
  });
}

export async function getNextOrderIndex(releaseId: number, category: StepCategory) {
  const templates = await db.query.stepTemplates.findMany({
    where: and(
      eq(stepTemplates.releaseId, releaseId),
      eq(stepTemplates.category, category)
    ),
  });
  
  const maxOrder = templates.length > 0 
    ? Math.max(...templates.map(t => t.orderIndex))
    : -1;
  
  return maxOrder + 1;
}
