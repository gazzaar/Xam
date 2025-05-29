const fs = require('fs');
const { parse } = require('csv-parse/sync');
const path = require('path');
const multer = require('multer');
const pool = require('../db/pool');

// Configure multer for CSV file uploads
const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  // Accept only CSV files
  if (file.mimetype !== 'text/csv') {
    return cb(new Error('Only CSV files are allowed'));
  }
  cb(null, true);
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter,
});
const { v4: uuidv4 } = require('uuid');

// Helper function to handle database errors
const handleDbError = (res, error) => {
  console.error('Database error:', error);
  res.status(500).json({ error: 'Database error', details: error.message });
};

class InstructorController {
  // Get instructor's assigned courses
  async getCourses(req, res) {
    const client = await pool.connect();
    try {
      const user_id = req.user.userId;

      // Get only courses assigned to the instructor
      const result = await client.query(
        `SELECT DISTINCT c.*,
          (
            SELECT COUNT(*)
            FROM question_banks qb
            WHERE qb.course_id = c.course_id
          ) as question_banks_count,
          (
            SELECT COUNT(*)
            FROM questions q
            JOIN question_banks qb ON q.question_bank_id = qb.question_bank_id
            WHERE qb.course_id = c.course_id
          ) as total_questions
         FROM courses c
         JOIN course_assignments ca ON c.course_id = ca.course_id
         WHERE ca.instructor_id = $1 AND ca.is_active = true
         ORDER BY c.created_at DESC`,
        [user_id]
      );

      res.json(result.rows);
    } catch (error) {
      handleDbError(res, error);
    } finally {
      client.release();
    }
  }

  // Create a new course
  async createCourse(req, res) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { course_name, course_code, description } = req.body;
      const user_id = req.user.userId;

      // Create course (using the new schema)
      const courseResult = await client.query(
        `INSERT INTO courses (course_name, course_code, description, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING course_id, course_name, course_code, description`,
        [course_name, course_code, description, user_id]
      );

      // Create course assignment for the instructor
      await client.query(
        `INSERT INTO course_assignments (course_id, instructor_id, assigned_by)
         VALUES ($1, $2, $3)`,
        [courseResult.rows[0].course_id, user_id, user_id]
      );

      await client.query('COMMIT');

      // Return the course data in the same format as getCourses
      const result = await client.query(
        `SELECT c.course_id, c.course_name, c.course_code, c.description
         FROM courses c
         JOIN course_assignments ca ON c.course_id = ca.course_id
         WHERE c.course_id = $1 AND ca.instructor_id = $2 AND ca.is_active = true`,
        [courseResult.rows[0].course_id, user_id]
      );

      res.status(201).json(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      handleDbError(res, error);
    } finally {
      client.release();
    }
  }

  // Delete course
  async deleteCourse(req, res) {
    const client = await pool.connect();
    try {
      const user_id = req.user.userId;
      const { course_id } = req.params;

      // Verify the course belongs to the instructor through course_assignments
      const courseResult = await client.query(
        `SELECT * FROM course_assignments WHERE course_id = $1 AND instructor_id = $2 AND is_active = true`,
        [course_id, user_id]
      );

      if (courseResult.rows.length === 0) {
        return res
          .status(403)
          .json({ error: 'You do not have permission to delete this course' });
      }

      // Check if there are any exams using this course
      const examsResult = await client.query(
        `SELECT * FROM exams WHERE course_id = $1`,
        [course_id]
      );

      if (examsResult.rows.length > 0) {
        return res.status(400).json({
          error: 'Cannot delete course that is being used by exams',
          count: examsResult.rows.length,
        });
      }

      // Begin transaction
      await client.query('BEGIN');

      // Delete all question banks associated with this course
      await client.query(`DELETE FROM question_banks WHERE course_id = $1`, [
        course_id,
      ]);

      // Delete course assignments
      await client.query(
        `DELETE FROM course_assignments WHERE course_id = $1`,
        [course_id]
      );

      // Delete the course
      await client.query(`DELETE FROM courses WHERE course_id = $1`, [
        course_id,
      ]);

      await client.query('COMMIT');

      res.status(200).json({
        message: 'Course deleted successfully',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error deleting course:', error);
      handleDbError(res, error);
    } finally {
      client.release();
    }
  }

  // Create a question bank
  async createQuestionBank(req, res) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { course_id, bank_name, description } = req.body;
      const user_id = req.user.userId;

      // Verify instructor has access to the course
      const courseCheck = await client.query(
        `SELECT course_id
         FROM course_assignments
         WHERE course_id = $1 AND instructor_id = $2 AND is_active = true`,
        [course_id, user_id]
      );

      if (courseCheck.rows.length === 0) {
        return res.status(403).json({
          error: 'Unauthorized to create question bank for this course',
        });
      }

      // Create question bank
      const result = await client.query(
        `INSERT INTO question_banks
         (bank_name, description, course_id, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING question_bank_id, bank_name, description`,
        [bank_name, description, course_id, user_id]
      );

      await client.query('COMMIT');

      res.status(201).json({
        question_bank: {
          ...result.rows[0],
          created_by: user_id,
          is_owner: true,
          creator_name: req.user.username,
        },
        message: 'Question bank created successfully',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      handleDbError(res, error);
    } finally {
      client.release();
    }
  }

  // Get question banks for a course
  async getQuestionBanks(req, res) {
    try {
      const user_id = req.user.userId;
      const course_id = req.query.course_id;

      const result = await pool.query(
        `SELECT qb.question_bank_id, qb.bank_name, qb.description,
                qb.created_by, qb.created_at,
                u.username as creator_name
         FROM question_banks qb
         JOIN courses c ON qb.course_id = c.course_id
         JOIN course_assignments ca ON c.course_id = ca.course_id
         LEFT JOIN users u ON qb.created_by = u.user_id
         WHERE c.course_id = $1
         AND ca.instructor_id = $2
         AND ca.is_active = true
         ORDER BY qb.created_at DESC`,
        [course_id, user_id]
      );

      // Add a flag to indicate if the current user created the question bank
      const questionBanks = result.rows.map((bank) => ({
        ...bank,
        is_owner: bank.created_by === user_id,
      }));

      res.json(questionBanks);
    } catch (error) {
      handleDbError(res, error);
    }
  }

  // Add questions to a question bank
  async addQuestionsToQuestionBank(req, res) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { question_bank_id } = req.params;
      const { questions } = req.body;
      const user_id = req.user.userId;

      // Verify instructor owns the question bank
      const bankCheck = await client.query(
        `SELECT qb.question_bank_id, qb.course_id
         FROM question_banks qb
         JOIN courses c ON qb.course_id = c.course_id
         JOIN course_assignments ca ON c.course_id = ca.course_id
         WHERE qb.question_bank_id = $1
         AND ca.instructor_id = $2
         AND ca.is_active = true`,
        [question_bank_id, user_id]
      );

      if (bankCheck.rows.length === 0) {
        return res.status(403).json({
          error: 'Unauthorized to modify this question bank',
        });
      }

      const course_id = bankCheck.rows[0].course_id;

      // Add each question
      for (const question of questions) {
        // Validate points
        const points = parseInt(question.points) || 1;
        if (points < 1 || points > 15) {
          return res.status(400).json({
            error: 'Question points must be between 1 and 15',
          });
        }

        const questionResult = await client.query(
          `INSERT INTO questions
           (question_text, question_type, points, image_url, chapter, question_bank_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING question_id`,
          [
            question.question_text,
            question.question_type,
            points,
            question.image_url,
            question.chapter,
            question_bank_id,
            user_id,
          ]
        );

        // Add options if multiple-choice
        if (question.options && question.options.length > 0) {
          for (const option of question.options) {
            // Ensure is_correct is a boolean
            const isCorrect = option.is_correct === true;
            await client.query(
              `INSERT INTO question_options (question_id, option_text, is_correct)
               VALUES ($1, $2, $3)`,
              [questionResult.rows[0].question_id, option.text, isCorrect]
            );
          }
        }
      }

      await client.query('COMMIT');

      res.status(201).json({
        message: 'Questions added successfully',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      handleDbError(res, error);
    } finally {
      client.release();
    }
  }

  // Get questions in a question bank
  async getQuestionsInQuestionBank(req, res) {
    try {
      const { question_bank_id } = req.params;
      const user_id = req.user.userId;

      // Log the question bank ID for debugging
      console.log('Fetching questions for question bank ID:', question_bank_id);

      // First verify that the user has access to this question bank
      const accessCheck = await pool.query(
        `SELECT qb.question_bank_id
         FROM question_banks qb
         JOIN courses c ON qb.course_id = c.course_id
         JOIN course_assignments ca ON c.course_id = ca.course_id
         WHERE qb.question_bank_id = $1
         AND ca.instructor_id = $2
         AND ca.is_active = true`,
        [question_bank_id, user_id]
      );

      if (accessCheck.rows.length === 0) {
        return res.status(403).json({
          error: 'You do not have permission to access this question bank',
        });
      }

      // Get all the questions in the question bank
      const questionsResult = await pool.query(
        `SELECT q.*
         FROM questions q
         WHERE q.question_bank_id = $1
         ORDER BY q.created_at DESC`,
        [question_bank_id]
      );

      // For each question, get its options and correct answers
      const questions = [];
      for (const question of questionsResult.rows) {
        // Log the question ID for debugging
        console.log('Processing question ID:', question.question_id);

        const optionsResult = await pool.query(
          `SELECT option_id, option_text, is_correct
           FROM question_options
           WHERE question_id = $1
           ORDER BY option_id ASC`,
          [question.question_id]
        );

        console.log(
          'Options result:',
          JSON.stringify(optionsResult.rows, null, 2)
        );

        // Extract options and correct answers into separate arrays
        const options = optionsResult.rows.map((row) => row.option_text);
        const correct_answers = optionsResult.rows.map((row) => row.is_correct);

        console.log('Processed options:', options);
        console.log('Processed correct_answers:', correct_answers);

        // Add the options and correct answers to the question
        questions.push({
          ...question,
          options,
          correct_answers,
        });
      }

      // Log the result for debugging
      console.log('Questions result:', JSON.stringify(questions, null, 2));

      res.json(questions);
    } catch (error) {
      handleDbError(res, error);
    }
  }

  // Update question
  async updateQuestion(req, res) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { question_id } = req.params;
      const {
        question_text,
        question_type,
        points,
        image_url,
        chapter,
        options,
        explanation,
      } = req.body;
      const user_id = req.user.user_id;

      console.log('Updating question:', question_id);
      console.log('Question data:', req.body);

      // Verify instructor owns the question
      const questionCheck = await client.query(
        `SELECT q.question_id
         FROM questions q
         WHERE q.question_id = $1 AND q.instructor_id = $2`,
        [question_id, user_id]
      );

      if (questionCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Unauthorized to modify this question',
        });
      }

      // Update question
      await client.query(
        `UPDATE questions
         SET question_text = $1,
             question_type = $2,
             points = $3,
             image_url = $4,
             chapter = $5,
             explanation = $6
         WHERE question_id = $7`,
        [
          question_text,
          question_type,
          points,
          image_url,
          chapter,
          explanation,
          question_id,
        ]
      );

      // Delete existing options
      await client.query(
        `DELETE FROM question_options WHERE question_id = $1`,
        [question_id]
      );

      // Add new options
      if (options && options.length > 0) {
        for (const option of options) {
          // Ensure is_correct is a boolean
          const isCorrect = option.is_correct === true;

          await client.query(
            `INSERT INTO question_options (question_id, option_text, is_correct)
             VALUES ($1, $2, $3)`,
            [question_id, option.text, isCorrect]
          );
        }
      }

      await client.query('COMMIT');

      res.status(200).json({
        message: 'Question updated successfully',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      handleDbError(res, error);
    } finally {
      client.release();
    }
  }

  // Delete question
  async deleteQuestion(req, res) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { question_id } = req.params;
      const user_id = req.user.user_id;

      console.log('Deleting question:', question_id);

      // Verify instructor owns the question
      const questionCheck = await client.query(
        `SELECT q.question_id
         FROM questions q
         WHERE q.question_id = $1 AND q.instructor_id = $2`,
        [question_id, user_id]
      );

      if (questionCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Unauthorized to delete this question',
        });
      }

      // Delete question (options will be deleted via CASCADE)
      await client.query(`DELETE FROM questions WHERE question_id = $1`, [
        question_id,
      ]);

      await client.query('COMMIT');

      res.status(200).json({
        message: 'Question deleted successfully',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      handleDbError(res, error);
    } finally {
      client.release();
    }
  }

  // Delete question from question bank
  async deleteQuestionFromQuestionBank(req, res) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { question_bank_id, question_id } = req.params;
      const user_id = req.user.userId;

      console.log(
        'Deleting question:',
        question_id,
        'from question bank:',
        question_bank_id
      );

      // Verify instructor has access to the question bank
      const bankCheck = await client.query(
        `SELECT qb.question_bank_id
         FROM question_banks qb
         JOIN courses c ON qb.course_id = c.course_id
         JOIN course_assignments ca ON c.course_id = ca.course_id
         WHERE qb.question_bank_id = $1
         AND ca.instructor_id = $2
         AND ca.is_active = true`,
        [question_bank_id, user_id]
      );

      if (bankCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Unauthorized to modify this question bank',
        });
      }

      // Delete the question (cascade will handle question_options)
      await client.query(
        `DELETE FROM questions
         WHERE question_id = $1
         AND question_bank_id = $2`,
        [question_id, question_bank_id]
      );

      await client.query('COMMIT');

      res.status(200).json({
        message: 'Question removed successfully',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error deleting question:', error);
      handleDbError(res, error);
    } finally {
      client.release();
    }
  }

  // Update question in question bank
  async updateQuestionInQuestionBank(req, res) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { question_bank_id, question_id } = req.params;
      const questionData = req.body;
      const user_id = req.user.userId;

      // Verify instructor has access to the question bank
      const bankCheck = await client.query(
        `SELECT qb.question_bank_id
         FROM question_banks qb
         JOIN courses c ON qb.course_id = c.course_id
         JOIN course_assignments ca ON c.course_id = ca.course_id
         WHERE qb.question_bank_id = $1
         AND ca.instructor_id = $2
         AND ca.is_active = true`,
        [question_bank_id, user_id]
      );

      if (bankCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Unauthorized to modify this question bank',
        });
      }

      // Validate points
      const updatedPoints = parseInt(questionData.points) || 1;
      if (updatedPoints < 1 || updatedPoints > 15) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Question points must be between 1 and 15',
        });
      }

      // Update question
      await client.query(
        `UPDATE questions
         SET question_text = $1,
             question_type = $2,
             points = $3,
             image_url = $4,
             chapter = $5
         WHERE question_id = $6
         AND question_bank_id = $7`,
        [
          questionData.question_text || '',
          questionData.question_type || 'multiple-choice',
          updatedPoints,
          questionData.image_url || '',
          questionData.chapter || '',
          question_id,
          question_bank_id,
        ]
      );

      // Delete existing options
      await client.query(
        `DELETE FROM question_options WHERE question_id = $1`,
        [question_id]
      );

      // Add new options
      if (questionData.options && Array.isArray(questionData.options)) {
        for (const option of questionData.options) {
          if (!option || typeof option !== 'object') continue;
          const optionText = option.text || '';
          const isCorrect = option.is_correct === true;

          await client.query(
            `INSERT INTO question_options (question_id, option_text, is_correct)
             VALUES ($1, $2, $3)`,
            [question_id, optionText, isCorrect]
          );
        }
      }

      await client.query('COMMIT');

      res.status(200).json({
        message: 'Question updated successfully',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error updating question:', error);
      handleDbError(res, error);
    } finally {
      client.release();
    }
  }

  // Create exam
  async createExam(req, res) {
    const client = await pool.connect();
    try {
      const user_id = req.user.user_id;
      const {
        exam_name,
        description,
        start_date,
        end_date,
        duration,
        course_id,
        question_bank_id,
        total_questions,
        chapterDistribution,
        difficultyDistribution,
        is_randomized = true,
      } = req.body;

      // Validate required fields
      if (!exam_name || !start_date || !end_date || !duration) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Validate chapter distribution
      if (
        !chapterDistribution ||
        !Array.isArray(chapterDistribution) ||
        chapterDistribution.length === 0
      ) {
        return res.status(400).json({ error: 'Invalid chapter distribution' });
      }

      // Generate a unique access code using UUID (10 characters)
      const accessCode = uuidv4().replace(/-/g, '').substring(0, 10);

      // Begin transaction
      await client.query('BEGIN');

      // Store the difficulty distribution and other metadata as JSON in the description field
      const examMetadata = {
        course_id,
        question_bank_id,
        total_questions,
        difficultyDistribution,
        is_randomized,
      };

      // Combine the description with the metadata
      const fullDescription = description || '';
      const metadataString = JSON.stringify(examMetadata);

      // Insert exam
      const examResult = await client.query(
        `INSERT INTO exams (
          exam_name,
          description,
          exam_metadata,
          time_limit_minutes,
          start_date,
          end_date,
          instructor_id,
          access_code,
          is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING exam_id`,
        [
          exam_name,
          description, // Store the actual description
          examMetadata, // Store the metadata as JSON
          duration,
          new Date(start_date),
          new Date(end_date),
          user_id,
          accessCode,
          true, // is_active
        ]
      );

      const exam_id = examResult.rows[0].exam_id;

      // Insert chapter distribution
      for (const item of chapterDistribution) {
        await client.query(
          `INSERT INTO exam_specifications (
            exam_id,
            chapter,
            num_questions
          )
          VALUES ($1, $2, $3)`,
          [exam_id, item.chapter, item.count]
        );
      }

      await client.query('COMMIT');

      const response = {
        exam_id: exam_id.toString(),
        access_code: accessCode,
      };
      console.log('Sending exam creation response:', response);
      res.status(201).json(response);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error creating exam:', error);
      handleDbError(res, error);
    } finally {
      client.release();
    }
  }

  // Helper method to generate random code (not used anymore)
  generateRandomCode(length) {
    // This method is no longer used - we're using UUID instead
    return '';
  }

  // Delete question bank
  async deleteQuestionBank(req, res) {
    const client = await pool.connect();
    try {
      const user_id = req.user.userId;
      const { question_bank_id } = req.params;

      // Verify the question bank belongs to the instructor through course assignments
      const bankResult = await client.query(
        `SELECT qb.question_bank_id, qb.course_id
         FROM question_banks qb
         JOIN courses c ON qb.course_id = c.course_id
         JOIN course_assignments ca ON c.course_id = ca.course_id
         WHERE qb.question_bank_id = $1
         AND ca.instructor_id = $2
         AND ca.is_active = true`,
        [question_bank_id, user_id]
      );

      if (bankResult.rows.length === 0) {
        return res.status(403).json({
          error: 'You do not have permission to delete this question bank',
        });
      }

      // Begin transaction
      await client.query('BEGIN');

      // Delete all questions in this bank (cascade will handle question_options)
      await client.query(`DELETE FROM questions WHERE question_bank_id = $1`, [
        question_bank_id,
      ]);

      // Delete the question bank
      await client.query(
        `DELETE FROM question_banks WHERE question_bank_id = $1`,
        [question_bank_id]
      );

      await client.query('COMMIT');

      res.status(200).json({
        message: 'Question bank deleted successfully',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error deleting question bank:', error);
      handleDbError(res, error);
    } finally {
      client.release();
    }
  }

  // Generate exam (placeholder)
  async generateExam(req, res) {
    res.status(501).json({ message: 'Not implemented yet' });
  }

  // Add question (placeholder)
  async addQuestion(req, res) {
    res.status(501).json({ message: 'Not implemented yet' });
  }

  // Get questions (placeholder)
  async getQuestions(req, res) {
    res.status(501).json({ message: 'Not implemented yet' });
  }

  // Get exams
  async getExams(req, res) {
    try {
      const user_id = req.user.userId;

      // Get all exams for this instructor by checking course assignments
      const examsResult = await pool.query(
        `SELECT DISTINCT
          e.exam_id,
          e.exam_name,
          e.description,
          e.time_limit_minutes AS duration,
          e.start_date,
          e.end_date,
          e.access_code AS exam_link_id,
          e.is_active,
          e.created_at,
          e.course_id,
          e.is_randomized,
          e.status
        FROM exams e
        JOIN courses c ON e.course_id = c.course_id
        JOIN course_assignments ca ON c.course_id = ca.course_id
        WHERE (e.created_by = $1 OR ca.instructor_id = $1)
          AND ca.is_active = true
        ORDER BY e.created_at DESC`,
        [user_id]
      );

      console.log('Exams query result:', examsResult.rows);

      if (examsResult.rows.length === 0) {
        return res.json([]);
      }

      // Helper function to calculate exam status
      const calculateStatus = (startDate, endDate) => {
        const now = new Date();
        const start = new Date(startDate);
        const end = new Date(endDate);

        if (now < start) {
          return 'upcoming';
        } else if (now >= start && now <= end) {
          return 'active';
        } else {
          return 'completed';
        }
      };

      // Get question distribution for each exam
      const exams = await Promise.all(
        examsResult.rows.map(async (exam) => {
          // Get question distribution
          const distributionResult = await pool.query(
            `SELECT
              es.chapter,
              es.num_questions AS count
            FROM exam_specifications es
            WHERE es.exam_id = $1`,
            [exam.exam_id]
          );

          // Get count of allowed students
          const studentsResult = await pool.query(
            `SELECT COUNT(*) AS student_count
            FROM allowed_students
            WHERE exam_id = $1`,
            [exam.exam_id]
          );

          // Format the exam data
          return {
            ...exam,
            question_references: distributionResult.rows,
            student_count: parseInt(studentsResult.rows[0].student_count) || 0,
            // Use database status if available, otherwise calculate it
            status:
              exam.status || calculateStatus(exam.start_date, exam.end_date),
          };
        })
      );

      console.log('Formatted exams:', exams);
      res.json(exams);
    } catch (error) {
      console.error('Error fetching exams:', error);
      handleDbError(res, error);
    }
  }

  // Delete exam
  async deleteExam(req, res) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { exam_id } = req.params;
      const user_id = req.user.user_id;

      if (!exam_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Exam ID is required' });
      }

      // Verify instructor owns the exam
      const examCheck = await client.query(
        'SELECT exam_id, start_date FROM exams WHERE exam_id = $1 AND instructor_id = $2',
        [exam_id, user_id]
      );

      if (examCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Unauthorized to delete this exam',
        });
      }

      // Check if the exam has already started
      const examData = examCheck.rows[0];
      const startDate = new Date(examData.start_date);
      const now = new Date();

      if (now >= startDate) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Cannot delete an exam that has already started or completed',
        });
      }

      // Delete the exam and all related data (cascade will handle dependencies)
      await client.query('DELETE FROM exams WHERE exam_id = $1', [exam_id]);

      await client.query('COMMIT');

      res.status(200).json({
        message: 'Exam deleted successfully',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error deleting exam:', error);
      handleDbError(res, error);
    } finally {
      client.release();
    }
  }

  // Add questions to exam (placeholder)
  async addQuestions(req, res) {
    res.status(501).json({ message: 'Not implemented yet' });
  }

  // Upload allowed students
  async uploadAllowedStudents(req, res) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { exam_id } = req.params;
      const user_id = req.user.user_id;

      if (!exam_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Exam ID is required' });
      }

      // Verify instructor owns the exam
      const examCheck = await client.query(
        'SELECT exam_id FROM exams WHERE exam_id = $1 AND instructor_id = $2',
        [exam_id, user_id]
      );

      if (examCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Unauthorized to modify this exam',
        });
      }

      // Handle the file upload
      upload.single('students')(req, res, async (err) => {
        if (err) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: err.message });
        }

        if (!req.file) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'No file uploaded' });
        }

        try {
          // Parse the CSV file
          const csvContent = req.file.buffer.toString('utf8');
          const records = parse(csvContent, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
          });

          if (records.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'CSV file is empty' });
          }

          // Clear existing allowed students for this exam
          await client.query(
            'DELETE FROM allowed_students WHERE exam_id = $1',
            [exam_id]
          );

          // Insert new allowed students
          let insertedCount = 0;
          for (const record of records) {
            // Validate required fields
            if (!record.student_id || !record.name) {
              console.warn('Skipping invalid record:', record);
              continue;
            }

            await client.query(
              `INSERT INTO allowed_students (exam_id, uni_id, student_name)
               VALUES ($1, $2, $3)`,
              [exam_id, record.student_id, record.name]
            );

            insertedCount++;
          }

          await client.query('COMMIT');

          res.status(200).json({
            message: `Successfully uploaded ${insertedCount} students`,
            exam_id,
          });
        } catch (error) {
          await client.query('ROLLBACK');
          console.error('Error processing CSV:', error);
          res.status(500).json({
            error: 'Error processing CSV file',
            details: error.message,
          });
        }
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error uploading students:', error);
      handleDbError(res, error);
    }
  }

  // Get exam results (placeholder)
  async getExamResults(req, res) {
    res.status(501).json({ message: 'Not implemented yet' });
  }

  // Get dashboard stats (placeholder)
  async getDashboardStats(req, res) {
    res.status(501).json({ message: 'Not implemented yet' });
  }

  // Update exam
  async updateExam(req, res) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { exam_id } = req.params;
      const {
        exam_name,
        description,
        duration,
        start_date,
        end_date,
        is_randomized,
        question_distribution,
      } = req.body;

      const user_id = req.user.user_id;

      if (!exam_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Exam ID is required' });
      }

      // Verify instructor owns the exam
      const examCheck = await client.query(
        'SELECT exam_id, start_date FROM exams WHERE exam_id = $1 AND instructor_id = $2',
        [exam_id, user_id]
      );

      if (examCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Unauthorized to modify this exam',
        });
      }

      // Check if the exam has already started
      const examData = examCheck.rows[0];
      const startDate = new Date(examData.start_date);
      const now = new Date();

      if (now >= startDate) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Cannot modify an exam that has already started or completed',
        });
      }

      // Update the exam
      const updateFields = [];
      const updateValues = [];
      let valueIndex = 1;

      if (exam_name) {
        updateFields.push(`exam_name = $${valueIndex}`);
        updateValues.push(exam_name);
        valueIndex++;
      }

      if (description !== undefined) {
        updateFields.push(`description = $${valueIndex}`);
        updateValues.push(description);
        valueIndex++;
      }

      if (duration) {
        updateFields.push(`time_limit_minutes = $${valueIndex}`);
        updateValues.push(duration);
        valueIndex++;
      }

      if (start_date) {
        updateFields.push(`start_date = $${valueIndex}`);
        updateValues.push(new Date(start_date));
        valueIndex++;
      }

      if (end_date) {
        updateFields.push(`end_date = $${valueIndex}`);
        updateValues.push(new Date(end_date));
        valueIndex++;
      }

      if (is_randomized !== undefined) {
        updateFields.push(`is_randomized = $${valueIndex}`);
        updateValues.push(is_randomized);
        valueIndex++;
      }

      if (updateFields.length > 0) {
        updateValues.push(exam_id);
        await client.query(
          `UPDATE exams SET ${updateFields.join(', ')} WHERE exam_id = $${valueIndex}`,
          updateValues
        );
      }

      // Update question distribution if provided
      if (
        question_distribution &&
        Array.isArray(question_distribution) &&
        question_distribution.length > 0
      ) {
        // Delete existing specifications
        await client.query(
          'DELETE FROM exam_specifications WHERE exam_id = $1',
          [exam_id]
        );

        // Add new specifications
        for (const item of question_distribution) {
          if (!item.chapter || !item.count || item.count < 1) {
            continue; // Skip invalid entries
          }

          await client.query(
            `INSERT INTO exam_specifications (
              exam_id,
              chapter,
              num_questions
            )
            VALUES ($1, $2, $3)`,
            [exam_id, item.chapter, item.count]
          );
        }
      }

      await client.query('COMMIT');

      res.status(200).json({
        message: 'Exam updated successfully',
        exam_id,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error updating exam:', error);
      handleDbError(res, error);
    } finally {
      client.release();
    }
  }

  // Get exam preview for instructors
  async getExamPreview(req, res) {
    try {
      const user_id = req.user.userId;
      const exam_id = req.params.id;

      console.log('Fetching exam preview:', { exam_id, user_id });

      // First, check if the exam exists and belongs to this instructor through either direct creation or course assignment
      const examResult = await pool.query(
        `SELECT
          e.exam_id,
          e.exam_name,
          e.description,
          e.time_limit_minutes AS duration,
          e.start_date,
          e.end_date,
          e.access_code AS exam_link_id,
          e.is_active,
          e.created_at,
          e.created_by,
          e.course_id,
          e.exam_metadata
        FROM exams e
        LEFT JOIN courses c ON e.course_id = c.course_id
        LEFT JOIN course_assignments ca ON c.course_id = ca.course_id
        WHERE e.exam_id = $1
        AND (e.created_by = $2 OR ca.instructor_id = $2)
        AND ca.is_active = true
        LIMIT 1`,
        [exam_id, user_id]
      );

      console.log('Exam query result:', examResult.rows);

      if (examResult.rows.length === 0) {
        console.log('No exam found or no permission:', { exam_id, user_id });
        return res.status(404).json({
          error: 'Exam not found or you do not have permission to view it',
        });
      }

      const exam = examResult.rows[0];
      console.log('Found exam:', exam);

      // Get question distribution
      const distributionResult = await pool.query(
        `SELECT
          es.chapter,
          es.num_questions AS count
        FROM exam_specifications es
        WHERE es.exam_id = $1`,
        [exam_id]
      );

      console.log('Distribution result:', distributionResult.rows);

      // Get count of allowed students
      const studentsResult = await pool.query(
        `SELECT COUNT(*) AS student_count
        FROM allowed_students
        WHERE exam_id = $1`,
        [exam_id]
      );

      // Calculate status based on dates
      const calculateStatus = (startDate, endDate) => {
        const now = new Date();
        const start = new Date(startDate);
        const end = new Date(endDate);

        if (now < start) {
          return 'upcoming';
        } else if (now >= start && now <= end) {
          return 'active';
        } else {
          return 'completed';
        }
      };

      // Format the exam data
      const examData = {
        ...exam,
        question_references: distributionResult.rows,
        student_count: parseInt(studentsResult.rows[0].student_count) || 0,
        status: calculateStatus(exam.start_date, exam.end_date),
      };

      console.log('Formatted exam data:', examData);

      // Get a sample of questions for each chapter in the distribution
      const sampleQuestions = [];

      // For each chapter in the distribution, get a sample of questions
      for (const spec of distributionResult.rows) {
        const chapter = spec.chapter;
        const count = Math.min(spec.count, 2); // Get at most 2 sample questions per chapter

        console.log('Fetching questions for chapter:', { chapter, count });

        // Get random questions from this chapter from the course's question banks
        const questionsResult = await pool.query(
          `WITH RandomQuestions AS (
            SELECT DISTINCT ON (q.question_id)
              q.question_id,
              q.question_text,
              q.question_type,
              q.chapter,
              random() as rand
            FROM questions q
            JOIN question_banks qb ON q.question_bank_id = qb.question_bank_id
            WHERE q.chapter = $1
            AND qb.course_id = $2
          )
          SELECT
            question_id,
            question_text,
            question_type,
            chapter
          FROM RandomQuestions
          ORDER BY rand
          LIMIT $3`,
          [chapter, exam.course_id, count]
        );

        console.log('Questions for chapter:', {
          chapter,
          questions: questionsResult.rows,
        });

        // For each question, get its options
        for (const question of questionsResult.rows) {
          // Get options for this question
          const optionsResult = await pool.query(
            `SELECT
              option_id,
              option_text,
              is_correct
            FROM question_options
            WHERE question_id = $1
            ORDER BY option_id`,
            [question.question_id]
          );

          // Add options to the question
          question.options = optionsResult.rows;

          // For true/false and multiple-choice questions, format the data for the frontend
          if (question.question_type === 'true/false') {
            // Find the correct option
            const correctOption = optionsResult.rows.find(
              (option) => option.is_correct
            );
            question.correct_answer = correctOption
              ? correctOption.option_text === 'True'
              : null;
          } else if (question.question_type === 'multiple-choice') {
            // Rename options to answers for consistency with frontend
            question.answers = optionsResult.rows.map((option) => ({
              answer_id: option.option_id,
              answer_text: option.option_text,
              is_correct: option.is_correct,
            }));
          }

          sampleQuestions.push(question);
        }
      }

      console.log('Sample questions:', sampleQuestions);

      // Return the exam data and sample questions
      res.json({
        exam: examData,
        sampleQuestions,
      });
    } catch (error) {
      console.error('Error fetching exam preview:', error);
      handleDbError(res, error);
    }
  }

  // Add chapters to a course
  async addChaptersToCourse(req, res) {
    const client = await pool.connect();
    try {
      const { course_id } = req.params;
      const { num_chapters } = req.body;
      const user_id = req.user.userId;

      // Validate number of chapters
      if (!num_chapters || num_chapters < 1 || num_chapters > 20) {
        return res.status(400).json({
          error: 'Number of chapters must be between 1 and 20',
        });
      }

      // Verify instructor has access to the course
      const courseCheck = await client.query(
        `SELECT course_id
         FROM course_assignments
         WHERE course_id = $1 AND instructor_id = $2 AND is_active = true`,
        [course_id, user_id]
      );

      if (courseCheck.rows.length === 0) {
        return res.status(403).json({
          error: 'You do not have permission to modify this course',
        });
      }

      await client.query('BEGIN');

      // Delete existing chapters
      await client.query(`DELETE FROM course_chapters WHERE course_id = $1`, [
        course_id,
      ]);

      // Add chapters based on the number specified
      for (let i = 1; i <= num_chapters; i++) {
        await client.query(
          `INSERT INTO course_chapters (course_id, chapter_number)
           VALUES ($1, $2)`,
          [course_id, i]
        );
      }

      await client.query('COMMIT');

      // Get all chapters for the course
      const result = await client.query(
        `SELECT chapter_id, chapter_number
         FROM course_chapters
         WHERE course_id = $1
         ORDER BY chapter_number`,
        [course_id]
      );

      res.status(200).json(result.rows);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error adding chapters:', error);
      handleDbError(res, error);
    } finally {
      client.release();
    }
  }

  // Get chapters for a course
  async getChaptersForCourse(req, res) {
    const client = await pool.connect();
    try {
      const { courseId } = req.params;
      const user_id = req.user.userId;

      // First verify that the instructor is assigned to this course
      const courseCheck = await client.query(
        `SELECT course_id
         FROM course_assignments
         WHERE course_id = $1 AND instructor_id = $2 AND is_active = true`,
        [courseId, user_id]
      );

      if (courseCheck.rows.length === 0) {
        return res.status(403).json({
          error: 'You do not have permission to access this course',
        });
      }

      // Get all chapters for the course
      const result = await client.query(
        `SELECT chapter_id, chapter_number
         FROM course_chapters
         WHERE course_id = $1
         ORDER BY chapter_number`,
        [courseId]
      );

      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching chapters:', error);
      handleDbError(res, error);
    } finally {
      client.release();
    }
  }

  // Delete a chapter
  async deleteChapter(req, res) {
    const client = await pool.connect();
    try {
      const { course_id, chapter_id } = req.params;
      const user_id = req.user.userId;

      // Verify instructor has access to the course
      const courseCheck = await client.query(
        `SELECT course_id
         FROM course_assignments
         WHERE course_id = $1 AND instructor_id = $2 AND is_active = true`,
        [course_id, user_id]
      );

      if (courseCheck.rows.length === 0) {
        return res.status(403).json({
          error: 'You do not have permission to modify this course',
        });
      }

      await client.query('BEGIN');

      // Delete the chapter
      await client.query(
        `DELETE FROM course_chapters
         WHERE chapter_id = $1 AND course_id = $2`,
        [chapter_id, course_id]
      );

      await client.query('COMMIT');

      res.status(200).json({
        message: 'Chapter deleted successfully',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error deleting chapter:', error);
      handleDbError(res, error);
    } finally {
      client.release();
    }
  }
}

// Create and export a new instance of the controller
const controller = new InstructorController();

// Bind all methods to the instance
Object.getOwnPropertyNames(InstructorController.prototype).forEach((name) => {
  if (typeof controller[name] === 'function') {
    controller[name] = controller[name].bind(controller);
  }
});

module.exports = controller;
