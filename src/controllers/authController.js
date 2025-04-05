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
};

module.exports = authController;
