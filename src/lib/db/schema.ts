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
