'use server';

import { db } from '@/lib/db';
import { clusters, customers } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
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
  const activeCustomers = await db.query.customers.findMany({
    where: and(
      eq(customers.clusterId, id),
      eq(customers.isActive, true)
    ),
  });
  
  if (activeCustomers.length > 0) {
    throw new Error(`Cannot delete cluster: ${activeCustomers.length} active customer(s) exist. Please move or delete customers first.`);
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

/**
 * Merge Cronicle connection settings into the cluster's metadata JSON.
 * `apiKey` is stored server-side in SQLite and only sent to the browser
 * as part of the cluster detail payload (needed to call the Cronicle API).
 */
export async function updateClusterCronicleConfig(
  id: number,
  cronicle: {
    namespace: string;
    resource: string;
    localPort: number;
    remotePort: number;
    apiKey?: string;
    categoryId?: string;
  }
) {
  const cluster = await getClusterById(id);
  if (!cluster) {
    throw new Error(`Cluster not found: ${id}`);
  }

  const metadata = { ...(cluster.metadata ?? {}), cronicle };
  const [updated] = await db
    .update(clusters)
    .set({ metadata, updatedAt: new Date() })
    .where(eq(clusters.id, id))
    .returning();
  revalidatePath(`/clusters/${id}`);
  return updated;
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
