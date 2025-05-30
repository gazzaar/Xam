const express = require('express');
const router = express.Router();
const studentController = require('../controllers/studentController');

// Route for validating student access to exam
router.post('/exam/validate-access', studentController.validateExamAccess);

// Route for getting exam questions
router.post('/exam/:examId/questions', studentController.getExamQuestions);

// Route for submitting an answer
router.post('/exam/:examId/answer', studentController.submitAnswer);

// Route for submitting the exam
router.post('/exam/:examId/submit', studentController.submitExam);

module.exports = router;
