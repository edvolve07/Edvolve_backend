import dotenv from "dotenv";
import crypto from "node:crypto";

dotenv.config();

const rootPort = process.env.PORT;

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'replace_with_a_long_random_secret' || process.env.JWT_SECRET.length < 32) {
  const generated = crypto.randomBytes(64).toString('hex');
  console.error(`[SECURITY] JWT_SECRET is weak or missing. Generated temporary secret: ${generated}`);
  console.error('[SECURITY] Set JWT_SECRET in your .env file to a long random string (min 32 chars).');
  process.env.JWT_SECRET = generated;
}

if (!process.env.DATABASE_URL) {
  console.error('[SECURITY] DATABASE_URL is not configured. The application will not start without a database connection.');
}



if (!process.env.JUDGE0_BASE_URL && process.env.CODE_RUNNER_PROVIDER !== 'local') {
  console.error('[SECURITY] JUDGE0_BASE_URL is not configured. Set CODE_RUNNER_PROVIDER=local only in development.');
}


if (!process.env.ADMIN_EMAILS) {
  console.warn('[SECURITY] ADMIN_EMAILS is not set. No admin accounts can be created via signup.');
}

const clientUrls = (process.env.CLIENT_URL || '').split(',').map(s => s.trim()).filter(Boolean);


export const ALLOWED_ORIGINS = [
  'https://app.edvols.in',
  ...clientUrls,
  'http://localhost:5173',
  'http://localhost:4173',
].filter(Boolean);





export const config = {
  databaseUrl: process.env.DATABASE_URL,
  groqApiKeys: String(process.env.GROQ_API_KEY || '').split(',').map(s => s.trim()).filter(Boolean),
  nvidiaApiKey: process.env.NVIDIA_NIM_API_KEY,
  nvidiaBaseUrl: process.env.NVIDIA_NIM_BASE_URL || 'https://integrate.api.nvidia.com/v1',
  nvidiaModel: process.env.NVIDIA_NIM_MODEL || 'nvidia/llama-3.1-nemotron-70b-instruct',
  port: Number(rootPort || 8000),
  maxQuestions: Number(process.env.MAX_QUESTIONS || 10),
  maxResumeSize: 5 * 1024 * 1024,
  maxVideoSize: 100 * 1024 * 1024,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  isProduction: process.env.NODE_ENV === 'production',
  codeRunnerProvider: process.env.CODE_RUNNER_PROVIDER || 'judge0',

  adminEmails: new Set(String(process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)),
  masterAdminEmails: new Set(String(process.env.MASTER_ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)),
  livekitUrl: process.env.LIVEKIT_URL || 'ws://localhost:7880',
  livekitApiKey: process.env.LIVEKIT_API_KEY || 'devkey',
  livekitApiSecret: process.env.LIVEKIT_API_SECRET || 'devsecret',
};




