For your graduation project, an Online Exam System Platform, I’ll provide both the Entity-Relationship Diagram (ERD) and the API documentation based on the Product Requirements Document (PRD). Since I can’t generate visual diagrams, I’ll describe the ERD in detail with entities, attributes, and relationships. For the API documentation, I’ll outline the key endpoints, methods, and expected request/response formats.

---

## Entity-Relationship Diagram (ERD)

The ERD represents the data model for the Online Exam System, detailing how data is structured and related. Below is a textual representation of the ERD, including entities, attributes, and relationships.

### Entities and Attributes

1. **User**

   - **user_id** (Primary Key, integer)
   - **username** (string)
   - **password** (string)
   - **role** (enum: 'instructor', 'student', 'admin')

2. **Instructor**

   - **instructor_id** (Primary Key, integer, Foreign Key to User.user_id)

3. **Student**

   - **student_id** (Primary Key, integer, Foreign Key to User.user_id)

4. **Admin**

   - **admin_id** (Primary Key, integer, Foreign Key to User.user_id)

5. **Exam**

   - **exam_id** (Primary Key, integer)
   - **exam_name** (string)
   - **description** (text, optional)
   - **start_date** (datetime)
   - **end_date** (datetime)
   - **duration** (integer, in minutes)
   - **instructor_id** (Foreign Key to Instructor.instructor_id)

6. **Question**

   - **question_id** (Primary Key, integer)
   - **exam_id** (Foreign Key to Exam.exam_id)
   - **question_type** (enum: 'multiple-choice', 'true/false', 'short-answer', 'essay')
   - **question_text** (text)
   - **score** (integer)

7. **Option** (for multiple-choice and true/false questions)

   - **option_id** (Primary Key, integer)
   - **question_id** (Foreign Key to Question.question_id)
   - **option_text** (string)
   - **is_correct** (boolean)

8. **StudentGroup**

   - **group_id** (Primary Key, integer)
   - **group_name** (string)
   - **instructor_id** (Foreign Key to Instructor.instructor_id)

9. **StudentGroupMembership** (junction table for Student and StudentGroup)

   - **membership_id** (Primary Key, integer)
   - **student_id** (Foreign Key to Student.student_id)
   - **group_id** (Foreign Key to StudentGroup.group_id)

10. **ExamAssignment** (junction table for Exam and StudentGroup)

    - **assignment_id** (Primary Key, integer)
    - **exam_id** (Foreign Key to Exam.exam_id)
    - **group_id** (Foreign Key to StudentGroup.group_id)

11. **ExamAttempt**

    - **attempt_id** (Primary Key, integer)
    - **student_id** (Foreign Key to Student.student_id)
    - **exam_id** (Foreign Key to Exam.exam_id)
    - **start_time** (datetime)
    - **end_time** (datetime)
    - **score** (integer)

12. **Answer**
    - **answer_id** (Primary Key, integer)
    - **attempt_id** (Foreign Key to ExamAttempt.attempt_id)
    - **question_id** (Foreign Key to Question.question_id)
    - **answer_text** (text)
    - **is_correct** (boolean, for auto-graded questions)

### Relationships

- **Instructor creates Exam**
  - One-to-many: One instructor can create multiple exams.
- **Exam has Question**
  - One-to-many: One exam can contain multiple questions.
- **Question has Option**
  - One-to-many: One question can have multiple options (for multiple-choice or true/false types).
- **Instructor creates StudentGroup**
  - One-to-many: One instructor can create multiple student groups.
- **Student is a member of StudentGroup**
  - Many-to-many: Students can belong to multiple groups, and groups can have multiple students (via **StudentGroupMembership**).
- **Exam is assigned to StudentGroup**
  - Many-to-many: Exams can be assigned to multiple groups, and groups can have multiple exams (via **ExamAssignment**).
- **Student attempts Exam**
  - Many-to-many: Students can attempt multiple exams, and exams can be attempted by multiple students (via **ExamAttempt**).
- **ExamAttempt has Answer**
  - One-to-many: One exam attempt can have answers to multiple questions.

### ERD Description

Imagine the ERD as a set of boxes (entities) connected by lines (relationships):

- **User** is the parent entity, splitting into **Instructor**, **Student**, and **Admin** (one-to-one relationships).
- **Instructor** connects to **Exam** and **StudentGroup** with one-to-many lines.
- **Exam** links to **Question** (one-to-many), and **Question** links to **Option** (one-to-many).
- **StudentGroup** connects to **Student** through **StudentGroupMembership** (many-to-many).
- **Exam** connects to **StudentGroup** through **ExamAssignment** (many-to-many).
- **Student** connects to **Exam** through **ExamAttempt** (many-to-many), and **ExamAttempt** links to **Answer** (one-to-many).

This structure supports creating exams, assigning them to groups, and tracking student attempts and answers.

---
