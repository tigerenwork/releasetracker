'use server';

import { db } from '@/lib/db';
import { clusters, customers } from '@/lib/db/schema';
import { eq, and, count } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export type ClusterInput = {
  name: string;
  kubeconfigPath?: string;
  description?: string;
};

export async function createCluster(data: ClusterInput) {
  const [cluster] = await db.insert(clusters).values({
    ...data,
    isActive: true,
  }).returning();
  revalidatePath('/clusters');
  return cluster;
}

export async function updateCluster(id: number, data: Partial<ClusterInput>) {
  const [cluster] = await db
    .update(clusters)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(clusters.id, id))
    .returning();
  revalidatePath('/clusters');
  revalidatePath(`/clusters/${id}`);
  return cluster;
}

export async function deleteCluster(id: number) {
  // Check if cluster has active customers
  const result = await db
    .select({ count: count() })
    .from(customers)
    .where(and(
      eq(customers.clusterId, id),
      eq(customers.isActive, true)
    ));
  
  const customerCount = result[0]?.count || 0;
  
  if (customerCount > 0) {
    throw new Error(`Cannot delete cluster: ${customerCount} active customer(s) exist. Please move or delete customers first.`);
  }
  
  await db.update(clusters)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(clusters.id, id));
  revalidatePath('/clusters');
}

export async function listClusters() {
  return db.query.clusters.findMany({
    where: eq(clusters.isActive, true),
    orderBy: clusters.name,
  });
}

export async function getClusterById(id: number) {
  return db.query.clusters.findFirst({
    where: eq(clusters.id, id),
  });
}

export async function getClusterWithCustomers(id: number) {
  return db.query.clusters.findFirst({
    where: eq(clusters.id, id),
    with: {
      customers: {
        where: eq(customers.isActive, true),
        orderBy: customers.name,
      },
    },
  });
}
