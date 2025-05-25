const express = require('express');
const router = express.Router();
const instructorController = require('../controllers/instructorController');
const authMiddleware = require('../middleware/authMiddleware');

// Configure multer for file uploads
// const upload = multer({ dest: 'uploads/' });

// Exam Generation
router.post(
  '/exams/generate',
  authMiddleware.verifyToken,
  authMiddleware.isInstructor,
  instructorController.generateExam
);

// Question Management
router.post(
  '/questions',
  authMiddleware.verifyToken,
  authMiddleware.isInstructor,
  instructorController.addQuestion
);
router.get(
  '/questions',
  authMiddleware.verifyToken,
  authMiddleware.isInstructor,
  instructorController.getQuestions
);
router.put(
  '/questions/:questionId',
  authMiddleware.verifyToken,
  authMiddleware.isInstructor,
  instructorController.updateQuestion
);
router.delete(
  '/questions/:questionId',
  authMiddleware.verifyToken,
  authMiddleware.isInstructor,
  instructorController.deleteQuestion
);

// Exam Management
/**
 * @route POST /api/instructor/exams
 * @description Create a new exam
 * @access Private (Instructor only)
 * @body {string} exam_name - Name of the exam
 * @body {string} description - Description of the exam
 * @body {number} time_limit_minutes - Time limit in minutes
 */
router.post(
  '/exams',
  authMiddleware.verifyToken,
  authMiddleware.isInstructor,
  instructorController.createExam
);

/**
 * @route GET /api/instructor/exams
 * @description Get all exams created by the instructor
 * @access Private (Instructor only)
 */
router.get(
  '/exams',
  authMiddleware.verifyToken,
  authMiddleware.isInstructor,
  instructorController.getExams
);

/**
 * @route PUT /api/instructor/exams/:exam_id
 * @description Update an existing exam
 * @access Private (Instructor only)
 * @param {string} exam_id - ID of the exam to update
 * @body {string} exam_name - New name of the exam
 * @body {string} description - New description of the exam
 * @body {number} time_limit_minutes - New time limit in minutes
 */
router.put(
  '/exams/:exam_id',
  authMiddleware.verifyToken,
  authMiddleware.isInstructor,
  instructorController.updateExam
);

/**
 * @route DELETE /api/instructor/exams/:exam_id
 * @description Delete an exam
 * @access Private (Instructor only)
 * @param {string} exam_id - ID of the exam to delete
 */
router.delete(
  '/exams/:exam_id',
  authMiddleware.verifyToken,
  authMiddleware.isInstructor,
  instructorController.deleteExam
);

/**
 * @route GET /api/instructor/exams/:id/preview
 * @description Get a preview of an exam with sample questions
 * @access Private (Instructor only)
 * @param {string} id - ID of the exam to preview
 */
router.get(
  '/exams/:id/preview',
  authMiddleware.verifyToken,
  authMiddleware.isInstructor,
  instructorController.getExamPreview
);

/**
 * @route POST /api/instructor/exams/:exam_id/questions
 * @description Add questions to an exam
 * @access Private (Instructor only)
 * @param {string} exam_id - ID of the exam
 * @body {Array} questions - Array of question objects
 */
router.post(
  '/exams/:exam_id/questions',
  authMiddleware.verifyToken,
  authMiddleware.isInstructor,
  instructorController.addQuestions
);

// Exam Student Management (commented out for now)
// router.post(
//   '/exams/:exam_id/students/upload',
//   authMiddleware.authenticateToken,
//   authMiddleware.isInstructor,
//   upload.single('file'),
//   instructorController.uploadAllowedStudents
// );

/**
 * @route GET /api/instructor/exams/:exam_id/results
 * @description Get exam results
 * @access Private (Instructor only)
 * @param {string} exam_id - ID of the exam
 */
router.get(
  '/exams/:exam_id/results',
  authMiddleware.verifyToken,
  authMiddleware.isInstructor,
  instructorController.getExamResults
);

// Dashboard
/**
 * @route GET /api/instructor/dashboard
 * @description Get instructor dashboard statistics
 * @access Private (Instructor only)
 */
router.get(
  '/dashboard',
  authMiddleware.verifyToken,
  authMiddleware.isInstructor,
  instructorController.getDashboardStats
);

// Course Management
router.post(
  '/courses',
  authMiddleware.verifyToken,
  authMiddleware.isInstructor,
  instructorController.createCourse
);

router.get(
  '/courses',
  authMiddleware.verifyToken,
  authMiddleware.isInstructor,
  instructorController.getCourses
);

router.delete(
  '/courses/:course_id',
  authMiddleware.verifyToken,
  authMiddleware.isInstructor,
  instructorController.deleteCourse
);

// Question Bank Management
router.post(
  '/question-banks',
  authMiddleware.verifyToken,
  authMiddleware.isInstructor,
  instructorController.createQuestionBank
);

router.get(
  '/question-banks',
  authMiddleware.verifyToken,
  authMiddleware.isInstructor,
  instructorController.getQuestionBanks
);

router.delete(
  '/question-banks/:question_bank_id',
  authMiddleware.verifyToken,
  authMiddleware.isInstructor,
  instructorController.deleteQuestionBank
);

// Question Bank Questions
router.get(
  '/question-banks/:question_bank_id/questions',
  authMiddleware.verifyToken,
  authMiddleware.isInstructor,
  instructorController.getQuestionsInQuestionBank
);

router.post(
  '/question-banks/:question_bank_id/questions',
  authMiddleware.verifyToken,
  authMiddleware.isInstructor,
  instructorController.addQuestionsToQuestionBank
);

router.delete(
  '/question-banks/:question_bank_id/questions/:question_id',
  authMiddleware.verifyToken,
  authMiddleware.isInstructor,
  instructorController.deleteQuestionFromQuestionBank
);

router.put(
  '/question-banks/:question_bank_id/questions/:question_id',
  authMiddleware.verifyToken,
  authMiddleware.isInstructor,
  instructorController.updateQuestionInQuestionBank
);

// Commenting out file upload endpoint for now
// router.post(
//   '/exams/:exam_id/students/upload',
//   authMiddleware.authenticateToken,
//   authMiddleware.isInstructor,
//   upload.single('students'),
//   instructorController.uploadAllowedStudents
// );

module.exports = router;
