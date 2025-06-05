const pool = require('../db/pool');
const dotenv = require('dotenv');

dotenv.config();

const adminController = {
  // Get all pending instructor registrations
  getPendingInstructors: async (req, res) => {
    const client = await pool.connect();
    try {
      const query = `
        SELECT user_id, username, email, first_name, last_name, created_at
        FROM users
        WHERE role = 'instructor' AND is_approved = false
        ORDER BY created_at DESC
      `;

      const result = await client.query(query);

      res.status(200).json({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      console.error('Error fetching pending instructors:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching pending instructors',
        error: error.message,
      });
    } finally {
      client.release();
    }
  },

  // Approve an instructor registration
  approveInstructor: async (req, res) => {
    const client = await pool.connect();
    const { instructorId } = req.params;

    try {
      // Start a transaction
      await client.query('BEGIN');

      // Update the user's approval status
      const updateQuery = `
        UPDATE users
        SET is_approved = true
        WHERE user_id = $1 AND role = 'instructor'
        RETURNING *
      `;

      const result = await client.query(updateQuery, [instructorId]);

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Instructor not found',
        });
      }

      // Commit the transaction
      await client.query('COMMIT');

      res.status(200).json({
        success: true,
        message: 'Instructor approved successfully',
        data: result.rows[0],
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error approving instructor:', error);
      res.status(500).json({
        success: false,
        message: 'Error approving instructor',
        error: error.message,
      });
    } finally {
      client.release();
    }
  },

  // Get all instructors (both pending and approved)
  getAllInstructors: async (req, res) => {
    const client = await pool.connect();
    try {
      const query = `
        SELECT
          u.user_id,
          u.username,
          u.email,
          u.first_name,
          u.last_name,
          u.department,
          u.is_approved,
          u.is_active,
          u.created_at,
          (
            SELECT COUNT(DISTINCT ca.course_id)
            FROM course_assignments ca
            WHERE ca.instructor_id = u.user_id AND ca.is_active = true
          ) as active_courses,
          (
            SELECT COUNT(*)
            FROM questions q
            WHERE q.created_by = u.user_id
          ) as total_questions,
          (
            SELECT json_agg(json_build_object(
              'course_id', c.course_id,
              'course_name', c.course_name,
              'course_code', c.course_code
            ))
            FROM course_assignments ca
            JOIN courses c ON ca.course_id = c.course_id
            WHERE ca.instructor_id = u.user_id AND ca.is_active = true
          ) as assigned_courses
        FROM users u
        WHERE u.role = 'instructor'
        ORDER BY u.is_approved DESC, u.created_at DESC
      `;

      const result = await client.query(query);

      // Format the response
      const instructors = result.rows.map((instructor) => ({
        ...instructor,
        assigned_courses: instructor.assigned_courses || [],
        active_courses: parseInt(instructor.active_courses) || 0,
        total_questions: parseInt(instructor.total_questions) || 0,
      }));

      res.status(200).json({
        success: true,
        data: instructors,
      });
    } catch (error) {
      console.error('Error fetching instructors:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching instructors',
        error: error.message,
      });
    } finally {
      client.release();
    }
  },

  // Get instructor's content summary
  getInstructorContent: async (req, res) => {
    const { instructorId } = req.params;
    try {
      const contentSummary = await client.query(
        `
        SELECT
          (SELECT COUNT(*) FROM courses WHERE instructor_id = $1) as course_count,
          (SELECT COUNT(*) FROM question_banks WHERE instructor_id = $1) as bank_count,
          (SELECT COUNT(*) FROM questions WHERE instructor_id = $1) as question_count,
          (SELECT COUNT(*) FROM exams WHERE instructor_id = $1) as exam_count
      `,
        [instructorId]
      );

      res.status(200).json({
        success: true,
        data: contentSummary.rows[0],
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching instructor content summary',
        error: error.message,
      });
    }
  },

  // Delete (deactivate) an instructor
  deleteInstructor: async (req, res) => {
    const client = await pool.connect();
    const { instructorId } = req.params;

    try {
      await client.query('BEGIN');

      // Deactivate instructor's course assignments
      await client.query(
        `UPDATE course_assignments
         SET is_active = false,
             end_date = CURRENT_TIMESTAMP
         WHERE instructor_id = $1`,
        [instructorId]
      );

      // Deactivate the instructor's account
      const result = await client.query(
        `UPDATE users
         SET is_active = false,
             is_approved = false
         WHERE user_id = $1 AND role = 'instructor'
         RETURNING *`,
        [instructorId]
      );

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Instructor not found',
        });
      }

      await client.query('COMMIT');
      res.status(200).json({
        success: true,
        message:
          'Instructor deactivated successfully. Their courses and content remain in the system.',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error deactivating instructor:', error);
      res.status(500).json({
        success: false,
        message: 'Error deactivating instructor',
        error: error.message,
      });
    } finally {
      client.release();
    }
  },

  // Get admin dashboard statistics
  getDashboardStats: async (req, res) => {
    const client = await pool.connect();
    try {
      const stats = await Promise.all([
        // Count total instructors
        client.query(`
          SELECT COUNT(*) as total_instructors
          FROM users
          WHERE role = 'instructor'
        `),

        // Count pending instructors
        client.query(`
          SELECT COUNT(*) as pending_instructors
          FROM users
          WHERE role = 'instructor' AND is_approved = false
        `),

        // Count total exams
        client.query(`
          SELECT COUNT(*) as total_exams
          FROM exams
        `),

        // Count active exams
        client.query(`
          SELECT COUNT(*) as active_exams
          FROM exams e
          WHERE e.start_date <= NOW() AND e.end_date >= NOW()
        `),

        // Count completed exams
        client.query(`
          SELECT COUNT(*) as completed_exams
          FROM exams
          WHERE end_date < NOW()
        `),

        // Count pending exams (active but not started)
        client.query(`
          SELECT COUNT(*) as pending_exams
          FROM exams
          WHERE is_active = true AND start_date > NOW()
        `),

        // Count total questions
        client.query(`
          SELECT COUNT(*) as total_questions
          FROM questions
        `),

        // Count total courses
        client.query(`
          SELECT COUNT(*) as total_courses
          FROM courses
        `),

        // Count total exam attempts
        client.query(`
          SELECT COUNT(*) as total_attempts
          FROM student_exams
        `),
      ]);

      res.status(200).json({
        success: true,
        data: {
          totalInstructors: parseInt(stats[0].rows[0].total_instructors),
          pendingInstructors: parseInt(stats[1].rows[0].pending_instructors),
          totalExams: parseInt(stats[2].rows[0].total_exams),
          activeExams: parseInt(stats[3].rows[0].active_exams),
          completedExams: parseInt(stats[4].rows[0].completed_exams),
          pendingExams: parseInt(stats[5].rows[0].pending_exams),
          totalQuestions: parseInt(stats[6].rows[0].total_questions),
          totalCourses: parseInt(stats[7].rows[0].total_courses),
          totalAttempts: parseInt(stats[8].rows[0].total_attempts),
        },
      });
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching dashboard statistics',
        error: error.message,
      });
    } finally {
      client.release();
    }
  },

  // Course Management
  createCourse: async (req, res) => {
    const client = await pool.connect();
    const { courseName, courseCode, description, numChapters } = req.body;
    try {
      await client.query('BEGIN');

      // Create the course
      const courseQuery = `
        INSERT INTO courses (course_name, course_code, description, created_by)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `;

      const courseResult = await client.query(courseQuery, [
        courseName,
        courseCode,
        description,
        req.user.userId,
      ]);

      const courseId = courseResult.rows[0].course_id;

      // Add chapters if specified
      if (numChapters && numChapters > 0) {
        // Validate number of chapters
        if (numChapters > 20) {
          throw new Error('Number of chapters cannot exceed 20');
        }

        // Add chapters
        for (let i = 1; i <= numChapters; i++) {
          await client.query(
            `INSERT INTO course_chapters (course_id, chapter_number)
             VALUES ($1, $2)`,
            [courseId, i]
          );
        }
      }

      await client.query('COMMIT');

      res.status(201).json({
        success: true,
        data: courseResult.rows[0],
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error creating course:', error);
      res.status(500).json({
        success: false,
        message: 'Error creating course',
        error: error.message,
      });
    } finally {
      client.release();
    }
  },

  getAllCourses: async (req, res) => {
    const client = await pool.connect();
    try {
      const query = `
        SELECT
          c.*,
          (
            SELECT COUNT(DISTINCT ca.instructor_id)
            FROM course_assignments ca
            WHERE ca.course_id = c.course_id AND ca.is_active = true
          ) as active_instructors,
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
          ) as total_questions,
          (
            SELECT json_agg(json_build_object(
              'user_id', u.user_id,
              'username', u.username,
              'first_name', u.first_name,
              'last_name', u.last_name,
              'is_active', u.is_active,
              'assignment_date', ca.assigned_date
            ))
            FROM course_assignments ca
            JOIN users u ON ca.instructor_id = u.user_id
            WHERE ca.course_id = c.course_id AND ca.is_active = true
          ) as assigned_instructors,
          (
            SELECT json_agg(json_build_object(
              'user_id', u.user_id,
              'username', u.username,
              'first_name', u.first_name,
              'last_name', u.last_name,
              'end_date', ca.end_date
            ) ORDER BY ca.end_date DESC)
            FROM course_assignments ca
            JOIN users u ON ca.instructor_id = u.user_id
            WHERE ca.course_id = c.course_id AND ca.is_active = false
          ) as previous_instructors,
          (
            SELECT json_agg(json_build_object(
              'bank_id', qb.question_bank_id,
              'bank_name', qb.bank_name,
              'question_count', (
                SELECT COUNT(*) FROM questions q
                WHERE q.question_bank_id = qb.question_bank_id
              )
            ))
            FROM question_banks qb
            WHERE qb.course_id = c.course_id
          ) as question_banks
        FROM courses c
        ORDER BY c.created_at DESC
      `;

      const result = await client.query(query);

      // Format the response
      const courses = result.rows.map((course) => ({
        ...course,
        assigned_instructors: course.assigned_instructors || [],
        previous_instructors: course.previous_instructors || [],
        question_banks: course.question_banks || [],
        active_instructors: parseInt(course.active_instructors) || 0,
        question_banks_count: parseInt(course.question_banks_count) || 0,
        total_questions: parseInt(course.total_questions) || 0,
      }));

      res.status(200).json({
        success: true,
        data: courses,
      });
    } catch (error) {
      console.error('Error fetching courses:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching courses',
        error: error.message,
      });
    } finally {
      client.release();
    }
  },

  assignInstructorToCourse: async (req, res) => {
    const client = await pool.connect();
    const { courseId, instructorId } = req.params;
    try {
      // First check if instructor exists and is approved
      const instructorCheck = await client.query(
        `SELECT user_id FROM users
         WHERE user_id = $1 AND role = 'instructor' AND is_approved = true`,
        [instructorId]
      );

      if (instructorCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Instructor not found or not approved',
        });
      }

      // Begin transaction
      await client.query('BEGIN');

      // Check for any existing assignments (both active and inactive)
      const existingAssignments = await client.query(
        `SELECT * FROM course_assignments
         WHERE course_id = $1 AND instructor_id = $2`,
        [courseId, instructorId]
      );

      if (existingAssignments.rows.length > 0) {
        // Delete all existing assignments for this instructor-course pair
        await client.query(
          `DELETE FROM course_assignments
           WHERE course_id = $1 AND instructor_id = $2`,
          [courseId, instructorId]
        );
      }

      // Create new assignment
      const result = await client.query(
        `INSERT INTO course_assignments
         (course_id, instructor_id, assigned_by, is_active, assigned_date)
         VALUES ($1, $2, $3, true, CURRENT_TIMESTAMP)
         RETURNING *`,
        [courseId, instructorId, req.user.userId]
      );

      // Update current_owner for question banks in this course
      await client.query(
        `UPDATE question_banks
         SET current_owner = $1
         WHERE course_id = $2`,
        [instructorId, courseId]
      );

      // Update current_owner for questions in this course's question banks
      await client.query(
        `UPDATE questions q
         SET current_owner = $1
         FROM question_banks qb
         WHERE q.question_bank_id = qb.question_bank_id
         AND qb.course_id = $2`,
        [instructorId, courseId]
      );

      await client.query('COMMIT');

      res.status(200).json({
        success: true,
        message:
          'Instructor assigned to course and granted content management rights',
        data: result.rows[0],
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error assigning instructor to course:', error);
      res.status(500).json({
        success: false,
        message: 'Error assigning instructor to course',
        error: error.message,
      });
    } finally {
      client.release();
    }
  },

  removeInstructorFromCourse: async (req, res) => {
    const client = await pool.connect();
    const { courseId, instructorId } = req.params;
    try {
      await client.query('BEGIN');

      
      
      

      // Check current assignments
      const currentAssignments = await client.query(
        `SELECT * FROM course_assignments
         WHERE course_id = $1 AND instructor_id = $2`,
        [courseId, instructorId]
      );
      

      // Delete all assignments for this instructor-course pair
      const deleteResult = await client.query(
        `DELETE FROM course_assignments
         WHERE course_id = $1 AND instructor_id = $2
         RETURNING *`,
        [courseId, instructorId]
      );
      

      if (deleteResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'No assignment found for this instructor in this course',
        });
      }

      await client.query('COMMIT');
      

      res.status(200).json({
        success: true,
        data: deleteResult.rows[0],
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error removing instructor from course:', error);
      res.status(500).json({
        success: false,
        message: 'Error removing instructor from course',
        error: error.message,
      });
    } finally {
      client.release();
    }
  },

  // Question Bank Management
  createQuestionBank: async (req, res) => {
    const client = await pool.connect();
    const { bankName, description, courseId } = req.body;
    try {
      const query = `
        INSERT INTO question_banks
        (bank_name, description, course_id, created_by)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `;

      const result = await client.query(query, [
        bankName,
        description,
        courseId,
        req.user.userId,
      ]);

      res.status(201).json({
        success: true,
        data: result.rows[0],
      });
    } catch (error) {
      console.error('Error creating question bank:', error);
      res.status(500).json({
        success: false,
        message: 'Error creating question bank',
        error: error.message,
      });
    } finally {
      client.release();
    }
  },

  getQuestionBanks: async (req, res) => {
    const client = await pool.connect();
    const { courseId } = req.params;
    try {
      const query = `
        SELECT
          qb.*,
          (SELECT COUNT(*) FROM questions q WHERE q.question_bank_id = qb.question_bank_id) as question_count
        FROM question_banks qb
        WHERE qb.course_id = $1
        ORDER BY qb.created_at DESC
      `;

      const result = await client.query(query, [courseId]);

      res.status(200).json({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      console.error('Error fetching question banks:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching question banks',
        error: error.message,
      });
    } finally {
      client.release();
    }
  },

  // Create a new instructor
  createInstructor: async (req, res) => {
    const client = await pool.connect();
    const { username, email, password, firstName, lastName, department } =
      req.body;

    try {
      // Start a transaction
      await client.query('BEGIN');

      // Check if username or email already exists
      const checkExisting = await client.query(
        `SELECT username, email FROM users
         WHERE username = $1 OR email = $2`,
        [username, email]
      );

      if (checkExisting.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Username or email already exists',
        });
      }

      // Insert the new instructor with department
      const result = await client.query(
        `INSERT INTO users (
          username,
          email,
          password,
          first_name,
          last_name,
          department,
          role,
          is_approved
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'instructor', true)
        RETURNING user_id, username, email, first_name, last_name, department`,
        [username, email, password, firstName, lastName, department]
      );

      await client.query('COMMIT');

      res.status(201).json({
        success: true,
        message: 'Instructor created successfully',
        data: result.rows[0],
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error creating instructor:', error);
      res.status(500).json({
        success: false,
        message: 'Error creating instructor',
        error: error.message,
      });
    } finally {
      client.release();
    }
  },

  // Get detailed course information
  getCourseDetails: async (req, res) => {
    const client = await pool.connect();
    const { courseId } = req.params;

    try {
      // Get course basic info and statistics
      const courseQuery = `
        SELECT
          c.*,
          u.first_name as created_by_first_name,
          u.last_name as created_by_last_name,
          (
            SELECT COUNT(DISTINCT ca.instructor_id)
            FROM course_assignments ca
            WHERE ca.course_id = c.course_id AND ca.is_active = true
          ) as active_instructors_count,
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
          ) as total_questions,
          (
            SELECT COUNT(*)
            FROM exams e
            WHERE e.course_id = c.course_id
          ) as total_exams
        FROM courses c
        JOIN users u ON c.created_by = u.user_id
        WHERE c.course_id = $1
      `;

      const courseResult = await client.query(courseQuery, [courseId]);

      if (courseResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Course not found',
        });
      }

      // Get current instructors
      const currentInstructorsQuery = `
        SELECT
          u.user_id,
          u.username,
          u.first_name,
          u.last_name,
          u.email,
          u.is_active,
          ca.assigned_date,
          (
            SELECT COUNT(*)
            FROM questions q
            JOIN question_banks qb ON q.question_bank_id = qb.question_bank_id
            WHERE qb.course_id = $1 AND q.created_by = u.user_id
          ) as questions_created
        FROM course_assignments ca
        JOIN users u ON ca.instructor_id = u.user_id
        WHERE ca.course_id = $1 AND ca.is_active = true
      `;

      const currentInstructors = await client.query(currentInstructorsQuery, [
        courseId,
      ]);

      // Get question banks with details
      const questionBanksQuery = `
        SELECT
          qb.question_bank_id,
          qb.bank_name,
          qb.description,
          qb.created_at,
          u.first_name as created_by_first_name,
          u.last_name as created_by_last_name,
          (
            SELECT COUNT(*)
            FROM questions q
            WHERE q.question_bank_id = qb.question_bank_id
          ) as question_count,
          (
            SELECT json_agg(json_build_object(
              'question_id', q.question_id,
              'question_text', q.question_text,
              'question_type', q.question_type,
              'points', q.points,
              'created_by', (
                SELECT json_build_object(
                  'user_id', u2.user_id,
                  'first_name', u2.first_name,
                  'last_name', u2.last_name
                )
                FROM users u2
                WHERE u2.user_id = q.created_by
              )
            ))
            FROM questions q
            WHERE q.question_bank_id = qb.question_bank_id
          ) as questions
        FROM question_banks qb
        JOIN users u ON qb.created_by = u.user_id
        WHERE qb.course_id = $1
        ORDER BY qb.created_at DESC
      `;

      const questionBanks = await client.query(questionBanksQuery, [courseId]);

      // Get assignment history
      const assignmentHistoryQuery = `
        SELECT
          ca.assignment_id,
          ca.assigned_date,
          ca.end_date,
          u.user_id,
          u.first_name,
          u.last_name,
          u.is_active,
          a.first_name as assigned_by_first_name,
          a.last_name as assigned_by_last_name
        FROM course_assignments ca
        JOIN users u ON ca.instructor_id = u.user_id
        JOIN users a ON ca.assigned_by = a.user_id
        WHERE ca.course_id = $1
        ORDER BY ca.assigned_date DESC
      `;

      const assignmentHistory = await client.query(assignmentHistoryQuery, [
        courseId,
      ]);

      // Combine all data
      const courseDetails = {
        ...courseResult.rows[0],
        current_instructors: currentInstructors.rows,
        question_banks: questionBanks.rows.map((bank) => ({
          ...bank,
          questions: bank.questions || [],
        })),
        assignment_history: assignmentHistory.rows,
      };

      res.status(200).json({
        success: true,
        data: courseDetails,
      });
    } catch (error) {
      console.error('Error fetching course details:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching course details',
        error: error.message,
      });
    } finally {
      client.release();
    }
  },

  // Add chapters to a course
  addChaptersToCourse: async (req, res) => {
    const client = await pool.connect();
    const { courseId } = req.params;
    const { numChapters } = req.body;

    try {
      await client.query('BEGIN');

      // Validate number of chapters
      if (!numChapters || numChapters < 1 || numChapters > 20) {
        return res.status(400).json({
          success: false,
          message: 'Number of chapters must be between 1 and 20',
        });
      }

      // Delete existing chapters
      await client.query(`DELETE FROM course_chapters WHERE course_id = $1`, [
        courseId,
      ]);

      // Add new chapters
      for (let i = 1; i <= numChapters; i++) {
        await client.query(
          `INSERT INTO course_chapters (course_id, chapter_number)
           VALUES ($1, $2)`,
          [courseId, i]
        );
      }

      await client.query('COMMIT');

      // Get all chapters for the course
      const result = await client.query(
        `SELECT chapter_id, chapter_number
         FROM course_chapters
         WHERE course_id = $1
         ORDER BY chapter_number`,
        [courseId]
      );

      res.status(200).json({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error adding chapters:', error);
      res.status(500).json({
        success: false,
        message: 'Error adding chapters',
        error: error.message,
      });
    } finally {
      client.release();
    }
  },

  // Delete a course and all its related data
  deleteCourse: async (req, res) => {
    const client = await pool.connect();
    try {
      const { courseId } = req.params;

      // Check if course exists
      const courseCheck = await client.query(
        'SELECT course_id FROM courses WHERE course_id = $1',
        [courseId]
      );

      if (courseCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Course not found',
        });
      }

      // Begin transaction
      await client.query('BEGIN');

      // Delete all question banks associated with this course
      await client.query(`DELETE FROM question_banks WHERE course_id = $1`, [
        courseId,
      ]);

      // Delete course assignments
      await client.query(
        `DELETE FROM course_assignments WHERE course_id = $1`,
        [courseId]
      );

      // Delete the course
      await client.query(`DELETE FROM courses WHERE course_id = $1`, [
        courseId,
      ]);

      await client.query('COMMIT');

      res.status(200).json({
        success: true,
        message: 'Course deleted successfully',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error deleting course:', error);
      res.status(500).json({
        success: false,
        message: 'Error deleting course',
        error: error.message,
      });
    } finally {
      client.release();
    }
  },

  // Reactivate an instructor
  reactivateInstructor: async (req, res) => {
    const client = await pool.connect();
    const { instructorId } = req.params;

    try {
      await client.query('BEGIN');

      // Reactivate the instructor's account
      const result = await client.query(
        `UPDATE users
         SET is_active = true,
             is_approved = true
         WHERE user_id = $1 AND role = 'instructor'
         RETURNING *`,
        [instructorId]
      );

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Instructor not found',
        });
      }

      await client.query('COMMIT');
      res.status(200).json({
        success: true,
        message: 'Instructor reactivated successfully',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error reactivating instructor:', error);
      res.status(500).json({
        success: false,
        message: 'Error reactivating instructor',
        error: error.message,
      });
    } finally {
      client.release();
    }
  },

  // Permanently delete an instructor
  permanentlyDeleteInstructor: async (req, res) => {
    const client = await pool.connect();
    const { instructorId } = req.params;

    try {
      await client.query('BEGIN');

      // First, get the instructor's information
      const instructorInfo = await client.query(
        `SELECT * FROM users WHERE user_id = $1 AND role = 'instructor'`,
        [instructorId]
      );

      if (instructorInfo.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Instructor not found',
        });
      }

      // Check if instructor is already inactive
      if (instructorInfo.rows[0].is_active) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message:
            'Cannot delete an active instructor. Please deactivate first.',
        });
      }

      const instructor = instructorInfo.rows[0];

      // Move instructor to past_instructors table
      await client.query(
        `INSERT INTO past_instructors (
          user_id, username, email, first_name, last_name, department,
          created_at, deleted_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          instructor.user_id,
          instructor.username,
          instructor.email,
          instructor.first_name,
          instructor.last_name,
          instructor.department,
          instructor.created_at,
          req.user.userId,
        ]
      );

      // Update question banks to transfer current ownership to admin
      // Keep original creator for historical record
      await client.query(
        `UPDATE question_banks
         SET current_owner = $1
         WHERE current_owner = $2`,
        [req.user.userId, instructorId]
      );

      // Update questions to transfer current ownership to admin
      // Keep original creator for historical record
      await client.query(
        `UPDATE questions
         SET current_owner = $1
         WHERE current_owner = $2`,
        [req.user.userId, instructorId]
      );

      // Update courses to transfer ownership to admin
      await client.query(
        `UPDATE courses
         SET created_by = $1
         WHERE created_by = $2`,
        [req.user.userId, instructorId]
      );

      // Delete course assignments
      await client.query(
        `DELETE FROM course_assignments
         WHERE instructor_id = $1`,
        [instructorId]
      );

      // Delete from users table
      await client.query(
        `DELETE FROM users
         WHERE user_id = $1 AND role = 'instructor'`,
        [instructorId]
      );

      await client.query('COMMIT');
      res.status(200).json({
        success: true,
        message:
          'Instructor permanently deleted. Content ownership transferred while preserving original creator information.',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error permanently deleting instructor:', error);
      res.status(500).json({
        success: false,
        message: 'Error permanently deleting instructor',
        error: error.message,
      });
    } finally {
      client.release();
    }
  },
};

module.exports = adminController;
