import { MongoClient, ServerApiVersion } from "mongodb";
import { config } from "./config.js";

let client;
let db;

export async function connectDatabase() {
  if (db) {
    return db;
  }

  client = new MongoClient(config.mongoUri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true
    }
  });

  await client.connect();
  await client.db("admin").command({ ping: 1 });
  db = client.db(config.databaseName);

  await Promise.all([
    db.collection("sessions").createIndex({ session_id: 1 }, { unique: true }),
    db.collection("sessions").createIndex({ student_id: 1, created_at: -1 }),
    db.collection("reports").createIndex({ session_id: 1 }, { unique: true }),
    db.collection("reports").createIndex({ student_id: 1, created_at: -1 }),
    db.collection("users").createIndex({ email: 1 }, { unique: true }),
    db.collection("ai_usage").createIndex({ created_at: -1 }),
    db.collection("ai_usage").createIndex({ provider: 1, feature: 1, created_at: -1 })
  ]);

  console.log("MongoDB connected");
  return db;
}

export function collections() {
  if (!db) {
    throw new Error("Database has not been connected");
  }

  return {
    sessions: db.collection("sessions"),
    reports: db.collection("reports"),
    users: db.collection("users"),
    aptitudeQuestions: db.collection("aptitude_questions"),
    aptitudeResults: db.collection("aptitude_results"),
    aiUsage: db.collection("ai_usage")
  };
}

export async function closeDatabase() {
  if (client) {
    await client.close();
  }
}
