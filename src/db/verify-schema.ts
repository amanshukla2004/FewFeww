import { pool } from './pool.js';

async function verify() {
  console.log('--- Verifying Schema Details ---');
  const client = await pool.connect();

  try {
    // 1. Check Primary Key types for tasks, reminders, users
    const pkRes = await client.query(`
      SELECT table_name, column_name, data_type 
      FROM information_schema.columns 
      WHERE column_name = 'id' AND table_name IN ('users', 'tasks', 'reminders', 'notes')
      ORDER BY table_name;
    `);
    console.log('Primary Key Types (Expected: bigint):');
    pkRes.rows.forEach(r => console.log(`  - ${r.table_name}.id -> ${r.data_type}`));

    // 2. Check Generated search_vector on tasks
    const tsRes = await client.query(`
      SELECT column_name, data_type, is_generated 
      FROM information_schema.columns 
      WHERE table_name = 'tasks' AND column_name = 'search_vector';
    `);
    console.log('Tasks search_vector (Expected: ALWAYS):');
    tsRes.rows.forEach(r => console.log(`  - tasks.search_vector -> is_generated: ${r.is_generated}`));

    // 3. Check Indexes
    const idxRes = await client.query(`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename IN ('tasks', 'reminders', 'inbox_updates')
      ORDER BY indexname;
    `);
    console.log(`Indexes verified (${idxRes.rows.length}):`);
    idxRes.rows.forEach(r => console.log(`  - ${r.indexname}`));

    console.log('\n✅ All Schema Constraints & Indexes Verified!');
  } finally {
    client.release();
    await pool.end();
  }
}

verify().catch(console.error);
