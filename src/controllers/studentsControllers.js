const db = require('../db/studentsQueries.js');

function setStudent(req, res) {
  const {
    studentFirstName,
    studentLastName,
    studentDegree,
    studentGrade,
    studentEmail,
    studentPass,
  } = req.body;

  const studentData = [
    studentFirstName,
    studentLastName,
    studentDegree,
    studentGrade,
    studentEmail,
    studentPass,
  ];

  db.insertStudent(...studentData);
  res.end();
}

async function getAllStudents(req, res) {
  const studentsNames = await db.getAll();
  console.log('studentsNames:', studentsNames);
  res.send(
    studentsNames
      .map((studentName) => studentName.student_first_name)
      .join(', ')
  );
}

async function setStudentDegree(req, res) {
  const { studentDegree, studentFirstName } = req.body;
  await db.insertDegree(studentFirstName, studentDegree);
  res.end();
}

async function setStudentGrade(req, res) {
  const { studentFirstName, studentGrade } = req.body;
  await db.insertGrade(studentFirstName, studentGrade);
  res.end();
}

module.exports = {
  setStudent,
  getAllStudents,
  setStudentDegree,
  setStudentGrade,
};
