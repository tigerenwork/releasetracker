/**
 * Release Tracker - Local Execution Agent (POC)
 * 
 * A minimal HTTP server that accepts execution requests from the browser extension
 * and runs commands locally (kubectl, bash, etc.)
 * 
 * Usage:
 *   AGENT_TOKEN=your-token node server.js
 *   
 * Or with default token:
 *   node server.js
 */

const http = require('http');
const { spawn } = require('child_process');
const crypto = require('crypto');

const PORT = process.env.AGENT_PORT || 3456;
const TOKEN = process.env.AGENT_TOKEN || 'poc-token-123';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// Store active executions
const activeExecutions = new Map();

function log(level, ...args) {
  const levels = { error: 0, warn: 1, info: 2, debug: 3 };
  if (levels[level] <= levels[LOG_LEVEL]) {
    console.log(`[AGENT:${level.toUpperCase()}]`, ...args);
  }
}

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
  
  // Health check endpoint
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'healthy', 
      version: 'poc-1.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    }));
    return;
  }
  
  // Execute endpoint
  if (req.url === '/execute' && req.method === 'POST') {
    handleExecute(req, res);
    return;
  }
  
  // Cancel endpoint
  if (req.url.startsWith('/execute/') && req.url.endsWith('/cancel') && req.method === 'POST') {
    handleCancel(req, res);
    return;
  }
  
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

function handleExecute(req, res) {
  // Check token
  const authHeader = req.headers['x-agent-token'];
  if (authHeader !== TOKEN) {
    log('warn', 'Invalid token attempt:', authHeader);
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid token' }));
    return;
  }
  
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      log('info', 'Received execution request:', data.id || 'no-id');
      
      // Generate execution ID if not provided
      const executionId = data.id || crypto.randomUUID();
      
      // For POC: just echo back the command
      // In real implementation, this would execute kubectl/bash/docker
      const result = executeCommand(executionId, data);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      log('error', 'Failed to process request:', err.message);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

function executeCommand(id, data) {
  const { type, command, context } = data;
  
  log('info', `Executing [${type}]: ${command}`);
  
  // POC: Return mock result
  // In real implementation, spawn kubectl/bash/etc.
  
  const startTime = Date.now();
  
  // Simulate some processing
  const stdout = `Executed: ${command}\nType: ${type}\nContext: ${JSON.stringify(context || {})}`;
  
  return {
    success: true,
    executionId: id,
    message: `Command executed successfully`,
    stdout: stdout,
    stderr: '',
    exitCode: 0,
    duration: Date.now() - startTime,
    timestamp: new Date().toISOString()
  };
}

function handleCancel(req, res) {
  const authHeader = req.headers['x-agent-token'];
  if (authHeader !== TOKEN) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid token' }));
    return;
  }
  
  const executionId = req.url.split('/')[2];
  
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

server.listen(PORT, '127.0.0.1', () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║  Release Tracker Agent (POC)                           ║
╠════════════════════════════════════════════════════════╣
║  URL:    http://127.0.0.1:${PORT}                        ║
║  Token:  ${TOKEN}                    ║
╚════════════════════════════════════════════════════════╝
  `);
  log('info', 'Agent started and ready for connections');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  log('info', 'SIGTERM received, shutting down gracefully');
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  log('info', 'SIGINT received, shutting down');
  server.close(() => {
    process.exit(0);
  });
});
