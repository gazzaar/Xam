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
      // Get user from database
      const result = await client.query(
        'SELECT user_id, username, role, is_approved FROM users WHERE username = $1 AND password = $2',
        [username, password]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials',
        });
      }

      const user = result.rows[0];

      // Create token
      const token = jwt.sign(
        { userId: user.user_id, role: user.role },
        JWT_SECRET,
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

  registerInstructor: async (req, res) => {
    const { username, password, email, firstName, lastName } = req.body;

    try {
      // Start transaction
      await client.query('BEGIN');

      // Check if username or email already exists
      const checkUser = await client.query(
        'SELECT username, email FROM users WHERE username = $1 OR email = $2',
        [username, email]
      );

      if (checkUser.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Username or email already exists',
        });
      }

      // Insert into users table
      const userResult = await client.query(
        `INSERT INTO users
         (username, password, email, first_name, last_name, role, is_approved)
         VALUES ($1, $2, $3, $4, $5, 'instructor', false)
         RETURNING user_id`,
        [username, password, email, firstName, lastName]
      );

      // Commit transaction
      await client.query('COMMIT');

      res.status(201).json({
        success: true,
        message: 'Registration successful. Waiting for admin approval.',
        data: {
          username,
          email,
          firstName,
          lastName,
        },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Registration error:', error);
      res.status(500).json({
        success: false,
        message: 'Error during registration',
        error: error.message,
      });
    }
  },

  logout: async (req, res) => {
    try {
      // You could implement token blacklisting here if needed
      // For now, we'll just send a success response
      res.status(200).json({
        success: true,
        message: 'Logged out successfully',
      });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({
        success: false,
        message: 'Error during logout',
        error: error.message,
      });
    }
  },
};

module.exports = authController;
