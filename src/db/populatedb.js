const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config();
const dbUser = process.env.DB_USER;
const dbPass = process.env.DB_PASS;

const SQL = `
-- Create role ENUM type
CREATE TYPE user_role AS ENUM ('instructor', 'admin');

-- Create question_type ENUM
CREATE TYPE question_type AS ENUM ('multiple-choice', 'true/false', 'short-answer', 'essay');

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  user_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  username VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role user_role NOT NULL,
  is_approved BOOLEAN DEFAULT false,
  email VARCHAR(255) NOT NULL UNIQUE,
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL
);

-- Create instructors table
CREATE TABLE IF NOT EXISTS instructors (
  instructor_id INTEGER PRIMARY KEY REFERENCES users(user_id),
  department VARCHAR(255)
);

-- Create admins table
CREATE TABLE IF NOT EXISTS admins (
  admin_id INTEGER PRIMARY KEY REFERENCES users(user_id)
);

-- Create exams table
CREATE TABLE IF NOT EXISTS exams (
  exam_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  exam_name VARCHAR(255) NOT NULL,
  description TEXT,
  start_date TIMESTAMP NOT NULL,
  end_date TIMESTAMP NOT NULL,
  duration INTEGER NOT NULL,
  instructor_id INTEGER REFERENCES instructors(instructor_id),
  access_code VARCHAR(10) UNIQUE,
  is_active BOOLEAN DEFAULT true
);

-- Create questions table
CREATE TABLE IF NOT EXISTS questions (
  question_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  exam_id INTEGER REFERENCES exams(exam_id),
  question_type question_type NOT NULL,
  question_text TEXT NOT NULL,
  score INTEGER NOT NULL,
  order_num INTEGER NOT NULL
);

-- Create options table
CREATE TABLE IF NOT EXISTS options (
  option_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  question_id INTEGER REFERENCES questions(question_id),
  option_text VARCHAR(255) NOT NULL,
  is_correct BOOLEAN NOT NULL
);

-- Create allowed_students table
CREATE TABLE IF NOT EXISTS allowed_students (
  allowed_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  exam_id INTEGER REFERENCES exams(exam_id),
  uni_id VARCHAR(255) NOT NULL,
  student_name VARCHAR(255),
  student_email VARCHAR(255),
  UNIQUE(exam_id, uni_id)
);

-- Create exam_attempts table
CREATE TABLE IF NOT EXISTS exam_attempts (
  attempt_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  exam_id INTEGER REFERENCES exams(exam_id),
  uni_id VARCHAR(255) NOT NULL,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP,
  score INTEGER,
  status VARCHAR(20) DEFAULT 'in_progress'
);

-- Create answers table
CREATE TABLE IF NOT EXISTS answers (
  answer_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  attempt_id INTEGER REFERENCES exam_attempts(attempt_id),
  question_id INTEGER REFERENCES questions(question_id),
  answer_text TEXT NOT NULL,
  is_correct BOOLEAN,
  score INTEGER
);

-- Insert sample admin user
INSERT INTO users (username, password, role, is_approved, email, first_name, last_name)
VALUES
  ('admin1', 'admin123', 'admin', true, 'admin@xam.edu', 'Admin', 'User')
RETURNING user_id;

-- Insert the admin record
INSERT INTO admins (admin_id)
SELECT user_id FROM users WHERE username = 'admin1';

-- Insert sample approved instructor
INSERT INTO users (username, password, role, is_approved, email, first_name, last_name)
VALUES
  ('instructor1', 'pass123', 'instructor', true, 'instructor1@xam.edu', 'John', 'Doe')
RETURNING user_id;

-- Insert the approved instructor record
INSERT INTO instructors (instructor_id, department)
SELECT user_id, 'Computer Science' FROM users WHERE username = 'instructor1';

-- Insert sample pending instructor
INSERT INTO users (username, password, role, is_approved, email, first_name, last_name)
VALUES
  ('instructor2', 'pass456', 'instructor', false, 'instructor2@xam.edu', 'Jane', 'Smith')
RETURNING user_id;

-- Insert the pending instructor record
INSERT INTO instructors (instructor_id, department)
SELECT user_id, 'Mathematics' FROM users WHERE username = 'instructor2';

-- Insert sample exam
INSERT INTO exams (exam_name, description, start_date, end_date, duration, instructor_id, access_code)
SELECT
  'Introduction to Programming Final',
  'Final exam for CS101 course covering basic programming concepts',
  NOW(),
  NOW() + INTERVAL '3 days',
  120,
  instructor_id,
  'CS101FINAL'
FROM instructors
WHERE instructor_id = (SELECT user_id FROM users WHERE username = 'instructor1')
RETURNING exam_id;

-- Insert sample questions
WITH exam AS (
  SELECT exam_id FROM exams WHERE access_code = 'CS101FINAL'
)
INSERT INTO questions (exam_id, question_type, question_text, score, order_num)
VALUES
  ((SELECT exam_id FROM exam), 'multiple-choice', 'What is a variable?', 10, 1),
  ((SELECT exam_id FROM exam), 'true/false', 'Python is a compiled language.', 5, 2),
  ((SELECT exam_id FROM exam), 'short-answer', 'Explain what a loop is.', 15, 3);

-- Insert options for multiple choice question
WITH question AS (
  SELECT question_id FROM questions
  WHERE question_text = 'What is a variable?'
  LIMIT 1
)
INSERT INTO options (question_id, option_text, is_correct)
VALUES
  ((SELECT question_id FROM question), 'A container for storing data', true),
  ((SELECT question_id FROM question), 'A type of loop', false),
  ((SELECT question_id FROM question), 'A mathematical operation', false),
  ((SELECT question_id FROM question), 'A function name', false);

-- Insert sample allowed students
WITH exam AS (
  SELECT exam_id FROM exams WHERE access_code = 'CS101FINAL'
)
INSERT INTO allowed_students (exam_id, uni_id)
VALUES
  ((SELECT exam_id FROM exam), 'STU001'),
  ((SELECT exam_id FROM exam), 'STU002'),
  ((SELECT exam_id FROM exam), 'STU003');
`;

async function main() {
  console.log('seeding...');
  const client = new Client({
    connectionString: `postgresql://${dbUser}:${dbPass}@localhost:5432/xam`,
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
