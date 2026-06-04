let connected = false;
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

export default async function handler(req, res) {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    const { app, connectDatabase, mongoose } = await loadServer();

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
  } catch (error) {
    console.error('[vercel-handler-error]', error);
    res.status(500).json({
      detail: 'Internal server error',
      message: 'Internal server error',
      details: [],
    });
  }
}
