'use server';

import { db } from '@/lib/db';
import { customerCollections, collectionCustomers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export type CollectionInput = {
  name: string;
  description?: string;
  customerIds: number[];
};

export async function listCollections() {
  return db.query.customerCollections.findMany({
    where: eq(customerCollections.isActive, true),
    orderBy: customerCollections.name,
    with: {
      members: {
        with: { customer: { with: { cluster: true } } },
      },
    },
  });
}

export async function createCollection(data: CollectionInput) {
  const [collection] = await db.insert(customerCollections).values({
    name: data.name,
    description: data.description,
    isActive: true,
  }).returning();

  if (data.customerIds.length > 0) {
    await db.insert(collectionCustomers).values(
      data.customerIds.map((customerId) => ({
        collectionId: collection.id,
        customerId,
      }))
    );
  }

  revalidatePath('/customers');
  return collection;
}

export async function updateCollection(id: number, data: Partial<CollectionInput>) {
  const [collection] = await db
    .update(customerCollections)
    .set({
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      updatedAt: new Date(),
    })
    .where(eq(customerCollections.id, id))
    .returning();

  // Replace membership when customerIds is provided
  if (data.customerIds) {
    await db.delete(collectionCustomers).where(eq(collectionCustomers.collectionId, id));
    if (data.customerIds.length > 0) {
      await db.insert(collectionCustomers).values(
        data.customerIds.map((customerId) => ({
          collectionId: id,
          customerId,
        }))
      );
    }
  }

  revalidatePath('/customers');
  return collection;
}

export async function deleteCollection(id: number) {
  await db
    .update(customerCollections)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(customerCollections.id, id));
  revalidatePath('/customers');
}
