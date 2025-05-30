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
