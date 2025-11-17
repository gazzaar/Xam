const { Client } = require('pg');
const dotenv = require('dotenv');
const pool = require('../db/pool');

dotenv.config();

const client = new Client({
  connectionString: process.env.DB_URL,
  ssl: { rejectUnauthorized: false },
});

client.connect();

// Helper function to handle database errors
const handleDbError = (res, error) => {
  console.error('Database error:', error);
  res.status(500).json({ error: 'Database error', details: error.message });
};

const examController = {
  // Validate student access to exam
  validateAccess: async (req, res) => {
    const { exam_link_id, student_id } = req.body;

    try {
      // Get exam details
      const examResult = await client.query(
        `SELECT e.*,
          (SELECT COUNT(*) FROM exam_attempts ea
           WHERE ea.exam_id = e.exam_id AND ea.student_id = $1) as attempt_count
        FROM exams e
        WHERE e.exam_link_id = $2 AND e.is_active = true`,
        [student_id, exam_link_id]
      );

      if (examResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Exam not found or not active',
        });
      }

      const exam = examResult.rows[0];

      // Check if exam is within time window
      const now = new Date();
      if (now < new Date(exam.start_date) || now > new Date(exam.end_date)) {
        return res.status(403).json({
          success: false,
          message: 'Exam is not currently available',
        });
      }

      // Check if student is in allowed list
      const allowedResult = await client.query(
        'SELECT * FROM allowed_students WHERE exam_id = $1 AND student_id = $2',
        [exam.exam_id, student_id]
      );

      if (allowedResult.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Student not in allowed list',
        });
      }

      // Check if student has already completed the exam
      if (exam.attempt_count > 0) {
        return res.status(403).json({
          success: false,
          message: 'You have already taken this exam',
        });
      }

      res.status(200).json({
        success: true,
        data: {
          exam_id: exam.exam_id,
          exam_name: exam.exam_name,
          duration: exam.duration,
        },
      });
    } catch (error) {
      handleDbError(res, error);
    }
  },

  // Start exam attempt
  startExam: async (req, res) => {
    const { exam_id, uni_id, student_name } = req.body;

    try {
      // Verify exam exists and is active
      const examResult = await client.query(
        'SELECT * FROM exams WHERE exam_id = $1 AND is_active = true',
        [exam_id]
      );

      if (examResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Exam not found or not active',
        });
      }

      // Start transaction
      await client.query('BEGIN');

      // Create exam attempt
      const attemptResult = await client.query(
        `INSERT INTO exam_attempts (exam_id, uni_id, start_time, status)
                VALUES ($1, $2, NOW(), 'in_progress')
                RETURNING attempt_id, start_time`,
        [exam_id, uni_id]
      );

      // Get questions for the exam
      const questionsResult = await client.query(
        `SELECT q.question_id, q.question_type, q.question_text, q.score, q.order_num,
                    CASE
                        WHEN q.question_type IN ('multiple-choice', 'true/false') THEN
                            json_agg(json_build_object(
                                'option_id', o.option_id,
                                'option_text', o.option_text
                            ))
                        ELSE NULL
                    END as options
                FROM questions q
                LEFT JOIN options o ON q.question_id = o.question_id
                WHERE q.exam_id = $1
                GROUP BY q.question_id
                ORDER BY q.order_num`,
        [exam_id]
      );

      await client.query('COMMIT');

      res.status(200).json({
        success: true,
        data: {
          attempt_id: attemptResult.rows[0].attempt_id,
          start_time: attemptResult.rows[0].start_time,
          questions: questionsResult.rows,
        },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error starting exam:', error);
      res.status(500).json({
        success: false,
        message: 'Error starting exam',
        error: error.message,
      });
    }
  },

  // Submit answer
  submitAnswer: async (req, res) => {
    const { attempt_id, question_id, answer_text } = req.body;

    try {
      // Verify attempt exists and is in progress
      const attemptResult = await client.query(
        `SELECT ea.*, e.end_date
                FROM exam_attempts ea
                JOIN exams e ON ea.exam_id = e.exam_id
                WHERE ea.attempt_id = $1 AND ea.status = 'in_progress'`,
        [attempt_id]
      );

      if (attemptResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Exam attempt not found or already completed',
        });
      }

      // Check if exam time has expired
      const now = new Date();
      const endTime = new Date(attemptResult.rows[0].end_date);
      if (now > endTime) {
        return res.status(403).json({
          success: false,
          message: 'Exam time has expired',
        });
      }

      // Get question details
      const questionResult = await client.query(
        'SELECT * FROM questions WHERE question_id = $1',
        [question_id]
      );

      const question = questionResult.rows[0];
      let isCorrect = null;
      let score = null;

      // For multiple choice/true-false questions, check correctness
      if (
        question.question_type === 'multiple-choice' ||
        question.question_type === 'true/false'
      ) {
        const correctAnswer = await client.query(
          'SELECT * FROM options WHERE question_id = $1 AND option_id = $2 AND is_correct = true',
          [question_id, answer_text]
        );
        isCorrect = correctAnswer.rows.length > 0;
        score = isCorrect ? question.score : 0;
      }

      // Save the answer
      await client.query(
        `INSERT INTO answers (attempt_id, question_id, answer_text, is_correct, score)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (attempt_id, question_id)
                DO UPDATE SET answer_text = $3, is_correct = $4, score = $5`,
        [attempt_id, question_id, answer_text, isCorrect, score]
      );

      res.status(200).json({
        success: true,
        message: 'Answer submitted successfully',
      });
    } catch (error) {
      console.error('Error submitting answer:', error);
      res.status(500).json({
        success: false,
        message: 'Error submitting answer',
        error: error.message,
      });
    }
  },

  // Finish exam
  finishExam: async (req, res) => {
    const { attempt_id } = req.params;

    try {
      await client.query('BEGIN');

      // Calculate total score
      const scoreResult = await client.query(
        `SELECT COALESCE(SUM(score), 0) as total_score
                FROM answers
                WHERE attempt_id = $1`,
        [attempt_id]
      );

      // Update attempt status and end time
      await client.query(
        `UPDATE exam_attempts
                SET status = 'completed',
                    end_time = NOW(),
                    score = $2
                WHERE attempt_id = $1
                RETURNING *`,
        [attempt_id, scoreResult.rows[0].total_score]
      );

      await client.query('COMMIT');

      res.status(200).json({
        success: true,
        message: 'Exam completed successfully',
        data: {
          score: scoreResult.rows[0].total_score,
        },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error finishing exam:', error);
      res.status(500).json({
        success: false,
        message: 'Error finishing exam',
        error: error.message,
      });
    }
  },
};

module.exports = examController;
