const jwt = require('jsonwebtoken');
const { Client } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

const dbUser = process.env.DB_USER;
const dbPass = process.env.DB_PASS;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

const client = new Client({
  connectionString: `postgresql://${dbUser}:${dbPass}@localhost:5432/xam`,
});

client.connect();

const authMiddleware = async (req, res, next) => {
  try {
    // Get token from header
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No authentication token, access denied',
      });
    }

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Get user from database
    const result = await client.query(
      'SELECT user_id, username, role, is_approved FROM users WHERE user_id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'User not found',
      });
    }

    // Add user info to request
    req.user = result.rows[0];
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({
      success: false,
      message: 'Token is invalid',
    });
  }
};

module.exports = authMiddleware;
