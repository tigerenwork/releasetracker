import { defineConfig } from 'drizzle-kit';

const dbType = process.env.DB_TYPE || 'sqlite';

// Configuration based on database type
const config = dbType === 'turso' 
  ? {
      schema: './src/lib/db/schema.ts',
      out: './src/lib/db/migrations',
      dialect: 'turso' as const,
      dbCredentials: {
        url: process.env.TURSO_URL || '',
        authToken: process.env.TURSO_TOKEN,
      },
    }
  : {
      schema: './src/lib/db/schema.ts',
      out: './src/lib/db/migrations',
      dialect: 'sqlite' as const,
      dbCredentials: {
        url: process.env.DATABASE_URL || 'file:./data/app.db',
      },
    };

export default defineConfig(config);
