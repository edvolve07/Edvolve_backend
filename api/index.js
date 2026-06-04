import app from '../src/server.js';
import { connectDatabase } from '../src/db.js';
import mongoose from 'mongoose';

let connected = false;

export default async function handler(req, res) {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (!connected) {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    await connectDatabase();
    if (mongoose.connection.readyState === 0) {
      mongoose.set('strictQuery', true);
      await mongoose.connect(mongoUri);
    }
    connected = true;
  }

  app(req, res);
}
