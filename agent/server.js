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
 * - pods: List pods with status details
 * - restart: Restart a pod by deleting it (controller recreates it)
 * 
 * Usage:
 *   AGENT_TOKEN=your-token node server.js
 *   
 * Or with default token:
 *   node server.js
 */

const http = require('http');
const { URL } = require('url');
const { WebSocketServer } = require('ws');
const { logger } = require('./src/utils/logger');
const { SQLExecutor } = require('./src/executors/sql');
const { RESTExecutor } = require('./src/executors/rest');
const { ScriptExecutor } = require('./src/executors/script');
const { PodsExecutor } = require('./src/executors/pods');
const { LogsExecutor } = require('./src/executors/logs');
const { PortForwardManager } = require('./src/executors/portforward');
const shell = require('./src/shell');
const { loadConfig } = require('./src/config');
const { version: VERSION } = require('./package.json');

const config = loadConfig();
const HOST = config.host;
const PORT = config.port;
const TOKEN = config.token;

// Preflight: kubectl must be available for any execution to work
let kubectlAvailable = false;
let kubectlError = null;

// Initialize executors
const sqlExecutor = new SQLExecutor();
const restExecutor = new RESTExecutor();
const scriptExecutor = new ScriptExecutor();
const podsExecutor = new PodsExecutor();
const logsExecutor = new LogsExecutor();
const portForwardManager = new PortForwardManager();

// Store active executions
const activeExecutions = new Map();

const server = http.createServer((req, res) => {
  // Enable CORS for extension
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
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
      version: VERSION,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: {
        kubectl: kubectlAvailable,
        ...(kubectlError ? { kubectlError } : {})
      }
    }));
    return;
  }

  // Execute endpoint
  if (url.pathname === '/api/v1/execute' && req.method === 'POST') {
    handleExecute(req, res);
    return;
  }

  // Streaming execute endpoint (NDJSON, script and logs types)
  if (url.pathname === '/api/v1/execute/stream' && req.method === 'POST') {
    handleExecuteStream(req, res);
    return;
  }

  // Cancel endpoint
  if (url.pathname.startsWith('/api/v1/execute/') && url.pathname.endsWith('/cancel') && req.method === 'POST') {
    handleCancel(req, res);
    return;
  }

  // Port-forward endpoints
  if (url.pathname === '/api/v1/portforward' && req.method === 'GET') {
    handlePortForwardList(req, res);
    return;
  }
  if (url.pathname === '/api/v1/portforward' && req.method === 'POST') {
    handlePortForwardStart(req, res);
    return;
  }
  if (url.pathname.startsWith('/api/v1/portforward/') && req.method === 'DELETE') {
    handlePortForwardStop(req, res);
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

        case 'restart':
          result = await podsExecutor.restart(data);
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

    if (!data.id || !data.type || !data.context) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Stream requires: id, type, context' }));
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

    let stream;
    try {
      if (data.type === 'script') {
        if (!data.script) {
          throw new Error('Missing script configuration');
        }
        stream = scriptExecutor.executeStream(data, send);
      } else if (data.type === 'logs') {
        stream = logsExecutor.executeStream(data, send);
      } else {
        throw new Error(`Streaming not supported for type: ${data.type}`);
      }
    } catch (err) {
      send({ type: 'error', message: err.message });
      res.end();
      return;
    }

    const { promise, kill } = stream;

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

function checkToken(req, res) {
  if (req.headers['x-agent-token'] !== TOKEN) {
    logger.warn('Invalid token attempt');
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid token' }));
    return false;
  }
  return true;
}

function handlePortForwardList(req, res) {
  if (!checkToken(req, res)) return;

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ forwards: portForwardManager.list() }));
}

function handlePortForwardStart(req, res) {
  if (!checkToken(req, res)) return;

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      const entry = portForwardManager.start(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, forward: entry }));
    } catch (err) {
      logger.error('[PortForward] Start failed:', err.message);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: { code: 'PORT_FORWARD_FAILED', message: err.message }
      }));
    }
  });
}

function handlePortForwardStop(req, res) {
  if (!checkToken(req, res)) return;

  const url = new URL(req.url, `http://${req.headers.host}`);
  const id = decodeURIComponent(url.pathname.split('/')[4] || '');

  try {
    portForwardManager.stop(id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Port-forward stopped' }));
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: err.message } }));
  }
}

// Preflight check: verify kubectl is on PATH (runs once at startup)
function checkKubectl() {
  const { spawn } = require('child_process');
  const child = spawn('kubectl', ['version', '--client', '-o', 'json']);
  let stderr = '';
  child.stderr.on('data', (d) => stderr += d.toString());
  child.on('close', (code) => {
    kubectlAvailable = code === 0;
    if (!kubectlAvailable) {
      kubectlError = stderr.trim() || `kubectl exited with code ${code}`;
      logger.error(`[Preflight] kubectl check failed: ${kubectlError}`);
    } else {
      logger.info('[Preflight] kubectl is available');
    }
  });
  child.on('error', () => {
    kubectlAvailable = false;
    kubectlError = 'kubectl not found on PATH';
    logger.error('[Preflight] kubectl not found on PATH — executions will fail until it is installed');
  });
}

server.listen(PORT, HOST, () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║  Release Tracker Agent v${VERSION}                          ║
╠════════════════════════════════════════════════════════╣
║  URL:    http://${HOST}:${PORT}                        ║
║  Token:  (run \`rt-agent token\` to view)              ║
╚════════════════════════════════════════════════════════╝
  `);
  logger.info('Agent started and ready for connections');
  logger.info('Supported execution types: sql, rest, script, pods, restart, portforward');
  checkKubectl();
});

// WebSocket endpoint for interactive shell sessions
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname !== '/ws/shell') {
    socket.destroy();
    return;
  }

  // Auth via query param token
  if (url.searchParams.get('token') !== TOKEN) {
    logger.warn('Invalid token attempt (websocket)');
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    const params = {
      kubeContext: url.searchParams.get('kubeContext') || undefined,
      namespace: url.searchParams.get('namespace'),
      pod: url.searchParams.get('pod'),
      container: url.searchParams.get('container') || undefined,
      shell: url.searchParams.get('shell') || 'bash',
      cols: parseInt(url.searchParams.get('cols') || '80', 10) || 80,
      rows: parseInt(url.searchParams.get('rows') || '24', 10) || 24
    };
    shell.handleConnection(ws, params);
  });
});

// Track open connections so shutdown can destroy them — server.close()
// alone waits indefinitely for keep-alive HTTP connections and WebSockets
const openSockets = new Set();
server.on('connection', (socket) => {
  openSockets.add(socket);
  socket.on('close', () => openSockets.delete(socket));
});

// Graceful shutdown: first signal tries a clean exit, second forces it
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) {
    logger.info(`${signal} received again, forcing exit`);
    process.exit(0);
  }
  shuttingDown = true;

  logger.info(`${signal} received, shutting down`);

  // Kill any running port-forward proxies
  portForwardManager.stopAll();

  // Close WebSocket server (terminates shell sessions, whose socket 'close'
  // handlers kill their kubectl children)
  wss.close();

  // Destroy all open connections so server.close() can complete
  for (const socket of openSockets) {
    socket.destroy();
  }

  server.close(() => {
    process.exit(0);
  });

  // Belt and braces: exit even if something still lingers
  setTimeout(() => process.exit(0), 1000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
