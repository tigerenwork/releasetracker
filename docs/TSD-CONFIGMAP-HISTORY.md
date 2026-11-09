# Technical Specification Document
## ConfigMap Edit History / Audit Trail

### Version: 1.0
### Date: 2026-11-09
### Status: Implemented
### Related: `docs/TSD-POD-CONFIG-EDIT.md` §7.4 / Q5 (future phase → this doc)

---

## 1. Overview

Extends ConfigMap last-edit persistence into an **append-only audit trail**. The existing `config_map_edits` table remains a last-edit cache for the “Last edited …” line; every successful apply also inserts into `config_map_edit_history`.

---

## 2. Data Model

### 2.1 `config_map_edit_history`

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | autoincrement |
| kube_context | TEXT | cluster name |
| namespace | TEXT | |
| config_map_name | TEXT | |
| deployment_name | TEXT nullable | |
| patch | TEXT JSON | `{ set: Record<string,string>, delete: string[] }` |
| rollout_restart | INTEGER bool | whether restart succeeded as part of this apply |
| source | TEXT | `pods-ui` \| `release-step` \| `auto-runner` |
| release_id | INTEGER nullable | set for release-step / auto-runner |
| step_id | INTEGER nullable | set for release-step / auto-runner |
| edited_at | INTEGER timestamp | |

Index: `(kube_context, namespace, config_map_name, edited_at)`

### 2.2 `config_map_edits` (unchanged role)

Still unique on `(kube_context, namespace, config_map_name)` and upserted on each record — fast last-edit read.

### 2.3 Backfill

On DB init, copy rows from `config_map_edits` into history when no history exists yet for that ConfigMap (source labeled `pods-ui`).

Migration file: `src/lib/db/migrations/0004_add_config_map_edit_history.sql`  
DDL also lives in `CREATE_TABLES_SQL` + `migrateSqlite` / `migrateTurso` in `src/lib/db/index.ts`.

---

## 3. Server Actions

`src/lib/actions/config-map-edits.ts`:

- `recordConfigMapEdit(input)` — **insert** history, then upsert last-edit cache. Accepts `source`, optional `releaseId` / `stepId`.
- `getLastConfigMapEdit(...)` — unchanged summary for the editor header.
- `getConfigMapEditHistory(..., limit?)` — newest-first list (default 50, max 200).

---

## 4. Write Paths

| Caller | `source` | Extra fields |
|--------|----------|--------------|
| `config-editor-dialog.tsx` | `pods-ui` | — |
| `configmap-executor.tsx` | `release-step` | `releaseId`, `stepId` |
| `auto-runner.ts` `runConfigMap` | `auto-runner` | `releaseId`, `stepId` |

Persistence remains best-effort / non-blocking after a successful cluster apply.

---

## 5. UI

`src/components/pods/config-map-history-panel.tsx` — collapsible panel embedded in the Config editor after the last-edit line. Lazy-loads on open; refreshes after a successful save via `refreshKey`.

---

## 6. Out of Scope

- Re-apply / rollback of a history patch
- Actor attribution
- External (non-RT) cluster edits
- Value redaction / secrets
