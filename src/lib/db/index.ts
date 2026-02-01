import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// Ensure data directory exists
const dataDir = join(process.cwd(), 'data');
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.DATABASE_URL?.replace('file:', '') || join(dataDir, 'app.db');

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');

export const db = drizzle(sqlite, { schema });

// Initialize database with migrations
export async function initDb() {
  // Create tables if they don't exist
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS clusters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      kubeconfig_path TEXT,
      description TEXT,
      is_active INTEGER DEFAULT 1,
      metadata TEXT,
      created_at INTEGER DEFAULT (unixepoch() * 1000),
      updated_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cluster_id INTEGER NOT NULL,
      namespace TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      is_active INTEGER DEFAULT 1,
      metadata TEXT,
      created_at INTEGER DEFAULT (unixepoch() * 1000),
      updated_at INTEGER DEFAULT (unixepoch() * 1000),
      FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE RESTRICT,
      UNIQUE(cluster_id, namespace)
    );

    CREATE TABLE IF NOT EXISTS releases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('onboarding', 'release', 'hotfix')),
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'archived')),
      version_number TEXT,
      release_date INTEGER,
      description TEXT,
      metadata TEXT,
      created_at INTEGER DEFAULT (unixepoch() * 1000),
      updated_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS step_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      release_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('deploy', 'verify')),
      type TEXT NOT NULL CHECK(type IN ('bash', 'sql', 'text')),
      content TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      description TEXT,
      created_at INTEGER DEFAULT (unixepoch() * 1000),
      FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE,
      UNIQUE(release_id, category, order_index)
    );

    CREATE TABLE IF NOT EXISTS customer_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      release_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      template_id INTEGER,
      name TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('deploy', 'verify')),
      type TEXT NOT NULL CHECK(type IN ('bash', 'sql', 'text')),
      content TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'done', 'skipped', 'reverted')),
      executed_at INTEGER,
      executed_by TEXT,
      skip_reason TEXT,
      notes TEXT,
      is_custom INTEGER DEFAULT 0,
      is_overridden INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch() * 1000),
      updated_at INTEGER DEFAULT (unixepoch() * 1000),
      FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
      FOREIGN KEY (template_id) REFERENCES step_templates(id) ON DELETE SET NULL,
      UNIQUE(release_id, customer_id, template_id)
    );

    CREATE INDEX IF NOT EXISTS idx_customers_cluster ON customers(cluster_id);
    CREATE INDEX IF NOT EXISTS idx_customer_steps_release ON customer_steps(release_id);
    CREATE INDEX IF NOT EXISTS idx_customer_steps_customer ON customer_steps(customer_id);
    CREATE INDEX IF NOT EXISTS idx_step_templates_release ON step_templates(release_id);
  `);
}
