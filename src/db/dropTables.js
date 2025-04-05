const { Client } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

const dbUser = process.env.DB_USER;
const dbPass = process.env.DB_PASS;

const client = new Client({
  connectionString: `postgresql://${dbUser}:${dbPass}@localhost:5432/xam`,
});

async function dropTables() {
  try {
    await client.connect();

    // Start a transaction
    await client.query('BEGIN');

    console.log('Dropping tables in order...');

    // Drop tables in order of dependencies
    await client.query('DROP TABLE IF EXISTS answers CASCADE');
    console.log('Dropped answers table');

    await client.query('DROP TABLE IF EXISTS exam_attempts CASCADE');
    console.log('Dropped exam_attempts table');

    await client.query('DROP TABLE IF EXISTS allowed_students CASCADE');
    console.log('Dropped allowed_students table');

    await client.query('DROP TABLE IF EXISTS options CASCADE');
    console.log('Dropped options table');

    await client.query('DROP TABLE IF EXISTS questions CASCADE');
    console.log('Dropped questions table');

    await client.query('DROP TABLE IF EXISTS exams CASCADE');
    console.log('Dropped exams table');

    await client.query('DROP TABLE IF EXISTS instructors CASCADE');
    console.log('Dropped instructors table');

    await client.query('DROP TABLE IF EXISTS users CASCADE');
    console.log('Dropped users table');

    // Commit the transaction
    await client.query('COMMIT');
    console.log('All tables dropped successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error dropping tables:', error);
  } finally {
    await client.end();
  }
}

// Run the function
dropTables();
