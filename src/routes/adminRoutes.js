const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middleware/authMiddleware');

// Middleware to check if user is admin
const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({
      success: false,
      message: 'Access denied. Admin only.',
    });
  }
};

// Apply authentication and admin check middleware to all routes
router.use(authMiddleware, isAdmin);

// Get dashboard statistics
router.get('/dashboard', adminController.getDashboardStats);

// Instructor management routes
router.get('/instructors', adminController.getAllInstructors);
router.get('/instructors/pending', adminController.getPendingInstructors);
router.put(
  '/instructors/:instructorId/approve',
  adminController.approveInstructor
);
router.delete('/instructors/:instructorId', adminController.deleteInstructor);

module.exports = router;
