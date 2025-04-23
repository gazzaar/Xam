const { Client } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

const dbUser = process.env.DB_USER;
const dbPass = process.env.DB_PASS;

const client = new Client({
  connectionString: `postgresql://${dbUser}:${dbPass}@localhost:5432/xam`,
});

client.connect();

const adminController = {
  // Get all pending instructor registrations
  getPendingInstructors: async (req, res) => {
    try {
      const query = `
                SELECT u.user_id, u.username, u.email, u.first_name, u.last_name,
                       i.department
                FROM users u
                JOIN instructors i ON u.user_id = i.instructor_id
                WHERE u.role = 'instructor' AND u.is_approved = false
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
    }
  },

  // Approve an instructor registration
  approveInstructor: async (req, res) => {
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
    }
  },

  // Get all instructors (both pending and approved)
  getAllInstructors: async (req, res) => {
    try {
      const query = `
                SELECT u.user_id, u.username, u.email, u.first_name, u.last_name,
                       u.is_approved, i.department
                FROM users u
                JOIN instructors i ON u.user_id = i.instructor_id
                WHERE u.role = 'instructor'
                ORDER BY u.is_approved DESC, u.username
            `;

      const result = await client.query(query);

      res.status(200).json({
        success: true,
        data: result.rows,
      });
    } catch (error) {
      console.error('Error fetching instructors:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching instructors',
        error: error.message,
      });
    }
  },

  // Delete an instructor
  deleteInstructor: async (req, res) => {
    const { instructorId } = req.params;

    try {
      // Start a transaction
      await client.query('BEGIN');

      // First, delete from instructors table
      await client.query('DELETE FROM instructors WHERE instructor_id = $1', [
        instructorId,
      ]);

      // Then, delete from users table
      const deleteQuery = `
                DELETE FROM users
                WHERE user_id = $1 AND role = 'instructor'
                RETURNING *
            `;

      const result = await client.query(deleteQuery, [instructorId]);

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
        message: 'Instructor deleted successfully',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error deleting instructor:', error);
      res.status(500).json({
        success: false,
        message: 'Error deleting instructor',
        error: error.message,
      });
    }
  },

  // Get admin dashboard statistics
  getDashboardStats: async (req, res) => {
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
          FROM exams
          WHERE is_active = true AND end_date > NOW()
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

module.exports = adminController;
