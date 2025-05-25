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
    console.log('Starting migration: Adding content ownership columns...');

    // Begin transaction
    await client.query('BEGIN');

    // Add columns to question_banks table
    const checkQuestionBanksColumns = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'question_banks'
      AND column_name IN ('original_creator', 'current_owner')
    `);

    if (checkQuestionBanksColumns.rows.length < 2) {
      console.log('Adding ownership columns to question_banks table...');

      // First backup the created_by values
      await client.query(`
        ALTER TABLE question_banks
        ADD COLUMN IF NOT EXISTS original_creator INTEGER REFERENCES users(user_id),
        ADD COLUMN IF NOT EXISTS current_owner INTEGER REFERENCES users(user_id)
      `);

      // Copy existing created_by values to both new columns
      await client.query(`
        UPDATE question_banks
        SET original_creator = created_by,
            current_owner = created_by
        WHERE original_creator IS NULL
      `);
    }

    // Add columns to questions table
    const checkQuestionsColumns = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'questions'
      AND column_name IN ('original_creator', 'current_owner')
    `);

    if (checkQuestionsColumns.rows.length < 2) {
      console.log('Adding ownership columns to questions table...');

      // First backup the created_by values
      await client.query(`
        ALTER TABLE questions
        ADD COLUMN IF NOT EXISTS original_creator INTEGER REFERENCES users(user_id),
        ADD COLUMN IF NOT EXISTS current_owner INTEGER REFERENCES users(user_id)
      `);

      // Copy existing created_by values to both new columns
      await client.query(`
        UPDATE questions
        SET original_creator = created_by,
            current_owner = created_by
        WHERE original_creator IS NULL
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
