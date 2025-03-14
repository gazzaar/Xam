const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config();
const dbUser = process.env.DB_USER;
const dbPass = process.env.DB_PASS;
console.log(dbUser, dbPass);

const SQL = `
-- Create students table
CREATE TABLE IF NOT EXISTS students (
  student_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  student_first_name VARCHAR(255) NOT NULL,
  student_last_name VARCHAR(255) NOT NULL,
  student_degree VARCHAR(255),
  student_grade VARCHAR(255),
  student_email VARCHAR(255) NOT NULL UNIQUE,
  student_password VARCHAR(255) NOT NULL
);

-- Create instructors table
CREATE TABLE IF NOT EXISTS instructors (
  instructor_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  instructor_first_name VARCHAR(255) NOT NULL,
  instructor_last_name VARCHAR(255) NOT NULL,
  instructor_subject VARCHAR(255),
  instructor_email VARCHAR(255) NOT NULL UNIQUE,
  instructor_password VARCHAR(255) NOT NULL
);

-- Create exam_type ENUM
CREATE TYPE exam_type AS ENUM ('MCQ', 'True/False', 'Text');

-- Create exams table
CREATE TABLE IF NOT EXISTS exams (
  exam_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  exam_duration INTEGER NOT NULL,
  pass_mark INTEGER NOT NULL,
  exam_type exam_type NOT NULL
);

-- Create difficulty_level ENUM
CREATE TYPE difficulty_level AS ENUM ('easy', 'medium', 'hard');

-- Create questions table (fixed GENERATED AS IDENTITY syntax)
CREATE TABLE IF NOT EXISTS questions (
  question_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  question_duration INTEGER NOT NULL,
  question_difficulty difficulty_level NOT NULL
);

-- Create admin table (added a minimal column for now)
CREATE TABLE IF NOT EXISTS admin (
  admin_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  admin_email VARCHAR(255) NOT NULL UNIQUE
);

INSERT INTO students (student_first_name, student_last_name,student_email,student_password)
VALUES
  ('manga','abdullah','abdullah@elhelw.com','Pa$$w0rd'),
  ('amr','walid','amr@gmail.com','123454332'),
  ('fathy','sameh','gazzar@mail.com','1234569');

INSERT INTO instructors(instructor_first_name, instructor_last_name,instructor_email,instructor_password)
VALUES
  ('bahlol','mohammed','bahlol@mail.com','Pa$$w0rd'),
  ('abdelsalam','mohammed','abdelsalam@gmail.com','123454332'),
  ('gaballah','something','gaballah@mail.com','1234569');

`;

async function main() {
  console.log('seeding...');
  const client = new Client({
    connectionString: `postgresql://${dbUser}:${dbPass}@localhost:5432/test_nova`,
  });
  try {
    await client.connect();
    await client.query(SQL);
    console.log('done');
  } catch (err) {
    console.error('Error executing query:', err.stack);
  } finally {
    await client.end();
  }
}

main();
