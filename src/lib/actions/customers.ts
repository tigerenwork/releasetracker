'use server';

import { db } from '@/lib/db';
import { customers, clusters } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export type CustomerInput = {
  clusterId: number;
  namespace: string;
  name: string;
  description?: string;
};

export async function createCustomer(data: CustomerInput) {
  const [customer] = await db.insert(customers).values({
    ...data,
    isActive: true,
  }).returning();
  revalidatePath('/customers');
  revalidatePath(`/clusters/${data.clusterId}`);
  return customer;
}

export async function updateCustomer(id: number, data: Partial<CustomerInput>) {
  const [customer] = await db
    .update(customers)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(customers.id, id))
    .returning();
  revalidatePath('/customers');
  revalidatePath(`/customers/${id}`);
  if (data.clusterId) {
    revalidatePath(`/clusters/${data.clusterId}`);
  }
  return customer;
}

export async function deleteCustomer(id: number) {
  await db.update(customers)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(customers.id, id));
  revalidatePath('/customers');
}

export async function listCustomers() {
  return db.query.customers.findMany({
    where: eq(customers.isActive, true),
    with: { cluster: true },
    orderBy: customers.name,
  });
}

export async function listCustomersByCluster(clusterId: number) {
  return db.query.customers.findMany({
    where: and(
      eq(customers.clusterId, clusterId),
      eq(customers.isActive, true)
    ),
    orderBy: customers.name,
  });
}

export async function getCustomerById(id: number) {
  return db.query.customers.findFirst({
    where: eq(customers.id, id),
    with: { cluster: true },
  });
}

export async function getCustomersGroupedByCluster() {
  const allCustomers = await db.query.customers.findMany({
    where: eq(customers.isActive, true),
    with: { cluster: true },
    orderBy: customers.name,
  });

  const grouped = allCustomers.reduce((acc, customer) => {
    const clusterName = customer.cluster?.name || 'Unknown';
    const clusterId = customer.cluster?.id || 0;
    
    if (!acc[clusterId]) {
      acc[clusterId] = {
        cluster: customer.cluster,
        customers: [],
      };
    }
    acc[clusterId].customers.push(customer);
    return acc;
  }, {} as Record<number, { cluster: typeof allCustomers[0]['cluster']; customers: typeof allCustomers }>);

  return grouped;
}
