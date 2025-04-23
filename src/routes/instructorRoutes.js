const express = require('express');
const router = express.Router();
const multer = require('multer');
const instructorController = require('../controllers/instructorController');
const authMiddleware = require('../middleware/authMiddleware');

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Middleware to check if user is an approved instructor
const isApprovedInstructor = (req, res, next) => {
  if (req.user && req.user.role === 'instructor' && req.user.is_approved) {
    next();
  } else {
    res.status(403).json({
      success: false,
      message: 'Access denied. Approved instructor only.',
    });
  }
};

// Apply authentication and instructor check middleware to all routes
router.use(authMiddleware, isApprovedInstructor);

// Dashboard statistics
router.get('/dashboard', instructorController.getDashboardStats);

// Exam management routes
router.post('/exams', instructorController.createExam);
router.get('/exams', instructorController.getExams);
router.put('/exams/:exam_id', instructorController.updateExam);
router.delete('/exams/:exam_id', instructorController.deleteExam);
router.post('/exams/:exam_id/questions', instructorController.addQuestions);
router.post(
  '/exams/:exam_id/students/upload',
  upload.single('file'),
  instructorController.uploadAllowedStudents
);
router.get('/exams/:exam_id/results', instructorController.getExamResults);

module.exports = router;
