import fs from 'fs';
import path from 'path';
import { pool } from './pool.js';

export async function runMigrations() {
  console.log('--- Starting Database Migration ---');
  const client = await pool.connect();

  try {
    const migrationFile = path.resolve(process.cwd(), 'migrations', '001_init_schema.sql');
    if (!fs.existsSync(migrationFile)) {
      throw new Error(`Migration file not found at ${migrationFile}`);
    }

    const sql = fs.readFileSync(migrationFile, 'utf8');

    console.log('Applying 001_init_schema.sql...');
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Migration executed successfully.');

    // Verification
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    const extensionsRes = await client.query(`
      SELECT extname FROM pg_extension WHERE extname = 'pg_trgm';
    `);

    console.log('\n--- Migration Verification ---');
    console.log(`Extensions enabled: ${extensionsRes.rows.map(r => r.extname).join(', ') || 'None'}`);
    console.log(`Tables created (${tablesRes.rows.length}):`);
    tablesRes.rows.forEach(r => console.log(`  - ${r.table_name}`));

    return tablesRes.rows.map(r => r.table_name);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Auto-run if executed directly
if (process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
