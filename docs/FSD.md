# Functional Specification Document
## Release Orchestration & Tracking System

### Version: 1.0
### Date: 2026-02-01

---

## 1. Overview

### 1.1 Purpose
A web application to manage, track, and execute multi-customer deployment workflows across multiple Kubernetes clusters with customer-specific variations.

### 1.2 Target User
Developer/Release manager managing multiple isolated customer environments across one or more K8s clusters.

### 1.3 Core Value
- Eliminate forgotten steps across customers and clusters
- Prevent wrong script execution on wrong customers
- Provide clear visibility of deployment progress per customer and cluster
- Manage customers organized by their hosting clusters

---

## 2. User Personas & Stories

### Persona: Release Manager (Developer)

| ID | User Story |
|----|-----------|
| US-001 | As a release manager, I want to create a release with deployment and verification steps so that I can standardize the release process |
| US-002 | As a release manager, I want to define common steps that apply to all customers so that I don't repeat myself |
| US-003 | As a release manager, I want to customize steps per customer so that customer-specific requirements are handled |
| US-004 | As a release manager, I want to track which steps are completed for each customer so that I don't miss anything |
| US-005 | As a release manager, I want to see the execution status at a glance so that I can identify blockers quickly |
| US-006 | As a release manager, I want to manage multiple K8s clusters so that I can organize customers by their hosting infrastructure |
| US-007 | As a release manager, I want to see which cluster a customer belongs to so that I can execute cluster-specific operations correctly |
| US-008 | As a release manager, I want to filter/view customers by cluster so that I can focus on one cluster at a time |

---

## 3. Core Entities

### 3.1 Entity Relationship Diagram

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│     Cluster     │────<│     Customer     │>────│  CustomerStep   │
├─────────────────┤ 1:M ├──────────────────┤ M:1 ├─────────────────┤
│ id              │     │ id               │     │ id              │
│ name            │     │ cluster_id (FK)  │     │ release_id (FK) │
│ kubeconfig_path │     │ namespace        │     │ customer_id(FK) │
│ description     │     │ name             │     │ template_id(FK) │
│ is_active       │     │ description      │     │ ...             │
│ metadata        │     │ is_active        │     │ status          │
│ created_at      │     │ metadata         │     │ content         │
└─────────────────┘     │ created_at       │     └─────────────────┘
                        └──────────────────┘              │
                               ^                          │
                               │                          │
                               │ M:1                      │ M:1
                               │                          │
                        ┌──────────────────┐     ┌─────────────────┐
                        │  StepTemplate    │<────│     Release     │
                        ├──────────────────┤ M:1 ├─────────────────┤
                        │ id               │     │ id              │
                        │ release_id (FK)  │     │ name            │
                        │ name             │     │ type            │
                        │ type             │     │ status          │
                        │ content          │     │ version_number  │
                        │ category         │     │ release_date    │
                        │ order_index      │     │ description     │
                        └──────────────────┘     └─────────────────┘
```

### 3.2 Entity Definitions

#### Cluster
Represents a Kubernetes cluster that hosts one or more customers.

| Field | Type | Description |
|-------|------|-------------|
| id | integer | Primary key |
| name | string | Cluster name (e.g., "production-eu", "staging-us") |
| kubeconfig_path | string | Path to kubeconfig file (optional, for future auto-execution) |
| description | text | Human-readable description |
| is_active | boolean | Whether cluster is active |
| metadata | json | Extensible metadata (API endpoints, region, etc.) |
| created_at | timestamp | Creation time |
| updated_at | timestamp | Last update time |

#### Customer
Represents a tenant/customer deployed in a specific namespace within a cluster.

| Field | Type | Description |
|-------|------|-------------|
| id | integer | Primary key |
| cluster_id | integer | FK to Cluster |
| namespace | string | K8s namespace (e.g., "customer-acme-prod") |
| name | string | Customer display name |
| description | text | Description |
| is_active | boolean | Whether customer is active |
| metadata | json | Extensible metadata |
| created_at | timestamp | Creation time |
| updated_at | timestamp | Last update time |

#### Release
Represents a deployment/release cycle.

| Field | Type | Description |
|-------|------|-------------|
| id | integer | Primary key |
| name | string | Release name |
| type | enum | `onboarding`, `release`, `hotfix` |
| status | enum | `draft`, `active`, `archived` |
| version_number | string | Version (e.g., "v2.5.0") for release type |
| release_date | timestamp | Target release date |
| description | text | Release notes/description |
| metadata | json | Additional properties |
| created_at | timestamp | Creation time |
| updated_at | timestamp | Last update time |

#### StepTemplate
Common step definition at release level.

| Field | Type | Description |
|-------|------|-------------|
| id | integer | Primary key |
| release_id | integer | FK to Release |
| name | string | Step name |
| category | enum | `deploy` or `verify` |
| type | enum | `bash`, `sql`, `text` |
| content | text | Step content (script, SQL, instructions) |
| order_index | integer | Execution order within category |
| description | text | Step description |
| created_at | timestamp | Creation time |

#### CustomerStep
Customer-specific step instance (actual execution unit).

| Field | Type | Description |
|-------|------|-------------|
| id | integer | Primary key |
| release_id | integer | FK to Release |
| customer_id | integer | FK to Customer |
| template_id | integer | FK to StepTemplate (nullable for custom steps) |
| name | string | Step name (copied or custom) |
| category | enum | `deploy` or `verify` |
| type | enum | `bash`, `sql`, `text` |
| content | text | Step content (may be overridden) |
| order_index | integer | Execution order |
| status | enum | `pending`, `done`, `skipped`, `reverted` |
| executed_at | timestamp | When step was executed |
| executed_by | string | Who executed (for future multi-user) |
| skip_reason | text | Reason if skipped |
| notes | text | Execution notes |
| is_custom | boolean | True if not from template |
| is_overridden | boolean | True if template content was changed |
| created_at | timestamp | Creation time |
| updated_at | timestamp | Last update time |

---

## 4. Feature Specifications

### 4.1 Cluster Management

| ID | Feature | Description |
|----|---------|-------------|
| FC-001 | Create Cluster | Add new K8s cluster with name, kubeconfig path (optional), description |
| FC-002 | Edit Cluster | Update cluster details |
| FC-003 | Delete Cluster | Soft delete cluster (only if no active customers) |
| FC-004 | List Clusters | View all clusters with customer count |
| FC-005 | View Cluster Detail | See cluster info and list of customers in it |
| FC-006 | Cluster Filter | Filter customers/releases by cluster |

### 4.2 Customer Management

| ID | Feature | Description |
|----|---------|-------------|
| FM-001 | Create Customer | Add customer with name, namespace, and assign to cluster |
| FM-002 | Edit Customer | Update customer details or move to different cluster |
| FM-003 | Delete Customer | Soft delete (archive) customer |
| FM-004 | List Customers | View all customers with cluster and namespace info |
| FM-005 | View Customer Detail | See customer info, cluster, namespace, and release history |
| FM-006 | Filter by Cluster | Show only customers in selected cluster(s) |

### 4.3 Release Management

| ID | Feature | Description |
|----|---------|-------------|
| FR-001 | Create Release | Create with type, name, description, version/date for release type |
| FR-002 | Release Lifecycle | Draft → Active → Archived workflow |
| FR-003 | Activate Release | Copies template steps to all active customers |
| FR-004 | Clone Release | Use existing release as template for new one |
| FR-005 | Archive Release | Archive completed/abandoned releases |
| FR-006 | View Release Dashboard | See progress across all customers and clusters |
| FR-007 | Filter Dashboard | Filter by cluster to focus on specific infrastructure |

### 4.4 Step Management (Template Layer)

| ID | Feature | Description |
|----|---------|-------------|
| FS-001 | Add Template Step | Add common step with category, type, content |
| FS-002 | Edit Template Step | Modify common step (affects pending customer steps only) |
| FS-003 | Reorder Steps | Drag-and-drop to reorder steps |
| FS-004 | Delete Template Step | Remove step with warning |
| FS-005 | Syntax Highlight | Display bash/SQL/text with appropriate highlighting |

### 4.5 Customer Step Customization

| ID | Feature | Description |
|----|---------|-------------|
| FCS-001 | View Inherited Steps | See template steps applied to customer |
| FCS-002 | Override Step Content | Modify step content for specific customer (even after release activation) |
| FCS-003 | Add Custom Step | Add step only for specific customer; option to "Add to template" (applies to all customers) |
| FCS-004 | Skip Step | Mark step as skipped with mandatory reason |
| FCS-005 | Revert Override | Reset to template content |
| FCS-006 | Remove Custom Step | Delete customer-specific step (not from template) |
| FCS-007 | Edit Template Steps | Edit template steps after activation (affects all customers with pending status) |
| FCS-008 | Mixed Step Ordering | Custom steps can be inserted between template steps; use decimal ordering |

**Add Custom Step Flow:**
1. User clicks "Add Custom Step" for a customer
2. Fill in step details (name, type, content, category)
3. Checkbox "Add to template" (unchecked by default):
   - **Unchecked**: Step is created only for this customer (is_custom=true)
   - **Checked**: Step is added to template AND all customers get this step immediately
4. Set order position (insert before/after existing steps)

### 4.6 Execution Tracking

| ID | Feature | Description |
|----|---------|-------------|
| FET-001 | Mark Done | Mark step as completed with optional notes |
| FET-002 | Mark Reverted | Revert a completed step |
| FET-003 | Skip Step | Skip with mandatory reason |
| FET-004 | Bulk Mark Done | Mark all deploy/verify steps done for customer |
| FET-005 | Progress Indicators | Show % complete per customer, per cluster, per category |

### 4.7 Dashboard & Views

| ID | Feature | Description |
|----|---------|-------------|
| FV-001 | Main Dashboard | Overview of active releases, recent activity |
| FV-002 | Release List | All releases with type badges and status |
| FV-003 | Release Matrix View | Grid: Steps × Customers with cluster grouping |
| FV-004 | Customer View | Steps list for specific customer |
| FV-005 | Step Cross-Customer View | Status of one step across all customers |
| FV-006 | Cluster View | All customers in a cluster with their release status |
| FV-007 | Step Detail Modal | Full content display with syntax highlight and copy |

---

## 5. UI/UX Design

### 5.1 Navigation Structure

```
┌─────────────────────────────────────────────────────────────────┐
│  🏠 Dashboard    🗂️ Clusters    👥 Customers    📦 Releases     │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Dashboard View

```
┌─────────────────────────────────────────────────────────────────┐
│  Dashboard                                          [+ Release] │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ Active Releases │  │ Clusters        │  │ Quick Stats     │  │
│  │ ━━━━━━━━━━━━━   │  │ ━━━━━━━━━━━━━   │  │ ━━━━━━━━━━━━━   │  │
│  │ • v2.5.0 (Rel)  │  │ • prod-us (3)   │  │ Pending: 47     │  │
│  │ • Hotfix-2024-1 │  │ • prod-eu (2)   │  │ Done: 128       │  │
│  │                 │  │ • staging (1)   │  │ Skipped: 5      │  │
│  │                 │  │                 │  │                 │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│                                                                  │
│  Recent Activity                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ • [v2.5.0] Customer A (prod-us) - Deploy Step 3 Done    │    │
│  │ • [v2.5.0] Customer B (prod-eu) - Verify Step 1 Skipped │    │
│  │ ...                                                     │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### 5.3 Clusters List View

```
┌─────────────────────────────────────────────────────────────────┐
│  Clusters                                           [+ Cluster] │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 🟢 prod-us                                    [Edit][🗑️] │    │
│  │    Path: ~/.kube/prod-us-config                         │    │
│  │    Region: us-east-1 | 3 Customers                      │    │
│  │    Customers: customer-a, customer-b, customer-c        │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 🟢 prod-eu                                    [Edit][🗑️] │    │
│  │    Path: ~/.kube/prod-eu-config                         │    │
│  │    Region: eu-west-1 | 2 Customers                      │    │
│  │    Customers: customer-d, customer-e                    │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 🟡 staging                                    [Edit][🗑️] │    │
│  │    Path: ~/.kube/staging-config                         │    │
│  │    Region: internal | 1 Customer                        │    │
│  │    Customers: demo-customer                             │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.4 Customers List View

```
┌─────────────────────────────────────────────────────────────────┐
│  Customers                      [Filter: All Clusters ▼] [+ Add]│
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  📁 prod-us (3 customers)                                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ customer-a       namespace: cust-a-prod       [Edit]   │    │
│  │ customer-b       namespace: cust-b-prod       [Edit]   │    │
│  │ customer-c       namespace: cust-c-prod       [Edit]   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  📁 prod-eu (2 customers)                                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ customer-d       namespace: cust-d-prod       [Edit]   │    │
│  │ customer-e       namespace: cust-e-prod       [Edit]   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.5 Release Matrix View (Cluster-Aware)

```
┌─────────────────────────────────────────────────────────────────┐
│  Release: v2.5.0 (Regular Release)                              │
│  Type: release | Status: Active | Date: 2024-01-15              │
│  [Deploy Tab] [Verify Tab]                          [Settings] │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Filter: [All Clusters ▼] [All Status ▼]          [Expand All] │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│  📁 prod-us                                                      │
│  ─────────────────────────────────────────────────────────────  │
│  ┌──────────┬─────────────────┬─────────────────┬────────────┐  │
│  │ Step     │ customer-a      │ customer-b      │ customer-c │  │
│  │          │ (cust-a-prod)   │ (cust-b-prod)   │ (cust-c..) │  │
│  ├──────────┼─────────────────┼─────────────────┼────────────┤  │
│  │ 1. Deploy│ ✅ Done         │ ✅ Done         │ 🔄 Pending │  │
│  │ 2. SQL ⭐ │ ✅ Done         │ ⚠️ Overridden   │ 🔄 Pending │  │
│  │ 3. Config│ ⏸️ Skipped      │ 🔄 Pending      │ 🔄 Pending │  │
│  └──────────┴─────────────────┴─────────────────┴────────────┘  │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│  📁 prod-eu                                                      │
│  ─────────────────────────────────────────────────────────────  │
│  ┌──────────┬─────────────────┬─────────────────┐               │
│  │ Step     │ customer-d      │ customer-e      │               │
│  │          │ (cust-d-prod)   │ (cust-e-prod)   │               │
│  ├──────────┼─────────────────┼─────────────────┤               │
│  │ 1. Deploy│ ✅ Done         │ 🔄 Pending      │               │
│  │ 2. SQL   │ 🔄 Pending      │ 🔄 Pending      │               │
│  │ 3. Config│ 🔄 Pending      │ ⏸️ Skipped      │               │
│  └──────────┴─────────────────┴─────────────────┘               │
│                                                                  │
│  Legend: ✅ Done | 🔄 Pending | ⏸️ Skipped | ⚠️ Custom/Overridden │
└─────────────────────────────────────────────────────────────────┘
```

### 5.6 Customer Step Detail View

```
┌─────────────────────────────────────────────────────────────────┐
│  Customer: customer-a                                            │
│  Cluster: prod-us | Namespace: cust-a-prod                       │
│  Release: v2.5.0                                      [Back]    │
├─────────────────────────────────────────────────────────────────┤
│  Deploy Steps (2/3 done)                            [Mark All] │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ ✅ 1. Deploy via Jenkins                        (Done) │    │
│  │    Completed: 2024-01-15 10:30                         │    │
│  │    [View Content] [Revert]                             │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │ ✅ 2. Run Migration SQL ⭐ CUSTOM                (Done) │    │
│  │    Overridden from template                            │    │
│  │    Completed: 2024-01-15 10:45                         │    │
│  │    [View Content] [Revert] [Reset to Template]         │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │ 🔄 3. Update ConfigMap                           (Pending)│   │
│  │    [View Content] [Mark Done] [Skip] [Edit]            │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Verify Steps (0/2 done)                            [Mark All] │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 🔄 1. Health Check API                         (Pending)│   │
│  │    [View Content] [Mark Done] [Skip]                   │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### 5.7 Step Detail Side Panel

The side panel opens when clicking a step cell in the matrix view, showing customer-specific content and actions.

**Side Panel Layout:**
```
┌──────────────────────────────────────────────────────────────────────────┐
│  Release: v2.5.0                                              [X] Close │
│  Step: Run Migration SQL                                                 │
├──────────────────────────────────────────────────────────────────────────┤
│  Customer: customer-a (prod-us/cust-a-prod)                              │
│  Category: Deploy | Type: SQL | Status: 🔄 Pending                       │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  SOURCE INFO:                                                            │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ 📋 From Template        [Override Content] [Reset to Template] │    │
│  │ ⭐ Custom Step          [Edit] [Delete]                        │    │
│  │ ⚠️ Overridden           [View Original] [Reset to Template]    │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  CONTENT:                                                                │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ 1  │ -- Custom migration for customer-a                         │    │
│  │ 2  │ ALTER TABLE users ADD COLUMN custom_field VARCHAR(100);    │    │
│  │ 3  │ UPDATE users SET custom_field = 'value' WHERE id > 100;    │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│  [📋 Copy] [⬇️ Download]                                                 │
│                                                                          │
│  EXECUTION:                                                              │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ Notes:                                                          │    │
│  │ ┌─────────────────────────────────────────────────────────┐     │    │
│  │ │ [Enter execution notes...                             ] │     │    │
│  │ └─────────────────────────────────────────────────────────┘     │    │
│  │                                                                  │    │
│  │ [Mark as Done]  [Skip]  [Revert]                                │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  HISTORY:                                                                │
│  • 2024-01-15 10:30 - Created from template                              │
│  • 2024-01-15 10:35 - Content overridden                                 │
│  • 2024-01-15 10:45 - Marked as Done                                     │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Actions by Source Type:**
| Source | Available Actions |
|--------|-------------------|
| Template (not overridden) | View, Copy, Mark Done, Skip, Override Content |
| Overridden | View Custom, View Original, Reset to Template, Mark Done, Skip |
| Custom Step | Edit, Delete, Mark Done, Skip |

### 5.8 Add Custom Step Dialog

```
┌─────────────────────────────────────────────────────────────────┐
│  Add Custom Step for customer-a                       [X]       │
├─────────────────────────────────────────────────────────────────┤
│  Step Name:                                                     │
│  [                                                    ]         │
│                                                                  │
│  Category: [Deploy ▼]  Type: [Bash ▼]                           │
│                                                                  │
│  Content:                                                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                                                         │    │
│  │                                                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Insert Position: [Before "Deploy App" ▼]                       │
│                                                                  │
│  ☐ Add to template (apply to all customers)                    │
│                                                                  │
│              [Cancel]  [Add Step]                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. Business Rules

### 6.1 Cluster Rules
- **BR-C01**: Cluster cannot be deleted if it has active customers
- **BR-C02**: Cluster name must be unique
- **BR-C03**: When viewing releases, customers are grouped by cluster for clarity

### 6.2 Customer Rules
- **BR-M01**: Customer namespace + cluster combination must be unique
- **BR-M02**: Customer can be moved between clusters (with warning about context change)
- **BR-M03**: Soft delete only; maintain history for audit

### 6.3 Release Rules
- **BR-R01**: When release is activated, steps are created for ALL active customers across ALL clusters
- **BR-R02**: Editing template step only affects customers where step is `pending`
- **BR-R03**: Once step is marked `done`, content is locked (prevent accidental changes)
- **BR-R04**: Reverting a step sets status to `reverted` but preserves history

### 6.4 Step Rules
- **BR-S01**: Custom steps (is_custom=true) don't affect other customers or template (unless "Add to template" is checked)
- **BR-S02**: Override (is_overridden=true) preserves link to template for reference
- **BR-S03**: Skipping requires mandatory reason
- **BR-S04**: Order index is per category (deploy/verify have separate ordering)
- **BR-S05**: Template steps use integer orderIndex (0, 1, 2...); custom steps use decimals (0.5, 1.5...) to insert between
- **BR-S06**: When "Add to template" is checked during custom step creation:
  - Step is added to step_templates table
  - All active customers get this step immediately (for active releases)
  - New customers will inherit this step automatically
- **BR-S07**: Editing template steps after activation only affects customers where step is `pending` and not `overridden`
- **BR-S08**: Customer-specific overrides persist even when template is edited

---

## 7. Workflow Scenarios

### 7.1 New Customer Onboarding

```
1. Create new Cluster (if new infrastructure)
   └─→ Enter name, kubeconfig path, description

2. Create new Customer in Cluster
   └─→ Select cluster
   └─→ Enter namespace, name, description

3. Create "onboarding" type Release
   └─→ Enter release name, type=onboarding
   └─→ Add template steps (common for all customers)

4. Activate Release
   └─→ System creates CustomerStep for new customer
   └─→ Customize steps if needed for this customer

5. Execute steps and track progress
```

### 7.2 Regular Release Deployment

```
1. Create "release" type Release
   └─→ Enter version number (e.g., v2.5.0)
   └─→ Set target release date
   └─→ Add deploy steps and verify steps

2. Activate Release
   └─→ Steps copied to all customers across all clusters

3. Execute per cluster or per customer
   └─→ Use cluster filter to focus on one cluster
   └─→ Mark steps done as completed
   └─→ Override content if customer-specific changes needed
   └─→ Add custom steps if needed

4. Monitor progress via matrix view
   └─→ Check all customers have completed all steps

5. Archive release when done
```

### 7.3 Hotfix Deployment

```
1. Create "hotfix" type Release
   └─→ Enter hotfix name/description
   └─→ May target specific customers only (via custom steps)

2. Add minimal steps for the fix

3. Activate and deploy

4. Verify and archive
```

---

## 8. Data Display Requirements

### 8.1 Cluster Information Display
Everywhere a customer is shown, the following should be visible:
- Cluster name
- Namespace

### 8.2 Progress Calculation
- **Per Customer**: (done_steps / total_steps) × 100
- **Per Cluster**: Average of all customers in cluster
- **Overall**: Average of all customers across all clusters
- **By Category**: Separate progress for deploy vs verify

### 8.3 Filtering & Sorting
- Filter customers by cluster
- Filter matrix view by cluster
- Sort customers by name, cluster, or progress

---

## 9. Future Extensibility

| Feature | Description | Current Preparation |
|---------|-------------|---------------------|
| Auto-execution | Execute bash/SQL via K8s agents | kubeconfig_path in Cluster, step type field |
| Multi-user | Authentication & authorization | executed_by field in CustomerStep |
| Audit log | Full change history | Template references, timestamps, override tracking |
| Batch operations | Execute on multiple clusters | Cluster grouping in UI |
| Integration APIs | Jenkins webhook, Rancher API | Metadata JSON fields for API endpoints |
| Scheduling | Schedule releases for specific time | release_date field |
| Notifications | Alert on step completion/failure | Status tracking infrastructure |
