-- Migration: Add config_map_edits table (last-edit persistence for ConfigMap edits)
-- Date: 2026-07-30
-- See docs/TSD-POD-CONFIG-EDIT.md §7.4

-- Persists only the most recent edit per ConfigMap (upsert on the unique key);
-- a full append-only audit trail is a future phase.
CREATE TABLE IF NOT EXISTS config_map_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kube_context TEXT NOT NULL, -- cluster name
  namespace TEXT NOT NULL,
  config_map_name TEXT NOT NULL,
  deployment_name TEXT,
  patch TEXT NOT NULL, -- JSON: { set: { key: value }, delete: [key] }
  rollout_restart INTEGER NOT NULL DEFAULT 0,
  edited_at INTEGER NOT NULL,
  UNIQUE(kube_context, namespace, config_map_name)
);
