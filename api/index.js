let serverModule;
let dbModule;

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;

  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS,PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-CSRF-Token');
  res.setHeader('Access-Control-Max-Age', '86400');
}

async function loadServer() {
  if (!serverModule) {
    [serverModule, dbModule] = await Promise.all([
      import('../src/server.js'),
      import('../src/db.js'),
    ]);
  }

  return {
    app: serverModule.default,
    connectDatabase: dbModule.connectDatabase,
  };
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    const { app, connectDatabase } = await loadServer();
    await connectDatabase();
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
