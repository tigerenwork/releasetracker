import { drizzle } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzleLibSQL } from 'drizzle-orm/libsql';
import Database from 'better-sqlite3';
import { createClient } from '@libsql/client';
import * as schema from './schema';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// Database configuration type
export type DatabaseType = 'sqlite' | 'turso';

export type DatabaseConfig = {
  type: DatabaseType;
  // SQLite options
  sqlitePath?: string;
  // Turso options
  tursoUrl?: string;
  tursoToken?: string;
};

// Get database configuration from environment
export function getDatabaseConfig(): DatabaseConfig {
  const dbType = (process.env.DB_TYPE as DatabaseType) || 'sqlite';
  
  if (dbType === 'turso') {
    const tursoUrl = process.env.TURSO_URL;
    const tursoToken = process.env.TURSO_TOKEN;
    
    if (!tursoUrl) {
      throw new Error('TURSO_URL environment variable is required when DB_TYPE=turso');
    }
    
    return {
      type: 'turso',
      tursoUrl,
      tursoToken,
    };
  }
  
  // Default to SQLite
  const dataDir = join(process.cwd(), 'data');
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  
  return {
    type: 'sqlite',
    sqlitePath: process.env.DATABASE_URL?.replace('file:', '') || join(dataDir, 'app.db'),
  };
}

// Create database client based on configuration
function createDatabaseClient(config: DatabaseConfig = getDatabaseConfig()) {
  if (config.type === 'turso') {
    const client = createClient({
      url: config.tursoUrl!,
      authToken: config.tursoToken,
    });
    
    return {
      type: 'turso' as const,
      client,
      db: drizzleLibSQL(client, { schema }),
    };
  }
  
  // SQLite (default)
  const sqlite = new Database(config.sqlitePath!);
  sqlite.pragma('journal_mode = WAL');
  
  return {
    type: 'sqlite' as const,
    client: sqlite,
    db: drizzle(sqlite, { schema }),
  };
}

// Database instance
let dbInstance: ReturnType<typeof createDatabaseClient> | null = null;

export function getDatabase() {
  if (!dbInstance) {
    dbInstance = createDatabaseClient();
  }
  return dbInstance.db;
}

export function getDatabaseType(): DatabaseType {
  if (!dbInstance) {
    dbInstance = createDatabaseClient();
  }
  return dbInstance.type;
}

// Export the database instance for use in server actions
export const db = getDatabase();

// SQL for table creation (compatible with both SQLite and Turso)
const CREATE_TABLES_SQL = `
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
`;

// Initialize database with migrations
export async function initDb() {
  const instance = dbInstance || createDatabaseClient();
  
  if (instance.type === 'turso') {
    // Execute SQL for Turso
    const statements = CREATE_TABLES_SQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    
    for (const sql of statements) {
      try {
        await instance.client.execute(sql + ';');
      } catch (error) {
        // Ignore "already exists" errors
        if (!(error instanceof Error && error.message.includes('already exists'))) {
          console.error('Migration error:', error);
        }
      }
    }
  } else {
    // Execute SQL for SQLite
    instance.client.exec(CREATE_TABLES_SQL);
  }
}
