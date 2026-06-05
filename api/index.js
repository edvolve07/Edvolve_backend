let nativeConnected = false;
let mongooseConnectPromise;
let serverModule;
let dbModule;
let mongooseModule;

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;

  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS,PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  res.setHeader('Access-Control-Max-Age', '86400');
}

async function loadServer() {
  if (!serverModule) {
    [serverModule, dbModule, mongooseModule] = await Promise.all([
      import('../src/server.js'),
      import('../src/db.js'),
      import('mongoose'),
    ]);
  }

  return {
    app: serverModule.default,
    connectDatabase: dbModule.connectDatabase,
    mongoose: mongooseModule.default,
  };
}

async function connectMongoose(mongoose) {
  if (mongoose.connection.readyState === 1) return;

  if (!mongooseConnectPromise) {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) {
      const error = new Error('MONGODB_URI or MONGO_URI is required');
      error.statusCode = 503;
      throw error;
    }

    mongoose.set('strictQuery', true);
    mongooseConnectPromise = mongoose.connect(mongoUri).catch((error) => {
      mongooseConnectPromise = null;
      throw error;
    });
  }

  await mongooseConnectPromise;
}

async function connectNativeDatabase(connectDatabase) {
  if (nativeConnected) return;

  await connectDatabase();
  nativeConnected = true;
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    const { app, connectDatabase, mongoose } = await loadServer();
    const path = req.url || '';
    const needsNativeDatabase = !path.startsWith('/api/auth/');

    await connectMongoose(mongoose);

    if (needsNativeDatabase) {
      await connectNativeDatabase(connectDatabase);
    }

    app(req, res);
  } catch (error) {
    console.error('[vercel-handler-error]', error);
    const status = error.status || error.statusCode || 500;
    const message = status === 500 ? 'Internal server error' : error.message || 'Service unavailable';

    res.status(status).json({
      detail: message,
      message,
      details: Array.isArray(error.details) ? error.details : [],
    });
  }
}
