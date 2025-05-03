const express = require('express');
const router = express.Router();
const multer = require('multer');
const instructorController = require('../controllers/instructorController');
const authMiddleware = require('../middleware/authMiddleware');

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Dashboard statistics
router.get(
  '/dashboard',
  authMiddleware.authenticateToken,
  authMiddleware.isInstructor,
  instructorController.getDashboardStats
);

// Exam management routes
router.post(
  '/exams',
  authMiddleware.authenticateToken,
  authMiddleware.isInstructor,
  instructorController.createExam
);
router.get(
  '/exams',
  authMiddleware.authenticateToken,
  authMiddleware.isInstructor,
  instructorController.getExams
);
router.put(
  '/exams/:exam_id',
  authMiddleware.authenticateToken,
  authMiddleware.isInstructor,
  instructorController.updateExam
);
router.delete(
  '/exams/:exam_id',
  authMiddleware.authenticateToken,
  authMiddleware.isInstructor,
  instructorController.deleteExam
);
router.post(
  '/exams/:exam_id/questions',
  authMiddleware.authenticateToken,
  authMiddleware.isInstructor,
  instructorController.addQuestions
);
router.post(
  '/exams/:exam_id/students/upload',
  authMiddleware.authenticateToken,
  authMiddleware.isInstructor,
  upload.single('file'),
  instructorController.uploadAllowedStudents
);
router.get(
  '/exams/:exam_id/results',
  authMiddleware.authenticateToken,
  authMiddleware.isInstructor,
  instructorController.getExamResults
);

// Question Bank Management
router.post(
  '/questions',
  authMiddleware.authenticateToken,
  authMiddleware.isInstructor,
  instructorController.addQuestion
);
router.get(
  '/questions',
  authMiddleware.authenticateToken,
  authMiddleware.isInstructor,
  instructorController.getQuestions
);
router.put(
  '/questions/:questionId',
  authMiddleware.authenticateToken,
  authMiddleware.isInstructor,
  instructorController.updateQuestion
);
router.delete(
  '/questions/:questionId',
  authMiddleware.authenticateToken,
  authMiddleware.isInstructor,
  instructorController.deleteQuestion
);

// Exam Generation
router.post(
  '/exams/generate',
  authMiddleware.authenticateToken,
  authMiddleware.isInstructor,
  instructorController.generateExam
);

module.exports = router;
