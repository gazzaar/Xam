-- Backup existing data
CREATE TEMP TABLE courses_backup AS SELECT * FROM courses;
CREATE TEMP TABLE questions_backup AS SELECT * FROM questions;

-- Drop dependent tables first (due to foreign key constraints)
DROP TABLE IF EXISTS student_exam_questions CASCADE;
DROP TABLE IF EXISTS student_exams CASCADE;
DROP TABLE IF EXISTS allowed_students CASCADE;
DROP TABLE IF EXISTS exam_specifications CASCADE;
DROP TABLE IF EXISTS exams CASCADE;
DROP TABLE IF EXISTS question_options CASCADE;
DROP TABLE IF EXISTS question_tag_mapping CASCADE;
DROP TABLE IF EXISTS questions CASCADE;
DROP TABLE IF EXISTS question_tags CASCADE;
DROP TABLE IF EXISTS question_banks CASCADE;
DROP TABLE IF EXISTS course_assignments CASCADE;
DROP TABLE IF EXISTS courses CASCADE;

-- Recreate courses table without instructor dependency
CREATE TABLE IF NOT EXISTS courses (
  course_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  course_name VARCHAR(255) NOT NULL,
  course_code VARCHAR(50) NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER REFERENCES users(user_id)
);

-- Recreate course_assignments table
CREATE TABLE IF NOT EXISTS course_assignments (
  assignment_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  course_id INTEGER REFERENCES courses(course_id) ON DELETE CASCADE,
  instructor_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  assigned_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  end_date TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  assigned_by INTEGER REFERENCES users(user_id),
  UNIQUE(course_id, instructor_id, is_active)
);

-- Recreate question_banks table
CREATE TABLE IF NOT EXISTS question_banks (
  question_bank_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  bank_name VARCHAR(255) NOT NULL,
  description TEXT,
  course_id INTEGER REFERENCES courses(course_id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER REFERENCES users(user_id)
);

-- Recreate questions table without instructor dependency
CREATE TABLE IF NOT EXISTS questions (
  question_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  question_text TEXT NOT NULL,
  question_type question_type NOT NULL,
  points INTEGER NOT NULL,
  image_url TEXT,
  chapter VARCHAR(50),
  question_bank_id INTEGER REFERENCES question_banks(question_bank_id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(user_id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Recreate other dependent tables
CREATE TABLE IF NOT EXISTS question_tags (
  tag_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  tag_name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS question_tag_mapping (
  question_id INTEGER REFERENCES questions(question_id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES question_tags(tag_id) ON DELETE CASCADE,
  PRIMARY KEY (question_id, tag_id)
);

CREATE TABLE IF NOT EXISTS question_options (
  option_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  question_id INTEGER REFERENCES questions(question_id) ON DELETE CASCADE,
  option_text VARCHAR(255) NOT NULL,
  is_correct BOOLEAN NOT NULL
);

CREATE TABLE IF NOT EXISTS exams (
  exam_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  exam_name VARCHAR(255) NOT NULL,
  description TEXT,
  time_limit_minutes INTEGER NOT NULL,
  start_date TIMESTAMP NOT NULL,
  end_date TIMESTAMP NOT NULL,
  course_id INTEGER REFERENCES courses(course_id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(user_id),
  access_code VARCHAR(16) UNIQUE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exam_specifications (
  spec_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  exam_id INTEGER REFERENCES exams(exam_id) ON DELETE CASCADE,
  question_bank_id INTEGER REFERENCES question_banks(question_bank_id),
  num_questions INTEGER NOT NULL,
  points_per_question INTEGER,
  CONSTRAINT check_num_questions CHECK (num_questions > 0)
);

CREATE TABLE IF NOT EXISTS allowed_students (
  allowed_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  exam_id INTEGER REFERENCES exams(exam_id) ON DELETE CASCADE,
  uni_id VARCHAR(255) NOT NULL,
  student_name VARCHAR(255) NOT NULL,
  UNIQUE(exam_id, uni_id)
);

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

CREATE TABLE IF NOT EXISTS student_exam_questions (
  student_question_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  student_exam_id INTEGER REFERENCES student_exams(student_exam_id) ON DELETE CASCADE,
  question_id INTEGER REFERENCES questions(question_id),
  question_order INTEGER NOT NULL,
  student_answer TEXT,
  is_correct BOOLEAN,
  UNIQUE(student_exam_id, question_order)
);

-- Restore backed up data
INSERT INTO courses (course_name, course_code, description, is_active, created_at, created_by)
SELECT course_name, course_code, description, is_active, created_at, created_by
FROM courses_backup;

INSERT INTO questions (question_text, question_type, points, image_url, chapter, question_bank_id, created_by, created_at)
SELECT question_text, question_type, points, image_url, chapter, question_bank_id, created_by, created_at
FROM questions_backup;

-- Drop temporary tables
DROP TABLE courses_backup;
DROP TABLE questions_backup;
