const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middleware/authMiddleware');

/**
 * @route GET /admin/dashboard
 * @desc Get admin dashboard statistics
 * @access Private (Admin only)
 */
router.get(
  '/dashboard',
  authMiddleware.authenticateToken,
  authMiddleware.isAdmin,
  adminController.getDashboardStats
);

/**
 * @route GET /admin/instructors
 * @desc Get all instructors (both pending and approved)
 * @access Private (Admin only)
 */
router.get(
  '/instructors',
  authMiddleware.authenticateToken,
  authMiddleware.isAdmin,
  adminController.getAllInstructors
);

/**
 * @route GET /admin/instructors/pending
 * @desc Get all pending instructor registrations
 * @access Private (Admin only)
 */
router.get(
  '/instructors/pending',
  authMiddleware.authenticateToken,
  authMiddleware.isAdmin,
  adminController.getPendingInstructors
);

/**
 * @route PUT /admin/instructors/:instructorId/approve
 * @desc Approve an instructor registration
 * @access Private (Admin only)
 */
router.put(
  '/instructors/:instructorId/approve',
  authMiddleware.authenticateToken,
  authMiddleware.isAdmin,
  adminController.approveInstructor
);

/**
 * @route DELETE /admin/instructors/:instructorId
 * @desc Delete an instructor account
 * @access Private (Admin only)
 */
router.delete(
  '/instructors/:instructorId',
  authMiddleware.authenticateToken,
  authMiddleware.isAdmin,
  adminController.deleteInstructor
);

module.exports = router;
