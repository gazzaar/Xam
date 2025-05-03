const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middleware/authMiddleware');

// Get dashboard statistics
router.get(
  '/dashboard',
  authMiddleware.authenticateToken,
  authMiddleware.isAdmin,
  adminController.getDashboardStats
);

// Instructor management routes
router.get(
  '/instructors',
  authMiddleware.authenticateToken,
  authMiddleware.isAdmin,
  adminController.getAllInstructors
);
router.get(
  '/instructors/pending',
  authMiddleware.authenticateToken,
  authMiddleware.isAdmin,
  adminController.getPendingInstructors
);
router.put(
  '/instructors/:instructorId/approve',
  authMiddleware.authenticateToken,
  authMiddleware.isAdmin,
  adminController.approveInstructor
);
router.delete(
  '/instructors/:instructorId',
  authMiddleware.authenticateToken,
  authMiddleware.isAdmin,
  adminController.deleteInstructor
);

module.exports = router;
