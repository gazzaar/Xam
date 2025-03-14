const { Router } = require('express');
const studentsControllers = require('../controllers/studentsControllers.js');

const studentRouter = Router();
studentRouter.get('/', studentsControllers.getAllStudents);
studentRouter.post('/', studentsControllers.setStudent);

module.exports = studentRouter;
