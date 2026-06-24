import { Sequelize } from 'sequelize';
import net from 'node:net';
import { config } from '../config.js';

let sequelize;

export function getSequelize() {
  if (!sequelize) {
    const dbUrl = config.databaseUrl || process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('DATABASE_URL is required for PostgreSQL connection');
    }

    const isNeon = dbUrl.includes('neon.tech');

    sequelize = new Sequelize(dbUrl, {
      dialect: 'postgres',
      logging: false,
      dialectOptions: isNeon ? {
        ssl: {
          require: true,
          rejectUnauthorized: false,
        },
        stream: () => {
          const s = new net.Socket();
          const orig = s.connect.bind(s);
          s.connect = (port, host, cb) => orig({ port, host, family: 4 }, cb);
          return s;
        },
      } : undefined,
      pool: {
        max: 5,
        min: 0,
        acquire: 60000,
        idle: 30000,
      },
      define: {
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    });
  }
  return sequelize;
}

export async function connectDatabase() {
  const sq = getSequelize();
  try {
    await sq.authenticate();
    console.log('PostgreSQL connected');
  } catch (error) {
    console.error('PostgreSQL connection failed:', error.message);
    throw error;
  }
}

export async function closeDatabase() {
  if (sequelize) {
    await sequelize.close();
    sequelize = null;
  }
}

export async function syncDatabase(options = { alter: false }) {
  const sq = getSequelize();
  try {
    await sq.sync(options);
  } catch (error) {
    if (error?.parent?.code === '42P07') {
      console.warn('Some indexes already exist (non-fatal)');
    } else {
      throw error;
    }
  }
}
