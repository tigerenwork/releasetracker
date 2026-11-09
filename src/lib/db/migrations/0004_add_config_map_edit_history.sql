-- Migration: Add config_map_edit_history table (append-only audit trail)
-- Date: 2026-11-09
-- See docs/TSD-CONFIGMAP-HISTORY.md

CREATE TABLE IF NOT EXISTS config_map_edit_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kube_context TEXT NOT NULL,
  namespace TEXT NOT NULL,
  config_map_name TEXT NOT NULL,
  deployment_name TEXT,
  patch TEXT NOT NULL, -- JSON: { set: { key: value }, delete: [key] }
  rollout_restart INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL, -- 'pods-ui' | 'release-step' | 'auto-runner'
  release_id INTEGER,
  step_id INTEGER,
  edited_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_config_map_edit_history_lookup
  ON config_map_edit_history(kube_context, namespace, config_map_name, edited_at);

-- Seed history from any existing last-edit cache rows (once per ConfigMap)
INSERT INTO config_map_edit_history (
  kube_context, namespace, config_map_name, deployment_name,
  patch, rollout_restart, source, edited_at
)
SELECT
  e.kube_context, e.namespace, e.config_map_name, e.deployment_name,
  e.patch, e.rollout_restart, 'pods-ui', e.edited_at
FROM config_map_edits e
WHERE NOT EXISTS (
  SELECT 1 FROM config_map_edit_history h
  WHERE h.kube_context = e.kube_context
    AND h.namespace = e.namespace
    AND h.config_map_name = e.config_map_name
);
