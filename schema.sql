--
-- PostgreSQL database dump
--

-- Dumped from database version 14.17 (Homebrew)
-- Dumped by pg_dump version 14.17 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: exam_status; Type: TYPE; Schema: public; Owner: fathysameh
--

CREATE TYPE public.exam_status AS ENUM (
    'draft',
    'published',
    'in_progress',
    'completed',
    'archived'
);


ALTER TYPE public.exam_status OWNER TO fathysameh;

--
-- Name: question_type; Type: TYPE; Schema: public; Owner: fathysameh
--

CREATE TYPE public.question_type AS ENUM (
    'multiple-choice',
    'true/false'
);


ALTER TYPE public.question_type OWNER TO fathysameh;

--
-- Name: user_role; Type: TYPE; Schema: public; Owner: fathysameh
--

CREATE TYPE public.user_role AS ENUM (
    'instructor',
    'admin'
);


ALTER TYPE public.user_role OWNER TO fathysameh;

--
-- Name: generate_student_exam(integer, character varying, character varying); Type: FUNCTION; Schema: public; Owner: fathysameh
--

CREATE FUNCTION public.generate_student_exam(p_exam_id integer, p_uni_id character varying, p_student_name character varying) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_student_exam_id INTEGER;
  v_spec RECORD;
  v_question_count INTEGER := 1;
BEGIN
  -- Create a new student exam record
  INSERT INTO student_exams (exam_id, uni_id, student_name, status)
  VALUES (p_exam_id, p_uni_id, p_student_name, 'not_started')
  RETURNING student_exam_id INTO v_student_exam_id;

  -- Process each specification
  FOR v_spec IN
    SELECT * FROM exam_specifications WHERE exam_id = p_exam_id
  LOOP
    -- Insert selected questions
    WITH eligible_questions AS (
      SELECT q.question_id
      FROM questions q
      WHERE q.question_bank_id = v_spec.question_bank_id
    )
    INSERT INTO student_exam_questions (student_exam_id, question_id, question_order)
    SELECT
      v_student_exam_id,
      question_id,
      v_question_count + row_number() OVER (ORDER BY random()) - 1
    FROM eligible_questions
    ORDER BY random()
    LIMIT v_spec.num_questions;

    v_question_count := v_question_count + v_spec.num_questions;
  END LOOP;

  RETURN v_student_exam_id;
END;
$$;


ALTER FUNCTION public.generate_student_exam(p_exam_id integer, p_uni_id character varying, p_student_name character varying) OWNER TO fathysameh;

--
-- Name: grade_student_exam(integer); Type: FUNCTION; Schema: public; Owner: fathysameh
--

CREATE FUNCTION public.grade_student_exam(p_student_exam_id integer) RETURNS numeric
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_total_score NUMERIC(5,2) := 0;
  v_total_possible NUMERIC(5,2) := 0;
  v_question RECORD;
BEGIN
  FOR v_question IN
    SELECT seq.student_question_id, seq.student_answer, q.question_id, q.points, q.question_type
    FROM student_exam_questions seq
    JOIN questions q ON seq.question_id = q.question_id
    WHERE seq.student_exam_id = p_student_exam_id
  LOOP
    IF v_question.question_type IN ('multiple-choice', 'true/false') THEN
      UPDATE student_exam_questions
      SET is_correct = (
        SELECT CASE
          WHEN qo.is_correct AND qo.option_id::text = v_question.student_answer THEN TRUE
          ELSE FALSE
        END
        FROM question_options qo
        WHERE qo.question_id = v_question.question_id
        AND qo.option_id::text = v_question.student_answer
      )
      WHERE student_question_id = v_question.student_question_id;
    END IF;

    v_total_possible := v_total_possible + v_question.points;

    IF EXISTS (
      SELECT 1 FROM student_exam_questions
      WHERE student_question_id = v_question.student_question_id AND is_correct = TRUE
    ) THEN
      v_total_score := v_total_score + v_question.points;
    END IF;
  END LOOP;

  IF v_total_possible > 0 THEN
    UPDATE student_exams
    SET score = (v_total_score / v_total_possible) * 100,
        status = 'completed',
        end_time = CURRENT_TIMESTAMP
    WHERE student_exam_id = p_student_exam_id;

    RETURN (v_total_score / v_total_possible) * 100;
  END IF;

  RETURN 0;
END;
$$;


ALTER FUNCTION public.grade_student_exam(p_student_exam_id integer) OWNER TO fathysameh;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: allowed_students; Type: TABLE; Schema: public; Owner: fathysameh
--

CREATE TABLE public.allowed_students (
    allowed_id integer NOT NULL,
    exam_id integer,
    student_id character varying(255) NOT NULL,
    student_name character varying(255) NOT NULL,
    student_email character varying(255) NOT NULL
);


ALTER TABLE public.allowed_students OWNER TO fathysameh;

--
-- Name: allowed_students_allowed_id_seq; Type: SEQUENCE; Schema: public; Owner: fathysameh
--

ALTER TABLE public.allowed_students ALTER COLUMN allowed_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.allowed_students_allowed_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: course_assignments; Type: TABLE; Schema: public; Owner: fathysameh
--

CREATE TABLE public.course_assignments (
    assignment_id integer NOT NULL,
    course_id integer,
    instructor_id integer,
    assigned_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    end_date timestamp without time zone,
    is_active boolean DEFAULT true,
    assigned_by integer
);


ALTER TABLE public.course_assignments OWNER TO fathysameh;

--
-- Name: course_assignments_assignment_id_seq; Type: SEQUENCE; Schema: public; Owner: fathysameh
--

ALTER TABLE public.course_assignments ALTER COLUMN assignment_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.course_assignments_assignment_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: course_chapters; Type: TABLE; Schema: public; Owner: fathysameh
--

CREATE TABLE public.course_chapters (
    chapter_id integer NOT NULL,
    course_id integer,
    chapter_number integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_chapter_number CHECK (((chapter_number > 0) AND (chapter_number <= 20)))
);


ALTER TABLE public.course_chapters OWNER TO fathysameh;

--
-- Name: course_chapters_chapter_id_seq; Type: SEQUENCE; Schema: public; Owner: fathysameh
--

CREATE SEQUENCE public.course_chapters_chapter_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.course_chapters_chapter_id_seq OWNER TO fathysameh;

--
-- Name: course_chapters_chapter_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: fathysameh
--

ALTER SEQUENCE public.course_chapters_chapter_id_seq OWNED BY public.course_chapters.chapter_id;


--
-- Name: courses; Type: TABLE; Schema: public; Owner: fathysameh
--

CREATE TABLE public.courses (
    course_id integer NOT NULL,
    course_name character varying(255) NOT NULL,
    course_code character varying(50) NOT NULL,
    description text,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_by integer
);


ALTER TABLE public.courses OWNER TO fathysameh;

--
-- Name: courses_course_id_seq; Type: SEQUENCE; Schema: public; Owner: fathysameh
--

ALTER TABLE public.courses ALTER COLUMN course_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.courses_course_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: exam_chapter_distribution; Type: TABLE; Schema: public; Owner: fathysameh
--

CREATE TABLE public.exam_chapter_distribution (
    distribution_id integer NOT NULL,
    exam_id integer,
    chapter character varying(50) NOT NULL,
    question_count integer NOT NULL,
    CONSTRAINT exam_chapter_distribution_question_count_check CHECK ((question_count > 0))
);


ALTER TABLE public.exam_chapter_distribution OWNER TO fathysameh;

--
-- Name: exam_chapter_distribution_distribution_id_seq; Type: SEQUENCE; Schema: public; Owner: fathysameh
--

CREATE SEQUENCE public.exam_chapter_distribution_distribution_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.exam_chapter_distribution_distribution_id_seq OWNER TO fathysameh;

--
-- Name: exam_chapter_distribution_distribution_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: fathysameh
--

ALTER SEQUENCE public.exam_chapter_distribution_distribution_id_seq OWNED BY public.exam_chapter_distribution.distribution_id;


--
-- Name: exam_difficulty_distribution; Type: TABLE; Schema: public; Owner: fathysameh
--

CREATE TABLE public.exam_difficulty_distribution (
    exam_id integer NOT NULL,
    easy_percentage integer NOT NULL,
    medium_percentage integer NOT NULL,
    hard_percentage integer NOT NULL,
    CONSTRAINT exam_difficulty_distribution_easy_percentage_check CHECK (((easy_percentage >= 0) AND (easy_percentage <= 100))),
    CONSTRAINT exam_difficulty_distribution_hard_percentage_check CHECK (((hard_percentage >= 0) AND (hard_percentage <= 100))),
    CONSTRAINT exam_difficulty_distribution_medium_percentage_check CHECK (((medium_percentage >= 0) AND (medium_percentage <= 100))),
    CONSTRAINT total_hundred CHECK ((((easy_percentage + medium_percentage) + hard_percentage) = 100))
);


ALTER TABLE public.exam_difficulty_distribution OWNER TO fathysameh;

--
-- Name: exam_specifications; Type: TABLE; Schema: public; Owner: fathysameh
--

CREATE TABLE public.exam_specifications (
    spec_id integer NOT NULL,
    exam_id integer,
    question_bank_id integer,
    num_questions integer NOT NULL,
    points_per_question integer,
    chapter character varying(255),
    CONSTRAINT check_num_questions CHECK ((num_questions > 0))
);


ALTER TABLE public.exam_specifications OWNER TO fathysameh;

--
-- Name: exam_specifications_spec_id_seq; Type: SEQUENCE; Schema: public; Owner: fathysameh
--

ALTER TABLE public.exam_specifications ALTER COLUMN spec_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.exam_specifications_spec_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: exams; Type: TABLE; Schema: public; Owner: fathysameh
--

CREATE TABLE public.exams (
    exam_id integer NOT NULL,
    exam_name character varying(255) NOT NULL,
    description text,
    time_limit_minutes integer NOT NULL,
    start_date timestamp without time zone NOT NULL,
    end_date timestamp without time zone NOT NULL,
    course_id integer,
    created_by integer,
    exam_link_id character varying(16),
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    status public.exam_status DEFAULT 'draft'::public.exam_status,
    published_at timestamp without time zone,
    archived_at timestamp without time zone,
    is_randomized boolean DEFAULT true,
    exam_metadata jsonb,
    CONSTRAINT check_access_code_format CHECK ((((length((exam_link_id)::text) >= 6) AND (length((exam_link_id)::text) <= 10)) AND ((exam_link_id)::text ~ '[A-Z0-9]+'::text)))
);


ALTER TABLE public.exams OWNER TO fathysameh;

--
-- Name: exams_exam_id_seq; Type: SEQUENCE; Schema: public; Owner: fathysameh
--

ALTER TABLE public.exams ALTER COLUMN exam_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.exams_exam_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: past_instructors; Type: TABLE; Schema: public; Owner: fathysameh
--

CREATE TABLE public.past_instructors (
    id integer NOT NULL,
    user_id integer NOT NULL,
    username character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    first_name character varying(255) NOT NULL,
    last_name character varying(255) NOT NULL,
    department character varying(255),
    deleted_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp without time zone,
    deleted_by integer
);


ALTER TABLE public.past_instructors OWNER TO fathysameh;

--
-- Name: past_instructors_id_seq; Type: SEQUENCE; Schema: public; Owner: fathysameh
--

CREATE SEQUENCE public.past_instructors_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.past_instructors_id_seq OWNER TO fathysameh;

--
-- Name: past_instructors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: fathysameh
--

ALTER SEQUENCE public.past_instructors_id_seq OWNED BY public.past_instructors.id;


--
-- Name: question_bank_questions; Type: TABLE; Schema: public; Owner: fathysameh
--

CREATE TABLE public.question_bank_questions (
    id integer NOT NULL,
    question_bank_id integer,
    question_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.question_bank_questions OWNER TO fathysameh;

--
-- Name: question_bank_questions_id_seq; Type: SEQUENCE; Schema: public; Owner: fathysameh
--

CREATE SEQUENCE public.question_bank_questions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.question_bank_questions_id_seq OWNER TO fathysameh;

--
-- Name: question_bank_questions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: fathysameh
--

ALTER SEQUENCE public.question_bank_questions_id_seq OWNED BY public.question_bank_questions.id;


--
-- Name: question_banks; Type: TABLE; Schema: public; Owner: fathysameh
--

CREATE TABLE public.question_banks (
    question_bank_id integer NOT NULL,
    bank_name character varying(255) NOT NULL,
    description text,
    course_id integer,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_by integer,
    original_creator integer,
    current_owner integer
);


ALTER TABLE public.question_banks OWNER TO fathysameh;

--
-- Name: question_banks_question_bank_id_seq; Type: SEQUENCE; Schema: public; Owner: fathysameh
--

ALTER TABLE public.question_banks ALTER COLUMN question_bank_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.question_banks_question_bank_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: question_options; Type: TABLE; Schema: public; Owner: fathysameh
--

CREATE TABLE public.question_options (
    option_id integer NOT NULL,
    question_id integer,
    option_text character varying(255) NOT NULL,
    is_correct boolean NOT NULL
);


ALTER TABLE public.question_options OWNER TO fathysameh;

--
-- Name: question_options_option_id_seq; Type: SEQUENCE; Schema: public; Owner: fathysameh
--

ALTER TABLE public.question_options ALTER COLUMN option_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.question_options_option_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: question_tag_mapping; Type: TABLE; Schema: public; Owner: fathysameh
--

CREATE TABLE public.question_tag_mapping (
    question_id integer NOT NULL,
    tag_id integer NOT NULL
);


ALTER TABLE public.question_tag_mapping OWNER TO fathysameh;

--
-- Name: question_tags; Type: TABLE; Schema: public; Owner: fathysameh
--

CREATE TABLE public.question_tags (
    tag_id integer NOT NULL,
    tag_name character varying(100) NOT NULL
);


ALTER TABLE public.question_tags OWNER TO fathysameh;

--
-- Name: question_tags_tag_id_seq; Type: SEQUENCE; Schema: public; Owner: fathysameh
--

ALTER TABLE public.question_tags ALTER COLUMN tag_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.question_tags_tag_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: questions; Type: TABLE; Schema: public; Owner: fathysameh
--

CREATE TABLE public.questions (
    question_id integer NOT NULL,
    question_text text NOT NULL,
    question_type public.question_type NOT NULL,
    points integer NOT NULL,
    image_url text,
    chapter character varying(50),
    question_bank_id integer,
    created_by integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    original_creator integer,
    current_owner integer,
    difficulty character varying(20) DEFAULT 'medium'::character varying
);


ALTER TABLE public.questions OWNER TO fathysameh;

--
-- Name: questions_question_id_seq; Type: SEQUENCE; Schema: public; Owner: fathysameh
--

ALTER TABLE public.questions ALTER COLUMN question_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.questions_question_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: student_exam_questions; Type: TABLE; Schema: public; Owner: fathysameh
--

CREATE TABLE public.student_exam_questions (
    student_question_id integer NOT NULL,
    student_exam_id integer,
    question_id integer,
    question_order integer NOT NULL,
    student_answer text,
    is_correct boolean
);


ALTER TABLE public.student_exam_questions OWNER TO fathysameh;

--
-- Name: student_exam_questions_student_question_id_seq; Type: SEQUENCE; Schema: public; Owner: fathysameh
--

ALTER TABLE public.student_exam_questions ALTER COLUMN student_question_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.student_exam_questions_student_question_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: student_exams; Type: TABLE; Schema: public; Owner: fathysameh
--

CREATE TABLE public.student_exams (
    student_exam_id integer NOT NULL,
    exam_id integer,
    student_id character varying(255) NOT NULL,
    student_name character varying(255) NOT NULL,
    start_time timestamp without time zone,
    end_time timestamp without time zone,
    score numeric(5,2),
    status character varying(20) DEFAULT 'not_started'::character varying,
    attempt_count integer DEFAULT 1,
    last_activity timestamp without time zone,
    ip_address character varying(45),
    browser_info text,
    CONSTRAINT check_attempt_count CHECK (((attempt_count > 0) AND (attempt_count <= 3)))
);


ALTER TABLE public.student_exams OWNER TO fathysameh;

--
-- Name: student_exams_student_exam_id_seq; Type: SEQUENCE; Schema: public; Owner: fathysameh
--

ALTER TABLE public.student_exams ALTER COLUMN student_exam_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.student_exams_student_exam_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: fathysameh
--

CREATE TABLE public.users (
    user_id integer NOT NULL,
    username character varying(255) NOT NULL,
    password character varying(255) NOT NULL,
    role public.user_role NOT NULL,
    is_approved boolean DEFAULT false,
    email character varying(255) NOT NULL,
    first_name character varying(255) NOT NULL,
    last_name character varying(255) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_active boolean DEFAULT true,
    department character varying(255)
);


ALTER TABLE public.users OWNER TO fathysameh;

--
-- Name: users_user_id_seq; Type: SEQUENCE; Schema: public; Owner: fathysameh
--

ALTER TABLE public.users ALTER COLUMN user_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.users_user_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: course_chapters chapter_id; Type: DEFAULT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.course_chapters ALTER COLUMN chapter_id SET DEFAULT nextval('public.course_chapters_chapter_id_seq'::regclass);


--
-- Name: exam_chapter_distribution distribution_id; Type: DEFAULT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.exam_chapter_distribution ALTER COLUMN distribution_id SET DEFAULT nextval('public.exam_chapter_distribution_distribution_id_seq'::regclass);


--
-- Name: past_instructors id; Type: DEFAULT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.past_instructors ALTER COLUMN id SET DEFAULT nextval('public.past_instructors_id_seq'::regclass);


--
-- Name: question_bank_questions id; Type: DEFAULT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.question_bank_questions ALTER COLUMN id SET DEFAULT nextval('public.question_bank_questions_id_seq'::regclass);


--
-- Name: allowed_students allowed_students_exam_id_uni_id_key; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.allowed_students
    ADD CONSTRAINT allowed_students_exam_id_uni_id_key UNIQUE (exam_id, student_id);


--
-- Name: allowed_students allowed_students_pkey; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.allowed_students
    ADD CONSTRAINT allowed_students_pkey PRIMARY KEY (allowed_id);


--
-- Name: course_assignments course_assignments_course_id_instructor_id_is_active_key; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.course_assignments
    ADD CONSTRAINT course_assignments_course_id_instructor_id_is_active_key UNIQUE (course_id, instructor_id, is_active);


--
-- Name: course_assignments course_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.course_assignments
    ADD CONSTRAINT course_assignments_pkey PRIMARY KEY (assignment_id);


--
-- Name: course_chapters course_chapters_course_id_chapter_number_key; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.course_chapters
    ADD CONSTRAINT course_chapters_course_id_chapter_number_key UNIQUE (course_id, chapter_number);


--
-- Name: course_chapters course_chapters_pkey; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.course_chapters
    ADD CONSTRAINT course_chapters_pkey PRIMARY KEY (chapter_id);


--
-- Name: courses courses_course_code_key; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_course_code_key UNIQUE (course_code);


--
-- Name: courses courses_pkey; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_pkey PRIMARY KEY (course_id);


--
-- Name: exam_chapter_distribution exam_chapter_distribution_pkey; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.exam_chapter_distribution
    ADD CONSTRAINT exam_chapter_distribution_pkey PRIMARY KEY (distribution_id);


--
-- Name: exam_difficulty_distribution exam_difficulty_distribution_pkey; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.exam_difficulty_distribution
    ADD CONSTRAINT exam_difficulty_distribution_pkey PRIMARY KEY (exam_id);


--
-- Name: exam_specifications exam_specifications_pkey; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.exam_specifications
    ADD CONSTRAINT exam_specifications_pkey PRIMARY KEY (spec_id);


--
-- Name: exams exams_access_code_key; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.exams
    ADD CONSTRAINT exams_access_code_key UNIQUE (exam_link_id);


--
-- Name: exams exams_pkey; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.exams
    ADD CONSTRAINT exams_pkey PRIMARY KEY (exam_id);


--
-- Name: past_instructors past_instructors_pkey; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.past_instructors
    ADD CONSTRAINT past_instructors_pkey PRIMARY KEY (id);


--
-- Name: past_instructors past_instructors_user_id_key; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.past_instructors
    ADD CONSTRAINT past_instructors_user_id_key UNIQUE (user_id);


--
-- Name: question_bank_questions question_bank_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.question_bank_questions
    ADD CONSTRAINT question_bank_questions_pkey PRIMARY KEY (id);


--
-- Name: question_bank_questions question_bank_questions_question_bank_id_question_id_key; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.question_bank_questions
    ADD CONSTRAINT question_bank_questions_question_bank_id_question_id_key UNIQUE (question_bank_id, question_id);


--
-- Name: question_banks question_banks_pkey; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.question_banks
    ADD CONSTRAINT question_banks_pkey PRIMARY KEY (question_bank_id);


--
-- Name: question_options question_options_pkey; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.question_options
    ADD CONSTRAINT question_options_pkey PRIMARY KEY (option_id);


--
-- Name: question_tag_mapping question_tag_mapping_pkey; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.question_tag_mapping
    ADD CONSTRAINT question_tag_mapping_pkey PRIMARY KEY (question_id, tag_id);


--
-- Name: question_tags question_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.question_tags
    ADD CONSTRAINT question_tags_pkey PRIMARY KEY (tag_id);


--
-- Name: question_tags question_tags_tag_name_key; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.question_tags
    ADD CONSTRAINT question_tags_tag_name_key UNIQUE (tag_name);


--
-- Name: questions questions_pkey; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_pkey PRIMARY KEY (question_id);


--
-- Name: student_exam_questions student_exam_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.student_exam_questions
    ADD CONSTRAINT student_exam_questions_pkey PRIMARY KEY (student_question_id);


--
-- Name: student_exam_questions student_exam_questions_student_exam_id_question_order_key; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.student_exam_questions
    ADD CONSTRAINT student_exam_questions_student_exam_id_question_order_key UNIQUE (student_exam_id, question_order);


--
-- Name: student_exams student_exams_exam_id_uni_id_key; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.student_exams
    ADD CONSTRAINT student_exams_exam_id_uni_id_key UNIQUE (exam_id, student_id);


--
-- Name: student_exams student_exams_pkey; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.student_exams
    ADD CONSTRAINT student_exams_pkey PRIMARY KEY (student_exam_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: idx_exams_access_code; Type: INDEX; Schema: public; Owner: fathysameh
--

CREATE INDEX idx_exams_access_code ON public.exams USING btree (exam_link_id);


--
-- Name: idx_student_exams_exam_id; Type: INDEX; Schema: public; Owner: fathysameh
--

CREATE INDEX idx_student_exams_exam_id ON public.student_exams USING btree (exam_id);


--
-- Name: idx_student_exams_status; Type: INDEX; Schema: public; Owner: fathysameh
--

CREATE INDEX idx_student_exams_status ON public.student_exams USING btree (status);


--
-- Name: idx_student_exams_uni_id; Type: INDEX; Schema: public; Owner: fathysameh
--

CREATE INDEX idx_student_exams_uni_id ON public.student_exams USING btree (student_id);


--
-- Name: allowed_students allowed_students_exam_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.allowed_students
    ADD CONSTRAINT allowed_students_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.exams(exam_id) ON DELETE CASCADE;


--
-- Name: course_assignments course_assignments_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.course_assignments
    ADD CONSTRAINT course_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(user_id);


--
-- Name: course_assignments course_assignments_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.course_assignments
    ADD CONSTRAINT course_assignments_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(course_id) ON DELETE CASCADE;


--
-- Name: course_assignments course_assignments_instructor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.course_assignments
    ADD CONSTRAINT course_assignments_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: course_chapters course_chapters_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.course_chapters
    ADD CONSTRAINT course_chapters_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(course_id) ON DELETE CASCADE;


--
-- Name: exam_chapter_distribution exam_chapter_distribution_exam_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.exam_chapter_distribution
    ADD CONSTRAINT exam_chapter_distribution_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.exams(exam_id) ON DELETE CASCADE;


--
-- Name: exam_difficulty_distribution exam_difficulty_distribution_exam_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.exam_difficulty_distribution
    ADD CONSTRAINT exam_difficulty_distribution_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.exams(exam_id) ON DELETE CASCADE;


--
-- Name: exam_specifications exam_specifications_exam_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.exam_specifications
    ADD CONSTRAINT exam_specifications_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.exams(exam_id) ON DELETE CASCADE;


--
-- Name: exam_specifications exam_specifications_question_bank_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.exam_specifications
    ADD CONSTRAINT exam_specifications_question_bank_id_fkey FOREIGN KEY (question_bank_id) REFERENCES public.question_banks(question_bank_id);


--
-- Name: exams exams_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.exams
    ADD CONSTRAINT exams_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(course_id) ON DELETE CASCADE;


--
-- Name: exams exams_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.exams
    ADD CONSTRAINT exams_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: past_instructors past_instructors_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.past_instructors
    ADD CONSTRAINT past_instructors_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(user_id);


--
-- Name: question_bank_questions question_bank_questions_question_bank_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.question_bank_questions
    ADD CONSTRAINT question_bank_questions_question_bank_id_fkey FOREIGN KEY (question_bank_id) REFERENCES public.question_banks(question_bank_id) ON DELETE CASCADE;


--
-- Name: question_bank_questions question_bank_questions_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.question_bank_questions
    ADD CONSTRAINT question_bank_questions_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(question_id) ON DELETE CASCADE;


--
-- Name: question_banks question_banks_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.question_banks
    ADD CONSTRAINT question_banks_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(course_id) ON DELETE CASCADE;


--
-- Name: question_banks question_banks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.question_banks
    ADD CONSTRAINT question_banks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: question_banks question_banks_current_owner_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.question_banks
    ADD CONSTRAINT question_banks_current_owner_fkey FOREIGN KEY (current_owner) REFERENCES public.users(user_id);


--
-- Name: question_banks question_banks_original_creator_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.question_banks
    ADD CONSTRAINT question_banks_original_creator_fkey FOREIGN KEY (original_creator) REFERENCES public.users(user_id);


--
-- Name: question_options question_options_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.question_options
    ADD CONSTRAINT question_options_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(question_id) ON DELETE CASCADE;


--
-- Name: question_tag_mapping question_tag_mapping_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.question_tag_mapping
    ADD CONSTRAINT question_tag_mapping_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(question_id) ON DELETE CASCADE;


--
-- Name: question_tag_mapping question_tag_mapping_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.question_tag_mapping
    ADD CONSTRAINT question_tag_mapping_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.question_tags(tag_id) ON DELETE CASCADE;


--
-- Name: questions questions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: questions questions_current_owner_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_current_owner_fkey FOREIGN KEY (current_owner) REFERENCES public.users(user_id);


--
-- Name: questions questions_original_creator_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_original_creator_fkey FOREIGN KEY (original_creator) REFERENCES public.users(user_id);


--
-- Name: questions questions_question_bank_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_question_bank_id_fkey FOREIGN KEY (question_bank_id) REFERENCES public.question_banks(question_bank_id) ON DELETE CASCADE;


--
-- Name: student_exam_questions student_exam_questions_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.student_exam_questions
    ADD CONSTRAINT student_exam_questions_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(question_id);


--
-- Name: student_exam_questions student_exam_questions_student_exam_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.student_exam_questions
    ADD CONSTRAINT student_exam_questions_student_exam_id_fkey FOREIGN KEY (student_exam_id) REFERENCES public.student_exams(student_exam_id) ON DELETE CASCADE;


--
-- Name: student_exams student_exams_exam_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: fathysameh
--

ALTER TABLE ONLY public.student_exams
    ADD CONSTRAINT student_exams_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.exams(exam_id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

