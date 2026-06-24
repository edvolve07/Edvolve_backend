import { getSequelize, connectDatabase } from '../../database/index.js';

export async function connectDb() {
  await connectDatabase();
}
