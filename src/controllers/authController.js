const { Client } = require('pg');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

const dbUser = process.env.DB_USER;
const dbPass = process.env.DB_PASS;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

const client = new Client({
  connectionString: `postgresql://${dbUser}:${dbPass}@localhost:5432/xam`,
});

client.connect();

const authController = {
  login: async (req, res) => {
    const { username, password } = req.body;

    try {
      // Check if user exists and password is correct
      const userResult = await client.query(
        'SELECT * FROM users WHERE username = $1',
        [username]
      );

      if (userResult.rows.length === 0) {
        return res.status(401).json({
          success: false,
          message: 'Invalid username or password',
        });
      }

      const user = userResult.rows[0];

      // For instructors, check if they are approved
      if (user.role === 'instructor' && !user.is_approved) {
        return res.status(401).json({
          success: false,
          message: 'Your account is pending approval',
        });
      }

      // Check if user is active
      if (!user.is_active) {
        return res.status(401).json({
          success: false,
          message: 'Your account has been deactivated',
        });
      }

      // Compare password
      if (password !== user.password) {
        return res.status(401).json({
          success: false,
          message: 'Invalid username or password',
        });
      }

      // If user is an instructor, get their assigned courses
      let assigned_courses = [];
      if (user.role === 'instructor') {
        const coursesResult = await client.query(
          `SELECT c.course_id, c.course_name, c.course_code
           FROM courses c
           JOIN course_assignments ca ON c.course_id = ca.course_id
           WHERE ca.instructor_id = $1 AND ca.is_active = true`,
          [user.user_id]
        );
        assigned_courses = coursesResult.rows;
      }

      // Generate JWT token
      const token = jwt.sign(
        {
          userId: user.user_id,
          username: user.username,
          role: user.role,
        },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

      res.status(200).json({
        success: true,
        token,
        user: {
          userId: user.user_id,
          username: user.username,
          role: user.role,
          isApproved: user.is_approved,
          firstName: user.first_name,
          lastName: user.last_name,
          email: user.email,
          assignedCourses: assigned_courses,
        },
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({
        success: false,
        message: 'Error during login',
        error: error.message,
      });
    }
  },

  logout: async (req, res) => {
    // Since we're using JWT, we don't need to do anything server-side
    // The client will remove the token
    res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });
  },
};

module.exports = authController;
