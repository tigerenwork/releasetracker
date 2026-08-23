-- Migration: Add customer_execution_configs.step_overrides (per-customer per-step
-- target overrides for automated execution) and widen customer_steps.status with
-- 'running' / 'failed'.
-- Date: 2026-08-23
--
-- NOTE: this file is documentary. The live, idempotent migration logic lives in
-- src/lib/db/index.ts (migrateSqlite / migrateTurso + the customer_steps table
-- rebuild path, since SQLite cannot alter CHECK constraints).

ALTER TABLE customer_execution_configs ADD COLUMN step_overrides TEXT;

-- customer_steps is rebuilt with:
--   status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'done', 'failed', 'skipped', 'reverted'))
