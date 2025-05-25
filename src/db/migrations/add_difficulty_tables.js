const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

// Create a new pool using the connection string from environment variables
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Starting migration: Adding difficulty column and tables...');
    
    // Begin transaction
    await client.query('BEGIN');

    // Add difficulty column to questions table if it doesn't exist
    const checkDifficultyColumn = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'questions' AND column_name = 'difficulty'
    `);
    
    if (checkDifficultyColumn.rows.length === 0) {
      console.log('Adding difficulty column to questions table...');
      await client.query(`
        ALTER TABLE questions 
        ADD COLUMN difficulty VARCHAR(20) DEFAULT 'medium'
      `);
    }

    // Create exam_difficulty_distribution table if it doesn't exist
    const checkDifficultyTable = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name = 'exam_difficulty_distribution'
    `);
    
    if (checkDifficultyTable.rows.length === 0) {
      console.log('Creating exam_difficulty_distribution table...');
      await client.query(`
        CREATE TABLE exam_difficulty_distribution (
          id SERIAL PRIMARY KEY,
          exam_id INTEGER REFERENCES exams(exam_id) ON DELETE CASCADE,
          easy_percentage INTEGER DEFAULT 30,
          medium_percentage INTEGER DEFAULT 50,
          hard_percentage INTEGER DEFAULT 20,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    }

    // Add subject_id and question_bank_id columns to exams table if they don't exist
    const checkSubjectColumn = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'exams' AND column_name = 'subject_id'
    `);
    
    if (checkSubjectColumn.rows.length === 0) {
      console.log('Adding subject_id column to exams table...');
      await client.query(`
        ALTER TABLE exams 
        ADD COLUMN subject_id INTEGER REFERENCES subjects(subject_id)
      `);
    }

    const checkBankColumn = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'exams' AND column_name = 'question_bank_id'
    `);
    
    if (checkBankColumn.rows.length === 0) {
      console.log('Adding question_bank_id column to exams table...');
      await client.query(`
        ALTER TABLE exams 
        ADD COLUMN question_bank_id INTEGER REFERENCES question_banks(question_bank_id)
      `);
    }

    const checkTotalQuestionsColumn = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'exams' AND column_name = 'total_questions'
    `);
    
    if (checkTotalQuestionsColumn.rows.length === 0) {
      console.log('Adding total_questions column to exams table...');
      await client.query(`
        ALTER TABLE exams 
        ADD COLUMN total_questions INTEGER DEFAULT 20
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
