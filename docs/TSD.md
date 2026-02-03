# Technical Specification Document
## Release Orchestration & Tracking System

### Version: 1.0
### Date: 2026-02-01

---

## 1. Technology Stack

| Layer | Technology | Version | Rationale |
|-------|-----------|---------|-----------|
| **Framework** | Next.js | 14+ (App Router) | Full-stack React, API routes, RSC support |
| **Language** | TypeScript | 5.x | Type safety, better DX |
| **Runtime** | Node.js | 20.x LTS | Stable, good performance |
| **Database** | SQLite | 3.x | Zero-config, single-file, sufficient for single-user |
| **ORM** | Drizzle ORM | Latest | Type-safe SQL, lightweight, migrations support |
| **Styling** | Tailwind CSS | 3.x | Utility-first, rapid UI development |
| **UI Components** | shadcn/ui | Latest | Accessible, customizable components |
| **Icons** | Lucide React | Latest | Clean, consistent icons |
| **Syntax Highlight** | PrismJS | Latest | Code display for bash/SQL |
| **State Management** | React Server Components + Server Actions | Built-in | Simplified data flow, minimal client JS |

### Alternative Considerations

| Alternative | Why Not Chosen | Migration Path |
|-------------|----------------|----------------|
| PostgreSQL | Overkill for single-user tool | Can migrate if multi-user needed later |
| Prisma | Heavier, requires client generation | Drizzle is lighter and faster |
| tRPC | Server Actions sufficient | Can add if API complexity grows |
| Redux/Zustand | Server-state preferred | Already using RSC pattern |

---

## 2. Database Schema

### 2.1 Drizzle ORM Schema Definition

```typescript
// lib/db/schema.ts

import { sqliteTable, integer, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// ==================== Clusters ====================
export const clusters = sqliteTable('clusters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  kubeconfigPath: text('kubeconfig_path'),
  description: text('description'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, any>>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const clustersRelations = relations(clusters, ({ many }) => ({
  customers: many(customers),
}));

// ==================== Customers ====================
export const customers = sqliteTable('customers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clusterId: integer('cluster_id').notNull().references(() => clusters.id, { onDelete: 'restrict' }),
  namespace: text('namespace').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, any>>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => ({
  uniqueNamespacePerCluster: uniqueIndex('unique_namespace_per_cluster')
    .on(table.clusterId, table.namespace),
}));

export const customersRelations = relations(customers, ({ one, many }) => ({
  cluster: one(clusters, { fields: [customers.clusterId], references: [clusters.id] }),
  steps: many(customerSteps),
}));

// ==================== Releases ====================
export const releases = sqliteTable('releases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  type: text('type', { enum: ['onboarding', 'release', 'hotfix'] }).notNull(),
  status: text('status', { enum: ['draft', 'active', 'archived'] }).default('draft'),
  versionNumber: text('version_number'),
  releaseDate: integer('release_date', { mode: 'timestamp' }),
  description: text('description'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, any>>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

export const releasesRelations = relations(releases, ({ many }) => ({
  templates: many(stepTemplates),
  customerSteps: many(customerSteps),
}));

// ==================== Step Templates ====================
export const stepTemplates = sqliteTable('step_templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  releaseId: integer('release_id').notNull().references(() => releases.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  category: text('category', { enum: ['deploy', 'verify'] }).notNull(),
  type: text('type', { enum: ['bash', 'sql', 'text'] }).notNull(),
  content: text('content').notNull(),
  orderIndex: integer('order_index').notNull(),
  description: text('description'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => ({
  uniqueOrderPerReleaseCategory: uniqueIndex('unique_order_per_release_category')
    .on(table.releaseId, table.category, table.orderIndex),
}));

export const stepTemplatesRelations = relations(stepTemplates, ({ one, many }) => ({
  release: one(releases, { fields: [stepTemplates.releaseId], references: [releases.id] }),
  customerSteps: many(customerSteps),
}));

// ==================== Customer Steps ====================
export const customerSteps = sqliteTable('customer_steps', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  releaseId: integer('release_id').notNull().references(() => releases.id, { onDelete: 'cascade' }),
  customerId: integer('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  templateId: integer('template_id').references(() => stepTemplates.id, { onDelete: 'set null' }),
  
  // Copied/Overridden fields
  name: text('name').notNull(),
  category: text('category', { enum: ['deploy', 'verify'] }).notNull(),
  type: text('type', { enum: ['bash', 'sql', 'text'] }).notNull(),
  content: text('content').notNull(),
  orderIndex: integer('order_index').notNull(),
  
  // Execution tracking
  status: text('status', { enum: ['pending', 'done', 'skipped', 'reverted'] }).default('pending'),
  executedAt: integer('executed_at', { mode: 'timestamp' }),
  executedBy: text('executed_by'),
  skipReason: text('skip_reason'),
  notes: text('notes'),
  
  // Flags
  isCustom: integer('is_custom', { mode: 'boolean' }).default(false),
  isOverridden: integer('is_overridden', { mode: 'boolean' }).default(false),
  
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => ({
  // Ensure unique steps per customer per release
  uniqueCustomerStep: uniqueIndex('unique_customer_step')
    .on(table.releaseId, table.customerId, table.templateId),
}));

export const customerStepsRelations = relations(customerSteps, ({ one }) => ({
  release: one(releases, { fields: [customerSteps.releaseId], references: [releases.id] }),
  customer: one(customers, { fields: [customerSteps.customerId], references: [customers.id] }),
  template: one(stepTemplates, { fields: [customerSteps.templateId], references: [stepTemplates.id] }),
}));

// ==================== Types ====================
export type Cluster = typeof clusters.$inferSelect;
export type NewCluster = typeof clusters.$inferInsert;

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;

export type Release = typeof releases.$inferSelect;
export type NewRelease = typeof releases.$inferInsert;

export type StepTemplate = typeof stepTemplates.$inferSelect;
export type NewStepTemplate = typeof stepTemplates.$inferInsert;

export type CustomerStep = typeof customerSteps.$inferSelect;
export type NewCustomerStep = typeof customerSteps.$inferInsert;

export type StepCategory = 'deploy' | 'verify';
export type StepType = 'bash' | 'sql' | 'text';
export type ReleaseType = 'onboarding' | 'release' | 'hotfix';
export type ReleaseStatus = 'draft' | 'active' | 'archived';
export type StepStatus = 'pending' | 'done' | 'skipped' | 'reverted';
```

### 2.2 Database Indexes

| Index | Purpose |
|-------|---------|
| `unique_namespace_per_cluster` | Prevent duplicate namespaces within a cluster |
| `unique_order_per_release_category` | Prevent duplicate ordering within a release category |
| `unique_customer_step` | Prevent duplicate steps per customer per release |
| `customer_steps.release_id` | Foreign key index for release lookups |
| `customer_steps.customer_id` | Foreign key index for customer lookups |
| `step_templates.release_id` | Foreign key index for template lookups |
| `customers.cluster_id` | Foreign key index for cluster lookups |

---

## 3. Project Structure

```
my-app/
├── app/                           # Next.js App Router
│   ├── page.tsx                   # Dashboard (main entry)
│   ├── layout.tsx                 # Root layout
│   ├── globals.css                # Global styles
│   │
│   ├── clusters/                  # Cluster management
│   │   ├── page.tsx               # List all clusters
│   │   ├── new/
│   │   │   └── page.tsx           # Create cluster form
│   │   └── [id]/
│   │       ├── page.tsx           # Cluster detail
│   │       └── edit/
│   │           └── page.tsx       # Edit cluster form
│   │
│   ├── customers/                 # Customer management
│   │   ├── page.tsx               # List all customers (grouped by cluster)
│   │   ├── new/
│   │   │   └── page.tsx           # Create customer form
│   │   └── [id]/
│   │       ├── page.tsx           # Customer detail
│   │       └── edit/
│   │           └── page.tsx       # Edit customer form
│   │
│   └── releases/                  # Release management
│       ├── page.tsx               # List all releases
│       ├── new/
│       │   └── page.tsx           # Create release wizard
│       └── [id]/
│           ├── page.tsx           # Release dashboard (matrix view)
│           ├── steps/
│           │   └── page.tsx       # Manage template steps
│           └── customer/
│               └── [customerId]/
│                   └── page.tsx   # Customer-specific steps view
│
├── components/                    # React components
│   ├── ui/                        # shadcn/ui components (auto-generated)
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── dialog.tsx
│   │   ├── input.tsx
│   │   ├── select.tsx
│   │   ├── table.tsx
│   │   ├── tabs.tsx
│   │   ├── badge.tsx
│   │   └── ...
│   │
│   ├── clusters/
│   │   ├── cluster-card.tsx
│   │   ├── cluster-form.tsx
│   │   └── cluster-list.tsx
│   │
│   ├── customers/
│   │   ├── customer-card.tsx
│   │   ├── customer-form.tsx
│   │   ├── customer-list.tsx
│   │   └── customer-select.tsx
│   │
│   ├── releases/
│   │   ├── release-card.tsx
│   │   ├── release-form.tsx
│   │   ├── release-matrix.tsx     # Main matrix view
│   │   ├── release-progress.tsx
│   │   └── release-type-badge.tsx
│   │
│   ├── steps/
│   │   ├── step-card.tsx
│   │   ├── step-editor.tsx        # Code editor with syntax highlight
│   │   ├── step-form.tsx
│   │   ├── step-list.tsx
│   │   ├── step-detail-modal.tsx
│   │   ├── step-status-badge.tsx
│   │   └── step-type-icon.tsx
│   │
│   └── layout/
│       ├── sidebar.tsx
│       ├── header.tsx
│       └── breadcrumb.tsx
│
├── lib/                           # Utilities and shared code
│   ├── db/
│   │   ├── index.ts               # Database connection
│   │   ├── schema.ts              # Drizzle schema
│   │   └── migrations/            # Migration files
│   │
│   ├── actions/                   # Server Actions
│   │   ├── clusters.ts
│   │   ├── customers.ts
│   │   ├── releases.ts
│   │   ├── step-templates.ts
│   │   └── customer-steps.ts
│   │
│   ├── utils/
│   │   ├── cn.ts                  # Tailwind merge utility
│   │   ├── formatting.ts          # Date/text formatting
│   │   └── validations.ts         # Input validations
│   │
│   └── types/
│       └── index.ts               # Shared TypeScript types
│
├── public/                        # Static assets
│
├── drizzle.config.ts              # Drizzle configuration
├── next.config.js                 # Next.js configuration
├── tailwind.config.ts             # Tailwind configuration
├── tsconfig.json                  # TypeScript configuration
└── package.json
```

---

## 4. Server Actions API

### 4.1 Cluster Actions

```typescript
// lib/actions/clusters.ts
'use server';

import { db } from '@/lib/db';
import { clusters, type NewCluster, type Cluster } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export async function createCluster(data: NewCluster): Promise<Cluster> {
  const [cluster] = await db.insert(clusters).values(data).returning();
  revalidatePath('/clusters');
  return cluster;
}

export async function updateCluster(
  id: number, 
  data: Partial<NewCluster>
): Promise<Cluster> {
  const [cluster] = await db
    .update(clusters)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(clusters.id, id))
    .returning();
  revalidatePath('/clusters');
  revalidatePath(`/clusters/${id}`);
  return cluster;
}

export async function deleteCluster(id: number): Promise<void> {
  // Check if cluster has active customers
  const customerCount = await db.query.customers.count({
    where: and(
      eq(customers.clusterId, id),
      eq(customers.isActive, true)
    )
  });
  
  if (customerCount > 0) {
    throw new Error('Cannot delete cluster with active customers');
  }
  
  await db.update(clusters)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(clusters.id, id));
  revalidatePath('/clusters');
}

export async function listClusters(): Promise<Cluster[]> {
  return db.query.clusters.findMany({
    where: eq(clusters.isActive, true),
    orderBy: clusters.name,
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
```

### 4.2 Customer Actions

```typescript
// lib/actions/customers.ts
'use server';

import { db } from '@/lib/db';
import { customers, type NewCustomer, type Customer } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export async function createCustomer(data: NewCustomer): Promise<Customer> {
  const [customer] = await db.insert(customers).values(data).returning();
  revalidatePath('/customers');
  revalidatePath(`/clusters/${data.clusterId}`);
  return customer;
}

export async function updateCustomer(
  id: number, 
  data: Partial<NewCustomer>
): Promise<Customer> {
  const [customer] = await db
    .update(customers)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(customers.id, id))
    .returning();
  revalidatePath('/customers');
  revalidatePath(`/customers/${id}`);
  return customer;
}

export async function deleteCustomer(id: number): Promise<void> {
  await db.update(customers)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(customers.id, id));
  revalidatePath('/customers');
}

export async function listCustomers(): Promise<Customer[]> {
  return db.query.customers.findMany({
    where: eq(customers.isActive, true),
    with: { cluster: true },
    orderBy: customers.name,
  });
}

export async function listCustomersByCluster(clusterId: number): Promise<Customer[]> {
  return db.query.customers.findMany({
    where: and(
      eq(customers.clusterId, clusterId),
      eq(customers.isActive, true)
    ),
    orderBy: customers.name,
  });
}

export async function getCustomerWithCluster(id: number) {
  return db.query.customers.findFirst({
    where: eq(customers.id, id),
    with: { cluster: true },
  });
}
```

### 4.3 Release Actions

```typescript
// lib/actions/releases.ts
'use server';

import { db } from '@/lib/db';
import { 
  releases, 
  stepTemplates, 
  customerSteps, 
  customers,
  type NewRelease, 
  type Release 
} from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export async function createRelease(data: NewRelease): Promise<Release> {
  const [release] = await db.insert(releases).values(data).returning();
  revalidatePath('/releases');
  return release;
}

export async function updateRelease(
  id: number, 
  data: Partial<NewRelease>
): Promise<Release> {
  const [release] = await db
    .update(releases)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(releases.id, id))
    .returning();
  revalidatePath('/releases');
  revalidatePath(`/releases/${id}`);
  return release;
}

export async function activateRelease(
  id: number, 
  customerIds?: number[]
): Promise<void> {
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

export async function addCustomersToRelease(
  releaseId: number,
  customerIds: number[]
): Promise<void> {
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
  const existingCustomerIds = new Set(existingSteps.map(s => s.customerId));
  
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

export async function archiveRelease(id: number): Promise<void> {
  await db.update(releases)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(eq(releases.id, id));
  revalidatePath('/releases');
}

export async function listReleases(): Promise<Release[]> {
  return db.query.releases.findMany({
    orderBy: (releases, { desc }) => [desc(releases.createdAt)],
  });
}

export async function getReleaseWithProgress(id: number) {
  const release = await db.query.releases.findFirst({
    where: eq(releases.id, id),
    with: {
      templates: {
        orderBy: [stepTemplates.category, stepTemplates.orderIndex],
      },
    },
  });
  
  if (!release) return null;
  
  // Get customer steps with customer and cluster info
  const steps = await db.query.customerSteps.findMany({
    where: eq(customerSteps.releaseId, id),
    with: {
      customer: {
        with: { cluster: true },
      },
    },
  });
  
  // Group by cluster for display
  const groupedByCluster = steps.reduce((acc, step) => {
    const clusterName = step.customer.cluster.name;
    if (!acc[clusterName]) acc[clusterName] = [];
    acc[clusterName].push(step);
    return acc;
  }, {} as Record<string, typeof steps>);
  
  return { ...release, groupedByCluster, allSteps: steps };
}
```

### 4.4 Step Template Actions

```typescript
// lib/actions/step-templates.ts
'use server';

import { db } from '@/lib/db';
import { stepTemplates, customerSteps, type NewStepTemplate, type StepTemplate } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export async function addTemplateStep(data: NewStepTemplate): Promise<StepTemplate> {
  const [template] = await db.insert(stepTemplates).values(data).returning();
  revalidatePath(`/releases/${data.releaseId}/steps`);
  return template;
}

export async function updateTemplateStep(
  id: number, 
  data: Partial<NewStepTemplate>
): Promise<StepTemplate> {
  const [template] = await db
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
  
  revalidatePath(`/releases/${template.releaseId}/steps`);
  return template;
}

export async function deleteTemplateStep(id: number): Promise<void> {
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
  category: 'deploy' | 'verify',
  orderedIds: number[]
): Promise<void> {
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
```

### 4.5 Customer Step Actions

```typescript
// lib/actions/customer-steps.ts
'use server';

import { db } from '@/lib/db';
import { customerSteps, type CustomerStep } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export async function getCustomerSteps(
  releaseId: number, 
  customerId: number
): Promise<CustomerStep[]> {
  return db.query.customerSteps.findMany({
    where: and(
      eq(customerSteps.releaseId, releaseId),
      eq(customerSteps.customerId, customerId)
    ),
    orderBy: [customerSteps.category, customerSteps.orderIndex],
  });
}

export async function overrideStepContent(
  stepId: number, 
  newContent: string
): Promise<CustomerStep> {
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
  data: {
    name: string;
    category: 'deploy' | 'verify';
    type: 'bash' | 'sql' | 'text';
    content: string;
    orderIndex: number;
    addToTemplate?: boolean;  // NEW: Option to add to template
  }
): Promise<CustomerStep> {
  const { addToTemplate, ...stepData } = data;
  
  // If addToTemplate is true, create template step first
  let templateId: number | null = null;
  
  if (addToTemplate) {
    const [template] = await db.insert(stepTemplates).values({
      ...stepData,
      releaseId,
    }).returning();
    templateId = template.id;
    
    // Add to ALL active customers (not just the current one)
    const allCustomers = await db.query.customers.findMany({
      where: eq(customers.isActive, true),
    });
    
    const stepsToInsert = allCustomers.map(customer => ({
      releaseId,
      customerId: customer.id,
      templateId: template.id,
      ...stepData,
      status: 'pending' as const,
      isCustom: false,  // It's now a template step
      isOverridden: false,
    }));
    
    if (stepsToInsert.length > 0) {
      await db.insert(customerSteps).values(stepsToInsert);
    }
    
    // Return the step for the requested customer
    const [step] = await db.query.customerSteps.findMany({
      where: and(
        eq(customerSteps.releaseId, releaseId),
        eq(customerSteps.customerId, customerId),
        eq(customerSteps.templateId, templateId)
      ),
    });
    
    revalidatePath(`/releases/${releaseId}`);
    return step;
  }
  
  // Original behavior: custom step for single customer
  const [step] = await db.insert(customerSteps).values({
    ...stepData,
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

export async function markStepDone(
  stepId: number, 
  notes?: string
): Promise<CustomerStep> {
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

export async function markStepReverted(
  stepId: number, 
  reason?: string
): Promise<CustomerStep> {
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

export async function skipStep(
  stepId: number, 
  reason: string
): Promise<CustomerStep> {
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

export async function bulkMarkDone(stepIds: number[]): Promise<void> {
  for (const id of stepIds) {
    await markStepDone(id);
  }
}

export async function resetToTemplate(stepId: number): Promise<CustomerStep> {
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
```

---

## 5. Key Implementation Details

### 5.1 Release Activation Algorithm

```typescript
async function activateRelease(releaseId: number) {
  // 1. Validate release is in draft status
  // 2. Fetch all templates for the release
  // 3. Fetch all active customers with their clusters
  // 4. For each customer, create CustomerStep for each template
  // 5. Copy template content to customer step (denormalization)
  // 6. Set status = 'pending' for all
  // 7. Update release status to 'active'
}
```

### 5.2 Matrix View Data Query

```typescript
// Optimized query for the matrix view
async function getReleaseMatrix(releaseId: number, clusterId?: number) {
  const whereClause = eq(customerSteps.releaseId, releaseId);
  
  const steps = await db.query.customerSteps.findMany({
    where: clusterId 
      ? and(whereClause, eq(customers.clusterId, clusterId))
      : whereClause,
    with: {
      customer: {
        with: { cluster: true },
      },
      template: true,
    },
    orderBy: [customerSteps.category, customerSteps.orderIndex],
  });
  
  // Transform into matrix format
  // Rows: Steps (grouped by category)
  // Columns: Customers (grouped by cluster)
  const matrix = {
    deploy: { steps: [], customers: {} },
    verify: { steps: [], customers: {} },
  };
  
  // Grouping logic...
  return matrix;
}
```

### 5.3 Progress Calculation

```typescript
function calculateProgress(steps: CustomerStep[]) {
  const total = steps.length;
  const done = steps.filter(s => s.status === 'done').length;
  const skipped = steps.filter(s => s.status === 'skipped').length;
  const pending = steps.filter(s => s.status === 'pending').length;
  const reverted = steps.filter(s => s.status === 'reverted').length;
  
  return {
    total,
    done,
    skipped,
    pending,
    reverted,
    percentage: Math.round(((done + skipped) / total) * 100),
  };
}
```

### 5.4 Syntax Highlighting

```typescript
// components/steps/code-block.tsx
import Prism from 'prismjs';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-bash';

interface CodeBlockProps {
  code: string;
  type: 'bash' | 'sql' | 'text';
}

export function CodeBlock({ code, type }: CodeBlockProps) {
  const language = type === 'text' ? 'text' : type;
  const highlighted = Prism.highlight(
    code,
    Prism.languages[language] || Prism.languages.text,
    language
  );
  
  return (
    <pre className="rounded bg-gray-900 p-4 overflow-x-auto">
      <code 
        className={`language-${language} text-sm`}
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    </pre>
  );
}
```

---

## 6. Component Specifications

### 6.1 Release Matrix Component

```typescript
// components/releases/release-matrix.tsx

interface ReleaseMatrixProps {
  releaseId: number;
  clusterId?: number; // Optional filter
}

interface MatrixData {
  clusters: {
    id: number;
    name: string;
    customers: {
      id: number;
      name: string;
      namespace: string;
      steps: CustomerStep[];
    }[];
  }[];
  deploySteps: StepTemplate[];
  verifySteps: StepTemplate[];
}

export function ReleaseMatrix({ releaseId, clusterId }: ReleaseMatrixProps) {
  // Fetches data and renders cluster-grouped matrix
  // Each cluster is a collapsible section
  // Table: Steps as rows, Customers as columns
  // Cells: Status badge with quick actions
}
```

### 6.2 Step Card Component

```typescript
// components/steps/step-card.tsx

interface StepCardProps {
  step: CustomerStep;
  onMarkDone: (id: number) => void;
  onMarkReverted: (id: number) => void;
  onSkip: (id: number, reason: string) => void;
  onEdit: (id: number, content: string) => void;
}

export function StepCard({ step, ...actions }: StepCardProps) {
  // Displays step name, type badge, status badge
  // Shows cluster/namespace context
  // Actions based on current status
  // Modal for viewing full content
}
```

### 6.3 Step Detail Side Panel (NEW)

```typescript
// components/steps/step-detail-panel.tsx

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { CodeBlock } from './code-block';

interface StepDetailPanelProps {
  step: CustomerStep & { template?: StepTemplate; customer: Customer };
  isOpen: boolean;
  onClose: () => void;
  onMarkDone: (id: number, notes?: string) => void;
  onSkip: (id: number, reason: string) => void;
  onRevert: (id: number, reason?: string) => void;
  onOverride: (id: number, content: string) => void;
  onResetToTemplate: (id: number) => void;
  onEditCustom: (id: number, data: Partial<CustomStepInput>) => void;
  onDeleteCustom: (id: number) => void;
}

export function StepDetailPanel({ step, isOpen, onClose, ...actions }: StepDetailPanelProps) {
  // Side panel with:
  // - Source info (template/custom/overridden)
  // - Syntax-highlighted content
  // - Action buttons based on source type
  // - Execution notes input
  // - History timeline
}
```

### 6.4 Add Custom Step Dialog (NEW)

```typescript
// components/steps/add-custom-step-dialog.tsx

interface AddCustomStepDialogProps {
  releaseId: number;
  customerId: number;
  category: 'deploy' | 'verify';
  existingSteps: { id: number; name: string; orderIndex: number }[];
  isOpen: boolean;
  onClose: () => void;
  onAdd: (data: CustomStepInput & { addToTemplate: boolean; insertPosition: number }) => void;
}

export function AddCustomStepDialog({ ...props }: AddCustomStepDialogProps) {
  // Dialog with:
  // - Name, type, content inputs
  // - Insert position dropdown (before/after existing steps)
  // - "Add to template" checkbox (unchecked by default)
  // - Add/Cancel buttons
}
```

### 6.5 Draggable Step List (NEW)

```typescript
// components/steps/draggable-step-list.tsx

import { DndContext, useDraggable, useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';

interface DraggableStepListProps {
  steps: (StepTemplate | CustomerStep)[];
  onReorder: (orderedIds: number[]) => void;
  renderStep: (step: StepTemplate | CustomerStep, index: number) => React.ReactNode;
}

export function DraggableStepList({ steps, onReorder, renderStep }: DraggableStepListProps) {
  // Drag-and-drop list using @dnd-kit
  // Visual drag handle on each item
  // Smooth animations
  // Calls onReorder when drop completes
}
```

### 6.6 Code Block with Syntax Highlight (NEW)

```typescript
// components/steps/code-block.tsx

import Prism from 'prismjs';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-bash';
import 'prismjs/themes/prism-tomorrow.css';

interface CodeBlockProps {
  code: string;
  type: 'bash' | 'sql' | 'text';
  showLineNumbers?: boolean;
}

export function CodeBlock({ code, type, showLineNumbers = true }: CodeBlockProps) {
  // Server-side or client-side syntax highlighting
  // Copy to clipboard button
  // Line numbers optional
}
```

### 6.7 Activate Release Dialog (NEW)

```typescript
// components/releases/activate-release-dialog.tsx

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { useState } from 'react';

interface CustomerWithCluster {
  id: number;
  name: string;
  namespace: string;
  cluster: {
    id: number;
    name: string;
  };
}

interface ActivateReleaseDialogProps {
  releaseId: number;
  releaseName: string;
  customers: CustomerWithCluster[];
  isOpen: boolean;
  onClose: () => void;
  onActivate: (customerIds: number[]) => Promise<void>;
}

export function ActivateReleaseDialog({ 
  releaseId, 
  releaseName,
  customers,
  isOpen, 
  onClose,
  onActivate 
}: ActivateReleaseDialogProps) {
  // Dialog for selecting customers before activation
  // Groups customers by cluster
  // Select All / Deselect All buttons
  // Shows count: "Selected X of Y customers"
  // Activate button (disabled if no customers selected)
  // Cancel button
}
```

### 6.8 Add Customer to Release Dialog (NEW)

```typescript
// components/releases/add-customer-dialog.tsx

interface AddCustomerDialogProps {
  releaseId: number;
  releaseName: string;
  // Customers not currently in the release
  availableCustomers: CustomerWithCluster[];
  isOpen: boolean;
  onClose: () => void;
  onAdd: (customerIds: number[]) => Promise<void>;
}

export function AddCustomerDialog({ ...props }: AddCustomerDialogProps) {
  // Dialog for adding customers to an active release
  // Shows only customers NOT already in the release
  // Multi-select with checkboxes
  // Grouped by cluster
  // Add button (disabled if none selected)
}
```

---

## 6.9 API Endpoints

### Reorder Steps Endpoint

```typescript
// app/api/steps/reorder/route.ts

import { NextRequest } from 'next/server';
import { reorderSteps } from '@/lib/actions/step-templates';

export async function POST(request: NextRequest) {
  const { releaseId, category, orderedIds } = await request.json();
  await reorderSteps(releaseId, category, orderedIds);
  return Response.json({ success: true });
}
```

### Get Step Detail Endpoint

```typescript
// app/api/steps/[id]/detail/route.ts

import { NextRequest } from 'next/server';
import { getStepWithDetails } from '@/lib/actions/customer-steps';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const stepId = parseInt(params.id);
  const step = await getStepWithDetails(stepId);
  return Response.json(step);
}
```

### Add Customers to Release Endpoint

```typescript
// app/api/releases/[id]/add-customers/route.ts

import { NextRequest } from 'next/server';
import { addCustomersToRelease } from '@/lib/actions/releases';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const releaseId = parseInt(params.id);
  const { customerIds } = await request.json();
  
  await addCustomersToRelease(releaseId, customerIds);
  return Response.json({ success: true });
}
```

---

## 7. Configuration

### 7.1 Environment Variables

```bash
# .env.local
# Database
DATABASE_URL="file:./data/app.db"

# Optional: For future integrations
JENKINS_URL=""
JENKINS_TOKEN=""
RANCHER_URL=""
RANCHER_TOKEN=""
```

### 7.2 Drizzle Configuration

```typescript
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  driver: 'better-sqlite3',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'file:./data/app.db',
  },
});
```

### 7.3 Next.js Configuration

```javascript
// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: true,
  },
  // Ensure SQLite database is not bundled
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
```

---

## 8. Database Migration Strategy

### Initial Migration

```bash
# 1. Generate migration
npx drizzle-kit generate:sqlite

# 2. Apply migration
npx drizzle-kit push:sqlite
```

### Schema Updates

```bash
# After modifying schema.ts:
npx drizzle-kit generate:sqlite
npx drizzle-kit push:sqlite
```

---

## 9. Development Workflow

### 9.1 Setup

```bash
# 1. Initialize project
npx create-next-app@latest my-app --typescript --tailwind --app

# 2. Install dependencies
cd my-app
npm install drizzle-orm better-sqlite3
npm install -D drizzle-kit @types/better-sqlite3

# 3. Initialize shadcn/ui
npx shadcn-ui@latest init

# 4. Add components
npx shadcn-ui@latest add button card dialog input select table tabs badge

# 5. Setup database
mkdir -p data
touch data/.gitkeep
```

### 9.2 Development Server

```bash
npm run dev
# Runs on http://localhost:3000
```

### 9.3 Build

```bash
npm run build
npm start
```

---

## 10. Security Considerations

| Concern | Mitigation |
|---------|-----------|
| SQL Injection | Drizzle ORM parameterized queries |
| XSS | React's built-in escaping, sanitize user input |
| CSRF | Next.js Server Actions built-in CSRF protection |
| Path Traversal | Validate file paths for kubeconfig |
| Data Integrity | Foreign key constraints, transactions |

---

## 11. Performance Considerations

| Area | Strategy |
|------|----------|
| Database | Proper indexes on foreign keys and common queries |
| Data Fetching | React Server Components for initial data |
| Re-rendering | Server Actions with revalidatePath |
| Large Lists | Virtualization if customer count grows large |
| Bundle Size | Tree-shaking, dynamic imports for heavy components |

---

## 12. Testing Strategy

| Type | Approach |
|------|----------|
| Unit | Test utilities, validations |
| Integration | Test Server Actions with test database |
| E2E | Playwright for critical user flows |

---

## 13. Deployment

### 13.1 Production Build

```bash
npm run build
```

### 13.2 Data Persistence

- SQLite database stored in `data/app.db`
- Mount data directory as volume in container
- Backup strategy: Regular file backups

### 13.3 Docker (Optional)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["npm", "start"]
```

---

## 14. Future Extensibility

| Feature | Technical Preparation |
|---------|----------------------|
| Multi-user | Add `users` table, auth middleware, row-level security |
| Auto-execution | Background job queue, K8s client libraries |
| Webhooks | API routes for Jenkins/Rancher callbacks |
| Notifications | WebSocket or Server-Sent Events for real-time updates |
| Audit log | Separate `audit_logs` table with triggers |
| Export/Import | CSV/JSON export endpoints |
