const pool = require('./pool.js');

async function insertStudent(...studentData) {
  const [fName, lName, degree, grade, email, pass] = studentData;
  const queryText = `
  INSERT INTO students (student_first_name, student_last_name,student_degree,student_grade, student_email,student_password)
  VALUES($1,$2,$3,$4,$5,$6)
`;
  await pool.query(queryText, [fName, lName, degree, grade, email, pass]);
}

async function getAll() {
  const { rows } = await pool.query('SELECT * FROM students;');
  return rows;
}

// async function insertName(studentName) {
//   await pool.query('INSERT INTO students (student_first_name) VALUES($1),', [
//     studentName,
//   ]);
// }

async function insertDegree(name, degree) {
  await pool.query(
    `UPDATE students SET student_degree = $1 WHERE student_first_name = $2`,
    [degree, name]
  );
}

async function insertGrade(name, grade) {
  await pool.query(
    `UPDATE students SET student_grade= $1 WHERE student_first_name = $2`,
    [grade, name]
  );
}
module.exports = {
  insertStudent,
  getAll,
  // insertName,
  insertGrade,
  insertDegree,
};
