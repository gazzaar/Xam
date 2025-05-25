const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config();
const dbUser = process.env.DB_USER;
const dbPass = process.env.DB_PASS;

const SQL = `
-- Create role ENUM type
CREATE TYPE user_role AS ENUM ('instructor', 'admin');

-- Create question_type ENUM
CREATE TYPE question_type AS ENUM ('multiple-choice', 'true/false');

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  user_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  username VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role user_role NOT NULL,
  is_approved BOOLEAN DEFAULT false,
  email VARCHAR(255) NOT NULL UNIQUE,
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create courses table (independent of instructors)
CREATE TABLE IF NOT EXISTS courses (
  course_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  course_name VARCHAR(255) NOT NULL,
  course_code VARCHAR(50) NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER REFERENCES users(user_id) -- admin who created the course
);

-- Create course_assignments table (links courses to instructors)
CREATE TABLE IF NOT EXISTS course_assignments (
  assignment_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  course_id INTEGER REFERENCES courses(course_id) ON DELETE CASCADE,
  instructor_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
  assigned_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  end_date TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  assigned_by INTEGER REFERENCES users(user_id), -- admin who made the assignment
  UNIQUE(course_id, instructor_id, is_active)
);

-- Create question_banks table (tied to courses, managed by admin)
CREATE TABLE IF NOT EXISTS question_banks (
  question_bank_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  bank_name VARCHAR(255) NOT NULL,
  description TEXT,
  course_id INTEGER REFERENCES courses(course_id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER REFERENCES users(user_id) -- admin who created the bank
);

-- Create questions table (instructors can add questions to banks)
CREATE TABLE IF NOT EXISTS questions (
  question_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  question_text TEXT NOT NULL,
  question_type question_type NOT NULL,
  points INTEGER NOT NULL,
  image_url VARCHAR(255),
  chapter VARCHAR(50),
  question_bank_id INTEGER REFERENCES question_banks(question_bank_id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(user_id), -- instructor who created the question
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create question_tags table
CREATE TABLE IF NOT EXISTS question_tags (
  tag_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  tag_name VARCHAR(100) NOT NULL UNIQUE
);

-- Create question_tag_mapping for many-to-many relationship
CREATE TABLE IF NOT EXISTS question_tag_mapping (
  question_id INTEGER REFERENCES questions(question_id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES question_tags(tag_id) ON DELETE CASCADE,
  PRIMARY KEY (question_id, tag_id)
);

-- Create question_options table
CREATE TABLE IF NOT EXISTS question_options (
  option_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  question_id INTEGER REFERENCES questions(question_id) ON DELETE CASCADE,
  option_text VARCHAR(255) NOT NULL,
  is_correct BOOLEAN NOT NULL
);

-- Create exams table
CREATE TABLE IF NOT EXISTS exams (
  exam_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  exam_name VARCHAR(255) NOT NULL,
  description TEXT,
  time_limit_minutes INTEGER NOT NULL,
  start_date TIMESTAMP NOT NULL,
  end_date TIMESTAMP NOT NULL,
  course_id INTEGER REFERENCES courses(course_id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(user_id), -- instructor who created the exam
  access_code VARCHAR(16) UNIQUE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create exam_specifications table
CREATE TABLE IF NOT EXISTS exam_specifications (
  spec_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  exam_id INTEGER REFERENCES exams(exam_id) ON DELETE CASCADE,
  question_bank_id INTEGER REFERENCES question_banks(question_bank_id),
  num_questions INTEGER NOT NULL,
  points_per_question INTEGER,
  CONSTRAINT check_num_questions CHECK (num_questions > 0)
);

-- Create allowed_students table
CREATE TABLE IF NOT EXISTS allowed_students (
  allowed_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  exam_id INTEGER REFERENCES exams(exam_id) ON DELETE CASCADE,
  uni_id VARCHAR(255) NOT NULL,
  student_name VARCHAR(255) NOT NULL,
  UNIQUE(exam_id, uni_id)
);

-- Create student_exams table
CREATE TABLE IF NOT EXISTS student_exams (
  student_exam_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  exam_id INTEGER REFERENCES exams(exam_id) ON DELETE CASCADE,
  uni_id VARCHAR(255) NOT NULL,
  student_name VARCHAR(255) NOT NULL,
  start_time TIMESTAMP,
  end_time TIMESTAMP,
  score NUMERIC(5,2),
  status VARCHAR(20) DEFAULT 'not_started',
  UNIQUE(exam_id, uni_id)
);

-- Create student_exam_questions table
CREATE TABLE IF NOT EXISTS student_exam_questions (
  student_question_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  student_exam_id INTEGER REFERENCES student_exams(student_exam_id) ON DELETE CASCADE,
  question_id INTEGER REFERENCES questions(question_id),
  question_order INTEGER NOT NULL,
  student_answer TEXT,
  is_correct BOOLEAN,
  UNIQUE(student_exam_id, question_order)
);

-- Insert initial admin user
INSERT INTO users (username, password, role, is_approved, email, first_name, last_name)
VALUES ('admin', 'admin123', 'admin', true, 'admin@example.com', 'Admin', 'User')
ON CONFLICT DO NOTHING;

-- Create functions for exam generation and grading
CREATE OR REPLACE FUNCTION generate_student_exam(p_exam_id INTEGER, p_uni_id VARCHAR(255), p_student_name VARCHAR(255))
RETURNS INTEGER AS $$
DECLARE
  v_student_exam_id INTEGER;
  v_spec RECORD;
  v_question_count INTEGER := 1;
BEGIN
  -- Create a new student exam record
  INSERT INTO student_exams (exam_id, uni_id, student_name, status)
  VALUES (p_exam_id, p_uni_id, p_student_name, 'not_started')
  RETURNING student_exam_id INTO v_student_exam_id;

  -- Process each specification
  FOR v_spec IN
    SELECT * FROM exam_specifications WHERE exam_id = p_exam_id
  LOOP
    -- Insert selected questions
    WITH eligible_questions AS (
      SELECT q.question_id
      FROM questions q
      WHERE q.question_bank_id = v_spec.question_bank_id
    )
    INSERT INTO student_exam_questions (student_exam_id, question_id, question_order)
    SELECT
      v_student_exam_id,
      question_id,
      v_question_count + row_number() OVER (ORDER BY random()) - 1
    FROM eligible_questions
    ORDER BY random()
    LIMIT v_spec.num_questions;

    v_question_count := v_question_count + v_spec.num_questions;
  END LOOP;

  RETURN v_student_exam_id;
END;
$$ LANGUAGE plpgsql;

-- Function to grade student exam
CREATE OR REPLACE FUNCTION grade_student_exam(p_student_exam_id INTEGER)
RETURNS NUMERIC AS $$
DECLARE
  v_total_score NUMERIC(5,2) := 0;
  v_total_possible NUMERIC(5,2) := 0;
  v_question RECORD;
BEGIN
  FOR v_question IN
    SELECT seq.student_question_id, seq.student_answer, q.question_id, q.points, q.question_type
    FROM student_exam_questions seq
    JOIN questions q ON seq.question_id = q.question_id
    WHERE seq.student_exam_id = p_student_exam_id
  LOOP
    IF v_question.question_type IN ('multiple-choice', 'true/false') THEN
      UPDATE student_exam_questions
      SET is_correct = (
        SELECT CASE
          WHEN qo.is_correct AND qo.option_id::text = v_question.student_answer THEN TRUE
          ELSE FALSE
        END
        FROM question_options qo
        WHERE qo.question_id = v_question.question_id
        AND qo.option_id::text = v_question.student_answer
      )
      WHERE student_question_id = v_question.student_question_id;
    END IF;

    v_total_possible := v_total_possible + v_question.points;

    IF EXISTS (
      SELECT 1 FROM student_exam_questions
      WHERE student_question_id = v_question.student_question_id AND is_correct = TRUE
    ) THEN
      v_total_score := v_total_score + v_question.points;
    END IF;
  END LOOP;

  IF v_total_possible > 0 THEN
    UPDATE student_exams
    SET score = (v_total_score / v_total_possible) * 100,
        status = 'completed',
        end_time = CURRENT_TIMESTAMP
    WHERE student_exam_id = p_student_exam_id;

    RETURN (v_total_score / v_total_possible) * 100;
  END IF;

  RETURN 0;
END;
$$ LANGUAGE plpgsql;
`;

async function main() {
  console.log('Seeding database...');
  const client = new Client({
    connectionString: `postgresql://${dbUser}:${dbPass}@localhost:5432/xam`,
  });
  try {
    await client.connect();
    await client.query(SQL);
    console.log('Database seeded successfully');
  } catch (err) {
    console.error('Error seeding database:', err.stack);
  } finally {
    await client.end();
  }
}

main();
