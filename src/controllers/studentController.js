const pool = require('../db/pool');

// Helper function to handle database errors
const handleDbError = (res, error) => {
  console.error('Database error:', error);
  res.status(500).json({ error: 'Database error', details: error.message });
};

class StudentController {
  // Validate student access to exam
  async validateExamAccess(req, res) {
    const client = await pool.connect();
    try {
      const { examLinkId, studentId, email } = req.body;

      console.log('Validating exam access:', { examLinkId, studentId, email });

      // Input validation
      if (!examLinkId || !studentId || !email) {
        return res.status(400).json({
          error: 'Missing required fields',
          details: 'Exam link ID, student ID, and email are required',
        });
      }

      // Get exam details and check if it exists and is active
      const examResult = await client.query(
        `SELECT e.*,
          (SELECT COUNT(*) FROM student_exams se
           WHERE se.exam_id = e.exam_id
           AND se.student_id = $1
           AND se.status = 'completed') as has_completed,
          (SELECT COUNT(*) FROM student_exams se
           WHERE se.exam_id = e.exam_id
           AND se.student_id = $1
           AND se.status = 'in_progress') as has_started
         FROM exams e
         WHERE e.exam_link_id = $2 AND e.is_active = true`,
        [studentId, examLinkId]
      );

      if (examResult.rows.length === 0) {
        return res.status(404).json({
          error: 'Exam not found',
          details: 'The exam link is invalid or the exam is not active',
        });
      }

      const exam = examResult.rows[0];
      const now = new Date();
      const endDate = new Date(exam.end_date);

      // First verify student is in allowed list with matching email
      const studentResult = await client.query(
        `SELECT *
         FROM allowed_students
         WHERE exam_id = $1 AND student_id = $2 AND student_email = $3`,
        [exam.exam_id, studentId, email]
      );

      if (studentResult.rows.length === 0) {
        return res.status(403).json({
          error: 'Access denied',
          details: 'Student ID or email not found in allowed list',
        });
      }

      // Check if exam has ended (this is checked first!)
      if (now > endDate) {
        return res.status(200).json({
          success: true,
          redirectToResults: true,
          exam: {
            id: exam.exam_id,
            name: exam.exam_name,
            duration: exam.time_limit_minutes,
            studentName: studentResult.rows[0].student_name,
          },
        });
      }

      // If exam hasn't ended, check if student already attempted
      const hasCompleted = exam.has_completed > 0;
      const hasStarted = exam.has_started > 0;

      if (hasCompleted || hasStarted) {
        return res.status(403).json({
          error: 'Access denied',
          details: 'You have already attempted this exam',
        });
      }

      // Check if exam hasn't started yet
      if (now < new Date(exam.start_date)) {
        return res.status(403).json({
          error: 'Access denied',
          details: 'The exam has not started yet',
        });
      }

      // If we get here, the exam is active and student can take it
      res.status(200).json({
        success: true,
        redirectToResults: false,
        exam: {
          id: exam.exam_id,
          name: exam.exam_name,
          duration: exam.time_limit_minutes,
          studentName: studentResult.rows[0].student_name,
          status: 'active',
        },
      });
    } catch (error) {
      handleDbError(res, error);
    } finally {
      client.release();
    }
  }

  // Get exam questions
  async getExamQuestions(req, res) {
    const client = await pool.connect();
    try {
      const { examId: examLinkId } = req.params;
      const { studentId } = req.body;

      console.log('Getting questions for:', { examLinkId, studentId });

      await client.query('BEGIN');

      // Get the actual exam ID from the exam link - use FOR UPDATE to lock the row
      const examResult = await client.query(
        'SELECT exam_id FROM exams WHERE exam_link_id = $1 FOR UPDATE',
        [examLinkId]
      );

      console.log('Exam query result:', examResult.rows);

      if (examResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          error: 'No exam found for this student',
        });
      }

      const actualExamId = examResult.rows[0].exam_id;
      console.log('Actual exam ID:', actualExamId);

      // Check if student is allowed for this exam - use FOR UPDATE to lock the row
      const allowedResult = await client.query(
        'SELECT * FROM allowed_students WHERE exam_id = $1 AND student_id = $2 FOR UPDATE',
        [actualExamId, studentId]
      );

      console.log('Allowed students query result:', allowedResult.rows);

      if (allowedResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          error: 'No exam found for this student',
        });
      }

      const studentInfo = allowedResult.rows[0];

      // Get exam details - use FOR UPDATE to lock the row
      const examDetailsResult = await client.query(
        'SELECT * FROM exams WHERE exam_id = $1 FOR UPDATE',
        [actualExamId]
      );

      console.log('Exam details query result:', examDetailsResult.rows);

      if (examDetailsResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          error: 'Exam not found',
        });
      }

      // Check if student_exams record exists - use FOR UPDATE to lock the row
      const studentExamResult = await client.query(
        'SELECT * FROM student_exams WHERE exam_id = $1 AND student_id = $2 FOR UPDATE',
        [actualExamId, studentId]
      );

      let studentExam;

      // If no student_exams record exists, create one and generate questions
      if (studentExamResult.rows.length === 0) {
        console.log('Creating new student exam record');
        const insertResult = await client.query(
          'INSERT INTO student_exams (exam_id, student_id, student_name, status, start_time) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
          [actualExamId, studentId, studentInfo.student_name, 'in_progress']
        );
        studentExam = insertResult.rows[0];
        console.log('Inserted student exam record:', studentExam);

        // Generate questions for this student
        await client.query('SELECT generate_student_exam($1, $2, $3)', [
          actualExamId,
          studentId,
          studentInfo.student_name,
        ]);
      } else {
        studentExam = studentExamResult.rows[0];
      }

      // Get questions for this exam - make sure to only get questions that exist
      const questionsResult = await client.query(
        `SELECT DISTINCT q.*, sq.question_order, q.points
         FROM questions q
         JOIN student_exam_questions sq ON q.question_id = sq.question_id
         JOIN student_exams se ON sq.student_exam_id = se.student_exam_id
         WHERE se.exam_id = $1 AND se.student_id = $2 AND se.status = 'in_progress'
         ORDER BY sq.question_order`,
        [actualExamId, studentId]
      );

      // Format questions with options
      const questions = {};
      for (const row of questionsResult.rows) {
        if (!questions[row.question_id]) {
          questions[row.question_id] = {
            question_id: row.question_id,
            question_text: row.question_text,
            question_type: row.question_type,
            image_url: row.image_url,
            questionNumber: row.question_order,
            points: row.points,
            options: [],
          };
        }
      }

      // Get options for each question
      for (const questionId in questions) {
        const optionsResult = await client.query(
          'SELECT * FROM question_options WHERE question_id = $1',
          [questionId]
        );
        questions[questionId].options = optionsResult.rows;
      }

      // Convert questions object to array and sort by questionNumber
      const sortedQuestions = Object.values(questions).sort(
        (a, b) => a.questionNumber - b.questionNumber
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        exam: {
          ...examDetailsResult.rows[0],
          startTime: studentExam.start_time,
          timeLimitMinutes: examDetailsResult.rows[0].time_limit_minutes,
        },
        questions: sortedQuestions,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error in getExamQuestions:', error);
      console.error('Error stack:', error.stack);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch exam questions',
        details: error.message,
      });
    } finally {
      client.release();
    }
  }

  // Submit an answer
  async submitAnswer(req, res) {
    const client = await pool.connect();
    try {
      const { examId: examLinkId } = req.params;
      const { studentId, questionId, answer } = req.body;

      // First get the exam ID from the link ID
      const examResult = await client.query(
        `SELECT exam_id FROM exams WHERE exam_link_id = $1`,
        [examLinkId]
      );

      if (examResult.rows.length === 0) {
        return res.status(404).json({
          error: 'Exam not found',
          details: 'Invalid exam link ID',
        });
      }

      const actualExamId = examResult.rows[0].exam_id;

      // Get student exam record
      const studentExamResult = await client.query(
        `SELECT * FROM student_exams
         WHERE exam_id = $1 AND student_id = $2`,
        [actualExamId, studentId]
      );

      if (studentExamResult.rows.length === 0) {
        return res.status(404).json({
          error: 'Exam not found',
          details: 'No exam found for this student',
        });
      }

      const studentExam = studentExamResult.rows[0];

      // Update the answer
      await client.query(
        `UPDATE student_exam_questions
         SET student_answer = $1
         WHERE student_exam_id = $2 AND question_id = $3`,
        [answer, studentExam.student_exam_id, questionId]
      );

      res.status(200).json({
        success: true,
        message: 'Answer submitted successfully',
      });
    } catch (error) {
      handleDbError(res, error);
    } finally {
      client.release();
    }
  }

  // Submit the exam
  async submitExam(req, res) {
    const client = await pool.connect();
    try {
      const { examId: examLinkId } = req.params;
      const { studentId } = req.body;

      // First get the exam ID from the link ID
      const examResult = await client.query(
        `SELECT exam_id FROM exams WHERE exam_link_id = $1`,
        [examLinkId]
      );

      if (examResult.rows.length === 0) {
        return res.status(404).json({
          error: 'Exam not found',
          details: 'Invalid exam link ID',
        });
      }

      const actualExamId = examResult.rows[0].exam_id;

      // Get student exam record
      const studentExamResult = await client.query(
        `SELECT * FROM student_exams
         WHERE exam_id = $1 AND student_id = $2`,
        [actualExamId, studentId]
      );

      if (studentExamResult.rows.length === 0) {
        return res.status(404).json({
          error: 'Exam not found',
          details: 'No exam found for this student',
        });
      }

      const studentExam = studentExamResult.rows[0];

      // Grade the exam
      const score = await client.query(
        `SELECT grade_student_exam($1) as score`,
        [studentExam.student_exam_id]
      );

      res.status(200).json({
        success: true,
        score: score.rows[0].score,
        message: 'Exam submitted successfully',
      });
    } catch (error) {
      handleDbError(res, error);
    } finally {
      client.release();
    }
  }

  // Get exam stats
  async getExamStats(req, res) {
    const client = await pool.connect();
    try {
      const { examId: examLinkId } = req.params;
      const { studentId } = req.query;

      // First get the exam ID from the link ID
      const examResult = await client.query(
        `SELECT exam_id, end_date, time_limit_minutes FROM exams WHERE exam_link_id = $1`,
        [examLinkId]
      );

      if (examResult.rows.length === 0) {
        return res.status(404).json({
          error: 'Exam not found',
          details: 'Invalid exam link ID',
        });
      }

      const actualExamId = examResult.rows[0].exam_id;
      const examEndDate = new Date(examResult.rows[0].end_date);
      const now = new Date();

      // Verify student is in allowed list
      const allowedResult = await client.query(
        `SELECT * FROM allowed_students WHERE exam_id = $1 AND student_id = $2`,
        [actualExamId, studentId]
      );

      if (allowedResult.rows.length === 0) {
        return res.status(403).json({
          error: 'Access denied',
          details: 'Student not found in allowed list',
        });
      }

      // Get student exam record with detailed stats
      const studentExamResult = await client.query(
        `WITH chapter_stats AS (
          SELECT
            q.chapter,
            COUNT(*) as total_questions,
            COUNT(CASE WHEN seq.is_correct = true THEN 1 END) as correct_answers
          FROM student_exam_questions seq
          JOIN questions q ON seq.question_id = q.question_id
          JOIN student_exams se ON seq.student_exam_id = se.student_exam_id
          WHERE se.exam_id = $1 AND se.student_id = $2
          GROUP BY q.chapter
        )
        SELECT
          se.*,
          json_build_object(
            'score', se.score,
            'duration', CASE
              WHEN se.end_time IS NOT NULL THEN
                EXTRACT(EPOCH FROM (se.end_time - se.start_time))::integer
              ELSE
                EXTRACT(EPOCH FROM (NOW() - se.start_time))::integer
              END,
            'per_chapter', (
              SELECT json_object_agg(
                chapter,
                json_build_object(
                  'correct', correct_answers,
                  'incorrect', total_questions - correct_answers
                )
              )
              FROM chapter_stats
            )
          ) as student_stats,
          (
            SELECT json_build_object(
              'avg_score', COALESCE(AVG(score), 0),
              'avg_duration', COALESCE(AVG(EXTRACT(EPOCH FROM (end_time - start_time))), 0)
            )
            FROM student_exams
            WHERE exam_id = $1 AND status = 'completed'
          ) as class_stats,
          (
            SELECT array_agg(DISTINCT chapter)
            FROM questions q
            JOIN student_exam_questions seq ON q.question_id = seq.question_id
            JOIN student_exams se2 ON seq.student_exam_id = se2.student_exam_id
            WHERE se2.exam_id = $1 AND se2.student_id = $2
          ) as chapters
        FROM student_exams se
        WHERE se.exam_id = $1 AND se.student_id = $2`,
        [actualExamId, studentId]
      );

      if (studentExamResult.rows.length === 0) {
        return res.status(404).json({
          error: 'Exam not found',
          details: 'No exam record found for this student',
        });
      }

      const stats = studentExamResult.rows[0];
      const hasCompleted = stats.status === 'completed';

      // Stats are available if:
      // 1. The exam has ended for everyone (current time > end date) OR
      // 2. The student has completed their exam
      const available = now > examEndDate || hasCompleted;

      // If stats aren't available yet, return a message
      if (!available) {
        return res.status(200).json({
          success: true,
          available: false,
          message: 'Stats will be available after the exam ends.',
        });
      }

      res.status(200).json({
        success: true,
        available: true,
        student: stats.student_stats,
        class: stats.class_stats,
        chapters: stats.chapters || [],
      });
    } catch (error) {
      handleDbError(res, error);
    } finally {
      client.release();
    }
  }
}

// Create and export a new instance of the controller
const controller = new StudentController();

// Bind all methods to the instance
Object.getOwnPropertyNames(StudentController.prototype).forEach((name) => {
  if (typeof controller[name] === 'function') {
    controller[name] = controller[name].bind(controller);
  }
});

module.exports = controller;
