const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const dotenv = require('dotenv');

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

const verifyToken = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No authentication token, access denied',
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    // Get user with assigned courses if instructor
    const query = `
      SELECT
        u.user_id,
        u.username,
        u.role,
        u.is_approved,
        CASE
          WHEN u.role = 'instructor' THEN (
            SELECT array_agg(ca.course_id)
            FROM course_assignments ca
            WHERE ca.instructor_id = u.user_id AND ca.is_active = true
          )
          ELSE NULL
        END as assigned_course_ids
      FROM users u
      WHERE u.user_id = $1
    `;

    const result = await pool.query(query, [decoded.userId]);

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'User not found',
      });
    }

    const user = result.rows[0];

    // Add user info to request
    req.user = {
      userId: user.user_id,
      username: user.username,
      role: user.role,
      isApproved: user.is_approved,
      assignedCourseIds: user.assigned_course_ids || [],
    };

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({
      success: false,
      message: 'Token is invalid',
    });
  }
};

const isInstructor = async (req, res, next) => {
  if (req.user.role !== 'instructor') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Instructor role required.',
    });
  }

  if (!req.user.isApproved) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Your account is pending approval.',
    });
  }

  next();
};

const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin role required.',
    });
  }
  next();
};

const hasAccessToCourse = async (req, res, next) => {
  const courseId = parseInt(req.params.courseId);

  if (req.user.role === 'admin') {
    return next();
  }

  if (!req.user.assignedCourseIds.includes(courseId)) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. You are not assigned to this course.',
    });
  }

  next();
};

module.exports = {
  verifyToken,
  isInstructor,
  isAdmin,
  hasAccessToCourse,
};
