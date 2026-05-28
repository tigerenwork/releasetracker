-- Migration: Add execution configuration and history tables
-- Date: 2026-02-28

-- Add new step types to existing tables
-- Note: SQLite doesn't support ALTER TYPE, so we handle this in application code

-- Create customer execution configs table
CREATE TABLE IF NOT EXISTS customer_execution_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  sql_config TEXT, -- JSON: { namespace, podSelector, containerName?, sqlClient, connectionEnvVar }
  rest_config TEXT, -- JSON: { namespace, podSelector, containerName?, baseUrl? }
  script_config TEXT, -- JSON: { namespace, podSelector, containerName?, workingDir? }
  is_active INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- Create unique index on customer_id
CREATE UNIQUE INDEX IF NOT EXISTS unique_customer_execution_config 
  ON customer_execution_configs(customer_id);

-- Create step executions table for history
CREATE TABLE IF NOT EXISTS step_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  step_id INTEGER NOT NULL REFERENCES customer_steps(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  release_id INTEGER NOT NULL REFERENCES releases(id),
  type TEXT NOT NULL CHECK(type IN ('sql', 'rest', 'script')),
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'cancelled', 'timeout')),
  request TEXT NOT NULL, -- JSON of the execution request
  exit_code INTEGER,
  stdout TEXT,
  stderr TEXT,
  sql_result TEXT, -- JSON for SQL execution results
  rest_result TEXT, -- JSON for REST execution results
  script_result TEXT, -- JSON for script execution results
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  duration INTEGER,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- Create indexes for step executions
CREATE INDEX IF NOT EXISTS step_executions_step_idx ON step_executions(step_id);
CREATE INDEX IF NOT EXISTS step_executions_status_idx ON step_executions(status);
CREATE INDEX IF NOT EXISTS step_executions_created_idx ON step_executions(created_at);

-- Add execution_config column to step_templates if not exists
-- Note: This allows storing type-specific config at template level
