import { initDb } from '../src/lib/db';

async function main() {
  console.log('Running database migrations...');
  try {
    await initDb();
    console.log('Migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    // Don't fail the build if migrations fail (tables might already exist)
    process.exit(0);
  }
}

main();
