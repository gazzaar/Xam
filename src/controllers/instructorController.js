const fs = require('fs');
const { parse } = require('csv-parse/sync');
const path = require('path');
const multer = require('multer');
const pool = require('../db/pool');

// Helper function to handle database errors
const handleDbError = (res, error) => {
  console.error('Database error:', error);
  res.status(500).json({ error: 'Database error', details: error.message });
};

class InstructorController {
  // Create a new subject
  async createCourse(req, res) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const { course_name, course_code, description } = req.body;
      const user_id = req.user.user_id;
      
      // Create subject (using courses table)
      const result = await client.query(
        `INSERT INTO courses (course_name, course_code, description, instructor_id)
         VALUES ($1, $2, $3, $4)
         RETURNING course_id, course_name, 
                  course_code, description`,
        [course_name, course_code, description, user_id]
      );
      
      await client.query('COMMIT');
      
      res.status(201).json({
        course: result.rows[0],
        message: 'Course created successfully'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      handleDbError(res, error);
    } finally {
      client.release();
    }
  }

  // Get all courses for an instructor
  async getCourses(req, res) {
    try {
      const user_id = req.user.user_id;
      
      const result = await pool.query(
        `SELECT course_id, course_name, course_code, description
         FROM courses 
         WHERE instructor_id = $1
         ORDER BY course_name`,
        [user_id]
      );
      
      res.json(result.rows);
    } catch (error) {
      handleDbError(res, error);
    }
  }

  // Create a question bank
  async createQuestionBank(req, res) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      console.log('Request body:', req.body);
      console.log('User ID:', req.user.user_id);
      
      // Extract values from the request body
      const { course_id, bank_name, description } = req.body;
      const user_id = req.user.user_id;
      
      // Verify instructor owns the course
      const courseCheck = await client.query(
        'SELECT course_id FROM courses WHERE course_id = $1 AND instructor_id = $2',
        [course_id, user_id]
      );
      
      console.log('Course check result:', courseCheck.rows);
      
      if (courseCheck.rows.length === 0) {
        return res.status(403).json({ 
          error: 'Unauthorized to create question bank for this course' 
        });
      }
      
      // Create question bank
      const result = await client.query(
        `INSERT INTO question_banks 
         (bank_name, description, course_id, instructor_id)
         VALUES ($1, $2, $3, $4)
         RETURNING question_bank_id, bank_name, description`,
        [bank_name, description, course_id, user_id]
      );
      
      console.log('Question bank created:', result.rows[0]);
      
      await client.query('COMMIT');
      
      res.status(201).json({
        question_bank: result.rows[0],
        message: 'Question bank created successfully'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error creating question bank:', error);
      handleDbError(res, error);
    } finally {
      client.release();
    }
  }

  // Get question banks for a course
  async getQuestionBanks(req, res) {
    try {
      const user_id = req.user.user_id;
      const course_id = req.query.course_id; // This maps to course_id
      
      const result = await pool.query(
        `SELECT qb.question_bank_id, qb.bank_name, qb.description
         FROM question_banks qb
         JOIN courses c ON qb.course_id = c.course_id
         WHERE c.course_id = $1 AND c.instructor_id = $2
         ORDER BY qb.created_at DESC`,
        [course_id, user_id]
      );
      
      res.json(result.rows);
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
      const user_id = req.user.user_id;
      
      // Verify instructor owns the question bank
      const bankCheck = await client.query(
        `SELECT qb.question_bank_id 
         FROM question_banks qb
         JOIN courses c ON qb.course_id = c.course_id
         WHERE qb.question_bank_id = $1 AND c.instructor_id = $2`,
        [question_bank_id, user_id]
      );
     
      if (bankCheck.rows.length === 0) {
        return res.status(403).json({ 
          error: 'Unauthorized to modify this question bank' 
        });
      }

      const course_id = bankCheck.rows[0].course_id;
      
      // Add each question
      for (const question of questions) {
        const questionResult = await client.query(
          `INSERT INTO questions 
           (question_text, question_type, points, image_url, chapter, course_id, instructor_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING question_id`,
          [
            question.question_text,
            question.question_type,
            question.points || 1,
            question.image_url,
            question.chapter,
            course_id,
            user_id
          ]
        );

        // Add question to bank
        await client.query(
          `INSERT INTO question_bank_questions 
           (question_bank_id, question_id)
           VALUES ($1, $2)`,
          [question_bank_id, questionResult.rows[0].question_id]
        );

        // Add options if multiple-choice
        if (question.options && question.options.length > 0) {
          console.log('Adding options for question:', questionResult.rows[0].question_id);
          console.log('Options data:', JSON.stringify(question.options, null, 2));
          
          for (const option of question.options) {
            // Ensure is_correct is a boolean
            const isCorrect = option.is_correct === true;
            console.log(`Adding option: ${option.text}, isCorrect: ${isCorrect}`);
            
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
        message: 'Questions added successfully' 
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
      const user_id = req.user.user_id;
      
      // Log the question bank ID for debugging
      console.log('Fetching questions for question bank ID:', question_bank_id);
      
      // First, get all the questions in the question bank
      const questionsResult = await pool.query(
        `SELECT q.* 
         FROM questions q
         JOIN question_bank_questions qbq ON q.question_id = qbq.question_id
         WHERE qbq.question_bank_id = $1
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
        
        console.log('Options result:', JSON.stringify(optionsResult.rows, null, 2));
        
        // Extract options and correct answers into separate arrays
        const options = optionsResult.rows.map(row => row.option_text);
        const correct_answers = optionsResult.rows.map(row => row.is_correct);
        
        console.log('Processed options:', options);
        console.log('Processed correct_answers:', correct_answers);
        
        // Add the options and correct answers to the question
        questions.push({
          ...question,
          options,
          correct_answers
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
      const { question_text, question_type, points, image_url, chapter, options, explanation } = req.body;
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
          error: 'Unauthorized to modify this question' 
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
        [question_text, question_type, points, image_url, chapter, explanation, question_id]
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
        message: 'Question updated successfully' 
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
          error: 'Unauthorized to delete this question' 
        });
      }
      
      // Delete question (options will be deleted via CASCADE)
      await client.query(
        `DELETE FROM questions WHERE question_id = $1`,
        [question_id]
      );
      
      await client.query('COMMIT');
      
      res.status(200).json({ 
        message: 'Question deleted successfully' 
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
      const user_id = req.user.user_id;
      
      console.log('Deleting question:', question_id, 'from question bank:', question_bank_id);
      
      // Verify instructor owns the question bank
      const bankCheck = await client.query(
        `SELECT qb.question_bank_id 
         FROM question_banks qb
         JOIN courses c ON qb.course_id = c.course_id
         WHERE qb.question_bank_id = $1 AND c.instructor_id = $2`,
        [question_bank_id, user_id]
      );
      
      if (bankCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(403).json({ 
          error: 'Unauthorized to modify this question bank' 
        });
      }
      
      // Verify question exists in the question bank
      const questionCheck = await client.query(
        `SELECT qbq.question_id 
         FROM question_bank_questions qbq
         WHERE qbq.question_bank_id = $1 AND qbq.question_id = $2`,
        [question_bank_id, question_id]
      );
      
      if (questionCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ 
          error: 'Question not found in this question bank' 
        });
      }
      
      // Remove question from question bank
      await client.query(
        `DELETE FROM question_bank_questions 
         WHERE question_bank_id = $1 AND question_id = $2`,
        [question_bank_id, question_id]
      );
      
      // Delete the question itself if it's not used in any other question bank
      const otherBanksCheck = await client.query(
        `SELECT * FROM question_bank_questions 
         WHERE question_id = $1`,
        [question_id]
      );
      
      if (otherBanksCheck.rows.length === 0) {
        // Question is not used in any other bank, safe to delete
        await client.query(
          `DELETE FROM questions WHERE question_id = $1`,
          [question_id]
        );
      }
      
      await client.query('COMMIT');
      
      res.status(200).json({ 
        message: 'Question removed from question bank successfully' 
      });
    } catch (error) {
      await client.query('ROLLBACK');
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
      const { question_text, question_type, options, explanation, points, image_url, chapter } = req.body;
      const user_id = req.user.user_id;
      
      console.log('Updating question:', question_id, 'in question bank:', question_bank_id);
      console.log('Request body:', JSON.stringify(req.body, null, 2));
      
      // Verify instructor owns the question bank
      const bankCheck = await client.query(
        `SELECT qb.question_bank_id 
         FROM question_banks qb
         JOIN courses c ON qb.course_id = c.course_id
         WHERE qb.question_bank_id = $1 AND c.instructor_id = $2`,
        [question_bank_id, user_id]
      );
      
      if (bankCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(403).json({ 
          error: 'Unauthorized to modify this question bank' 
        });
      }
      
      // Verify question exists in the question bank
      const questionCheck = await client.query(
        `SELECT qbq.question_id 
         FROM question_bank_questions qbq
         WHERE qbq.question_bank_id = $1 AND qbq.question_id = $2`,
        [question_bank_id, question_id]
      );
      
      if (questionCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ 
          error: 'Question not found in this question bank' 
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
         WHERE question_id = $6`,
        [
          question_text || '', 
          question_type || 'multiple-choice', 
          points || 1, 
          image_url || '', 
          chapter || '', 
          question_id
        ]
      );
      
      // Delete existing options
      await client.query(
        `DELETE FROM question_options WHERE question_id = $1`,
        [question_id]
      );
      
      // Add new options
      if (options && Array.isArray(options) && options.length > 0) {
        for (const option of options) {
          if (!option || typeof option !== 'object') {
            console.error('Invalid option format:', option);
            continue;
          }
          
          const optionText = option.text || '';
          const isCorrect = option.is_correct === true;
          
          console.log('Adding option:', JSON.stringify({
            text: optionText,
            is_correct: isCorrect
          }));
          
          await client.query(
            `INSERT INTO question_options (question_id, option_text, is_correct)
             VALUES ($1, $2, $3)`,
            [question_id, optionText, isCorrect]
          );
        }
      }
      
      await client.query('COMMIT');
      
      res.status(200).json({ 
        message: 'Question updated successfully' 
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
        is_randomized = true
      } = req.body;
      
      // Validate required fields
      if (!exam_name || !start_date || !end_date || !duration) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      
      // Validate chapter distribution
      if (!chapterDistribution || !Array.isArray(chapterDistribution) || chapterDistribution.length === 0) {
        return res.status(400).json({ error: 'Invalid chapter distribution' });
      }
      
      // Generate a unique access code
      let accessCode;
      let isUnique = false;
      
      while (!isUnique) {
        // Generate a random code
        accessCode = this.generateRandomCode(8);
        
        // Check if it's unique
        const existingExam = await client.query(
          'SELECT exam_id FROM exams WHERE access_code = $1',
          [accessCode]
        );
        
        if (existingExam.rows.length === 0) {
          isUnique = true;
        }
      }
      
      // Begin transaction
      await client.query('BEGIN');
      
      // Store the difficulty distribution and other metadata as JSON in the description field
      const examMetadata = {
        course_id,
        question_bank_id,
        total_questions,
        difficultyDistribution,
        is_randomized
      };
      
      // Combine the description with the metadata
      const fullDescription = description || '';
      const metadataString = JSON.stringify(examMetadata);
      
      // Insert exam
      const examResult = await client.query(
        `INSERT INTO exams (
          exam_name, 
          description, 
          time_limit_minutes, 
          start_date, 
          end_date, 
          instructor_id,
          access_code,
          is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING exam_id`,
        [
          exam_name,
          metadataString, // Store metadata in the description field
          duration,
          new Date(start_date),
          new Date(end_date),
          user_id,
          accessCode,
          true // is_active
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
          [
            exam_id,
            item.chapter,
            item.count
          ]
        );
      }
      
      await client.query('COMMIT');
      
      res.status(201).json({
        exam_id: exam_id.toString(),
        access_code: accessCode, // Return the actual access code used
        message: 'Exam created successfully'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error creating exam:', error);
      handleDbError(res, error);
    } finally {
      client.release();
    }
  }
  
  // Helper method to generate random code
  generateRandomCode(length) {
    const characters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'; // Removed similar looking characters
    let result = '';
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
  }

  // Delete course
  async deleteCourse(req, res) {
    const client = await pool.connect();
    try {
      const user_id = req.user.user_id;
      const { course_id } = req.params;
      
      // Verify the course belongs to the instructor
      const courseResult = await client.query(
        `SELECT * FROM courses WHERE course_id = $1 AND instructor_id = $2`,
        [course_id, user_id]
      );
      
      if (courseResult.rows.length === 0) {
        return res.status(403).json({ error: 'You do not have permission to delete this course' });
      }
      
      // Check if there are any exams using this course
      const examsResult = await client.query(
        `SELECT * FROM exams WHERE course_id = $1`,
        [course_id]
      );
      
      if (examsResult.rows.length > 0) {
        return res.status(400).json({ 
          error: 'Cannot delete course that is being used by exams',
          count: examsResult.rows.length
        });
      }
      
      // Begin transaction
      await client.query('BEGIN');
      
      // Delete all question banks associated with this course
      await client.query(
        `DELETE FROM question_banks WHERE course_id = $1`,
        [course_id]
      );
      
      // Delete the course
      await client.query(
        `DELETE FROM courses WHERE course_id = $1`,
        [course_id]
      );
      
      await client.query('COMMIT');
      
      res.status(200).json({
        message: 'Course deleted successfully'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error deleting course:', error);
      handleDbError(res, error);
    } finally {
      client.release();
    }
  }
  
  // Delete question bank
  async deleteQuestionBank(req, res) {
    const client = await pool.connect();
    try {
      const user_id = req.user.user_id;
      const { question_bank_id } = req.params;
      
      // Verify the question bank belongs to the instructor and get the course_id
      const bankResult = await client.query(
        `SELECT * FROM question_banks WHERE question_bank_id = $1 AND instructor_id = $2`,
        [question_bank_id, user_id]
      );
      
      if (bankResult.rows.length === 0) {
        return res.status(403).json({ error: 'You do not have permission to delete this question bank' });
      }
      
      const { course_id } = bankResult.rows[0];
      
      // Begin transaction
      await client.query('BEGIN');
      
      // Delete all question options for questions in this course
      await client.query(
        `DELETE FROM question_options WHERE question_id IN 
          (SELECT question_id FROM questions WHERE course_id = $1)`,
        [course_id]
      );

      // Delete all questions in this course
      await client.query(
        `DELETE FROM questions WHERE course_id = $1`,
        [course_id]
      );
      
      // Delete the question bank
      await client.query(
        `DELETE FROM question_banks WHERE question_bank_id = $1`,
        [question_bank_id]
      );
      
      await client.query('COMMIT');
      
      res.status(200).json({
        message: 'Question bank deleted successfully'
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
      const user_id = req.user.user_id;
      
      // Get all exams for this instructor
      const examsResult = await pool.query(
        `SELECT 
          e.exam_id, 
          e.exam_name, 
          e.description, 
          e.time_limit_minutes AS duration, 
          e.start_date, 
          e.end_date, 
          e.access_code AS exam_link_id,
          e.is_active,
          e.created_at
        FROM exams e
        WHERE e.instructor_id = $1
        ORDER BY e.created_at DESC`,
        [user_id]
      );
      
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
      const exams = await Promise.all(examsResult.rows.map(async (exam) => {
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
          // Calculate status based on dates
          status: calculateStatus(exam.start_date, exam.end_date)
        };
      }));
      
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
          error: 'Unauthorized to delete this exam' 
        });
      }
      
      // Check if the exam has already started
      const examData = examCheck.rows[0];
      const startDate = new Date(examData.start_date);
      const now = new Date();
      
      if (now >= startDate) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          error: 'Cannot delete an exam that has already started or completed' 
        });
      }
      
      // Delete the exam and all related data (cascade will handle dependencies)
      await client.query(
        'DELETE FROM exams WHERE exam_id = $1',
        [exam_id]
      );
      
      await client.query('COMMIT');
      
      res.status(200).json({
        message: 'Exam deleted successfully'
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
          error: 'Unauthorized to modify this exam' 
        });
      }
      
      // Setup multer for file upload
      const storage = multer.memoryStorage();
      const upload = multer({ 
        storage,
        limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
        fileFilter: (req, file, cb) => {
          // Accept only CSV files
          if (file.mimetype !== 'text/csv') {
            return cb(new Error('Only CSV files are allowed'));
          }
          cb(null, true);
        }
      }).single('students');
      
      // Handle the file upload
      upload(req, res, async (err) => {
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
            trim: true
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
            exam_id
          });
        } catch (error) {
          await client.query('ROLLBACK');
          console.error('Error processing CSV:', error);
          res.status(500).json({ error: 'Error processing CSV file', details: error.message });
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
        question_distribution 
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
          error: 'Unauthorized to modify this exam' 
        });
      }
      
      // Check if the exam has already started
      const examData = examCheck.rows[0];
      const startDate = new Date(examData.start_date);
      const now = new Date();
      
      if (now >= startDate) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          error: 'Cannot modify an exam that has already started or completed' 
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
      if (question_distribution && Array.isArray(question_distribution) && question_distribution.length > 0) {
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
            [
              exam_id,
              item.chapter,
              item.count
            ]
          );
        }
      }
      
      await client.query('COMMIT');
      
      res.status(200).json({
        message: 'Exam updated successfully',
        exam_id
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
      const user_id = req.user.user_id;
      const exam_id = req.params.id;
      
      // First, check if the exam exists and belongs to this instructor
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
          e.created_at
        FROM exams e
        WHERE e.exam_id = $1 AND e.instructor_id = $2`,
        [exam_id, user_id]
      );
      
      if (examResult.rows.length === 0) {
        return res.status(404).json({ error: 'Exam not found or you do not have permission to view it' });
      }
      
      const exam = examResult.rows[0];
      
      // Get question distribution
      const distributionResult = await pool.query(
        `SELECT 
          es.chapter, 
          es.num_questions AS count
        FROM exam_specifications es
        WHERE es.exam_id = $1`,
        [exam_id]
      );
      
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
        status: calculateStatus(exam.start_date, exam.end_date)
      };
      
      // Get a sample of questions for each chapter in the distribution
      const sampleQuestions = [];
      
      // For each chapter in the distribution, get a sample of questions
      for (const spec of distributionResult.rows) {
        const chapter = spec.chapter;
        const count = Math.min(spec.count, 2); // Get at most 2 sample questions per chapter
        
        // Get random questions from this chapter
        const questionsResult = await pool.query(
          `SELECT 
            q.question_id,
            q.question_text,
            q.question_type,
            q.chapter
          FROM questions q
          WHERE q.chapter = $1 AND q.instructor_id = $2
          ORDER BY RANDOM()
          LIMIT $3`,
          [chapter, user_id, count]
        );
        
        // For each question, get its options
        for (const question of questionsResult.rows) {
          // Get options for this question
          const optionsResult = await pool.query(
            `SELECT 
              option_id,
              option_text,
              is_correct
            FROM question_options
            WHERE question_id = $1`,
            [question.question_id]
          );
          
          // Add options to the question
          question.options = optionsResult.rows;
          
          // For true/false and multiple-choice questions, format the data for the frontend
          if (question.question_type === 'true/false') {
            // Find the correct option
            const correctOption = optionsResult.rows.find(option => option.is_correct);
            question.correct_answer = correctOption ? correctOption.option_text === 'True' : null;
          } else if (question.question_type === 'multiple-choice') {
            // Rename options to answers for consistency with frontend
            question.answers = optionsResult.rows.map(option => ({
              answer_id: option.option_id,
              answer_text: option.option_text,
              is_correct: option.is_correct
            }));
          }
          
          sampleQuestions.push(question);
        }
      }
      
      // Return the exam data and sample questions
      res.json({
        exam: examData,
        sampleQuestions
      });
      
    } catch (error) {
      console.error('Error fetching exam preview:', error);
      handleDbError(res, error);
    }
  }
}

module.exports = new InstructorController();
