import { drizzle } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzleLibSQL } from 'drizzle-orm/libsql';
import Database from 'better-sqlite3';
import { createClient } from '@libsql/client';
import * as schema from './schema';

// Database configuration type
export type DatabaseConfig = {
  type: 'sqlite' | 'turso';
  // SQLite options
  sqlitePath?: string;
  // Turso options
  tursoUrl?: string;
  tursoToken?: string;
};

// Get database configuration from environment
export function getDatabaseConfig(): DatabaseConfig {
  const dbType = process.env.DB_TYPE || 'sqlite';
  
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
  return {
    type: 'sqlite',
    sqlitePath: process.env.DATABASE_URL?.replace('file:', '') || './data/app.db',
  };
}

// Create database client based on configuration
export function createDatabaseClient(config: DatabaseConfig = getDatabaseConfig()) {
  if (config.type === 'turso') {
    const client = createClient({
      url: config.tursoUrl!,
      authToken: config.tursoToken,
    });
    
    return drizzleLibSQL(client, { schema });
  }
  
  // SQLite (default)
  const sqlite = new Database(config.sqlitePath);
  return drizzle(sqlite, { schema });
}

// Export the database instance
let dbInstance: ReturnType<typeof createDatabaseClient> | null = null;

export function getDatabase() {
  if (!dbInstance) {
    dbInstance = createDatabaseClient();
  }
  return dbInstance;
}

// For use in server actions and API routes
export const db = getDatabase();
