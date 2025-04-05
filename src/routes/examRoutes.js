const express = require('express');
const router = express.Router();
const examController = require('../controllers/examController');

// Student exam access routes (no auth required)
router.post('/validate-access', examController.validateAccess);
router.post('/start', examController.startExam);
router.post('/answer', examController.submitAnswer);
router.post('/:attempt_id/finish', examController.finishExam);

module.exports = router;
