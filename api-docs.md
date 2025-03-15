## API Documentation

The API documentation outlines the endpoints for interacting with the Online Exam System, covering user management, exam creation, assignment, attempts, and dashboards. Below are the key endpoints with HTTP methods, paths, and descriptions.

### Base URL

- `/api`

### Authentication

- Most endpoints require a token (e.g., JWT) from the `/login` endpoint.
- Role-based access control applies (e.g., instructors create exams, students take exams).

### Endpoints

#### 1. User Management

- **POST /users**

  - **Description**: Create a new user.
  - **Request Body**: `{ "username": string, "password": string, "role": "instructor" | "student" | "admin" }`
  - **Response**: `{ "user_id": integer, "username": string, "role": string }`
  - **Accessible by**: Admin

- **GET /users/{user_id}**

  - **Description**: Get user details by ID.
  - **Response**: `{ "user_id": integer, "username": string, "role": string }`
  - **Accessible by**: Admin, or the user themselves

- **PUT /users/{user_id}**

  - **Description**: Update user details.
  - **Request Body**: `{ "username": string, "password": string, "role": string }`
  - **Response**: `{ "user_id": integer, "username": string, "role": string }`
  - **Accessible by**: Admin, or the user themselves (limited fields)

- **DELETE /users/{user_id}**
  - **Description**: Delete a user.
  - **Accessible by**: Admin

#### 2. Instructor, Student, and Admin Subtypes

- **POST /instructors**

  - **Description**: Create an instructor (link to a user).
  - **Request Body**: `{ "user_id": integer }`
  - **Response**: `{ "instructor_id": integer }`
  - **Accessible by**: Admin

- **POST /students**

  - **Description**: Create a student (link to a user).
  - **Request Body**: `{ "user_id": integer }`
  - **Response**: `{ "student_id": integer }`
  - **Accessible by**: Admin or Instructor

- **POST /admins**
  - **Description**: Create an admin (link to a user).
  - **Request Body**: `{ "user_id": integer }`
  - **Response**: `{ "admin_id": integer }`
  - **Accessible by**: Admin

#### 3. Exam Management

- **POST /exams**

  - **Description**: Create a new exam.
  - **Request Body**: `{ "exam_name": string, "description": string, "start_date": datetime, "end_date": datetime, "duration": integer, "instructor_id": integer }`
  - **Response**: `{ "exam_id": integer, "exam_name": string, ... }`
  - **Accessible by**: Instructor

- **GET /exams/{exam_id}**

  - **Description**: Get exam details by ID.
  - **Response**: `{ "exam_id": integer, "exam_name": string, ... }`
  - **Accessible by**: Instructor, or students assigned to the exam

- **PUT /exams/{exam_id}**

  - **Description**: Update an exam.
  - **Request Body**: `{ "exam_name": string, "description": string, ... }`
  - **Response**: `{ "exam_id": integer, "exam_name": string, ... }`
  - **Accessible by**: Instructor

- **DELETE /exams/{exam_id}**
  - **Description**: Delete an exam.
  - **Accessible by**: Instructor

#### 4. Question Management

- **POST /questions**

  - **Description**: Add a question to an exam.
  - **Request Body**: `{ "exam_id": integer, "question_type": string, "question_text": string, "score": integer }`
  - **Response**: `{ "question_id": integer, "exam_id": integer, ... }`
  - **Accessible by**: Instructor

- **GET /questions/{question_id}**

  - **Description**: Get question details by ID.
  - **Response**: `{ "question_id": integer, "exam_id": integer, ... }`
  - **Accessible by**: Instructor, or students taking the exam

- **PUT /questions/{question_id}**

  - **Description**: Update a question.
  - **Request Body**: `{ "question_type": string, "question_text": string, "score": integer }`
  - **Response**: `{ "question_id": integer, ... }`
  - **Accessible by**: Instructor

- **DELETE /questions/{question_id}**
  - **Description**: Delete a question.
  - **Accessible by**: Instructor

#### 5. Option Management

- **POST /options**

  - **Description**: Add an option to a question.
  - **Request Body**: `{ "question_id": integer, "option_text": string, "is_correct": boolean }`
  - **Response**: `{ "option_id": integer, "question_id": integer, ... }`
  - **Accessible by**: Instructor

- **GET /options/{option_id}**

  - **Description**: Get option details by ID.
  - **Response**: `{ "option_id": integer, "question_id": integer, ... }`
  - **Accessible by**: Instructor, or students taking the exam

- **PUT /options/{option_id}**

  - **Description**: Update an option.
  - **Request Body**: `{ "option_text": string, "is_correct": boolean }`
  - **Response**: `{ "option_id": integer, ... }`
  - **Accessible by**: Instructor

- **DELETE /options/{option_id}**
  - **Description**: Delete an option.
  - **Accessible by**: Instructor

#### 6. Student Group Management

- **POST /student-groups**

  - **Description**: Create a student group.
  - **Request Body**: `{ "group_name": string, "instructor_id": integer }`
  - **Response**: `{ "group_id": integer, "group_name": string, ... }`
  - **Accessible by**: Instructor

- **GET /student-groups/{group_id}**

  - **Description**: Get group details by ID.
  - **Response**: `{ "group_id": integer, "group_name": string, ... }`
  - **Accessible by**: Instructor

- **PUT /student-groups/{group_id}**

  - **Description**: Update a group.
  - **Request Body**: `{ "group_name": string }`
  - **Response**: `{ "group_id": integer, "group_name": string, ... }`
  - **Accessible by**: Instructor

- **DELETE /student-groups/{group_id}**
  - **Description**: Delete a group.
  - **Accessible by**: Instructor

#### 7. Student Group Membership Management

- **POST /student-group-memberships**

  - **Description**: Add a student to a group.
  - **Request Body**: `{ "student_id": integer, "group_id": integer }`
  - **Response**: `{ "membership_id": integer, "student_id": integer, "group_id": integer }`
  - **Accessible by**: Instructor

- **DELETE /student-group-memberships/{membership_id}**
  - **Description**: Remove a student from a group.
  - **Accessible by**: Instructor

#### 8. Exam Assignment Management

- **POST /exam-assignments**

  - **Description**: Assign an exam to a group.
  - **Request Body**: `{ "exam_id": integer, "group_id": integer }`
  - **Response**: `{ "assignment_id": integer, "exam_id": integer, "group_id": integer }`
  - **Accessible by**: Instructor

- **DELETE /exam-assignments/{assignment_id}**
  - **Description**: Remove an exam assignment.
  - **Accessible by**: Instructor

#### 9. Exam Attempt Management

- **POST /exam-attempts**

  - **Description**: Start an exam attempt.
  - **Request Body**: `{ "student_id": integer, "exam_id": integer }`
  - **Response**: `{ "attempt_id": integer, "student_id": integer, "exam_id": integer, "start_time": datetime }`
  - **Accessible by**: Student

- **PUT /exam-attempts/{attempt_id}**

  - **Description**: Submit an exam attempt.
  - **Request Body**: `{ "end_time": datetime, "score": integer }`
  - **Response**: `{ "attempt_id": integer, ... }`
  - **Accessible by**: Student or System (auto-submit)

- **GET /exam-attempts/{attempt_id}**
  - **Description**: Get attempt details by ID.
  - **Response**: `{ "attempt_id": integer, "student_id": integer, "exam_id": integer, "start_time": datetime, "end_time": datetime, "score": integer }`
  - **Accessible by**: Student, Instructor

#### 10. Answer Management

- **POST /answers**

  - **Description**: Submit an answer for a question.
  - **Request Body**: `{ "attempt_id": integer, "question_id": integer, "answer_text": string, "is_correct": boolean }`
  - **Response**: `{ "answer_id": integer, "attempt_id": integer, ... }`
  - **Accessible by**: Student

- **GET /answers/{answer_id}**
  - **Description**: Get answer details by ID.
  - **Response**: `{ "answer_id": integer, "attempt_id": integer, ... }`
  - **Accessible by**: Student, Instructor

#### 11. Authentication

- **POST /login**

  - **Description**: Authenticate a user.
  - **Request Body**: `{ "username": string, "password": string }`
  - **Response**: `{ "token": string }`

- **POST /logout**
  - **Description**: Log out a user.

#### 12. Dashboard Endpoints

- **GET /dashboard/instructor/{instructor_id}**

  - **Description**: Get instructor dashboard data.
  - **Response**: `{ "exams": [...], "students": [...], "attempts": [...], ... }`
  - **Accessible by**: Instructor

- **GET /dashboard/student/{student_id}**

  - **Description**: Get student dashboard data.
  - **Response**: `{ "assigned_exams": [...], "attempts": [...], "scores": [...], ... }`
  - **Accessible by**: Student

- **GET /dashboard/admin**
  - **Description**: Get admin dashboard data.
  - **Response**: `{ "total_exams": integer, "total_students": integer, ... }`
  - **Accessible by**: Admin

---

### Additional Notes

- **Error Handling**: Use standard HTTP status codes (e.g., 200 OK, 400 Bad Request, 401 Unauthorized).
- **Pagination**: Add `limit` and `offset` parameters for list endpoints if needed.
- **Validation**: Validate all inputs to ensure data integrity.

---
