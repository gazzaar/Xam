const { Client } = require('pg');
const dotenv = require('dotenv');
const csv = require('csv-parse');
const fs = require('fs');

dotenv.config();

const dbUser = process.env.DB_USER;
const dbPass = process.env.DB_PASS;

const client = new Client({
  connectionString: `postgresql://${dbUser}:${dbPass}@localhost:5432/xam`,
});

client.connect();

const instructorController = {
  // Create a new exam
  createExam: async (req, res) => {
    const { exam_name, description, start_date, end_date, duration } = req.body;
    const instructor_id = req.user.user_id;

    try {
      // Start transaction
      await client.query('BEGIN');

      // Create exam
      const examResult = await client.query(
        `INSERT INTO exams
                (exam_name, description, start_date, end_date, duration, instructor_id, access_code, is_active)
                VALUES ($1, $2, $3, $4, $5, $6, $7, true)
                RETURNING exam_id`,
        [
          exam_name,
          description,
          start_date,
          end_date,
          duration,
          instructor_id,
          generateAccessCode(), // Helper function to generate unique access code
        ]
      );

      await client.query('COMMIT');

      res.status(201).json({
        success: true,
        message: 'Exam created successfully',
        data: {
          exam_id: examResult.rows[0].exam_id,
        },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error creating exam:', error);
      res.status(500).json({
        success: false,
        message: 'Error creating exam',
        error: error.message,
      });
    }
  },

  // Add questions to an exam
  addQuestions: async (req, res) => {
    const { exam_id } = req.params;
    const { questions } = req.body;
    const instructor_id = req.user.user_id;

    try {
      // Verify exam belongs to instructor
      const examCheck = await client.query(
        'SELECT exam_id FROM exams WHERE exam_id = $1 AND instructor_id = $2',
        [exam_id, instructor_id]
      );

      if (examCheck.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized to modify this exam',
        });
      }

      await client.query('BEGIN');

      // Add each question
      for (const question of questions) {
        const questionResult = await client.query(
          `INSERT INTO questions
                    (exam_id, question_type, question_text, score, order_num)
                    VALUES ($1, $2, $3, $4, $5)
                    RETURNING question_id`,
          [
            exam_id,
            question.type,
            question.text,
            question.score,
            question.order_num,
          ]
        );

        // If multiple choice or true/false, add options
        if (
          question.type === 'multiple-choice' ||
          question.type === 'true/false'
        ) {
          for (const option of question.options) {
            await client.query(
              `INSERT INTO options
                            (question_id, option_text, is_correct)
                            VALUES ($1, $2, $3)`,
              [
                questionResult.rows[0].question_id,
                option.text,
                option.is_correct,
              ]
            );
          }
        }
      }

      await client.query('COMMIT');

      res.status(200).json({
        success: true,
        message: 'Questions added successfully',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error adding questions:', error);
      res.status(500).json({
        success: false,
        message: 'Error adding questions',
        error: error.message,
      });
    }
  },

  // Upload allowed students list (CSV)
  uploadAllowedStudents: async (req, res) => {
    const { exam_id } = req.params;
    const instructor_id = req.user.user_id;
    const csvFile = req.file;

    try {
      // Verify exam belongs to instructor
      const examCheck = await client.query(
        'SELECT exam_id FROM exams WHERE exam_id = $1 AND instructor_id = $2',
        [exam_id, instructor_id]
      );

      if (examCheck.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized to modify this exam',
        });
      }

      await client.query('BEGIN');

      // Read and parse CSV file
      const students = await new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(csvFile.path)
          .pipe(
            csv({
              columns: true, // This will use the header row to name properties
              skip_empty_lines: true,
              trim: true,
            })
          )
          .on('data', (data) => {
            // Validate required fields
            if (!data.uni_id) {
              reject(new Error('Missing uni_id in CSV'));
              return;
            }
            results.push({
              uni_id: data.uni_id,
              student_name: data.student_name || null,
              student_email: data.student_email || null,
            });
          })
          .on('end', () => resolve(results))
          .on('error', reject);
      });

      // Insert allowed students
      for (const student of students) {
        await client.query(
          `INSERT INTO allowed_students (exam_id, uni_id, student_name, student_email)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (exam_id, uni_id)
           DO UPDATE SET
              student_name = EXCLUDED.student_name,
              student_email = EXCLUDED.student_email`,
          [exam_id, student.uni_id, student.student_name, student.student_email]
        );
      }

      await client.query('COMMIT');

      // Clean up uploaded file
      fs.unlinkSync(csvFile.path);

      res.status(200).json({
        success: true,
        message: 'Student list uploaded successfully',
        data: {
          students_added: students.length,
          students: students, // Return the processed list for confirmation
        },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error uploading student list:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Error uploading student list',
        error: error.message,
      });
    }
  },

  // Get instructor's exams
  getExams: async (req, res) => {
    const instructor_id = req.user.user_id;

    try {
      const result = await client.query(
        `SELECT e.*,
                    (SELECT COUNT(*) FROM allowed_students WHERE exam_id = e.exam_id) as total_students,
                    (SELECT COUNT(*) FROM exam_attempts WHERE exam_id = e.exam_id) as attempts_made
                FROM exams e
                WHERE e.instructor_id = $1
                ORDER BY e.start_date DESC`,
        [instructor_id]
      );

      res.status(200).json({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      console.error('Error fetching exams:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching exams',
        error: error.message,
      });
    }
  },

  // Get exam results
  getExamResults: async (req, res) => {
    const { exam_id } = req.params;
    const instructor_id = req.user.user_id;

    try {
      // Verify exam belongs to instructor
      const examCheck = await client.query(
        'SELECT exam_id FROM exams WHERE exam_id = $1 AND instructor_id = $2',
        [exam_id, instructor_id]
      );

      if (examCheck.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized to view this exam',
        });
      }

      const results = await client.query(
        `SELECT ea.uni_id, ea.start_time, ea.end_time, ea.score,
                        json_agg(json_build_object(
                            'question_id', a.question_id,
                            'answer_text', a.answer_text,
                            'is_correct', a.is_correct,
                            'score', a.score
                        )) as answers
                FROM exam_attempts ea
                LEFT JOIN answers a ON ea.attempt_id = a.attempt_id
                WHERE ea.exam_id = $1
                GROUP BY ea.attempt_id, ea.uni_id, ea.start_time, ea.end_time, ea.score
                ORDER BY ea.end_time DESC`,
        [exam_id]
      );

      res.status(200).json({
        success: true,
        data: results.rows,
      });
    } catch (error) {
      console.error('Error fetching exam results:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching exam results',
        error: error.message,
      });
    }
  },

  // Update an exam
  updateExam: async (req, res) => {
    const { exam_id } = req.params;
    const {
      exam_name,
      description,
      start_date,
      end_date,
      duration,
      is_active,
    } = req.body;
    const instructor_id = req.user.user_id;

    try {
      // Verify exam belongs to instructor
      const examCheck = await client.query(
        'SELECT exam_id FROM exams WHERE exam_id = $1 AND instructor_id = $2',
        [exam_id, instructor_id]
      );

      if (examCheck.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized to modify this exam',
        });
      }

      // Check if exam has any attempts before allowing updates
      const attemptsCheck = await client.query(
        'SELECT COUNT(*) as attempt_count FROM exam_attempts WHERE exam_id = $1',
        [exam_id]
      );

      if (attemptsCheck.rows[0].attempt_count > 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot modify exam that has been attempted by students',
        });
      }

      await client.query('BEGIN');

      const result = await client.query(
        `UPDATE exams
         SET exam_name = COALESCE($1, exam_name),
             description = COALESCE($2, description),
             start_date = COALESCE($3, start_date),
             end_date = COALESCE($4, end_date),
             duration = COALESCE($5, duration),
             is_active = COALESCE($6, is_active)
         WHERE exam_id = $7 AND instructor_id = $8
         RETURNING *`,
        [
          exam_name,
          description,
          start_date,
          end_date,
          duration,
          is_active,
          exam_id,
          instructor_id,
        ]
      );

      await client.query('COMMIT');

      res.status(200).json({
        success: true,
        message: 'Exam updated successfully',
        data: result.rows[0],
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error updating exam:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating exam',
        error: error.message,
      });
    }
  },

  // Delete an exam
  deleteExam: async (req, res) => {
    const { exam_id } = req.params;
    const instructor_id = req.user.user_id;

    try {
      // Verify exam belongs to instructor
      const examCheck = await client.query(
        'SELECT exam_id FROM exams WHERE exam_id = $1 AND instructor_id = $2',
        [exam_id, instructor_id]
      );

      if (examCheck.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized to delete this exam',
        });
      }

      // Check if exam has any attempts before deletion
      const attemptsCheck = await client.query(
        'SELECT COUNT(*) as attempt_count FROM exam_attempts WHERE exam_id = $1',
        [exam_id]
      );

      if (attemptsCheck.rows[0].attempt_count > 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete exam that has been attempted by students',
        });
      }

      await client.query('BEGIN');

      // Delete in this order due to foreign key constraints:
      // 1. Delete allowed students
      await client.query('DELETE FROM allowed_students WHERE exam_id = $1', [
        exam_id,
      ]);

      // 2. Delete options (connected to questions)
      await client.query(
        'DELETE FROM options WHERE question_id IN (SELECT question_id FROM questions WHERE exam_id = $1)',
        [exam_id]
      );

      // 3. Delete questions
      await client.query('DELETE FROM questions WHERE exam_id = $1', [exam_id]);

      // 4. Finally delete the exam
      await client.query(
        'DELETE FROM exams WHERE exam_id = $1 AND instructor_id = $2',
        [exam_id, instructor_id]
      );

      await client.query('COMMIT');

      res.status(200).json({
        success: true,
        message: 'Exam deleted successfully',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error deleting exam:', error);
      res.status(500).json({
        success: false,
        message: 'Error deleting exam',
        error: error.message,
      });
    }
  },

  // Get instructor dashboard statistics
  getDashboardStats: async (req, res) => {
    const instructor_id = req.user.user_id;

    try {
      const stats = await Promise.all([
        // Count total exams
        client.query(
          `
          SELECT COUNT(*) as total_exams
          FROM exams
          WHERE instructor_id = $1
        `,
          [instructor_id]
        ),

        // Count active exams
        client.query(
          `
          SELECT COUNT(*) as active_exams
          FROM exams
          WHERE instructor_id = $1
          AND is_active = true
          AND end_date > NOW()
        `,
          [instructor_id]
        ),

        // Count completed exams
        client.query(
          `
          SELECT COUNT(*) as completed_exams
          FROM exams
          WHERE instructor_id = $1
          AND end_date < NOW()
        `,
          [instructor_id]
        ),

        // Count pending exams (active but not started)
        client.query(
          `
          SELECT COUNT(*) as pending_exams
          FROM exams
          WHERE instructor_id = $1
          AND is_active = true
          AND start_date > NOW()
        `,
          [instructor_id]
        ),
      ]);

      res.status(200).json({
        success: true,
        data: {
          totalExams: parseInt(stats[0].rows[0].total_exams),
          activeExams: parseInt(stats[1].rows[0].active_exams),
          completedExams: parseInt(stats[2].rows[0].completed_exams),
          pendingExams: parseInt(stats[3].rows[0].pending_exams),
        },
      });
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching dashboard statistics',
        error: error.message,
      });
    }
  },
};

// Helper function to generate unique access code
function generateAccessCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

module.exports = instructorController;
