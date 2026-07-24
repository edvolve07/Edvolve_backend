import {
  getSequelize,
  connectDatabase as pgConnect,
  closeDatabase as pgClose,
  syncDatabase as pgSync,
  InterviewSession,
  InterviewReport,
  AiUsage,
  AptitudeQuestion,
  AptitudeResult,
  Admin,
  Student,
} from './database/index.js';
import { config } from "./config.js";

export async function connectDatabase() {
  if (config.databaseUrl) {
    await pgConnect();
    console.log("Database connected (PostgreSQL)");
  } else {
    if (config.isProduction) {
      console.error('[FATAL] DATABASE_URL is not configured. Cannot start without a database.');
      process.exit(1);
    }
    console.warn("DATABASE_URL not configured");
  }
}

export function collections() {
  return {
    sessions: InterviewSession,
    reports: InterviewReport,
    users: null,
    admins: Admin,
    students: Student,
    aptitudeQuestions: AptitudeQuestion,
    aptitudeResults: AptitudeResult,
    aiUsage: AiUsage,
  };
}

export async function syncDatabase(options = { alter: false }) {
  await pgSync(options);
}

export async function closeDatabase() {
  await pgClose();
}
