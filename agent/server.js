/**
 * Release Tracker - Local Execution Agent
 * 
 * A HTTP server that accepts execution requests from the browser extension
 * and runs commands via kubectl exec into Kubernetes pods.
 * 
 * Supported execution types:
 * - sql: Execute SQL queries via database client pods
 * - rest: Execute REST API calls via curl in pods
 * - script: Execute custom scripts in pods
 * 
 * Usage:
 *   AGENT_TOKEN=your-token node server.js
 *   
 * Or with default token:
 *   node server.js
 */

const http = require('http');
const { URL } = require('url');
const { logger } = require('./src/utils/logger');
const { SQLExecutor } = require('./src/executors/sql');
const { RESTExecutor } = require('./src/executors/rest');
const { ScriptExecutor } = require('./src/executors/script');
const { PodsExecutor } = require('./src/executors/pods');

const HOST = process.env.AGENT_HOST || '127.0.0.1';
const PORT = process.env.AGENT_PORT || 3456;
const TOKEN = process.env.AGENT_TOKEN || 'poc-token-123';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// Initialize executors
const sqlExecutor = new SQLExecutor();
const restExecutor = new RESTExecutor();
const scriptExecutor = new ScriptExecutor();
const podsExecutor = new PodsExecutor();

// Store active executions
const activeExecutions = new Map();

const server = http.createServer((req, res) => {
  // Enable CORS for extension
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Agent-Token');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Parse URL
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Health check endpoint (no auth required)
  if (url.pathname === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      version: '1.1.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    }));
    return;
  }

  // Execute endpoint
  if (url.pathname === '/api/v1/execute' && req.method === 'POST') {
    handleExecute(req, res);
    return;
  }

  // Streaming execute endpoint (NDJSON, script type only)
  if (url.pathname === '/api/v1/execute/stream' && req.method === 'POST') {
    handleExecuteStream(req, res);
    return;
  }

  // Cancel endpoint
  if (url.pathname.startsWith('/api/v1/execute/') && url.pathname.endsWith('/cancel') && req.method === 'POST') {
    handleCancel(req, res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

async function handleExecute(req, res) {
  // Check token
  const authHeader = req.headers['x-agent-token'];
  if (authHeader !== TOKEN) {
    logger.warn('Invalid token attempt');
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid token' }));
    return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const data = JSON.parse(body);
      logger.info(`[Execute] Received: type=${data.type}, id=${data.id}`);

      // Validate request
      if (!data.id || !data.type || !data.context) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required fields: id, type, context' }));
        return;
      }

      // Route to appropriate executor
      let result;
      switch (data.type) {
        case 'sql':
          if (!data.sql) {
            throw new Error('Missing sql configuration');
          }
          result = await sqlExecutor.execute(data);
          break;

        case 'rest':
          if (!data.rest) {
            throw new Error('Missing rest configuration');
          }
          result = await restExecutor.execute(data);
          break;

        case 'script':
          if (!data.script) {
            throw new Error('Missing script configuration');
          }
          result = await scriptExecutor.execute(data);
          break;

        case 'pods':
          result = await podsExecutor.execute(data);
          break;

        default:
          throw new Error(`Unknown execution type: ${data.type}`);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));

    } catch (err) {
      logger.error('[Execute] Failed:', err.message);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: {
          code: 'EXECUTION_FAILED',
          message: err.message
        }
      }));
    }
  });
}

async function handleExecuteStream(req, res) {
  // Check token
  const authHeader = req.headers['x-agent-token'];
  if (authHeader !== TOKEN) {
    logger.warn('Invalid token attempt');
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid token' }));
    return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    logger.info(`[Execute] Stream received: type=${data.type}, id=${data.id}`);

    if (!data.id || data.type !== 'script' || !data.context || !data.script) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Stream requires: id, type=script, context, script' }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no'
    });

    const send = (obj) => {
      try {
        res.write(JSON.stringify(obj) + '\n');
      } catch {
        // Client already gone
      }
    };

    const { promise, kill } = scriptExecutor.executeStream(data, send);

    // If the client disconnects mid-stream, kill the kubectl child
    res.on('close', () => {
      if (!res.writableEnded) {
        logger.info(`[Execute] Stream client disconnected, killing execution: id=${data.id}`);
        kill();
      }
    });

    try {
      const result = await promise;
      send({ type: 'done', result });
    } catch (err) {
      send({ type: 'error', message: err.message });
    }
    res.end();
  });
}

function handleCancel(req, res) {
  const authHeader = req.headers['x-agent-token'];
  if (authHeader !== TOKEN) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid token' }));
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const executionId = url.pathname.split('/')[4];

  if (activeExecutions.has(executionId)) {
    const child = activeExecutions.get(executionId);
    child.kill('SIGTERM');
    activeExecutions.delete(executionId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Execution cancelled' }));
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Execution not found or already completed' }));
  }
}

server.listen(PORT, HOST, () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║  Release Tracker Agent v1.1.0                          ║
╠════════════════════════════════════════════════════════╣
║  URL:    http://${HOST}:${PORT}                        ║
║  Token:  ${TOKEN}                    ║
╚════════════════════════════════════════════════════════╝
  `);
  logger.info('Agent started and ready for connections');
  logger.info('Supported execution types: sql, rest, script, pods');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down');
  server.close(() => {
    process.exit(0);
  });
});
