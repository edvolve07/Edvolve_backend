import app from '../src/server.js';
import { connectDatabase } from '../src/db.js';
import mongoose from 'mongoose';

let connected = false;

export default async function handler(req, res) {
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
