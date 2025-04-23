-- Create role ENUM type
CREATE TYPE user_role AS ENUM ('instructor', 'admin');

-- Create question_type ENUM
CREATE TYPE question_type AS ENUM ('multiple-choice', 'true/false', 'short-answer', 'essay');

-- Create question_category ENUM
CREATE TYPE question_category AS ENUM ('mental_ability', 'psychological', 'technical', 'general_knowledge', 'other');

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

-- Create question_bank table
CREATE TABLE IF NOT EXISTS question_bank (
  question_bank_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  question_type question_type NOT NULL,
  question_text TEXT NOT NULL,
  category question_category NOT NULL,
  reference VARCHAR(50), -- e.g., 'ch1', 'ch2'
  image_url VARCHAR(255), -- URL or path to attached image
  timer INTEGER, -- Time limit in seconds for this question
  score INTEGER NOT NULL,
  instructor_id INTEGER REFERENCES instructors(instructor_id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create question_bank_options table
CREATE TABLE IF NOT EXISTS question_bank_options (
  option_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  question_bank_id INTEGER REFERENCES question_bank(question_bank_id),
  option_text VARCHAR(255) NOT NULL,
  is_correct BOOLEAN NOT NULL
);

-- Create exam_models table
CREATE TABLE IF NOT EXISTS exam_models (
  model_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  model_name VARCHAR(255) NOT NULL,
  description TEXT,
  instructor_id INTEGER REFERENCES instructors(instructor_id),
  total_questions INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create exam_model_questions table
CREATE TABLE IF NOT EXISTS exam_model_questions (
  model_question_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  model_id INTEGER REFERENCES exam_models(model_id),
  category question_category,
  num_questions INTEGER NOT NULL,
  CONSTRAINT check_num_questions CHECK (num_questions > 0)
);

-- Create exams table
CREATE TABLE IF NOT EXISTS exams (
  exam_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  exam_name VARCHAR(255) NOT NULL,
  description TEXT,
  start_date TIMESTAMP NOT NULL,
  end_date TIMESTAMP NOT NULL,
  duration INTEGER NOT NULL, -- Total exam duration in minutes
  instructor_id INTEGER REFERENCES instructors(instructor_id),
  model_id INTEGER REFERENCES exam_models(model_id),
  access_code VARCHAR(10) UNIQUE,
  is_active BOOLEAN DEFAULT true
);

-- Create exam_questions table
CREATE TABLE IF NOT EXISTS exam_questions (
  exam_question_id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  exam_id INTEGER REFERENCES exams(exam_id),
  question_bank_id INTEGER REFERENCES question_bank(question_bank_id),
  order_num INTEGER NOT NULL,
  UNIQUE(exam_id, question_bank_id, order_num)
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
  exam_question_id INTEGER REFERENCES exam_questions(exam_question_id),
  answer_text TEXT NOT NULL,
  is_correct BOOLEAN,
  score INTEGER
);

-- Function to assign questions to an exam based on its model
CREATE OR REPLACE FUNCTION assign_questions_to_exam(p_exam_id INTEGER) RETURNS VOID AS $$
DECLARE
  v_model_id INTEGER;
  v_category question_category;
  v_num_questions INTEGER;
  v_order_num INTEGER := 1;
BEGIN
  -- Get the model_id for the exam
  SELECT model_id INTO v_model_id
  FROM exams
  WHERE exam_id = p_exam_id;

  -- Loop through each category and number of questions in the model
  FOR v_category, v_num_questions IN
    SELECT category, num_questions
    FROM exam_model_questions
    WHERE model_id = v_model_id
  LOOP
    -- Insert random questions from question_bank for the category
    INSERT INTO exam_questions (exam_id, question_bank_id, order_num)
    SELECT p_exam_id, question_bank_id, v_order_num + ROW_NUMBER() OVER (ORDER BY RANDOM()) - 1
    FROM question_bank
    WHERE category = v_category
    ORDER BY RANDOM()
    LIMIT v_num_questions;

    -- Update the order_num for the next batch
    v_order_num := v_order_num + v_num_questions;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Trigger to assign questions when an exam is created
CREATE OR REPLACE FUNCTION trigger_assign_questions() RETURNS TRIGGER AS $$
BEGIN
  PERFORM assign_questions_to_exam(NEW.exam_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER exam_questions_trigger
AFTER INSERT ON exams
FOR EACH ROW
EXECUTE FUNCTION trigger_assign_questions();

-- Insert sample admin user
INSERT INTO users (username, password, role, is_approved, email, first_name, last_name)
VALUES
  ('admin1', 'admin123', 'admin', true, 'admin@xam.edu', 'Admin', 'User')
RETURNING user_id;

INSERT INTO admins (admin_id)
SELECT user_id FROM users WHERE username = 'admin1';

-- Insert sample approved instructor
INSERT INTO users (username, password, role, is_approved, email, first_name, last_name)
VALUES
  ('instructor1', 'pass123', 'instructor', true, 'instructor1@xam.edu', 'John', 'Doe')
RETURNING user_id;

INSERT INTO instructors (instructor_id, department)
SELECT user_id, 'Computer Science' FROM users WHERE username = 'instructor1';

-- Insert sample questions into question_bank
INSERT INTO question_bank (question_type, question_text, category, reference, image_url, timer, score, instructor_id)
VALUES
  ('multiple-choice', 'What is the capital of France?', 'general_knowledge', 'ch1', NULL, 30, 10, (SELECT instructor_id FROM instructors WHERE instructor_id = (SELECT user_id FROM users WHERE username = 'instructor1'))),
  ('true/false', 'The brain is the largest organ in the human body.', 'mental_ability', 'ch2', 'brain_image.jpg', 20, 5, (SELECT instructor_id FROM instructors WHERE instructor_id = (SELECT user_id FROM users WHERE username = 'instructor1'))),
  ('short-answer', 'Describe the fight-or-flight response.', 'psychological', 'ch3', NULL, 60, 15, (SELECT instructor_id FROM instructors WHERE instructor_id = (SELECT user_id FROM users WHERE username = 'instructor1')));

-- Insert options for multiple-choice question
INSERT INTO question_bank_options (question_bank_id, option_text, is_correct)
SELECT question_bank_id, option_text, is_correct
FROM (VALUES
  ((SELECT question_bank_id FROM question_bank WHERE question_text = 'What is the capital of France?'), 'Paris', true),
  ((SELECT question_bank_id FROM question_bank WHERE question_text = 'What is the capital of France?'), 'London', false),
  ((SELECT question_bank_id FROM question_bank WHERE question_text = 'What is the capital of France?'), 'Berlin', false),
  ((SELECT question_bank_id FROM question_bank WHERE question_text = 'What is the capital of France?'), 'Madrid', false)
) AS options (question_bank_id, option_text, is_correct);

-- Insert sample exam model
INSERT INTO exam_models (model_name, description, instructor_id, total_questions)
VALUES
  ('CS101 Final Model', 'Model for CS101 final exam with mixed categories',
   (SELECT instructor_id FROM instructors WHERE instructor_id = (SELECT user_id FROM users WHERE username = 'instructor1')), 3);

-- Insert question selection criteria for exam model
INSERT INTO exam_model_questions (model_id, category, num_questions)
VALUES
  ((SELECT model_id FROM exam_models WHERE model_name = 'CS101 Final Model'), 'general_knowledge', 1),
  ((SELECT model_id FROM exam_models WHERE model_name = 'CS101 Final Model'), 'mental_ability', 1),
  ((SELECT model_id FROM exam_models WHERE model_name = 'CS101 Final Model'), 'psychological', 1);

-- Insert sample exam (questions will be auto-assigned via trigger)
INSERT INTO exams (exam_name, description, start_date, end_date, duration, instructor_id, model_id, access_code)
SELECT
  'Introduction to Programming Final',
  'Final exam for CS101 course',
  NOW(),
  NOW() + INTERVAL '3 days',
  120,
  instructor_id,
  (SELECT model_id FROM exam_models WHERE model_name = 'CS101 Final Model'),
  'CS101FINAL'
FROM instructors
WHERE instructor_id = (SELECT user_id FROM users WHERE username = 'instructor1');

-- Insert sample allowed students
INSERT INTO allowed_students (exam_id, uni_id)
SELECT exam_id, uni_id
FROM exams, (VALUES ('STU001'), ('STU002'), ('STU003')) AS students(uni_id)
WHERE access_code = 'CS101FINAL';
