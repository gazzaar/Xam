const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middleware/authMiddleware');

// Apply admin middleware to all routes
router.use(authMiddleware.verifyToken, authMiddleware.isAdmin);

/**
 * @route GET /admin/dashboard
 * @desc Get admin dashboard statistics
 * @access Private (Admin only)
 */
router.get('/dashboard', adminController.getDashboardStats);

/**
 * @route POST /admin/instructors
 * @desc Create a new instructor
 * @access Private (Admin only)
 */
router.post('/instructors', adminController.createInstructor);

/**
 * @route GET /admin/instructors
 * @desc Get all instructors (both active and inactive)
 * @access Private (Admin only)
 */
router.get('/instructors', adminController.getAllInstructors);

/**
 * @route GET /admin/instructors/pending
 * @desc Get all pending instructor registrations
 * @access Private (Admin only)
 */
router.get('/instructors/pending', adminController.getPendingInstructors);

/**
 * @route PUT /admin/instructors/:instructorId/approve
 * @desc Approve an instructor registration
 * @access Private (Admin only)
 */
router.put(
  '/instructors/:instructorId/approve',
  adminController.approveInstructor
);

/**
 * @route PUT /admin/instructors/:instructorId/deactivate
 * @desc Deactivate an instructor account (reversible)
 * @access Private (Admin only)
 */
router.put(
  '/instructors/:instructorId/deactivate',
  adminController.deleteInstructor
);

/**
 * @route PUT /admin/instructors/:instructorId/reactivate
 * @desc Reactivate a deactivated instructor account
 * @access Private (Admin only)
 */
router.put(
  '/instructors/:instructorId/reactivate',
  adminController.reactivateInstructor
);

/**
 * @route DELETE /admin/instructors/:instructorId/permanent
 * @desc Permanently delete an instructor (only for inactive instructors)
 * @access Private (Admin only)
 */
router.delete(
  '/instructors/:instructorId/permanent',
  adminController.permanentlyDeleteInstructor
);

// Course management
router.post('/courses', adminController.createCourse);
router.get('/courses', adminController.getAllCourses);
router.get('/courses/:courseId', adminController.getCourseDetails);
router.post('/courses/:courseId/chapters', adminController.addChaptersToCourse);
router.delete('/courses/:courseId', adminController.deleteCourse);

// Course assignment management
router.post(
  '/courses/:courseId/instructors/:instructorId',
  adminController.assignInstructorToCourse
);
router.delete(
  '/courses/:courseId/instructors/:instructorId',
  adminController.removeInstructorFromCourse
);

// Question bank management
router.post('/question-banks', adminController.createQuestionBank);
router.get(
  '/courses/:courseId/question-banks',
  adminController.getQuestionBanks
);

module.exports = router;
