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
        `SELECT e.*
         FROM exams e
         WHERE e.exam_link_id = $1 AND e.is_active = true`,
        [examLinkId]
      );

      console.log('Exam query result:', examResult.rows);

      if (examResult.rows.length === 0) {
        return res.status(404).json({
          error: 'Exam not found',
          details: 'The exam link is invalid or the exam is not active',
        });
      }

      const exam = examResult.rows[0];

      // Check if exam is within its time window
      const now = new Date();
      const startDate = new Date(exam.start_date);
      const endDate = new Date(exam.end_date);

      if (now < startDate) {
        return res.status(403).json({
          error: 'Exam not started',
          details: 'This exam has not started yet',
          startTime: startDate,
        });
      }

      if (now > endDate) {
        return res.status(403).json({
          error: 'Exam ended',
          details: 'This exam has already ended',
          endTime: endDate,
        });
      }

      // Verify student is in allowed list with matching email
      const studentResult = await client.query(
        `SELECT *
         FROM allowed_students
         WHERE exam_id = $1 AND student_id = $2 AND student_email = $3`,
        [exam.exam_id, studentId, email]
      );

      console.log('Student query result:', studentResult.rows);

      if (studentResult.rows.length === 0) {
        return res.status(403).json({
          error: 'Access denied',
          details: 'Student ID or email not found in allowed list',
        });
      }

      // Check if student has already attempted the exam
      const attemptResult = await client.query(
        `SELECT *
         FROM student_exams
         WHERE exam_id = $1 AND student_id = $2`,
        [exam.exam_id, studentId]
      );

      if (attemptResult.rows.length > 0) {
        return res.status(403).json({
          error: 'Already attempted',
          details: 'You have already attempted this exam',
        });
      }

      // If all checks pass, return success with exam details
      res.status(200).json({
        success: true,
        exam: {
          id: exam.exam_id,
          name: exam.exam_name,
          duration: exam.time_limit_minutes,
          studentName: studentResult.rows[0].student_name,
        },
      });
    } catch (error) {
      console.error('Error validating exam access:', error);
      res.status(500).json({
        error: 'Server error',
        details: 'An error occurred while validating exam access',
      });
    } finally {
      client.release();
    }
  }

  // Get exam questions for a student
  async getExamQuestions(req, res) {
    const client = await pool.connect();
    try {
      const { examId } = req.params; // This is actually the exam_link_id
      const studentId = String(req.body.studentId); // Ensure studentId is a string

      // First, get the actual exam_id using the exam_link_id
      const examResult = await client.query(
        `SELECT exam_id, exam_metadata
         FROM exams
         WHERE exam_link_id = $1`,
        [examId]
      );

      if (examResult.rows.length === 0) {
        return res.status(404).json({
          error: 'Exam not found',
          details: 'No exam found with the provided link ID',
        });
      }

      const actualExamId = examResult.rows[0].exam_id;
      const examMetadata = examResult.rows[0].exam_metadata;

      // Begin transaction
      await client.query('BEGIN');

      // Check if student is allowed to take this exam
      const allowedCheck = await client.query(
        `SELECT *
         FROM allowed_students
         WHERE exam_id = $1 AND student_id::text = $2::text`,
        [actualExamId, studentId]
      );

      if (allowedCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Access denied',
          details: 'Student not allowed to take this exam',
        });
      }

      // Get or create student exam record
      let examSession = null;
      const existingSession = await client.query(
        `SELECT se.*, e.time_limit_minutes, e.exam_name
         FROM student_exams se
         JOIN exams e ON se.exam_id = e.exam_id
         WHERE se.exam_id = $1 AND se.student_id::text = $2::text`,
        [actualExamId, studentId]
      );

      if (existingSession.rows.length === 0) {
        // Create new session using UPSERT pattern
        const newSession = await client.query(
          `INSERT INTO student_exams (exam_id, student_id, student_name, status, start_time)
           SELECT $1, $2::text, student_name, 'in_progress', NOW()
           FROM allowed_students
           WHERE exam_id = $1 AND student_id::text = $2::text
           ON CONFLICT (exam_id, student_id)
           DO UPDATE SET
             status = CASE
               WHEN student_exams.status = 'completed' THEN 'completed'
               ELSE 'in_progress'
             END,
             start_time = CASE
               WHEN student_exams.start_time IS NULL THEN NOW()
               ELSE student_exams.start_time
             END
           RETURNING *`,
          [actualExamId, studentId]
        );
        examSession = newSession.rows[0];

        // Get exam details
        const examDetails = await client.query(
          `SELECT time_limit_minutes, exam_name FROM exams WHERE exam_id = $1`,
          [actualExamId]
        );
        examSession = { ...examSession, ...examDetails.rows[0] };
      } else {
        examSession = existingSession.rows[0];

        // If the exam is already completed, return error
        if (examSession.status === 'completed') {
          await client.query('ROLLBACK');
          return res.status(403).json({
            error: 'Exam completed',
            details: 'You have already completed this exam',
          });
        }

        // Update status to in_progress if it's not already
        if (examSession.status !== 'in_progress') {
          await client.query(
            `UPDATE student_exams
             SET status = 'in_progress',
                 start_time = COALESCE(start_time, NOW())
             WHERE student_exam_id = $1`,
            [examSession.student_exam_id]
          );
        }

        // Check if existing session has questions
        const existingQuestions = await client.query(
          `SELECT * FROM student_exam_questions WHERE student_exam_id = $1`,
          [examSession.student_exam_id]
        );

        if (existingQuestions.rows.length > 0) {
          // Return existing questions
          const questions = await client.query(
            `SELECT
              q.question_id,
              q.question_text,
              q.question_type,
              q.points,
              q.chapter,
              q.image_url,
              seq.question_order,
              CASE
                WHEN q.question_type IN ('multiple-choice', 'true/false') THEN
                  json_agg(
                    json_build_object(
                      'option_id', qo.option_id,
                      'option_text', qo.option_text
                    )
                  )
                ELSE NULL
              END as options
            FROM student_exam_questions seq
            JOIN questions q ON seq.question_id = q.question_id
            LEFT JOIN question_options qo ON q.question_id = qo.question_id
            WHERE seq.student_exam_id = $1
            GROUP BY q.question_id, q.question_text, q.question_type, q.points, q.chapter, q.image_url, seq.question_order
            ORDER BY seq.question_order`,
            [examSession.student_exam_id]
          );

          await client.query('COMMIT');
          return res.json({
            exam: {
              examId: examSession.exam_id,
              examName: examSession.exam_name,
              duration: examSession.time_limit_minutes,
              startTime: examSession.start_time,
            },
            questions: questions.rows.map((q) => ({
              ...q,
              questionNumber: q.question_order,
            })),
          });
        }
      }

      // Get questions based on exam specifications
      const specResult = await client.query(
        `SELECT chapter, num_questions
         FROM exam_specifications
         WHERE exam_id = $1`,
        [actualExamId]
      );

      const questions = [];
      // Get questions for each chapter specification
      for (const spec of specResult.rows) {
        const chapterQuestions = await client.query(
          `SELECT
            q.question_id,
            q.question_text,
            q.question_type,
            q.points,
            q.chapter,
            q.image_url,
            CASE
              WHEN q.question_type IN ('multiple-choice', 'true/false') THEN
                json_agg(
                  json_build_object(
                    'option_id', qo.option_id,
                    'option_text', qo.option_text
                  )
                )
              ELSE NULL
            END as options
          FROM questions q
          LEFT JOIN question_options qo ON q.question_id = qo.question_id
          WHERE q.question_bank_id = $1
          AND q.chapter = $2
          GROUP BY q.question_id, q.question_text, q.question_type, q.points, q.chapter, q.image_url
          ORDER BY RANDOM()
          LIMIT $3`,
          [examMetadata.question_bank_id, spec.chapter, spec.num_questions]
        );
        questions.push(...chapterQuestions.rows);
      }

      // Randomize the final question order if specified
      if (examMetadata.is_randomized) {
        questions.sort(() => Math.random() - 0.5);
      }

      // Insert questions into student_exam_questions
      for (let i = 0; i < questions.length; i++) {
        const question = questions[i];
        await client.query(
          `INSERT INTO student_exam_questions
           (student_exam_id, question_id, question_order)
           VALUES ($1, $2, $3)
           ON CONFLICT (student_exam_id, question_order)
           DO UPDATE SET
             question_id = EXCLUDED.question_id
           WHERE student_exam_questions.student_exam_id = $1
           AND student_exam_questions.question_order = $3`,
          [examSession.student_exam_id, question.question_id, i + 1]
        );
      }

      await client.query('COMMIT');

      // Return exam data and questions
      const formattedQuestions = questions.map((q, index) => ({
        ...q,
        questionNumber: index + 1,
      }));

      console.log(
        'Sending questions to student:',
        formattedQuestions.map((q) => ({
          questionId: q.question_id,
          hasImage: !!q.image_url,
          imageUrl: q.image_url,
        }))
      );

      res.json({
        exam: {
          examId: examSession.exam_id,
          examName: examSession.exam_name,
          duration: examSession.time_limit_minutes,
          startTime: examSession.start_time,
        },
        questions: formattedQuestions,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error getting exam questions:', error);
      res.status(500).json({
        error: 'Server error',
        details: 'An error occurred while getting exam questions',
      });
    } finally {
      client.release();
    }
  }

  // Submit answer
  async submitAnswer(req, res) {
    const client = await pool.connect();
    try {
      const { examId } = req.params; // This is actually exam_link_id
      const { studentId, questionId, answer } = req.body;

      // First, get the actual exam_id and student_exam_id using the exam_link_id
      const examResult = await client.query(
        `SELECT e.exam_id, se.student_exam_id
         FROM exams e
         JOIN student_exams se ON e.exam_id = se.exam_id
         WHERE e.exam_link_id = $1 AND se.student_id::text = $2::text`,
        [examId, studentId]
      );

      if (examResult.rows.length === 0) {
        return res.status(404).json({
          error: 'Exam not found',
          details: 'No active exam session found for this student',
        });
      }

      const { exam_id, student_exam_id } = examResult.rows[0];

      // Verify exam is in progress
      const examCheck = await client.query(
        `SELECT se.*
         FROM student_exams se
         WHERE se.student_exam_id = $1 AND se.status = 'in_progress'`,
        [student_exam_id]
      );

      if (examCheck.rows.length === 0) {
        return res.status(404).json({
          error: 'Active exam not found',
          details: 'No active exam session found for this student',
        });
      }

      // Update the answer
      await client.query(
        `UPDATE student_exam_questions
         SET student_answer = $1
         WHERE student_exam_id = $2 AND question_id = $3`,
        [answer, student_exam_id, questionId]
      );

      res.json({ success: true });
    } catch (error) {
      console.error('Error submitting answer:', error);
      res.status(500).json({
        error: 'Server error',
        details: 'An error occurred while submitting the answer',
      });
    } finally {
      client.release();
    }
  }

  // Submit exam
  async submitExam(req, res) {
    const client = await pool.connect();
    try {
      const { examId } = req.params; // This is actually exam_link_id
      const { studentId } = req.body;

      // First, get the actual exam_id and student_exam_id using the exam_link_id
      const examResult = await client.query(
        `SELECT e.exam_id, se.student_exam_id
         FROM exams e
         JOIN student_exams se ON e.exam_id = se.exam_id
         WHERE e.exam_link_id = $1 AND se.student_id::text = $2::text`,
        [examId, studentId]
      );

      if (examResult.rows.length === 0) {
        return res.status(404).json({
          error: 'Exam not found',
          details: 'No active exam session found for this student',
        });
      }

      const { exam_id, student_exam_id } = examResult.rows[0];

      // Verify exam is in progress
      const examCheck = await client.query(
        `SELECT se.*
         FROM student_exams se
         WHERE se.student_exam_id = $1 AND se.status = 'in_progress'`,
        [student_exam_id]
      );

      if (examCheck.rows.length === 0) {
        return res.status(404).json({
          error: 'Active exam not found',
          details: 'No active exam session found for this student',
        });
      }

      // Start transaction for grading
      await client.query('BEGIN');

      // Grade multiple choice and true/false questions
      await client.query(
        `UPDATE student_exam_questions seq
         SET is_correct = (
           SELECT qo.is_correct
           FROM question_options qo
           WHERE qo.question_id = seq.question_id
           AND qo.option_id::text = seq.student_answer
         )
         WHERE student_exam_id = $1
         AND EXISTS (
           SELECT 1 FROM questions q
           WHERE q.question_id = seq.question_id
           AND q.question_type IN ('multiple-choice', 'true/false')
         )`,
        [student_exam_id]
      );

      // Calculate score
      const scoreResult = await client.query(
        `SELECT
           COALESCE(
             SUM(CASE WHEN seq.is_correct THEN q.points ELSE 0 END)::numeric /
             NULLIF(SUM(q.points), 0) * 100,
             0
           ) as score
         FROM student_exam_questions seq
         JOIN questions q ON seq.question_id = q.question_id
         WHERE seq.student_exam_id = $1
         AND q.question_type IN ('multiple-choice', 'true/false')`,
        [student_exam_id]
      );

      const finalScore = parseFloat(scoreResult.rows[0].score) || 0;

      // Update exam status and score
      await client.query(
        `UPDATE student_exams
         SET status = 'completed',
             end_time = NOW(),
             score = $1
         WHERE student_exam_id = $2`,
        [finalScore, student_exam_id]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        score: finalScore,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error submitting exam:', error);
      res.status(500).json({
        error: 'Server error',
        details: 'An error occurred while submitting the exam',
      });
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
