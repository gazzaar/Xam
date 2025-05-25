const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

const dbUser = process.env.DB_USER;
const dbPass = process.env.DB_PASS;

const pool = new Pool({
  connectionString: `postgresql://${dbUser}:${dbPass}@localhost:5432/xam`,
});

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log(
      'Starting migration: Adding is_active column to users table...'
    );

    // Begin transaction
    await client.query('BEGIN');

    // Check if is_active column exists
    const checkColumn = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'is_active'
    `);

    if (checkColumn.rows.length === 0) {
      console.log('Adding is_active column to users table...');
      await client.query(`
        ALTER TABLE users
        ADD COLUMN is_active BOOLEAN DEFAULT true
      `);
    }

    // Commit transaction
    await client.query('COMMIT');
    console.log('Migration completed successfully!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
