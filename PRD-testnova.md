## Testnova

### 1. Overview

The Online Exam System is a web-based platform designed to streamline the process of creating, assigning, and taking exams in an educational setting. It supports three main user roles: instructors, students, and admins. Instructors can create exams, assign them to groups of students, and share access links. Students can take the exams online, and the system will automatically analyze the results and present them on a dashboard for review. The platform aims to simplify exam management and provide actionable insights into student performance.

---

### 2. User Roles

The system includes three distinct user roles, each with specific permissions and responsibilities:

- **Instructors**:

  - Create and manage exams.
  - Organize students into groups and assign exams to these groups.
  - Share exam links with students.
  - View exam results and analytics on a dashboard.

- **Students**:

  - Access and take exams assigned to them via shared links.
  - Submit their answers online.
  - View their own results (if permitted by the instructor).

- **Admins**:
  - Manage user accounts for instructors and students.
  - Oversee the system and access high-level performance statistics.

---

### 3. Functional Requirements

The system’s core functionalities are broken down into key areas:

#### 3.1 User Management

- **Admins**:
  - Create, edit, and delete instructor and student accounts.
  - Assign roles to users (instructor or student).
- **Instructors**:
  - Create, edit, and delete student accounts.
  - Create student groups and assign individual students to these groups.

#### 3.2 Exam Creation

- Instructors can create exams with the following details:
  - **Exam Name**: A unique title for the exam.
  - **Description**: Optional field for additional context or instructions.
  - **Start Date and Time**: When the exam becomes available.
  - **End Date and Time**: When the exam is no longer accessible.
  - **Duration**: Time limit (in minutes) for students to complete the exam once started.
  - **Questions**:
    - **Multiple-Choice**:
      - Question text.
      - 2–5 answer options.
      - Designation of the correct option.
    - **True/False**:
      - Question text.
      - Correct answer (true or false).
    - **Short Answer**:
      - Question text.
      - Correct answer (for auto-grading via exact match).
    - **Essay**:
      - Question text (requires manual grading).
    - **Score**: Point value assigned to each question.
  - **Settings**:
    - Option to randomize question order.
    - Option to randomize option order for multiple-choice questions.
    - Option to allow students to revisit previous questions.
    - Option to display feedback (e.g., correct answers) after submission.

#### 3.3 Exam Assignment

- Instructors can:
  - Assign an exam to one or more student groups.
  - Generate and share a unique link for each exam, which directs students to the exam after logging in.

#### 3.4 Taking the Exam

- **Student Workflow**:
  - Log in to the platform using their credentials.
  - View a list of assigned exams available within the specified start and end times.
  - Start an exam by clicking its link.
  - Answer questions within the allotted duration:
    - Select options for multiple-choice and true/false questions.
    - Enter text for short answer and essay questions.
  - Navigate between questions (if allowed by settings).
  - Submit the exam manually or automatically when time expires.

#### 3.5 Grading

- **Automatic Grading**:
  - Multiple-choice and true/false questions graded based on predefined correct answers.
  - Short answer questions graded automatically if the student’s response exactly matches the specified correct answer.
- **Manual Grading**:
  - Essay questions graded by instructors via the platform.
- **Scoring**:
  - Total score calculated by summing points from all questions.

#### 3.6 Results and Dashboard

- **For Students**:
  - View their individual scores and feedback (e.g., correct answers) after submission, if enabled by the instructor.
- **For Instructors**:
  - Access a dashboard displaying:
    - List of students who took the exam, their scores, and completion times.
    - Per-question performance (e.g., percentage of students who answered correctly).
    - Overall exam statistics (e.g., average score, highest score, lowest score).
    - Option to export results as a CSV file.
- **For Admins**:
  - Access a system-wide dashboard showing:
    - Total number of exams created.
    - Total number of students registered.
    - High-level usage statistics (e.g., exams completed).

---

### 4. Non-Functional Requirements

- **Platform**: Web-based, accessible via standard browsers (e.g., Chrome, Firefox).
- **Authentication**: Secure login system with usernames and passwords for all users.
- **Authorization**: Role-based access control to restrict functionalities by user type.
- **Usability**: Responsive design for desktops and tablets.
- **Reliability**: Basic data backup to prevent loss of exam data.
- **Scalability**: Capable of supporting multiple concurrent users (e.g., a small classroom setting).

---

### 5. Future Enhancements (Out of Scope for Initial Version)

- **Question Banks**: Allow instructors to save and reuse questions across exams.
- **Advanced Analytics**: Detailed reports with charts (e.g., score distribution).
- **Proctoring**: Features to monitor students during exams (e.g., webcam integration).
- **Notifications**: Email alerts for exam assignments or deadlines.
- **Integration**: Compatibility with learning management systems (e.g., Moodle).

---

### 6. Assumptions and Constraints

- **Environment**: Assumes use in a controlled educational setting (e.g., a school or university).
- **Connectivity**: Requires stable internet access for all users.
- **User Skills**: Assumes basic computer literacy for instructors, students, and admins.
- **Scope Limitation**: Initial version supports a limited number of concurrent exams and users (suitable for a graduation project).

---
