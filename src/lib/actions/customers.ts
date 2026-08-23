'use server';

import { db } from '@/lib/db';
import { customers, clusters, customerExecutionConfigs, type StepTargetOverride } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export type CustomerInput = {
  clusterId: number;
  namespace: string;
  name: string;
  description?: string;
  websiteUrl?: string;
};

// Bare hostnames get https:// so the stored value is always navigable
function normalizeWebsiteUrl(url?: string) {
  const trimmed = url?.trim();
  if (!trimmed) return undefined;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export async function createCustomer(data: CustomerInput) {
  const [customer] = await db.insert(customers).values({
    ...data,
    websiteUrl: normalizeWebsiteUrl(data.websiteUrl) ?? null,
    isActive: true,
  }).returning();
  revalidatePath('/customers');
  revalidatePath(`/clusters/${data.clusterId}`);
  return customer;
}

export async function updateCustomer(id: number, data: Partial<CustomerInput>) {
  const { websiteUrl, ...rest } = data;
  const set: Record<string, any> = { ...rest, updatedAt: new Date() };
  // The form always sends the field, so undefined means "cleared"
  if ('websiteUrl' in data) {
    set.websiteUrl = normalizeWebsiteUrl(websiteUrl) ?? null;
  }
  const [customer] = await db
    .update(customers)
    .set(set)
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

// Per-customer SQL execution defaults (env var name, client) if configured
export async function getCustomerSqlConfig(customerId: number) {
  const row = await db.query.customerExecutionConfigs.findFirst({
    where: eq(customerExecutionConfigs.customerId, customerId),
  });
  return row?.sqlConfig || null;
}

// Full per-customer execution config (SQL defaults, jenkins mapping, step overrides)
export async function getCustomerExecutionConfig(customerId: number) {
  const row = await db.query.customerExecutionConfigs.findFirst({
    where: eq(customerExecutionConfigs.customerId, customerId),
  });
  return row ?? null;
}

// Upsert one per-step target override (keyed by templateId, or customerStep id
// for custom steps). Pass null to remove the override.
export async function saveStepTargetOverride(
  customerId: number,
  key: string,
  override: StepTargetOverride | null
) {
  const existing = await db.query.customerExecutionConfigs.findFirst({
    where: eq(customerExecutionConfigs.customerId, customerId),
  });

  const stepOverrides = { ...(existing?.stepOverrides || {}) };
  if (override) {
    stepOverrides[key] = override;
  } else {
    delete stepOverrides[key];
  }

  if (existing) {
    await db
      .update(customerExecutionConfigs)
      .set({ stepOverrides, updatedAt: new Date() })
      .where(eq(customerExecutionConfigs.id, existing.id));
  } else {
    await db.insert(customerExecutionConfigs).values({ customerId, stepOverrides });
  }

  revalidatePath(`/customers/${customerId}`);
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
