import dotenv from "dotenv";

dotenv.config();

const rootPort = process.env.PORT;

if (!process.env.MONGO_URI && process.env.MONGODB_URI) {
  process.env.MONGO_URI = process.env.MONGODB_URI;
}

if (!process.env.MONGODB_URI && process.env.MONGO_URI) {
  process.env.MONGODB_URI = process.env.MONGO_URI;
}

const required = ["MONGO_URI", "GROQ_API_KEY"];
const missing = required.filter((key) => !process.env[key]);

if (missing.length) {
  throw new Error(`${missing.join(", ")} missing`);
}

export const config = {
  mongoUri: process.env.MONGO_URI,
  groqApiKey: process.env.GROQ_API_KEY,
  databaseName: process.env.DATABASE_NAME || "VithAI",
  port: Number(rootPort || 8000),
  maxQuestions: Number(process.env.MAX_QUESTIONS || 10),
  maxResumeSize: 5 * 1024 * 1024,
  maxVideoSize: 100 * 1024 * 1024
};
