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
    website_url TEXT,
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
    type TEXT NOT NULL CHECK(type IN ('bash', 'sql', 'rest', 'script', 'text', 'jenkins')),
    content TEXT NOT NULL,
    order_index INTEGER NOT NULL,
    description TEXT,
    execution_config TEXT,
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
    type TEXT NOT NULL CHECK(type IN ('bash', 'sql', 'rest', 'script', 'text', 'jenkins')),
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

  CREATE TABLE IF NOT EXISTS release_customers (
    release_id INTEGER NOT NULL,
    customer_id INTEGER NOT NULL,
    enrolled_at INTEGER DEFAULT (unixepoch() * 1000),
    PRIMARY KEY (release_id, customer_id),
    FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_release_customers_release ON release_customers(release_id);

  CREATE TABLE IF NOT EXISTS customer_execution_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    sql_config TEXT,
    rest_config TEXT,
    script_config TEXT,
    jenkins_config TEXT,
    is_active INTEGER DEFAULT 1,
    created_at INTEGER DEFAULT (unixepoch() * 1000),
    updated_at INTEGER DEFAULT (unixepoch() * 1000),
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    UNIQUE(customer_id)
  );

  CREATE TABLE IF NOT EXISTS step_executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    step_id INTEGER NOT NULL,
    customer_id INTEGER NOT NULL,
    release_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('sql', 'rest', 'script', 'jenkins')),
    status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'cancelled', 'timeout')),
    request TEXT NOT NULL,
    exit_code INTEGER,
    stdout TEXT,
    stderr TEXT,
    sql_result TEXT,
    rest_result TEXT,
    script_result TEXT,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    duration INTEGER,
    created_at INTEGER DEFAULT (unixepoch() * 1000),
    FOREIGN KEY (step_id) REFERENCES customer_steps(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (release_id) REFERENCES releases(id)
  );

  CREATE INDEX IF NOT EXISTS step_executions_step_idx ON step_executions(step_id);
  CREATE INDEX IF NOT EXISTS step_executions_status_idx ON step_executions(status);
  CREATE INDEX IF NOT EXISTS step_executions_created_idx ON step_executions(created_at);

  CREATE TABLE IF NOT EXISTS jenkins_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    base_url TEXT NOT NULL,
    username TEXT,
    api_token TEXT,
    created_at INTEGER DEFAULT (unixepoch() * 1000),
    updated_at INTEGER DEFAULT (unixepoch() * 1000)
  );
`;

// Backfill SQL: populate release_customers from existing customer_steps for already-active releases
const BACKFILL_SQL = `
  INSERT OR IGNORE INTO release_customers (release_id, customer_id, enrolled_at)
  SELECT DISTINCT cs.release_id, cs.customer_id, MIN(cs.created_at)
  FROM customer_steps cs
  WHERE cs.is_custom = 0
  GROUP BY cs.release_id, cs.customer_id;
`;

// New DDL used when rebuilding tables whose CHECK constraints predate
// newer step/execution types (SQLite cannot alter CHECK constraints)
const STEP_TEMPLATES_DDL = `
  CREATE TABLE step_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    release_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('deploy', 'verify')),
    type TEXT NOT NULL CHECK(type IN ('bash', 'sql', 'rest', 'script', 'text', 'jenkins')),
    content TEXT NOT NULL,
    order_index INTEGER NOT NULL,
    description TEXT,
    execution_config TEXT,
    created_at INTEGER DEFAULT (unixepoch() * 1000),
    FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE,
    UNIQUE(release_id, category, order_index)
  );
`;

const CUSTOMER_STEPS_DDL = `
  CREATE TABLE customer_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    release_id INTEGER NOT NULL,
    customer_id INTEGER NOT NULL,
    template_id INTEGER,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('deploy', 'verify')),
    type TEXT NOT NULL CHECK(type IN ('bash', 'sql', 'rest', 'script', 'text', 'jenkins')),
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
`;

const STEP_EXECUTIONS_DDL = `
  CREATE TABLE step_executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    step_id INTEGER NOT NULL,
    customer_id INTEGER NOT NULL,
    release_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('sql', 'rest', 'script', 'jenkins')),
    status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'cancelled', 'timeout')),
    request TEXT NOT NULL,
    exit_code INTEGER,
    stdout TEXT,
    stderr TEXT,
    sql_result TEXT,
    rest_result TEXT,
    script_result TEXT,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    duration INTEGER,
    created_at INTEGER DEFAULT (unixepoch() * 1000),
    FOREIGN KEY (step_id) REFERENCES customer_steps(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (release_id) REFERENCES releases(id)
  );
`;

// Indexes on step_executions are dropped together with the old table during a
// rebuild, so they have to be recreated afterwards
const STEP_EXECUTIONS_INDEXES = [
  'CREATE INDEX IF NOT EXISTS step_executions_step_idx ON step_executions(step_id)',
  'CREATE INDEX IF NOT EXISTS step_executions_status_idx ON step_executions(status)',
  'CREATE INDEX IF NOT EXISTS step_executions_created_idx ON step_executions(created_at)',
];

// A column DEFAULT on execution_config (e.g. from `DEFAULT "execution_config"`)
// makes every pre-existing row read a non-JSON string and breaks JSON parsing
const BAD_EXECUTION_CONFIG_DEFAULT = /execution_config[^,)]*DEFAULT/i;
const TYPE_CHECK_RE = /CHECK\(type IN \(([^)]*)\)\)/i;

function typeCheckLacks(ddl: string, value: string) {
  const match = ddl.match(TYPE_CHECK_RE);
  return !!match && !match[1].includes(`'${value}'`);
}

const STEP_TEMPLATES_COLS =
  'id, release_id, name, category, type, content, order_index, description, execution_config, created_at';
const STEP_TEMPLATES_SELECT_COLS =
  "id, release_id, name, category, type, content, order_index, description, NULLIF(execution_config, 'execution_config'), created_at";
const CUSTOMER_STEPS_COLS =
  'id, release_id, customer_id, template_id, name, category, type, content, order_index, status, executed_at, executed_by, skip_reason, notes, is_custom, is_overridden, created_at, updated_at';
const STEP_EXECUTIONS_COLS =
  'id, step_id, customer_id, release_id, type, status, request, exit_code, stdout, stderr, sql_result, rest_result, script_result, started_at, completed_at, duration, created_at';

function rebuildPlanFor(table: string, ddl: string) {
  if (table === 'step_templates' && (typeCheckLacks(ddl, 'jenkins') || BAD_EXECUTION_CONFIG_DEFAULT.test(ddl))) {
    return { table, ddl: STEP_TEMPLATES_DDL, insertCols: STEP_TEMPLATES_COLS, selectCols: STEP_TEMPLATES_SELECT_COLS, after: [] as string[] };
  }
  if (table === 'customer_steps' && typeCheckLacks(ddl, 'jenkins')) {
    return { table, ddl: CUSTOMER_STEPS_DDL, insertCols: CUSTOMER_STEPS_COLS, selectCols: CUSTOMER_STEPS_COLS, after: [] as string[] };
  }
  // Rebuild when the CHECK predates 'jenkins', or when a previous table rebuild
  // left the FK to customer_steps pointing at the dropped _customer_steps_old
  if (table === 'step_executions' && (typeCheckLacks(ddl, 'jenkins') || ddl.includes('_customer_steps_old'))) {
    return { table, ddl: STEP_EXECUTIONS_DDL, insertCols: STEP_EXECUTIONS_COLS, selectCols: STEP_EXECUTIONS_COLS, after: STEP_EXECUTIONS_INDEXES };
  }
  return null;
}

const REBUILT_TABLES = ['step_templates', 'customer_steps', 'step_executions'];

// Migrate an existing SQLite database created with an older schema (idempotent)
function migrateSqlite(client: Database.Database) {
  // 1. Add step_templates.execution_config if missing
  const columns = client.prepare('PRAGMA table_info(step_templates)').all() as { name: string }[];
  if (!columns.some((c) => c.name === 'execution_config')) {
    client.exec('ALTER TABLE step_templates ADD COLUMN execution_config TEXT');
  }

  // 2. Clean up non-JSON values stored in the JSON column
  client.exec(`UPDATE step_templates SET execution_config = NULL WHERE execution_config = 'execution_config'`);

  // 3. Add customer_execution_configs.jenkins_config if missing
  const configColumns = client.prepare('PRAGMA table_info(customer_execution_configs)').all() as { name: string }[];
  if (!configColumns.some((c) => c.name === 'jenkins_config')) {
    client.exec('ALTER TABLE customer_execution_configs ADD COLUMN jenkins_config TEXT');
  }

  // 4. Add customers.website_url if missing
  const customerColumns = client.prepare('PRAGMA table_info(customers)').all() as { name: string }[];
  if (!customerColumns.some((c) => c.name === 'website_url')) {
    client.exec('ALTER TABLE customers ADD COLUMN website_url TEXT');
  }

  // 4. Rebuild tables with stale CHECK constraints or a bad column DEFAULT
  const ddlOf = (table: string) =>
    (client.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table) as { sql?: string } | undefined)?.sql || '';

  const rebuilds = REBUILT_TABLES.map((table) => rebuildPlanFor(table, ddlOf(table)))
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rebuilds.length > 0) {
    client.pragma('foreign_keys = OFF');
    try {
      for (const { table, ddl, insertCols, selectCols, after } of rebuilds) {
        client.transaction(() => {
          client.exec(`ALTER TABLE ${table} RENAME TO _${table}_old`);
          client.exec(ddl);
          client.exec(`INSERT INTO ${table} (${insertCols}) SELECT ${selectCols} FROM _${table}_old`);
          client.exec(`DROP TABLE _${table}_old`);
          for (const stmt of after) {
            client.exec(stmt);
          }
        })();
      }
    } finally {
      client.pragma('foreign_keys = ON');
    }
  }
}

// Same migration for Turso (libsql client), also idempotent
async function migrateTurso(client: ReturnType<typeof createClient>) {
  // 1. Add step_templates.execution_config if missing
  const columns = await client.execute('PRAGMA table_info(step_templates)');
  if (!columns.rows.some((c) => c.name === 'execution_config')) {
    await client.execute('ALTER TABLE step_templates ADD COLUMN execution_config TEXT');
  }

  // 2. Clean up non-JSON values stored in the JSON column
  await client.execute(`UPDATE step_templates SET execution_config = NULL WHERE execution_config = 'execution_config'`);

  // 3. Add customer_execution_configs.jenkins_config if missing
  const configColumns = await client.execute('PRAGMA table_info(customer_execution_configs)');
  if (!configColumns.rows.some((c) => c.name === 'jenkins_config')) {
    await client.execute('ALTER TABLE customer_execution_configs ADD COLUMN jenkins_config TEXT');
  }

  // 4. Add customers.website_url if missing
  const customerColumns = await client.execute('PRAGMA table_info(customers)');
  if (!customerColumns.rows.some((c) => c.name === 'website_url')) {
    await client.execute('ALTER TABLE customers ADD COLUMN website_url TEXT');
  }

  // 4. Rebuild tables with stale CHECK constraints or a bad column DEFAULT
  const ddlOf = async (table: string) => {
    const rs = await client.execute({ sql: 'SELECT sql FROM sqlite_master WHERE name = ?', args: [table] });
    return (rs.rows[0]?.sql as string | undefined) || '';
  };

  const rebuilds = (
    await Promise.all(REBUILT_TABLES.map(async (table) => rebuildPlanFor(table, await ddlOf(table))))
  ).filter((r): r is NonNullable<typeof r> => r !== null);

  for (const { table, ddl, insertCols, selectCols, after } of rebuilds) {
    await client.execute('PRAGMA foreign_keys = OFF');
    try {
      await client.batch(
        [
          `ALTER TABLE ${table} RENAME TO _${table}_old`,
          ddl,
          `INSERT INTO ${table} (${insertCols}) SELECT ${selectCols} FROM _${table}_old`,
          `DROP TABLE _${table}_old`,
          ...after,
        ],
        'write'
      );
    } finally {
      await client.execute('PRAGMA foreign_keys = ON');
    }
  }
}

// Initialize database with migrations
export async function initDb() {
  const instance = dbInstance || createDatabaseClient();
  
  if (instance.type === 'turso') {
    // Execute CREATE TABLE statements for Turso
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

    // Bring existing Turso databases up to the current schema
    await migrateTurso(instance.client);

    // Backfill release_customers from existing data
    try {
      await instance.client.execute(BACKFILL_SQL.trim());
    } catch (error) {
      console.error('Backfill error:', error);
    }
  } else {
    // Execute SQL for SQLite
    instance.client.exec(CREATE_TABLES_SQL);
    migrateSqlite(instance.client);
    instance.client.exec(BACKFILL_SQL);
  }
}
