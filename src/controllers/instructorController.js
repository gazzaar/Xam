const fs = require('fs');
const { parse } = require('csv-parse/sync');
const path = require('path');
const multer = require('multer');
const pool = require('../db/pool');
const csv = require('csv-parse');
const { promisify } = require('util');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const https = require('https');

// Helper function to download and save external images
async function downloadAndSaveImage(imageUrl) {
  try {
    // Generate a unique filename
    const fileExtension = path.extname(imageUrl).split('?')[0] || '.jpg';
    const filename = `${uuidv4()}${fileExtension}`;
    const imagePath = path.join(__dirname, '..', 'uploads', 'images', filename);

    // Download the image with a 5-second timeout
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 5000,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });

    // Save the image
    await fs.promises.writeFile(imagePath, response.data);

    // Return the relative path to be stored in the database
    return `/uploads/images/${filename}`;
  } catch (error) {
    console.error('Error downloading image:', error);
    return null;
  }
}

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

// Helper function to handle database errors
const handleDbError = (res, error) => {
  console.error('Database error:', error);
  res.status(500).json({ error: 'Database error', details: error.message });
};

// Helper function to validate student CSV data
const validateStudentData = (data) => {
  const errors = [];
  const validRows = [];
  const seenIds = new Set();
  const seenEmails = new Set();

  data.forEach((row, index) => {
    const lineNumber = index + 2; // +2 because index starts at 0 and we skip header row

    // Handle both CSV and TSV formats
    const student_id = row.student_id?.trim();
    const name = row.student_name?.trim();
    const email = row.student_email?.trim();

    if (!student_id || !name || !email) {
      errors.push(`Line ${lineNumber}: Missing required fields`);
      return;
    }

    if (seenIds.has(student_id)) {
      errors.push(`Line ${lineNumber}: Duplicate student ID ${student_id}`);
      return;
    }

    if (seenEmails.has(email)) {
      errors.push(`Line ${lineNumber}: Duplicate email ${email}`);
      return;
    }

    if (!email.includes('@')) {
      errors.push(`Line ${lineNumber}: Invalid email format`);
      return;
    }

    seenIds.add(student_id);
    seenEmails.add(email);
    validRows.push({ student_id, name, email });
  });

  return { errors, validRows };
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
                u.username as creator_name,
                COUNT(q.question_id) as total_questions
         FROM question_banks qb
         JOIN courses c ON qb.course_id = c.course_id
         JOIN course_assignments ca ON c.course_id = ca.course_id
         LEFT JOIN users u ON qb.created_by = u.user_id
         LEFT JOIN questions q ON qb.question_bank_id = q.question_bank_id
         WHERE c.course_id = $1
         AND ca.instructor_id = $2
         AND ca.is_active = true
         GROUP BY qb.question_bank_id, qb.bank_name, qb.description, qb.created_by, qb.created_at, u.username
         ORDER BY qb.created_at DESC`,
        [course_id, user_id]
      );

      // Add a flag to indicate if the current user created the question bank
      const questionBanks = result.rows.map((bank) => ({
        ...bank,
        is_owner: bank.created_by === user_id,
        total_questions: parseInt(bank.total_questions) || 0,
      }));

      res.json(questionBanks);
    } catch (error) {
      handleDbError(res, error);
    }
  }

  // Get question bank statistics
  async getQuestionBankStats(req, res) {
    try {
      const user_id = req.user.userId;
      const bank_id = req.params.bank_id;

      // First verify access to the question bank
      const accessCheck = await pool.query(
        `SELECT qb.question_bank_id
         FROM question_banks qb
         JOIN courses c ON qb.course_id = c.course_id
         JOIN course_assignments ca ON c.course_id = ca.course_id
         WHERE qb.question_bank_id = $1
         AND ca.instructor_id = $2
         AND ca.is_active = true`,
        [bank_id, user_id]
      );

      if (accessCheck.rows.length === 0) {
        return res.status(403).json({
          error: 'You do not have permission to access this question bank',
        });
      }

      // Get total questions count
      const totalResult = await pool.query(
        `SELECT COUNT(*) as total
         FROM questions
         WHERE question_bank_id = $1`,
        [bank_id]
      );

      // Get questions count by chapter
      const chapterResult = await pool.query(
        `SELECT
           chapter,
           COUNT(*) as count
         FROM questions
         WHERE question_bank_id = $1
         GROUP BY chapter
         ORDER BY chapter`,
        [bank_id]
      );

      const response = {
        totalQuestions: parseInt(totalResult.rows[0].total),
        chapterStats: chapterResult.rows.reduce((acc, row) => {
          acc[row.chapter] = {
            count: parseInt(row.count),
          };
          return acc;
        }, {}),
      };

      res.json(response);
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

        // Store the image URL directly without any processing
        const imageUrl = question.image_url || null;

        // Validate difficulty
        const difficulty = question.difficulty || 'medium';
        if (!['easy', 'medium', 'hard'].includes(difficulty)) {
          return res.status(400).json({
            error: 'Difficulty must be one of: easy, medium, hard',
          });
        }

        const questionResult = await client.query(
          `INSERT INTO questions
           (question_text, question_type, points, image_url, chapter, difficulty, question_bank_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING question_id`,
          [
            question.question_text,
            question.question_type,
            points,
            imageUrl,
            question.chapter,
            difficulty,
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
      // console.log('Fetching questions for question bank ID:', question_bank_id);

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

      // Get all the questions in the question bank with creator information
      const questionsResult = await pool.query(
        `SELECT
           q.*,
           u.first_name as created_by_first_name,
           u.last_name as created_by_last_name,
           u.username as created_by_username,
           q.image_url,
           q.difficulty
         FROM questions q
         LEFT JOIN users u ON q.created_by = u.user_id
         WHERE q.question_bank_id = $1
         ORDER BY q.created_at DESC`,
        [question_bank_id]
      );

      // For each question, get its options and correct answers
      const questions = [];
      for (const question of questionsResult.rows) {
        // Log the question ID for debugging
        // console.log('Processing question ID:', question.question_id);

        const optionsResult = await pool.query(
          `SELECT option_id, option_text, is_correct
           FROM question_options
           WHERE question_id = $1
           ORDER BY option_id ASC`,
          [question.question_id]
        );

        // console.log(
        //   'Options result:',
        //   JSON.stringify(optionsResult.rows, null, 2)
        // );

        // Extract options and correct answers into separate arrays
        const options = optionsResult.rows.map((row) => row.option_text);
        const correct_answers = optionsResult.rows.map((row) => row.is_correct);

        // console.log('Processed options:', options);
        // console.log('Processed correct_answers:', correct_answers);

        // Add the options and correct answers to the question
        questions.push({
          ...question,
          options,
          correct_answers,
        });
      }

      // Log the result for debugging
      // console.log('Questions result:', JSON.stringify(questions, null, 2));

      res.json(questions);
    } catch (error) {
      handleDbError(res, error);
    }
  }

  // Delete question from question bank
  async deleteQuestionFromQuestionBank(req, res) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { question_bank_id, question_id } = req.params;
      const user_id = req.user.userId;

      // First check if the instructor has access to this question bank
      const accessCheck = await client.query(
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
        await client.query('ROLLBACK');
        return res.status(403).json({
          error:
            'You do not have permission to delete questions from this question bank',
        });
      }

      // Check if the question is used in any student exam responses
      const studentExamCheck = await client.query(
        `SELECT DISTINCT e.exam_name
         FROM student_exam_questions seq
         JOIN student_exams se ON seq.student_exam_id = se.student_exam_id
         JOIN exams e ON se.exam_id = e.exam_id
         WHERE seq.question_id = $1`,
        [question_id]
      );

      // Check if the question is used in any exam specifications
      const examSpecCheck = await client.query(
        `SELECT DISTINCT e.exam_name
         FROM exam_specifications es
         JOIN exams e ON es.exam_id = e.exam_id
         WHERE es.question_bank_id = $1
         AND e.is_active = true`,
        [question_bank_id]
      );

      // Combine results from both checks
      const usedInExams = [
        ...new Set([
          ...studentExamCheck.rows.map((row) => row.exam_name),
          ...examSpecCheck.rows.map((row) => row.exam_name),
        ]),
      ];

      if (usedInExams.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error:
            'Cannot delete this question as it is being used in the following exams: ' +
            usedInExams.join(', '),
        });
      }

      // If not used in any exams, proceed with deletion
      await client.query('DELETE FROM questions WHERE question_id = $1', [
        question_id,
      ]);

      await client.query('COMMIT');
      res.json({ message: 'Question deleted successfully' });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Database error:', error);
      res.status(500).json({ error: 'Failed to delete question' });
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

      // Handle image URL if present and it's a new external URL
      let finalImageUrl = questionData.image_url;
      if (finalImageUrl && finalImageUrl.startsWith('http')) {
        finalImageUrl = await downloadAndSaveImage(finalImageUrl);
        if (!finalImageUrl) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: 'Failed to download and save the image',
          });
        }
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
             chapter = $5,
             difficulty = $6
         WHERE question_id = $7
         AND question_bank_id = $8`,
        [
          questionData.question_text || '',
          questionData.question_type || 'multiple-choice',
          updatedPoints,
          finalImageUrl,
          questionData.chapter || '',
          questionData.difficulty || 'medium',
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
      const userId = req.user.userId;
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
      if (!exam_name || !start_date || !end_date || !duration || !course_id) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Validate dates
      const startDateTime = new Date(start_date);
      const endDateTime = new Date(end_date);
      const now = new Date();

      if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
        return res.status(400).json({ error: 'Invalid date format' });
      }

      // Compare with current time including hours and minutes
      if (startDateTime.getTime() <= now.getTime()) {
        return res
          .status(400)
          .json({ error: 'Start date and time must be in the future' });
      }

      // Ensure end time is strictly after start time
      if (endDateTime.getTime() <= startDateTime.getTime()) {
        return res
          .status(400)
          .json({ error: 'End time must be after start time' });
      }

      // Validate duration is not more than 3 hours
      const MAX_DURATION = 180; // 3 hours in minutes
      if (duration > MAX_DURATION) {
        return res.status(400).json({
          error: `Duration cannot exceed ${MAX_DURATION} minutes (3 hours)`,
        });
      }

      // Validate chapter distribution
      if (
        !chapterDistribution ||
        !Array.isArray(chapterDistribution) ||
        chapterDistribution.length === 0
      ) {
        return res.status(400).json({ error: 'Invalid chapter distribution' });
      }

      const totalDistributedQuestions = chapterDistribution.reduce(
        (sum, item) => sum + (item.count || 0),
        0
      );

      if (totalDistributedQuestions !== total_questions) {
        return res.status(400).json({
          error:
            'Total questions in chapter distribution must match total questions specified',
        });
      }

      // Validate difficulty distribution
      if (
        !difficultyDistribution ||
        typeof difficultyDistribution !== 'object' ||
        !('easy' in difficultyDistribution) ||
        !('medium' in difficultyDistribution) ||
        !('hard' in difficultyDistribution)
      ) {
        return res
          .status(400)
          .json({ error: 'Invalid difficulty distribution' });
      }

      const totalDifficulty =
        difficultyDistribution.easy +
        difficultyDistribution.medium +
        difficultyDistribution.hard;

      if (totalDifficulty !== 100) {
        return res
          .status(400)
          .json({ error: 'Difficulty distribution must add up to 100%' });
      }

      // Generate a unique exam link ID
      const examLinkId = uuidv4().replace(/-/g, '').substring(0, 10);

      // Begin transaction
      await client.query('BEGIN');

      // Store the metadata
      const examMetadata = {
        course_id,
        question_bank_id,
        total_questions,
        difficultyDistribution,
        is_randomized,
      };

      // Insert exam
      const examResult = await client.query(
        `INSERT INTO exams (
          exam_name,
          description,
          exam_metadata,
          time_limit_minutes,
          start_date,
          end_date,
          created_by,
          exam_link_id,
          is_active,
          course_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING exam_id`,
        [
          exam_name,
          description,
          examMetadata,
          duration,
          startDateTime,
          endDateTime,
          userId,
          examLinkId,
          true,
          course_id,
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

      res.status(201).json({
        exam_id: exam_id.toString(),
        exam_link_id: examLinkId,
      });
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

  // Get exams
  async getExams(req, res) {
    try {
      const user_id = req.user.userId;

      // Get only exams created by this instructor
      const examsResult = await pool.query(
        `SELECT DISTINCT
          e.exam_id,
          e.exam_name,
          e.description,
          e.time_limit_minutes AS duration,
          e.start_date,
          e.end_date,
          e.exam_link_id,
          e.is_active,
          e.created_at,
          e.course_id,
          e.is_randomized
        FROM exams e
        JOIN courses c ON e.course_id = c.course_id
        JOIN course_assignments ca ON c.course_id = ca.course_id
        WHERE e.created_by = $1
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

          // Calculate the status
          const status = calculateStatus(exam.start_date, exam.end_date);

          // Format the exam data
          return {
            ...exam,
            question_references: distributionResult.rows,
            student_count: parseInt(studentsResult.rows[0].student_count) || 0,
            status: status,
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
      const userId = req.user.userId;

      console.log('Delete exam request:', {
        exam_id,
        userId,
        user: req.user,
      });

      if (!exam_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Exam ID is required' });
      }

      // Verify instructor owns the exam
      const examCheck = await client.query(
        'SELECT exam_id, created_by FROM exams WHERE exam_id = $1 AND created_by = $2',
        [exam_id, userId]
      );

      console.log('Exam check result:', {
        rows: examCheck.rows,
        query: {
          exam_id,
          userId,
        },
      });

      if (examCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Unauthorized to delete this exam',
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

  // Upload allowed students
  async uploadAllowedStudents(req, res) {
    const client = await pool.connect();
    try {
      const { exam_id } = req.params;
      const user_id = req.user.userId;

      if (!exam_id) {
        return res.status(400).json({ error: 'Exam ID is required' });
      }

      // Verify instructor owns the exam
      const examCheck = await client.query(
        'SELECT exam_id FROM exams WHERE exam_id = $1 AND created_by = $2',
        [exam_id, user_id]
      );

      if (examCheck.rows.length === 0) {
        return res.status(403).json({
          error: 'Unauthorized to modify this exam',
        });
      }

      if (!req.file) {
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
          return res.status(400).json({ error: 'CSV file is empty' });
        }

        await client.query('BEGIN');

        // Clear existing allowed students for this exam
        await client.query('DELETE FROM allowed_students WHERE exam_id = $1', [
          exam_id,
        ]);

        // Insert new allowed students
        let insertedCount = 0;
        for (const record of records) {
          // Log the record for debugging
          console.log('Processing record:', record);

          // Map CSV fields to database fields
          const studentId = record.student_id;
          const studentName = record.student_name;
          const studentEmail = record.student_email;

          // Validate required fields
          if (!studentId || !studentName || !studentEmail) {
            console.warn('Skipping invalid record:', record);
            continue;
          }

          // Validate email format
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(studentEmail)) {
            console.warn('Invalid email format:', studentEmail);
            continue;
          }

          await client.query(
            `INSERT INTO allowed_students (exam_id, student_id, student_name, student_email)
             VALUES ($1, $2, $3, $4)`,
            [exam_id, studentId, studentName, studentEmail]
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
    } catch (error) {
      if (client.query) await client.query('ROLLBACK');
      console.error('Error uploading students:', error);
      handleDbError(res, error);
    } finally {
      client.release();
    }
  }

  // Export student grades to CSV
  async exportStudentGrades(req, res) {
    try {
      const { exam_id } = req.params;
      const user_id = req.user.userId;

      // Verify instructor owns or has access to the exam
      const examCheck = await pool.query(
        `SELECT e.exam_id, e.exam_name
         FROM exams e
         JOIN courses c ON e.course_id = c.course_id
         JOIN course_assignments ca ON c.course_id = ca.course_id
         WHERE e.exam_id = $1
         AND (e.created_by = $2 OR ca.instructor_id = $2)
         AND ca.is_active = true`,
        [exam_id, user_id]
      );

      if (examCheck.rows.length === 0) {
        return res.status(403).json({
          error: 'You do not have permission to access this exam data',
        });
      }

      // Get student grades for this exam
      const gradesResult = await pool.query(
        `SELECT
           als.student_id,
           als.student_name,
           als.student_email,
           se.score as grade
         FROM student_exams se
         JOIN allowed_students als ON se.exam_id = als.exam_id AND se.student_id = als.student_id
         WHERE se.exam_id = $1
         AND se.status = 'completed'
         ORDER BY als.student_name`,
        [exam_id]
      );

      if (gradesResult.rows.length === 0) {
        return res.status(404).json({
          error: 'No completed exam records found',
        });
      }

      // Create CSV header
      const csvHeader = 'Student ID,Student Name,Student Email,Grade\n';

      // Create CSV rows
      const csvRows = gradesResult.rows
        .map((student) => {
          return `${student.student_id},"${student.student_name}",${student.student_email},${student.grade}`;
        })
        .join('\n');

      // Combine header and rows
      const csvContent = csvHeader + csvRows;

      // Set response headers for CSV download
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=exam_${exam_id}_grades.csv`
      );

      // Send the CSV content
      res.send(csvContent);
    } catch (error) {
      console.error('Error exporting grades:', error);
      handleDbError(res, error);
    }
  }

  // Get dashboard stats
  async getDashboardStats(req, res) {
    const client = await pool.connect();
    try {
      const user_id = req.user.userId;
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Get active exams count (exams currently in progress)
      const activeExamsResult = await client.query(
        `SELECT COUNT(*) as count
         FROM exams e
         WHERE e.created_by = $1
         AND e.start_date <= NOW()
         AND e.end_date >= NOW()`,
        [user_id]
      );

      // Get total exams count
      const totalExamsResult = await client.query(
        `SELECT COUNT(*) as count
         FROM exams e
         WHERE e.created_by = $1`,
        [user_id]
      );

      // Get students taking exams today
      const studentsTodayResult = await client.query(
        `SELECT COUNT(DISTINCT se.student_id) as count
         FROM student_exams se
         JOIN exams e ON se.exam_id = e.exam_id
         WHERE e.created_by = $1
         AND se.start_time >= $2
         AND se.start_time < $3`,
        [user_id, today, tomorrow]
      );

      // Get average score across all completed exams
      const avgScoreResult = await client.query(
        `SELECT COALESCE(AVG(se.score), 0) as avg_score
         FROM student_exams se
         JOIN exams e ON se.exam_id = e.exam_id
         WHERE e.created_by = $1
         AND se.status = 'completed'`,
        [user_id]
      );

      // Get grade distribution for all exams
      const gradeDistResult = await client.query(
        `WITH grade_ranges AS (
           SELECT
             CASE
               WHEN se.score >= 90 THEN 'A (90-100)'
               WHEN se.score >= 80 THEN 'B (80-89)'
               WHEN se.score >= 70 THEN 'C (70-79)'
               WHEN se.score >= 60 THEN 'D (60-69)'
               ELSE 'F (0-59)'
             END as grade_range,
             COUNT(*) as count
           FROM student_exams se
           JOIN exams e ON se.exam_id = e.exam_id
           WHERE e.created_by = $1
           AND se.status = 'completed'
           GROUP BY
             CASE
               WHEN se.score >= 90 THEN 'A (90-100)'
               WHEN se.score >= 80 THEN 'B (80-89)'
               WHEN se.score >= 70 THEN 'C (70-79)'
               WHEN se.score >= 60 THEN 'D (60-69)'
               ELSE 'F (0-59)'
             END
           ORDER BY grade_range
         )
         SELECT
           COALESCE(array_agg(grade_range), ARRAY[]::text[]) as ranges,
           COALESCE(array_agg(count::integer), ARRAY[]::integer[]) as counts
         FROM grade_ranges`,
        [user_id]
      );

      // Get chapter performance for all exams
      const chapterPerfResult = await client.query(
        `WITH chapter_stats AS (
           SELECT
             q.chapter,
             COUNT(CASE WHEN seq.is_correct THEN 1 END) as correct_count,
             COUNT(*) as total_count
           FROM student_exam_questions seq
           JOIN questions q ON seq.question_id = q.question_id
           JOIN student_exams se ON seq.student_exam_id = se.student_exam_id
           JOIN exams e ON se.exam_id = e.exam_id
           WHERE e.created_by = $1
           AND se.status = 'completed'
           AND q.chapter IS NOT NULL
           GROUP BY q.chapter
           ORDER BY q.chapter
         )
         SELECT
           COALESCE(array_agg(chapter), ARRAY[]::text[]) as chapters,
           COALESCE(array_agg((correct_count * 100.0 / NULLIF(total_count, 0))::numeric(5,2)), ARRAY[]::numeric[]) as correct_percentages,
           COALESCE(array_agg(((total_count - correct_count) * 100.0 / NULLIF(total_count, 0))::numeric(5,2)), ARRAY[]::numeric[]) as incorrect_percentages
         FROM chapter_stats`,
        [user_id]
      );

      // Get per-exam statistics
      const examStatsResult = await client.query(
        `SELECT
          e.exam_id,
          e.exam_name,
          COUNT(DISTINCT se.student_id) as total_students,
          COALESCE(AVG(se.score), 0) as avg_score,
          (
            SELECT COUNT(DISTINCT se2.student_id)
            FROM student_exams se2
            WHERE se2.exam_id = e.exam_id
            AND se2.start_time >= $2
            AND se2.start_time < $3
          ) as students_today,
          (
            SELECT json_build_object(
              'ranges', COALESCE(array_agg(grade_range), ARRAY[]::text[]),
              'counts', COALESCE(array_agg(count::integer), ARRAY[]::integer[])
            )
            FROM (
              SELECT
                CASE
                  WHEN se2.score >= 90 THEN 'A (90-100)'
                  WHEN se2.score >= 80 THEN 'B (80-89)'
                  WHEN se2.score >= 70 THEN 'C (70-79)'
                  WHEN se2.score >= 60 THEN 'D (60-69)'
                  ELSE 'F (0-59)'
                END as grade_range,
                COUNT(*) as count
              FROM student_exams se2
              WHERE se2.exam_id = e.exam_id
              AND se2.status = 'completed'
              GROUP BY grade_range
              ORDER BY grade_range
            ) grades
          ) as grade_distribution,
          (
            SELECT json_build_object(
              'chapters', COALESCE(array_agg(chapter), ARRAY[]::text[]),
              'correct_percentages', COALESCE(array_agg((correct_count * 100.0 / NULLIF(total_count, 0))::numeric(5,2)), ARRAY[]::numeric[]),
              'incorrect_percentages', COALESCE(array_agg(((total_count - correct_count) * 100.0 / NULLIF(total_count, 0))::numeric(5,2)), ARRAY[]::numeric[])
            )
            FROM (
              SELECT
                q.chapter,
                COUNT(CASE WHEN seq.is_correct THEN 1 END) as correct_count,
                COUNT(*) as total_count
              FROM student_exam_questions seq
              JOIN questions q ON seq.question_id = q.question_id
              JOIN student_exams se2 ON seq.student_exam_id = se2.student_exam_id
              WHERE se2.exam_id = e.exam_id
              AND se2.status = 'completed'
              AND q.chapter IS NOT NULL
              GROUP BY q.chapter
              ORDER BY q.chapter
            ) chapters
          ) as chapter_performance
        FROM exams e
        LEFT JOIN student_exams se ON e.exam_id = se.exam_id
        WHERE e.created_by = $1
        GROUP BY e.exam_id, e.exam_name
        ORDER BY e.created_at DESC`,
        [user_id, today, tomorrow]
      );

      // Format response
      const response = {
        active_exams_count: parseInt(activeExamsResult.rows[0].count) || 0,
        exams_count: parseInt(totalExamsResult.rows[0].count) || 0,
        students_today: parseInt(studentsTodayResult.rows[0].count) || 0,
        average_score: parseFloat(avgScoreResult.rows[0].avg_score) || 0,
        grade_distribution: {
          ranges: gradeDistResult.rows[0]?.ranges || [],
          counts: gradeDistResult.rows[0]?.counts || [],
        },
        chapter_performance: {
          chapters: chapterPerfResult.rows[0]?.chapters || [],
          correct_percentages:
            chapterPerfResult.rows[0]?.correct_percentages || [],
          incorrect_percentages:
            chapterPerfResult.rows[0]?.incorrect_percentages || [],
        },
        exam_stats: examStatsResult.rows.map((exam) => ({
          exam_id: exam.exam_id,
          exam_name: exam.exam_name,
          total_students: parseInt(exam.total_students) || 0,
          average_score: parseFloat(exam.avg_score) || 0,
          students_today: parseInt(exam.students_today) || 0,
          grade_distribution: exam.grade_distribution || {
            ranges: [],
            counts: [],
          },
          chapter_performance: exam.chapter_performance || {
            chapters: [],
            correct_percentages: [],
            incorrect_percentages: [],
          },
        })),
      };

      res.json(response);
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
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
          e.exam_link_id,
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
              q.image_url,
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
            chapter,
            image_url
          FROM RandomQuestions
          ORDER BY rand
          LIMIT $3`,
          [chapter, exam.course_id, count]
        );

        // console.log('Questions for chapter:', {
        //   chapter,
        //   questions: questionsResult.rows,
        // });

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

  // Validate student file
  async validateStudentFile(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No file uploaded',
        });
      }

      // Convert buffer to string and detect if it's TSV by checking for tabs
      const fileContent = req.file.buffer.toString('utf8');
      const delimiter = fileContent.includes('\t') ? '\t' : ',';

      const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        delimiter: delimiter,
        relaxColumnCount: true,
      });

      console.log('Parsed records:', records); // Add this for debugging

      const { errors, validRows } = validateStudentData(records);

      if (errors.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Invalid file format',
          details: errors,
        });
      }

      res.json({
        success: true,
        message: 'File format is valid',
        studentCount: validRows.length,
      });
    } catch (error) {
      console.error('Error validating student file:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to validate file',
        details: error.message,
      });
    }
  }

  // Create exam with students in a single transaction
  async createExamWithStudents(req, res) {
    const client = await pool.connect();
    try {
      if (!req.file) {
        return res.status(400).json({
          error: 'No student file uploaded',
        });
      }

      const examData = JSON.parse(req.body.examData);
      const userId = req.user.userId;

      // Parse student file
      const fileContent = req.file.buffer.toString('utf8');
      const delimiter = fileContent.includes('\t') ? '\t' : ',';

      const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        delimiter: delimiter,
        relaxColumnCount: true,
      });

      console.log('Parsed student records:', records); // Add for debugging

      // Validate student data
      const { errors, validRows } = validateStudentData(records);
      if (errors.length > 0) {
        return res.status(400).json({
          error: 'Invalid student file',
          details: errors,
        });
      }

      // Start transaction
      await client.query('BEGIN');

      // Generate exam link ID
      const examLinkId = uuidv4().replace(/-/g, '').substring(0, 10);

      // Store the metadata
      const examMetadata = {
        course_id: examData.course_id,
        question_bank_id: examData.question_bank_id,
        total_questions: examData.total_questions,
        difficultyDistribution: examData.difficultyDistribution,
        is_randomized: examData.is_randomized,
      };

      // Insert exam
      const examResult = await client.query(
        `INSERT INTO exams (
          exam_name,
          description,
          exam_metadata,
          time_limit_minutes,
          start_date,
          end_date,
          created_by,
          exam_link_id,
          is_active,
          course_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING exam_id`,
        [
          examData.exam_name,
          examData.description,
          examMetadata,
          examData.duration,
          new Date(examData.start_date),
          new Date(examData.end_date),
          userId,
          examLinkId,
          true,
          examData.course_id,
        ]
      );

      const exam_id = examResult.rows[0].exam_id;

      // Insert chapter distribution
      for (const item of examData.chapterDistribution) {
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

      // Insert allowed students
      for (const student of validRows) {
        await client.query(
          `INSERT INTO allowed_students (
            exam_id,
            student_id,
            student_email,
            student_name
          )
          VALUES ($1, $2, $3, $4)`,
          [exam_id, student.student_id, student.email, student.name]
        );
      }

      await client.query('COMMIT');

      res.status(201).json({
        success: true,
        exam_id: exam_id.toString(),
        exam_link_id: examLinkId,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error creating exam with students:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create exam',
        details: error.message,
      });
    } finally {
      client.release();
    }
  }

  // Migrate external images to local storage
  async migrateExternalImages(req, res) {
    const client = await pool.connect();
    try {
      // Get all questions with external image URLs
      const questionsResult = await client.query(
        `SELECT question_id, image_url
         FROM questions
         WHERE image_url LIKE 'http%'`
      );

      console.log(
        `Found ${questionsResult.rows.length} questions with external images`
      );

      let migratedCount = 0;
      let failedCount = 0;

      await client.query('BEGIN');

      for (const question of questionsResult.rows) {
        try {
          const localImageUrl = await downloadAndSaveImage(question.image_url);
          if (localImageUrl) {
            await client.query(
              `UPDATE questions
               SET image_url = $1
               WHERE question_id = $2`,
              [localImageUrl, question.question_id]
            );
            migratedCount++;
          } else {
            failedCount++;
          }
        } catch (error) {
          console.error(
            `Failed to migrate image for question ${question.question_id}:`,
            error
          );
          failedCount++;
        }
      }

      await client.query('COMMIT');

      res.json({
        message: 'Image migration completed',
        total: questionsResult.rows.length,
        migrated: migratedCount,
        failed: failedCount,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error during image migration:', error);
      handleDbError(res, error);
    } finally {
      client.release();
    }
  }

  // Import questions from JSON file
  async importQuestionsFromJson(req, res) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { question_bank_id } = req.params;
      const user_id = req.user.userId;

      // Verify instructor owns or has access to the question bank
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

      // Get the uploaded file from multer
      if (!req.file) {
        return res.status(400).json({
          error: 'No JSON file uploaded',
        });
      }

      // Parse the JSON file
      let questions;
      try {
        const fileContent = req.file.buffer.toString();
        const jsonData = JSON.parse(fileContent);
        questions = jsonData.questions;

        if (!Array.isArray(questions)) {
          throw new Error('Invalid format: questions must be an array');
        }
      } catch (error) {
        return res.status(400).json({
          error: 'Invalid JSON format',
          details: error.message,
        });
      }

      // Validate each question
      for (const question of questions) {
        // Basic field validation
        if (
          !question.question_text ||
          !question.question_type ||
          !question.chapter
        ) {
          throw new Error(
            'Missing required fields: question_text, question_type, or chapter'
          );
        }

        // Validate question type
        if (
          !['multiple-choice', 'true/false'].includes(question.question_type)
        ) {
          throw new Error(`Invalid question type: ${question.question_type}`);
        }

        // Validate points
        const points = parseInt(question.points) || 1;
        if (points < 1 || points > 15) {
          throw new Error('Question points must be between 1 and 15');
        }

        // Validate options
        if (!Array.isArray(question.options) || question.options.length === 0) {
          throw new Error('Questions must have at least one option');
        }

        if (
          question.question_type === 'true/false' &&
          question.options.length !== 2
        ) {
          throw new Error('True/False questions must have exactly two options');
        }

        // Validate that at least one option is correct
        const hasCorrectOption = question.options.some((opt) => opt.is_correct);
        if (!hasCorrectOption) {
          throw new Error('At least one option must be marked as correct');
        }

        // Validate difficulty
        if (
          question.difficulty &&
          !['easy', 'medium', 'hard'].includes(question.difficulty)
        ) {
          throw new Error('Difficulty must be either easy, medium, or hard');
        }
      }

      // Insert questions
      for (const question of questions) {
        // Insert the question
        const questionResult = await client.query(
          `INSERT INTO questions
           (question_text, question_type, points, image_url, chapter, difficulty, question_bank_id, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING question_id`,
          [
            question.question_text,
            question.question_type,
            parseInt(question.points) || 1,
            question.image_url || null,
            question.chapter,
            question.difficulty || 'medium',
            question_bank_id,
            user_id,
          ]
        );

        const questionId = questionResult.rows[0].question_id;

        // Insert options
        for (const option of question.options) {
          await client.query(
            `INSERT INTO question_options (question_id, option_text, is_correct)
             VALUES ($1, $2, $3)`,
            [questionId, option.text, option.is_correct]
          );
        }
      }

      await client.query('COMMIT');

      res.status(201).json({
        message: `Successfully imported ${questions.length} questions`,
        count: questions.length,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error importing questions:', error);
      res.status(400).json({
        error: error.message || 'Failed to import questions',
      });
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
