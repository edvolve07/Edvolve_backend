import {
  getSequelize,
  connectDatabase as pgConnect,
  closeDatabase as pgClose,
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

export async function closeDatabase() {
  await pgClose();
}
