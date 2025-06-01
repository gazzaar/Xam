const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config();
const dbUser = process.env.DB_USER;
const dbPass = process.env.DB_PASS;

// Function to create admin user
async function createAdminUser(client) {
  try {
    // Check if admin already exists
    const checkResult = await client.query(
      "SELECT * FROM users WHERE username = 'admin'"
    );

    if (checkResult.rows.length > 0) {
      console.log('Admin user already exists');
      return;
    }

    // Insert admin user
    await client.query(
      `INSERT INTO users (
        username,
        password,
        role,
        email,
        first_name,
        last_name,
        is_approved,
        is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        'admin',
        'admin123', // Plain password for now
        'admin',
        'admin@example.com',
        'Admin',
        'User',
        true,
        true,
      ]
    );

    console.log('Admin user created successfully');
  } catch (error) {
    console.error('Error creating admin user:', error);
  }
}

const SQL = `
-- Create ENUM types
CREATE TYPE public.exam_status AS ENUM (
    'draft',
    'published',
    'in_progress',
    'completed',
    'archived'
);

CREATE TYPE public.question_type AS ENUM (
    'multiple-choice',
    'true/false'
);

CREATE TYPE public.user_role AS ENUM (
    'instructor',
    'admin'
);

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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    department VARCHAR(255)
);

-- Create courses table
CREATE TABLE IF NOT EXISTS courses (
    course_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    course_name VARCHAR(255) NOT NULL,
    course_code VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER REFERENCES users(user_id)
);

-- Create course_chapters table
CREATE TABLE IF NOT EXISTS course_chapters (
    chapter_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    course_id INTEGER REFERENCES courses(course_id) ON DELETE CASCADE,
    chapter_number INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_chapter_number CHECK (chapter_number > 0 AND chapter_number <= 20),
    UNIQUE(course_id, chapter_number)
);

-- Create course_assignments table
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

-- Create past_instructors table
CREATE TABLE IF NOT EXISTS past_instructors (
    id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    user_id INTEGER NOT NULL UNIQUE,
    username VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    first_name VARCHAR(255) NOT NULL,
    last_name VARCHAR(255) NOT NULL,
    department VARCHAR(255),
    deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP,
    deleted_by INTEGER REFERENCES users(user_id)
);

-- Create question_banks table
CREATE TABLE IF NOT EXISTS question_banks (
    question_bank_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    bank_name VARCHAR(255) NOT NULL,
    description TEXT,
    course_id INTEGER REFERENCES courses(course_id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER REFERENCES users(user_id),
    original_creator INTEGER REFERENCES users(user_id),
    current_owner INTEGER REFERENCES users(user_id)
);

-- Create questions table
CREATE TABLE IF NOT EXISTS questions (
    question_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    question_text TEXT NOT NULL,
    question_type question_type NOT NULL,
    points INTEGER NOT NULL,
    image_url TEXT,
    chapter VARCHAR(50),
    question_bank_id INTEGER REFERENCES question_banks(question_bank_id) ON DELETE CASCADE,
    created_by INTEGER REFERENCES users(user_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    original_creator INTEGER REFERENCES users(user_id),
    current_owner INTEGER REFERENCES users(user_id),
    difficulty VARCHAR(20) DEFAULT 'medium'
);

-- Create question_bank_questions table
CREATE TABLE IF NOT EXISTS question_bank_questions (
    id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    question_bank_id INTEGER REFERENCES question_banks(question_bank_id) ON DELETE CASCADE,
    question_id INTEGER REFERENCES questions(question_id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(question_bank_id, question_id)
);

-- Create question_tags table
CREATE TABLE IF NOT EXISTS question_tags (
    tag_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    tag_name VARCHAR(100) NOT NULL UNIQUE
);

-- Create question_tag_mapping table
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
    created_by INTEGER REFERENCES users(user_id),
    exam_link_id VARCHAR(16) UNIQUE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status exam_status DEFAULT 'draft',
    published_at TIMESTAMP,
    archived_at TIMESTAMP,
    is_randomized BOOLEAN DEFAULT true,
    exam_metadata JSONB,
    CONSTRAINT check_access_code_format CHECK (
        length(exam_link_id) >= 6
        AND length(exam_link_id) <= 10
        AND exam_link_id ~ '[A-Z0-9]+'
    )
);

-- Create exam_specifications table
CREATE TABLE IF NOT EXISTS exam_specifications (
    spec_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    exam_id INTEGER REFERENCES exams(exam_id) ON DELETE CASCADE,
    question_bank_id INTEGER REFERENCES question_banks(question_bank_id),
    num_questions INTEGER NOT NULL,
    points_per_question INTEGER,
    chapter VARCHAR(255),
    CONSTRAINT check_num_questions CHECK (num_questions > 0)
);

-- Create exam_chapter_distribution table
CREATE TABLE IF NOT EXISTS exam_chapter_distribution (
    distribution_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    exam_id INTEGER REFERENCES exams(exam_id) ON DELETE CASCADE,
    chapter VARCHAR(50) NOT NULL,
    question_count INTEGER NOT NULL,
    CONSTRAINT exam_chapter_distribution_question_count_check CHECK (question_count > 0)
);

-- Create exam_difficulty_distribution table
CREATE TABLE IF NOT EXISTS exam_difficulty_distribution (
    exam_id INTEGER PRIMARY KEY REFERENCES exams(exam_id) ON DELETE CASCADE,
    easy_percentage INTEGER NOT NULL,
    medium_percentage INTEGER NOT NULL,
    hard_percentage INTEGER NOT NULL,
    CONSTRAINT exam_difficulty_distribution_easy_percentage_check CHECK (easy_percentage >= 0 AND easy_percentage <= 100),
    CONSTRAINT exam_difficulty_distribution_medium_percentage_check CHECK (medium_percentage >= 0 AND medium_percentage <= 100),
    CONSTRAINT exam_difficulty_distribution_hard_percentage_check CHECK (hard_percentage >= 0 AND hard_percentage <= 100),
    CONSTRAINT total_hundred CHECK (easy_percentage + medium_percentage + hard_percentage = 100)
);

-- Create allowed_students table
CREATE TABLE IF NOT EXISTS allowed_students (
    allowed_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    exam_id INTEGER REFERENCES exams(exam_id) ON DELETE CASCADE,
    student_id VARCHAR(255) NOT NULL,
    student_name VARCHAR(255) NOT NULL,
    student_email VARCHAR(255) NOT NULL,
    UNIQUE(exam_id, student_id)
);

-- Create student_exams table
CREATE TABLE IF NOT EXISTS student_exams (
    student_exam_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    exam_id INTEGER REFERENCES exams(exam_id) ON DELETE CASCADE,
    student_id VARCHAR(255) NOT NULL,
    student_name VARCHAR(255) NOT NULL,
    start_time TIMESTAMP,
    end_time TIMESTAMP,
    score NUMERIC(5,2),
    status VARCHAR(20) DEFAULT 'not_started',
    attempt_count INTEGER DEFAULT 1,
    last_activity TIMESTAMP,
    ip_address VARCHAR(45),
    browser_info TEXT,
    UNIQUE(exam_id, student_id),
    CONSTRAINT check_attempt_count CHECK (attempt_count > 0 AND attempt_count <= 3)
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

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_exams_access_code ON exams(exam_link_id);
CREATE INDEX IF NOT EXISTS idx_student_exams_exam_id ON student_exams(exam_id);
CREATE INDEX IF NOT EXISTS idx_student_exams_uni_id ON student_exams(student_id);
CREATE INDEX IF NOT EXISTS idx_student_exams_status ON student_exams(status);

-- Create functions
CREATE OR REPLACE FUNCTION generate_student_exam(p_exam_id INTEGER, p_student_id VARCHAR(255), p_student_name VARCHAR(255))
RETURNS INTEGER AS $$
DECLARE
  v_student_exam_id INTEGER;
  v_spec RECORD;
  v_question_count INTEGER := 1;
  v_exam_metadata JSONB;
  v_chapter_dist RECORD;
  v_difficulty_dist JSONB;
  v_total_questions INTEGER;
  v_question_bank_id INTEGER;
  v_available_easy INTEGER;
  v_available_medium INTEGER;
  v_available_hard INTEGER;
  v_easy_count INTEGER;
  v_medium_count INTEGER;
  v_hard_count INTEGER;
BEGIN
  -- Get exam metadata
  SELECT exam_metadata INTO v_exam_metadata
  FROM exams
  WHERE exam_id = p_exam_id;

  -- Create a new student exam record if it doesn't exist
  INSERT INTO student_exams (exam_id, student_id, student_name, status, start_time)
  VALUES (p_exam_id, p_student_id, p_student_name, 'in_progress', NOW())
  ON CONFLICT (exam_id, student_id) DO NOTHING
  RETURNING student_exam_id INTO v_student_exam_id;

  -- If no new record was created, get the existing one
  IF v_student_exam_id IS NULL THEN
    SELECT student_exam_id INTO v_student_exam_id
    FROM student_exams
    WHERE exam_id = p_exam_id AND student_id = p_student_id;
  END IF;

  -- Get question bank ID and total questions from metadata
  v_question_bank_id := (v_exam_metadata->>'question_bank_id')::INTEGER;
  v_total_questions := (v_exam_metadata->>'total_questions')::INTEGER;
  v_difficulty_dist := v_exam_metadata->'difficultyDistribution';

  -- Process each chapter specification
  FOR v_chapter_dist IN
    SELECT chapter, num_questions
    FROM exam_specifications
    WHERE exam_id = p_exam_id
  LOOP
    -- Get available questions count for each difficulty
    SELECT COUNT(*) INTO v_available_easy
    FROM questions q
    WHERE q.question_bank_id = v_question_bank_id
    AND q.chapter = v_chapter_dist.chapter
    AND q.difficulty = 'easy';

    SELECT COUNT(*) INTO v_available_medium
    FROM questions q
    WHERE q.question_bank_id = v_question_bank_id
    AND q.chapter = v_chapter_dist.chapter
    AND q.difficulty = 'medium';

    SELECT COUNT(*) INTO v_available_hard
    FROM questions q
    WHERE q.question_bank_id = v_question_bank_id
    AND q.chapter = v_chapter_dist.chapter
    AND q.difficulty = 'hard';

    -- Calculate total available questions
    DECLARE
      v_total_available INTEGER := v_available_easy + v_available_medium + v_available_hard;
    BEGIN
      IF v_total_available = 0 THEN
        RAISE EXCEPTION 'No questions available for chapter %', v_chapter_dist.chapter;
      END IF;

      -- Calculate initial counts based on percentages
      v_easy_count := CEIL(v_chapter_dist.num_questions * (v_difficulty_dist->>'easy')::INTEGER / 100.0);
      v_medium_count := CEIL(v_chapter_dist.num_questions * (v_difficulty_dist->>'medium')::INTEGER / 100.0);
      v_hard_count := v_chapter_dist.num_questions - v_easy_count - v_medium_count;

      -- Adjust counts based on availability
      IF v_easy_count > v_available_easy OR v_medium_count > v_available_medium OR v_hard_count > v_available_hard THEN
        -- Distribute questions proportionally based on availability
        DECLARE
          v_remaining INTEGER := LEAST(v_chapter_dist.num_questions, v_total_available);
        BEGIN
          -- Handle the case where some difficulties have no questions
          IF v_available_easy > 0 THEN
            v_easy_count := CEIL(v_remaining * v_available_easy::FLOAT / v_total_available);
            v_remaining := v_remaining - v_easy_count;
          ELSE
            v_easy_count := 0;
          END IF;

          IF v_available_medium > 0 THEN
            IF v_available_hard = 0 THEN
              v_medium_count := v_remaining;
            ELSE
              v_medium_count := CEIL(v_remaining * v_available_medium::FLOAT / (v_available_medium + v_available_hard));
            END IF;
            v_remaining := v_remaining - v_medium_count;
          ELSE
            v_medium_count := 0;
          END IF;

          IF v_available_hard > 0 THEN
            v_hard_count := v_remaining;
          ELSE
            v_hard_count := 0;
          END IF;
        END;
      END IF;

      -- Insert easy questions
      IF v_easy_count > 0 THEN
        WITH eligible_questions AS (
          SELECT q.question_id
          FROM questions q
          WHERE q.question_bank_id = v_question_bank_id
          AND q.chapter = v_chapter_dist.chapter
          AND q.difficulty = 'easy'
          ORDER BY random()
          LIMIT v_easy_count
        )
        INSERT INTO student_exam_questions (student_exam_id, question_id, question_order)
        SELECT
          v_student_exam_id,
          question_id,
          v_question_count + row_number() OVER (ORDER BY random()) - 1
        FROM eligible_questions;

        v_question_count := v_question_count + v_easy_count;
      END IF;

      -- Insert medium questions
      IF v_medium_count > 0 THEN
        WITH eligible_questions AS (
          SELECT q.question_id
          FROM questions q
          WHERE q.question_bank_id = v_question_bank_id
          AND q.chapter = v_chapter_dist.chapter
          AND q.difficulty = 'medium'
          ORDER BY random()
          LIMIT v_medium_count
        )
        INSERT INTO student_exam_questions (student_exam_id, question_id, question_order)
        SELECT
          v_student_exam_id,
          question_id,
          v_question_count + row_number() OVER (ORDER BY random()) - 1
        FROM eligible_questions;

        v_question_count := v_question_count + v_medium_count;
      END IF;

      -- Insert hard questions
      IF v_hard_count > 0 THEN
        WITH eligible_questions AS (
          SELECT q.question_id
          FROM questions q
          WHERE q.question_bank_id = v_question_bank_id
          AND q.chapter = v_chapter_dist.chapter
          AND q.difficulty = 'hard'
          ORDER BY random()
          LIMIT v_hard_count
        )
        INSERT INTO student_exam_questions (student_exam_id, question_id, question_order)
        SELECT
          v_student_exam_id,
          question_id,
          v_question_count + row_number() OVER (ORDER BY random()) - 1
        FROM eligible_questions;

        v_question_count := v_question_count + v_hard_count;
      END IF;
    END;
  END LOOP;

  -- Verify total questions
  DECLARE
    v_actual_count INTEGER;
  BEGIN
    SELECT COUNT(*) INTO v_actual_count
    FROM student_exam_questions
    WHERE student_exam_id = v_student_exam_id;

    IF v_actual_count = 0 THEN
      RAISE EXCEPTION 'No questions could be generated for the exam';
    END IF;

    -- Log the actual distribution
    RAISE NOTICE 'Generated % questions for exam %', v_actual_count, p_exam_id;
  END;

  RETURN v_student_exam_id;
END;
$$ LANGUAGE plpgsql;

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
  const client = new Client({
    host: 'localhost',
    user: dbUser,
    database: 'xam',
    password: dbPass,
    port: 5432,
  });

  try {
    await client.connect();
    console.log('Connected to database. Creating schema...');
    await client.query(SQL);
    console.log('Schema created successfully!');

    // Create admin user
    await createAdminUser(client);
  } catch (err) {
    console.error('Error creating database schema:', err.stack);
  } finally {
    await client.end();
  }
}

main();
