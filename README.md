<p align="center">
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js"/>
  <img src="https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express"/>
  <img src="https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white" alt="MongoDB"/>
  <img src="https://img.shields.io/badge/Mongoose-880000?style=for-the-badge&logo=mongoose&logoColor=white" alt="Mongoose"/>
  <img src="https://img.shields.io/badge/JWT-000000?style=for-the-badge&logo=jsonwebtokens&logoColor=white" alt="JWT"/>
  <img src="https://img.shields.io/badge/Groq-FF6600?style=for-the-badge&logo=groq&logoColor=white" alt="Groq"/>
  <img src="https://img.shields.io/badge/OpenAI-412991?style=for-the-badge&logo=openai&logoColor=white" alt="OpenAI"/>
</p>

<h1 align="center">🎯 PrepUp Backend</h1>
<p align="center">
  <strong>Node.js + Express backend powering the PrepUp AI-driven placement readiness platform</strong>
  <br/>
  Mock interviews · Aptitude assessments · AI evaluations · Reports & analytics
</p>

---

## 📋 Table of Contents

- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [API Reference](#-api-reference)
  - [Interview System](#interview-system)
  - [Authentication](#authentication)
  - [Student Routes](#student-routes)
  - [Admin Routes](#admin-routes)
  - [Master Admin Routes](#master-admin-routes)
- [Database Schemas](#-database-schemas)
  - [Native Collections](#native-collections)
  - [Mongoose Models](#mongoose-models)
- [AI Services](#-ai-services)
- [Project Structure](#-project-structure)
- [Security](#-security)
- [Scripts](#-scripts)

---

## 🏗️ Architecture

```
                  ┌──────────────────────┐
                  │     Frontend (Vite)   │
                  │   React + Tailwind    │
                  └──────────┬───────────┘
                             │  HTTP / WebSocket
                             ▼
                  ┌──────────────────────┐
                  │   Express Server      │
                  │   (port 8000)        │
                  ├──────────────────────┤
                  │   Middleware Stack    │
                  │  · Helmet (security) │
                  │  · CORS              │
                  │  · Morgan (logging)  │
                  │  · Multer (uploads)  │
                  │  · JWT/UUID auth     │
                  ├──────────────────────┤
                  │   Route Modules      │
                  │  /api/auth/*         │
                  │  /api/student/*      │
                  │  /api/admin/*        │
                  │  /api/master/*       │
                  │  /api/* (interview)  │
                  ├──────────────────────┤
                  │   Services Layer     │
                  │  · AiService (Groq)  │
                  │  · Transcriber       │
                  │  · MediaService      │
                  │  · ResumeParser      │
                  │  · PDFReports        │
                  │  · EmailService      │
                  │  · ScoringService    │
                  └──────────┬───────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                              ▼
   ┌────────────────────┐       ┌────────────────────┐
   │  MongoDB (Native)   │       │  MongoDB (Mongoose) │
   │  sessions, reports  │       │  users, assessments │
   │  users (legacy)     │       │  questions, answers │
   │  ai_usage           │       │  attempts           │
   └────────────────────┘       └────────────────────┘
```

The backend uses **two MongoDB connection strategies**:
- **Native `mongodb` driver** for the interview system sessions, reports, user auth, and AI usage tracking
- **Mongoose ODM** for the aptitude assessment sub-system with full schema validation and relationships

---

## 🛠️ Tech Stack

| Category | Technology |
|---|---|
| **Runtime** | Node.js 20+ (ESM) |
| **Framework** | Express 4 |
| **Databases** | MongoDB 6+ (Native Driver + Mongoose 8) |
| **Authentication** | JWT (jsonwebtoken) + UUID v4 tokens |
| **AI / LLMs** | Groq SDK (LLaMA, Mixtral, Whisper) + OpenAI SDK (NVIDIA NIM) |
| **File Processing** | Multer, pdf-parse, mammoth (DOCX), pdfkit (PDF generation), ffmpeg + ffprobe |
| **Security** | Helmet, bcryptjs, CORS |
| **Email** | Raw SMTP (net/tls — no nodemailer) |
| **Utilities** | xlsx (CSV/Excel bulk import) |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** >= 20
- **MongoDB** >= 6.0 (local or Atlas)
- **ffmpeg** + **ffprobe** installed and on PATH (for audio/video processing)
- A **Groq API key** (for interview AI + transcription)
- (Optional) NVIDIA NIM API key for AI-powered question generation

### Installation

```bash
# 1. Clone the repository
git clone <repo-url>
cd backend

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your configuration

# 4. Start development server
npm run dev
```

The server starts at **http://localhost:8000** by default.

---

## 🔐 Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| **`MONGO_URI`** | ✅ | `mongodb://127.0.0.1:27017/prepup` | MongoDB connection string (Native Driver) |
| **`MONGODB_URI`** | ✅ | same as above | MongoDB connection string (Mongoose) |
| **`PORT`** | ❌ | `8000` | Server port |
| **`NODE_ENV`** | ❌ | `development` | Environment mode |
| **`JWT_SECRET`** | ✅ | — | Secret key for JWT signing |
| **`JWT_EXPIRES_IN`** | ❌ | `7d` | JWT expiration duration |
| **`CLIENT_URL`** | ✅ | — | Frontend URL for CORS |
| **`ADMIN_EMAILS`** | ❌ | — | Comma/space-separated emails auto-assigned `admin` role |
| **`MASTER_ADMIN_EMAILS`** | ❌ | — | Comma/space-separated emails auto-assigned `master_admin` role |
| **`GROQ_API_KEY`** | ✅* | — | Groq API key (interviews, transcription, evaluations) |
| **`NVIDIA_NIM_API_KEY`** | ❌ | — | NVIDIA NIM key (aptitude AI generation) |
| **`NVIDIA_NIM_BASE_URL`** | ❌ | `https://integrate.api.nvidia.com/v1` | NVIDIA NIM API base |
| **`NVIDIA_NIM_MODEL`** | ❌ | `minimaxai/minimax-m2.7` | NVIDIA NIM model |
| **`AI_PROVIDER`** | ❌ | `nvidia` | AI provider: `nvidia`, `openai`, or `generic` |
| **`AI_DEFAULT_GENERATION_MODE`** | ❌ | `fast` | Generation mode: `fast` (algorithmic) or `ai` |
| **`AI_BATCH_SIZE`** | ❌ | `5` | Questions per batch in AI mode |
| **`AI_BATCH_CONCURRENCY`** | ❌ | `2` | Concurrent AI batches |
| **`AI_TIMEOUT_MS`** | ❌ | `120000` | AI request timeout |
| **`SMTP_HOST`** | ✅* | — | SMTP server for password reset emails |
| **`SMTP_USER`** | ✅* | — | SMTP login |
| **`SMTP_PASS`** | ✅* | — | SMTP password |
| **`SMTP_FROM`** | ❌ | — | Sender address |
| **`PASSWORD_RESET_BASE_URL`** | ❌ | — | Base URL for reset links |

> \* Required only if the corresponding feature is used.

---

## 📡 API Reference

### Interview System

Routes defined in `src/server.js`.

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/` | — | Health check |
| `GET` | `/api/health` | — | Detailed health status (MongoDB, STT) |
| `POST` | `/api/signup` | — | Register new user (UUID token auth) |
| `POST` | `/api/login` | — | Login (UUID token auth) |
| `GET` | `/api/me` | Bearer | Current user profile |
| `POST` | `/api/start` | Bearer | Upload resume PDF, start interview, get ATS + first question |
| `POST` | `/api/answer_text` | Bearer | Submit text answer → evaluation + next question |
| `POST` | `/api/answer_video` | Bearer | Submit video answer → transcription + body language → evaluation |
| `POST` | `/api/answer_video_with_audio` | Bearer | Submit separate video + audio tracks |
| `POST` | `/api/end` | Bearer | Finalize interview → generate full report |
| `GET` | `/api/reports` | Bearer | List all reports (admin: all, student: own) |
| `GET` | `/api/report/:session_id` | Bearer | Get full report |
| `GET` | `/api/report/:session_id/pdf` | Bearer | Download performance PDF |
| `GET` | `/api/report/:session_id/ats` | Bearer | Download ATS summary PDF |
| `GET` | `/api/aptitude/questions` | — | Random aptitude questions (answers excluded) |
| `POST` | `/api/aptitude/submit` | — | Submit aptitude answers → score |

### Authentication

Routes defined in `src/aptitude/routes/authRoutes.js`.

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/signup` | — | Register (bcrypt) → JWT + auto role assignment |
| `POST` | `/api/auth/login` | — | Login (bcrypt, legacy scrypt fallback) → JWT |
| `POST` | `/api/auth/forgot-password` | — | Send password reset email (5-min TTL) |
| `POST` | `/api/auth/reset-password` | — | Reset password with token |
| `GET` | `/api/auth/me` | JWT | Current user profile |

### Student Routes

All require `requireAuth` + `requireRole('student')`. Defined in `src/aptitude/routes/studentRoutes.js`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/student/dashboard` | Stats: available/submitted assessments, pass rate, topic analytics, interview history |
| `GET` | `/api/student/assessments` | List published assessments |
| `POST` | `/api/student/assessments/:id/start` | Start or resume an attempt |
| `GET` | `/api/student/attempts/:attemptId/time` | Get remaining time (with sync for admin extensions) |
| `PUT` | `/api/student/attempts/:attemptId/answers` | Save/update a single answer |
| `POST` | `/api/student/attempts/:attemptId/submit` | Submit attempt → triggers scoring |
| `GET` | `/api/student/results` | List all results |
| `GET` | `/api/student/results/:attemptId` | Detailed result with per-question breakdown |

### Admin Routes

All require `requireAuth` + `requireRole('admin')`. Defined in `src/aptitude/routes/adminRoutes.js`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/dashboard` | Aggregate stats: assessments, students, submissions, pass rate, interviews |
| `GET` | `/api/admin/analytics/aptitude` | Per-student aptitude analytics |
| `GET` | `/api/admin/analytics/interviews` | Interview report analytics |
| `POST` | `/api/admin/assessments/generate` | AI-generate or algorithm-generate questions + create assessment |
| `GET` | `/api/admin/assessments` | List all assessments |
| `POST` | `/api/admin/assessments` | Create blank assessment |
| `GET` | `/api/admin/assessments/:id` | Get assessment + questions |
| `PATCH` | `/api/admin/assessments/:id` | Update assessment fields |
| `DELETE` | `/api/admin/assessments/:id` | Soft-delete assessment |
| `PATCH` | `/api/admin/assessments/:id/status` | Publish/unpublish |
| `PATCH` | `/api/admin/assessments/:id/extend-duration` | Add time to assessment duration |
| `PUT` | `/api/admin/assessments/:id/questions` | Bulk replace questions |
| `GET` | `/api/admin/assessments/:id/results` | All student results for an assessment |
| `PATCH` | `/api/admin/attempts/:attemptId/extend` | Add extra time to a student's in-progress attempt |

### Master Admin Routes

All require `requireAuth` + `requireRole('master_admin')`. Defined in `src/aptitude/routes/masterAdminRoutes.js`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/master/dashboard` | User counts, recent users, AI usage summary |
| `GET` | `/api/master/users` | List/search users (paginated) |
| `POST` | `/api/master/users` | Create a single user |
| `POST` | `/api/master/users/import` | Bulk import via CSV/Excel |
| `PATCH` | `/api/master/users/:id/role` | Change user role |
| `GET` | `/api/master/api-keys` | List AI provider configs (masked) |
| `PATCH` | `/api/master/api-keys/:providerId` | Update API key (persists to .env + runtime) |

---

## 🗄️ Database Schemas

### Native Collections (`src/db.js`)

**`sessions`** — Interview sessions
```js
{
  session_id: String (uuid, unique),
  student_id: String,
  student_name: String,
  student_email: String,
  student_role: String,
  domain: String,
  role: String,
  resume_text: String,
  ats_analysis: { ats_score: Number, skills_found: [String], improvements: [String] },
  history: [{ question_number, question, answer, evaluation, video_metrics?, timestamp }],
  current_question: String,
  question_count: Number,
  status: 'active' | 'completed' | 'ended',
  created_at: Date
}
```

**`reports`** — Interview reports
```js
{
  session_id: String (unique),
  student_id: String, student_name, student_email,
  interview_domain, interview_role, report_id,
  generated_date: String,
  overall: { total_score, max_score, percentage, grade, grade_label, metrics },
  ats_analysis: { ats_score, skills_found, improvements },
  question_breakdown: [{ number, question, answer, evaluation }],
  strengths: [String], areas_to_improve: [String], interview_tips: [String],
  created_at: Date
}
```

**`ai_usage`** — AI request tracking
```js
{
  provider: String, model: String, feature: String,
  status: 'success' | 'error', prompt_tokens, completion_tokens, total_tokens: Number,
  metadata: {}, created_at: Date
}
```

### Mongoose Models (`src/aptitude/models/`)

**`User`** — Platform users
```js
{
  name: String, email: String (unique),
  password_hash: String (select: false), password_salt: String (select: false),
  password_reset_token_hash: String (select: false), password_reset_expires_at: Date,
  role: 'student' | 'admin' | 'master_admin'
}
// Method: toSafeJSON() – strips sensitive fields
```

**`Assessment`** — MCQ tests
```js
{
  title, description, concept: String (one of 20 topics),
  difficulty: 'Easy' | 'Medium' | 'Hard' | 'Mixed',
  duration_minutes: Number, total_marks: Number, passing_marks: Number,
  start_time: Date, end_time: Date,
  status: 'draft' | 'published', is_deleted: Boolean,
  created_by: ObjectId ref 'User'
}
// Virtual: total_questions
```

**`Question`** — Individual MCQ questions
```js
{
  assessment_id: ObjectId ref 'Assessment',
  question_text: String, option_a/b/c/d: String,
  correct_option: 'A' | 'B' | 'C' | 'D',
  explanation: String, shortcut: String,
  concept: String, difficulty: String,
  marks: Number, negative_marks: Number
}
```

**`AssessmentAttempt`** — Student attempt on an assessment
```js
{
  assessment_id: ObjectId ref 'Assessment',
  student_id: ObjectId ref 'User',
  started_at: Date, submitted_at: Date,
  extra_time_minutes: Number (default: 0),
  score: Number, percentage: Number,
  status: 'in_progress' | 'submitted'
}
```

**`StudentAnswer`** — Per-question answer within an attempt
```js
{
  attempt_id: ObjectId ref 'AssessmentAttempt',
  question_id: ObjectId ref 'Question',
  selected_option: 'A' | 'B' | 'C' | 'D' | null,
  is_correct: Boolean, marks_awarded: Number
}
// Compound unique index: { attempt_id, question_id }
```

---

## 🤖 AI Services

### Interview AI (`src/services/aiService.js`)
- **Provider:** Groq (via `groq-sdk`)
- **Models (fallback chain):**
  1. `llama-3.1-8b-instant`
  2. `llama-3.3-70b-versatile`
  3. `mixtral-8x7b-32768`
- **Capabilities:**
  - Resume ATS analysis (score, skills found, improvements)
  - Dynamic interview questions (first + context-aware follow-ups)
  - 5-dimension answer evaluation: confidence, body language, knowledge, fluency, skill relevance
  - Overall report generation (strengths, weaknesses, tips)

### Speech-to-Text (`src/services/transcriber.js`)
- **Provider:** Groq Whisper API
- **Model:** `whisper-large-v3-turbo`
- **Features:** English transcription with technical interview context prompt

### Aptitude Question Generation (`src/aptitude/services/aiService.js`)
- **Dual mode:**
  - **`fast` mode (default):** Algorithmic generation using 20 pre-defined concept templates (Percentages, Profit/Loss, Time & Work, etc.) — no API calls, instant results
  - **`ai` mode:** Configurable AI provider via OpenAI-compatible SDK (NVIDIA NIM by default, or OpenAI/generic)
- **Batching:** Configurable batch size (5) and concurrency (2), with per-question fallback on batch failure
- **Supported file context:** PDF, DOCX, TXT uploads as reference material for question generation

### AI Usage Tracking (`src/services/aiUsageService.js`)
- Every AI call is recorded to the `ai_usage` collection
- Tracked fields: provider, model, feature (interview, transcription, question_generation, evaluation), token counts, status
- 30-day aggregation available via master admin dashboard

---

## 📁 Project Structure

```
backend/
├── src/
│   ├── server.js                 # Express entry point + interview routes
│   ├── config.js                 # Central environment configuration
│   ├── db.js                     # Native MongoDB connection
│   ├── utils/
│   │   ├── auth.js               # Password hashing (scrypt) + UUID token generation
│   │   └── httpError.js          # HttpError class + async handler wrapper
│   ├── services/
│   │   ├── aiService.js          # Groq-powered interview AI
│   │   ├── aiUsageService.js     # AI usage tracking
│   │   ├── transcriber.js        # Whisper speech-to-text
│   │   ├── mediaService.js       # ffmpeg audio/video processing
│   │   ├── resumeParser.js       # PDF text extraction
│   │   ├── emailService.js       # Raw SMTP password reset emails
│   │   └── pdfReports.js         # PDFKit report generation
│   └── aptitude/
│       ├── config/
│       │   ├── db.js             # Mongoose connection
│       │   └── mongoose.js       # CommonJS bridge
│       ├── middleware/
│       │   ├── auth.js           # JWT verification + role-based guards
│       │   └── errorHandler.js   # Global error handler
│       ├── models/
│       │   ├── User.js           # Mongoose User schema
│       │   ├── Assessment.js     # Assessment schema
│       │   ├── Question.js       # MCQ question schema
│       │   ├── AssessmentAttempt.js
│       │   └── StudentAnswer.js
│       ├── routes/
│       │   ├── authRoutes.js     # Authentication endpoints
│       │   ├── studentRoutes.js  # Student portal endpoints
│       │   ├── adminRoutes.js    # Admin management endpoints
│       │   └── masterAdminRoutes.js  # Master admin endpoints
│       ├── services/
│       │   ├── aiService.js      # AI/algorithmic question generation
│       │   ├── scoringService.js # Attempt evaluation + scoring
│       │   └── fileTextService.js # PDF/DOCX/TXT text extraction
│       └── utils/
│           ├── roles.js          # Role enum + email-based assignment
│           ├── constants.js      # 20 concepts, difficulties, statuses
│           ├── httpError.js      # HTTP error factory functions
│           ├── asyncHandler.js   # Express async error wrapper
│           └── questionValidation.js  # Question validation + serialization
├── .env                          # Environment variables
└── package.json
```

---

## 🔒 Security

- **Password hashing:** bcrypt (cost 12) with legacy scrypt migration support
- **JWT tokens:** 7-day expiry, signed with configurable secret
- **Sensitive fields:** `password_hash`, `password_salt`, `password_reset_token_hash` excluded from query results by default (`select: false`)
- **API key storage:** Keys stored in `.env` file (persisted) and runtime memory; masked in API responses
- **CORS:** Configurable origin via `CLIENT_URL`
- **Helmet:** Security headers applied globally
- **Multer limits:** File uploads limited to 5-8 MB depending on endpoint
- **Input validation:** Question validation helpers ensure data integrity
- **Error handling:** Centralized error handler prevents stack traces in production

---

## 📜 Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start with file watching (`node --watch`) |
| `npm start` | Production start |
| `npm install` | Install dependencies |

---

## 📄 License

This project is licensed under the ISC License.
