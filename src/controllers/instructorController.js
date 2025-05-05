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
  async createSubject(req, res) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const { subject_name, subject_code, description } = req.body;
      const user_id = req.user.user_id;
      
      // Create subject (using courses table)
      const result = await client.query(
        `INSERT INTO courses (course_name, course_code, description, instructor_id)
         VALUES ($1, $2, $3, $4)
         RETURNING course_id as subject_id, course_name as subject_name, 
                   course_code as subject_code, description`,
        [subject_name, subject_code, description, user_id]
      );
      
      await client.query('COMMIT');
      
      res.status(201).json({
        subject: result.rows[0],
        message: 'Subject created successfully'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      handleDbError(res, error);
    } finally {
      client.release();
    }
  }

  // Get all subjects for an instructor
  async getSubjects(req, res) {
    try {
      const user_id = req.user.user_id;
      
      const result = await pool.query(
        `SELECT course_id as subject_id, course_name as subject_name, 
                course_code as subject_code, description
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
      const { subject_id, bank_name, description } = req.body;
      const user_id = req.user.user_id;
      
      // Convert subject_id to number
      const course_id = parseInt(subject_id, 10);
      
      // Verify instructor owns the course
      const courseCheck = await client.query(
        'SELECT course_id FROM courses WHERE course_id = $1 AND instructor_id = $2',
        [course_id, user_id]
      );
      
      console.log('Course check result:', courseCheck.rows);
      
      if (courseCheck.rows.length === 0) {
        return res.status(403).json({ 
          error: 'Unauthorized to create question bank for this subject' 
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

  // Get question banks for a subject
  async getQuestionBanks(req, res) {
    try {
      const user_id = req.user.user_id;
      const subject_id = req.query.subject_id; // This maps to course_id
      
      const result = await pool.query(
        `SELECT qb.question_bank_id, qb.bank_name, qb.description
         FROM question_banks qb
         JOIN courses c ON qb.course_id = c.course_id
         WHERE c.course_id = $1 AND c.instructor_id = $2
         ORDER BY qb.created_at DESC`,
        [subject_id, user_id]
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

  // Create exam (placeholder)
  async createExam(req, res) {
    res.status(501).json({ message: 'Not implemented yet' });
  }

  // Get exams (placeholder)
  async getExams(req, res) {
    res.status(501).json({ message: 'Not implemented yet' });
  }

  // Update exam (placeholder)
  async updateExam(req, res) {
    res.status(501).json({ message: 'Not implemented yet' });
  }

  // Delete exam (placeholder)
  async deleteExam(req, res) {
    res.status(501).json({ message: 'Not implemented yet' });
  }

  // Add questions to exam (placeholder)
  async addQuestions(req, res) {
    res.status(501).json({ message: 'Not implemented yet' });
  }

  // Upload allowed students (placeholder)
  async uploadAllowedStudents(req, res) {
    res.status(501).json({ message: 'Not implemented yet' });
  }

  // Get exam results (placeholder)
  async getExamResults(req, res) {
    res.status(501).json({ message: 'Not implemented yet' });
  }

  // Get dashboard stats (placeholder)
  async getDashboardStats(req, res) {
    res.status(501).json({ message: 'Not implemented yet' });
  }
}

module.exports = new InstructorController();
