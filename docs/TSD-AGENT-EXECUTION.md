# Technical Specification Document
## Local Agent Execution System

### Version: 1.0
### Date: 2026-02-28
### Status: Draft

---

## 1. Architecture Overview

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              CLOUD (Vercel)                                      │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │  Release Tracker Web App (Next.js)                                       │  │
│  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐               │  │
│  │  │ Agent Bridge  │  │ Execution UI  │  │ Settings API  │               │  │
│  │  │ Service       │  │ Components    │  │               │               │  │
│  │  └───────┬───────┘  └───────┬───────┘  └───────────────┘               │  │
│  │          │                  │                                         │  │
│  │          └──────────────────┘                                         │  │
│  │                     │                                                 │  │
│  │                     ▼ postMessage                                     │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                    │                                             │
│                                    │ HTTPS                                       │
└────────────────────────────────────┼─────────────────────────────────────────────┘
                                     │
                                     │ Chrome Extension API
                                     │ (privileged localhost access)
                                     │
┌────────────────────────────────────┼─────────────────────────────────────────────┐
│                         USER LAPTOP │                                             │
│  ┌──────────────────────────────────┴─────────────────────────────────────────┐  │
│  │                         BROWSER (Chrome/Firefox)                           │  │
│  │  ┌─────────────────┐      ┌──────────────────┐      ┌──────────────────┐  │  │
│  │  │  Content Script │◄────►│  Background SW   │◄────►│  Popup UI        │  │  │
│  │  │  (injected.js)  │      │  (background.js) │      │  (settings)      │  │  │
│  │  └─────────────────┘      └────────┬─────────┘      └──────────────────┘  │  │
│  │                                    │                                        │  │
│  │                                    │ fetch() to localhost:3456              │  │
│  │                                    │                                        │  │
│  └────────────────────────────────────┼────────────────────────────────────────┘  │
│                                       │                                           │
│                                       │ HTTP / WebSocket                          │
│                                       │                                           │
│  ┌────────────────────────────────────┼────────────────────────────────────────┐  │
│  │  DOCKER HOST                        ▼                                        │  │
│  │  ┌──────────────────────────────────────────────────────────────────────┐   │  │
│  │  │  Local Agent Container (Node.js/Express)                             │   │  │
│  │  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐        │   │  │
│  │  │  │ HTTP API   │ │ WebSocket  │ │ Command    │ │ Stream     │        │   │  │
│  │  │  │ Server     │ │ Server     │ │ Executor   │ │ Handler    │        │   │  │
│  │  │  └────────────┘ └────────────┘ └────────────┘ └────────────┘        │   │  │
│  │  │                                                                         │   │  │
│  │  │  Mounted Volumes:                                                       │   │  │
│  │  │  • ~/.kube:/root/.kube:ro      (kubeconfig)                            │   │  │
│  │  │  • ~/.ssh:/root/.ssh:ro        (SSH keys)                              │   │  │
│  │  │  • /var/run/docker.sock        (Docker access)                         │   │  │
│  │  └──────────────────────────────────────────────────────────────────────┘   │  │
│  └─────────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Communication Flow

```
┌──────────┐    postMessage    ┌──────────────┐    chrome.runtime    ┌──────────────┐
│ Web App  │◄─────────────────►│   Content    │◄───────────────────►│  Background  │
│          │                   │   Script     │    .sendMessage()    │   Service    │
└──────────┘                   └──────────────┘                      └──────┬───────┘
                                                                            │
                                                                            │ fetch()
                                                                            │
                                                                     ┌──────▼───────┐
                                                                     │  Local Agent │
                                                                     │  :3456         │
                                                                     └──────────────┘
```

### 1.3 Why This Architecture Works

| Challenge | Solution |
|-----------|----------|
| CORS from HTTPS to HTTP | Browser extension has unrestricted localhost access |
| Token security | Stored in extension's `chrome.storage.local`, not web app |
| Cross-origin isolation | Content script bridges web app and extension contexts |
| Real-time streaming | WebSocket connection from background script to agent |
| User's kubeconfig | Mounted into Docker container, never leaves laptop |

---

## 2. Browser Extension Specification

### 2.1 Manifest V3 Configuration

```json
{
  "manifest_version": 3,
  "name": "Release Tracker Agent Bridge",
  "version": "1.0.0",
  "description": "Bridge between Release Tracker web app and local execution agent",
  "permissions": [
    "storage",
    "activeTab"
  ],
  "host_permissions": [
    "http://localhost:3456/*",
    "https://*.vercel.app/*"
  ],
  "content_scripts": [
    {
      "matches": ["https://*.vercel.app/*", "http://localhost:3000/*"],
      "js": ["injected.js", "content.js"],
      "run_at": "document_start",
      "world": "MAIN"
    }
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

### 2.2 Injected Script (injected.js)

Runs in page context, exposes `window.releaseTrackerAgent` API.

```typescript
// injected.js - Runs in MAIN world (page context)

interface ExecutionRequest {
  id: string;
  type: 'kubectl' | 'sql' | 'bash' | 'docker';
  command: string;
  context: {
    cluster?: string;
    namespace?: string;
    customerId?: number;
    stepId?: number;
  };
  timeout?: number;
}

interface ExecutionResponse {
  success: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  duration?: number;
}

(function() {
  'use strict';
  
  // Prevent double-injection
  if (window.releaseTrackerAgent) return;
  
  const pendingRequests = new Map();
  
  window.releaseTrackerAgent = {
    version: '1.0.0',
    
    isAvailable(): boolean {
      return document.querySelector('meta[name="rt-extension-installed"]') !== null;
    },
    
    async execute(request: ExecutionRequest): Promise<ExecutionResponse> {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingRequests.delete(request.id);
          reject(new Error('Request timeout'));
        }, request.timeout || 300000);
        
        const handler = (event: MessageEvent) => {
          if (event.source !== window) return;
          if (event.data?.type !== 'RT_EXECUTE_RESULT') return;
          if (event.data.requestId !== request.id) return;
          
          clearTimeout(timeout);
          window.removeEventListener('message', handler);
          pendingRequests.delete(request.id);
          
          if (event.data.success) {
            resolve(event.data.result);
          } else {
            reject(new Error(event.data.error));
          }
        };
        
        window.addEventListener('message', handler);
        pendingRequests.set(request.id, { resolve, reject, handler });
        
        window.postMessage({
          type: 'RT_EXECUTE',
          requestId: request.id,
          payload: request
        }, '*');
      });
    },
    
    async getStatus(): Promise<{ connected: boolean; version?: string }> {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({ connected: false }), 5000);
        
        const handler = (event: MessageEvent) => {
          if (event.data?.type === 'RT_STATUS_RESULT') {
            clearTimeout(timeout);
            window.removeEventListener('message', handler);
            resolve(event.data.status);
          }
        };
        
        window.addEventListener('message', handler);
        window.postMessage({ type: 'RT_GET_STATUS' }, '*');
      });
    }
  };
  
  // Signal extension presence
  const meta = document.createElement('meta');
  meta.name = 'rt-extension-installed';
  meta.content = '1.0.0';
  document.head.appendChild(meta);
})();
```

### 2.3 Content Script (content.js)

Runs in ISOLATED world, bridges page and background.

```typescript
// content.js - Runs in ISOLATED world

// Relay messages from page to background
window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  if (!event.data?.type?.startsWith('RT_')) return;
  
  switch (event.data.type) {
    case 'RT_EXECUTE': {
      try {
        const result = await chrome.runtime.sendMessage({
          action: 'execute',
          request: event.data.payload
        });
        
        window.postMessage({
          type: 'RT_EXECUTE_RESULT',
          requestId: event.data.requestId,
          success: result.success,
          result: result.data,
          error: result.error
        }, '*');
      } catch (err) {
        window.postMessage({
          type: 'RT_EXECUTE_RESULT',
          requestId: event.data.requestId,
          success: false,
          error: err.message
        }, '*');
      }
      break;
    }
    
    case 'RT_GET_STATUS': {
      const status = await chrome.runtime.sendMessage({ action: 'getStatus' });
      window.postMessage({
        type: 'RT_STATUS_RESULT',
        status
      }, '*');
      break;
    }
  }
});
```

### 2.4 Background Service Worker (background.js)

Handles HTTP communication with local agent.

```typescript
// background.js - Service Worker

const DEFAULT_AGENT_URL = 'http://localhost:3456';

// Keep-alive for long-running executions
let activeConnections = 0;

chrome.runtime.onConnect.addListener((port) => {
  activeConnections++;
  port.onDisconnect.addListener(() => activeConnections--);
});

// Message handlers
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request).then(sendResponse).catch(err => {
    sendResponse({ success: false, error: err.message });
  });
  return true; // Keep channel open for async
});

async function handleMessage(request) {
  const { agentUrl, token } = await chrome.storage.local.get([
    'agentUrl',
    'agentToken'
  ]);
  
  const baseUrl = agentUrl || DEFAULT_AGENT_URL;
  
  switch (request.action) {
    case 'execute':
      return executeCommand(baseUrl, token, request.request);
    case 'getStatus':
      return checkStatus(baseUrl, token);
    case 'testConnection':
      return testConnection(baseUrl, token);
    default:
      throw new Error(`Unknown action: ${request.action}`);
  }
}

async function executeCommand(baseUrl: string, token: string, request: any) {
  const response = await fetch(`${baseUrl}/api/v1/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Token': token
    },
    body: JSON.stringify(request)
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Agent error: ${error}`);
  }
  
  return await response.json();
}

async function checkStatus(baseUrl: string, token: string) {
  try {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { 'X-Agent-Token': token },
      signal: AbortSignal.timeout(3000)
    });
    
    if (response.ok) {
      const data = await response.json();
      return { connected: true, version: data.version };
    }
    return { connected: false };
  } catch {
    return { connected: false };
  }
}
```

### 2.5 Popup UI (popup.html / popup.js)

```typescript
// popup.js - Extension settings UI

document.addEventListener('DOMContentLoaded', async () => {
  const urlInput = document.getElementById('agentUrl');
  const tokenInput = document.getElementById('agentToken');
  const statusDiv = document.getElementById('status');
  const saveBtn = document.getElementById('save');
  const testBtn = document.getElementById('test');
  
  // Load saved settings
  const saved = await chrome.storage.local.get(['agentUrl', 'agentToken']);
  urlInput.value = saved.agentUrl || 'http://localhost:3456';
  tokenInput.value = saved.agentToken || '';
  
  // Update status indicator
  async function updateStatus() {
    const status = await chrome.runtime.sendMessage({ action: 'getStatus' });
    statusDiv.textContent = status.connected 
      ? `🟢 Connected (v${status.version})`
      : '🔴 Disconnected';
    statusDiv.className = status.connected ? 'connected' : 'disconnected';
  }
  
  await updateStatus();
  
  // Save settings
  saveBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({
      agentUrl: urlInput.value,
      agentToken: tokenInput.value
    });
    await updateStatus();
  });
  
  // Test connection
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    await updateStatus();
    testBtn.disabled = false;
  });
});
```

---

## 3. Local Agent Specification

### 3.1 Docker Compose Configuration

```yaml
# docker-compose.yml

version: '3.8'

services:
  agent:
    build:
      context: ./agent
      dockerfile: Dockerfile
    container_name: release-tracker-agent
    ports:
      - "3456:3456"
    environment:
      - AGENT_TOKEN=${AGENT_TOKEN}
      - LOG_LEVEL=info
      - MAX_CONCURRENT_EXECUTIONS=5
      - DEFAULT_TIMEOUT=300
    volumes:
      # Kubernetes configuration
      - ~/.kube:/root/.kube:ro
      # SSH keys for git operations
      - ~/.ssh:/root/.ssh:ro
      # Docker socket for docker commands
      - /var/run/docker.sock:/var/run/docker.sock
      # Execution logs persistence
      - ./data/agent-logs:/app/logs
    restart: unless-stopped
    networks:
      - agent-network

networks:
  agent-network:
    driver: bridge
```

### 3.2 Dockerfile

```dockerfile
# agent/Dockerfile

FROM node:20-alpine

# Install dependencies
RUN apk add --no-cache \
    bash \
    curl \
    openssh-client \
    git \
    # Kubernetes tools
    kubectl \
    # Database clients
    postgresql-client \
    mysql-client \
    redis \
    # Optional: MongoDB client
    mongodb-tools

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy application
COPY . .

# Create logs directory
RUN mkdir -p /app/logs

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f -H "X-Agent-Token: $AGENT_TOKEN" http://localhost:3456/health || exit 1

EXPOSE 3456

CMD ["node", "dist/server.js"]
```

### 3.3 Agent Server (Express + TypeScript)

```typescript
// agent/src/server.ts

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { config } from './config';
import { authMiddleware } from './middleware/auth';
import { executionRouter } from './routes/execution';
import { statusRouter } from './routes/status';
import { logger } from './utils/logger';
import { ExecutionManager } from './services/execution-manager';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Security middleware
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, etc.)
    if (!origin) return callback(null, true);
    // Allow Chrome extension
    if (origin.startsWith('chrome-extension://')) return callback(null, true);
    // Deny others
    callback(new Error('Not allowed by CORS'));
  }
}));

app.use(express.json({ limit: '10mb' }));

// Auth middleware for all routes except health
app.use('/api', authMiddleware);
app.use('/ws', authMiddleware);

// Routes
app.use('/health', statusRouter);
app.use('/api/v1/execute', executionRouter);

// WebSocket for streaming
wss.on('connection', (ws, req) => {
  logger.info('WebSocket connection established');
  
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      if (message.type === 'execute') {
        const executionManager = new ExecutionManager();
        await executionManager.executeStreaming(message.request, ws);
      }
    } catch (err) {
      ws.send(JSON.stringify({
        type: 'error',
        error: err.message
      }));
    }
  });
});

server.listen(config.port, () => {
  logger.info(`Agent listening on port ${config.port}`);
});
```

### 3.4 Execution Manager

```typescript
// agent/src/services/execution-manager.ts

import { spawn, ChildProcess } from 'child_process';
import { WebSocket } from 'ws';
import { logger } from '../utils/logger';
import { config } from '../config';

interface ExecutionRequest {
  id: string;
  type: 'kubectl' | 'sql' | 'bash' | 'docker';
  command: string;
  context: {
    cluster?: string;
    namespace?: string;
    podSelector?: string;
    container?: string;
  };
  timeout?: number;
}

interface ExecutionResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
}

export class ExecutionManager {
  private activeExecutions = new Map<string, ChildProcess>();

  async executeStreaming(request: ExecutionRequest, ws: WebSocket): Promise<void> {
    const startTime = Date.now();
    const timeout = request.timeout || config.defaultTimeout;
    
    logger.info(`Starting execution ${request.id}: ${request.type}`);
    
    // Build command based on type
    const { cmd, args } = this.buildCommand(request);
    
    // Check whitelist
    if (!this.isCommandAllowed(cmd, args)) {
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Command not allowed by security policy'
      }));
      return;
    }
    
    // Spawn process
    const child = spawn(cmd, args, {
      shell: true,
      env: {
        ...process.env,
        KUBECONFIG: '/root/.kube/config'
      }
    });
    
    this.activeExecutions.set(request.id, child);
    
    // Set timeout
    const timeoutId = setTimeout(() => {
      child.kill('SIGTERM');
      ws.send(JSON.stringify({
        type: 'timeout',
        message: `Execution timed out after ${timeout}s`
      }));
    }, timeout * 1000);
    
    // Stream stdout
    child.stdout.on('data', (data) => {
      ws.send(JSON.stringify({
        type: 'stdout',
        data: data.toString()
      }));
    });
    
    // Stream stderr
    child.stderr.on('data', (data) => {
      ws.send(JSON.stringify({
        type: 'stderr',
        data: data.toString()
      }));
    });
    
    // Handle completion
    child.on('close', (code) => {
      clearTimeout(timeoutId);
      this.activeExecutions.delete(request.id);
      
      const duration = Date.now() - startTime;
      
      ws.send(JSON.stringify({
        type: 'complete',
        exitCode: code,
        duration
      }));
      
      logger.info(`Execution ${request.id} completed with exit code ${code}`);
    });
    
    // Handle errors
    child.on('error', (err) => {
      clearTimeout(timeoutId);
      this.activeExecutions.delete(request.id);
      
      ws.send(JSON.stringify({
        type: 'error',
        error: err.message
      }));
    });
  }
  
  cancelExecution(executionId: string): boolean {
    const child = this.activeExecutions.get(executionId);
    if (child) {
      child.kill('SIGTERM');
      this.activeExecutions.delete(executionId);
      return true;
    }
    return false;
  }
  
  private buildCommand(request: ExecutionRequest): { cmd: string; args: string[] } {
    switch (request.type) {
      case 'kubectl':
        return { cmd: 'kubectl', args: request.command.split(' ') };
        
      case 'sql': {
        // Build kubectl exec command for SQL execution
        const { namespace, podSelector, container } = request.context;
        const podName = this.resolvePodName(namespace!, podSelector!);
        
        const execCmd = [
          'kubectl', 'exec',
          '-n', namespace!,
          podName,
          ...(container ? ['-c', container] : []),
          '--', 'sh', '-c',
          request.command // SQL command passed to pod
        ];
        
        return { cmd: 'sh', args: ['-c', execCmd.join(' ')] };
      }
        
      case 'bash':
        return { cmd: 'bash', args: ['-c', request.command] };
        
      case 'docker':
        return { cmd: 'docker', args: request.command.split(' ') };
        
      default:
        throw new Error(`Unknown execution type: ${request.type}`);
    }
  }
  
  private resolvePodName(namespace: string, selector: string): string {
    // Use kubectl to find pod by label selector
    const result = spawn.sync('kubectl', [
      'get', 'pods',
      '-n', namespace,
      '-l', selector,
      '-o', 'jsonpath={.items[0].metadata.name}'
    ], { encoding: 'utf8' });
    
    if (result.error || !result.stdout) {
      throw new Error(`Failed to find pod in namespace ${namespace} with selector ${selector}`);
    }
    
    return result.stdout.trim();
  }
  
  private isCommandAllowed(cmd: string, args: string[]): boolean {
    const fullCommand = `${cmd} ${args.join(' ')}`;
    
    for (const pattern of config.commandWhitelist) {
      const regex = new RegExp(pattern);
      if (regex.test(fullCommand)) {
        return true;
      }
    }
    
    return false;
  }
}
```

### 3.5 SQL Execution Helper

```typescript
// agent/src/services/sql-executor.ts

import { spawn } from 'child_process';
import { logger } from '../utils/logger';

interface SQLExecutionOptions {
  namespace: string;
  podSelector: string;
  container?: string;
  client: 'psql' | 'mysql' | 'mongosh' | 'redis-cli';
  database: string;  // Logical name (env var will be resolved in pod)
  query: string;
}

export class SQLExecutor {
  async execute(options: SQLExecutionOptions): Promise<{
    success: boolean;
    output: string;
    rows?: any[];
  }> {
    const { namespace, podSelector, container, client, database, query } = options;
    
    // Find the target pod
    const podName = await this.findPod(namespace, podSelector);
    
    // Build the SQL command based on client type
    const sqlCommand = this.buildSQLCommand(client, database, query);
    
    // Build kubectl exec command
    const kubectlArgs = [
      'exec',
      '-n', namespace,
      podName,
      ...(container ? ['-c', container] : []),
      '--', 'sh', '-c', sqlCommand
    ];
    
    logger.info(`Executing SQL via kubectl: kubectl ${kubectlArgs.join(' ')}`);
    
    return new Promise((resolve, reject) => {
      const child = spawn('kubectl', kubectlArgs);
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (data) => stdout += data.toString());
      child.stderr.on('data', (data) => stderr += data.toString());
      
      child.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            output: stdout,
            rows: this.parseOutput(client, stdout)
          });
        } else {
          resolve({
            success: false,
            output: stderr || stdout
          });
        }
      });
      
      child.on('error', reject);
    });
  }
  
  private buildSQLCommand(client: string, database: string, query: string): string {
    const escapedQuery = query.replace(/"/g, '\\"');
    const dbVar = `${database.toUpperCase()}_URL`;
    
    switch (client) {
      case 'psql':
        return `psql "\${${dbVar}}" -c "${escapedQuery}"`;
      case 'mysql':
        return `mysql -e "${escapedQuery}"`;
      case 'mongosh':
        return `mongosh "\${${dbVar}}" --eval "${escapedQuery}"`;
      case 'redis-cli':
        return `redis-cli ${escapedQuery}`;
      default:
        throw new Error(`Unsupported SQL client: ${client}`);
    }
  }
  
  private async findPod(namespace: string, selector: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const kubectl = spawn('kubectl', [
        'get', 'pods',
        '-n', namespace,
        '-l', selector,
        '-o', 'jsonpath={.items[0].metadata.name}'
      ]);
      
      let stdout = '';
      kubectl.stdout.on('data', (data) => stdout += data.toString());
      
      kubectl.on('close', (code) => {
        if (code === 0 && stdout.trim()) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Pod not found: namespace=${namespace}, selector=${selector}`));
        }
      });
    });
  }
  
  private parseOutput(client: string, output: string): any[] | undefined {
    // Parse tabular output for SELECT queries
    if (client === 'psql') {
      // Simple CSV parsing for psql output
      const lines = output.trim().split('\n');
      if (lines.length < 2) return undefined;
      
      // Skip header separator line (----+----)
      const dataLines = lines.filter(l => !l.includes('---') && l.trim());
      
      return dataLines.slice(1).map(line => {
        // Parse pipe-separated values
        return line.split('|').map(v => v.trim());
      });
    }
    return undefined;
  }
}
```

---

## 4. Web App Integration

### 4.1 Agent Bridge Service

```typescript
// src/lib/services/agent-bridge.ts

interface AgentStatus {
  available: boolean;
  connected: boolean;
  version?: string;
  error?: string;
}

interface ExecutionRequest {
  id: string;
  type: 'kubectl' | 'sql' | 'bash' | 'docker';
  command: string;
  context: {
    cluster?: string;
    namespace?: string;
    podSelector?: string;
    customerId: number;
    stepId: number;
  };
  timeout?: number;
}

interface ExecutionUpdate {
  type: 'stdout' | 'stderr' | 'complete' | 'error' | 'timeout';
  data?: string;
  exitCode?: number;
  duration?: number;
  error?: string;
}

class AgentBridge {
  private status: AgentStatus = { available: false, connected: false };
  private statusListeners: ((status: AgentStatus) => void)[] = [];
  private checkInterval?: NodeJS.Timeout;
  
  constructor() {
    this.startStatusCheck();
  }
  
  // Subscribe to status changes
  onStatusChange(callback: (status: AgentStatus) => void): () => void {
    this.statusListeners.push(callback);
    callback(this.status); // Initial status
    return () => {
      this.statusListeners = this.statusListeners.filter(cb => cb !== callback);
    };
  }
  
  private setStatus(newStatus: AgentStatus) {
    this.status = newStatus;
    this.statusListeners.forEach(cb => cb(newStatus));
  }
  
  // Check if extension is installed
  isExtensionInstalled(): boolean {
    return typeof window !== 'undefined' && 
           !!window.releaseTrackerAgent?.isAvailable?.();
  }
  
  // Start periodic status checks
  private startStatusCheck() {
    this.checkStatus();
    this.checkInterval = setInterval(() => this.checkStatus(), 5000);
  }
  
  async checkStatus(): Promise<AgentStatus> {
    if (!this.isExtensionInstalled()) {
      this.setStatus({ available: false, connected: false, error: 'Extension not installed' });
      return this.status;
    }
    
    try {
      const status = await window.releaseTrackerAgent!.getStatus();
      this.setStatus({
        available: true,
        connected: status.connected,
        version: status.version
      });
    } catch (err) {
      this.setStatus({
        available: true,
        connected: false,
        error: err.message
      });
    }
    
    return this.status;
  }
  
  // Execute command with streaming updates
  async execute(
    request: ExecutionRequest,
    onUpdate: (update: ExecutionUpdate) => void
  ): Promise<void> {
    if (!this.isExtensionInstalled()) {
      throw new Error('Agent extension not installed');
    }
    
    try {
      const result = await window.releaseTrackerAgent!.execute(request);
      
      // For non-streaming response, simulate updates
      if (result.stdout) {
        onUpdate({ type: 'stdout', data: result.stdout });
      }
      if (result.stderr) {
        onUpdate({ type: 'stderr', data: result.stderr });
      }
      onUpdate({
        type: 'complete',
        exitCode: result.exitCode,
        duration: result.duration
      });
    } catch (err) {
      onUpdate({ type: 'error', error: err.message });
      throw err;
    }
  }
  
  destroy() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }
}

// Global instance
export const agentBridge = typeof window !== 'undefined' ? new AgentBridge() : null;

// Type declarations for window
declare global {
  interface Window {
    releaseTrackerAgent?: {
      version: string;
      isAvailable(): boolean;
      execute(request: ExecutionRequest): Promise<any>;
      getStatus(): Promise<{ connected: boolean; version?: string }>;
    };
  }
}
```

### 4.2 Execution UI Component

```typescript
// src/components/steps/step-executor.tsx

'use client';

import { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Terminal } from '@/components/ui/terminal';
import { agentBridge, ExecutionUpdate } from '@/lib/services/agent-bridge';
import { useToast } from '@/components/ui/use-toast';

interface StepExecutorProps {
  stepId: number;
  customerId: number;
  type: 'kubectl' | 'sql' | 'bash' | 'docker';
  command: string;
  context: {
    cluster?: string;
    namespace?: string;
    podSelector?: string;
  };
  onExecutionComplete?: (success: boolean, output: string) => void;
}

export function StepExecutor({
  stepId,
  customerId,
  type,
  command,
  context,
  onExecutionComplete
}: StepExecutorProps) {
  const [isExecuting, setIsExecuting] = useState(false);
  const [output, setOutput] = useState<string>('');
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [agentStatus, setAgentStatus] = useState({ available: false, connected: false });
  const { toast } = useToast();
  
  useEffect(() => {
    if (!agentBridge) return;
    
    const unsubscribe = agentBridge.onStatusChange((status) => {
      setAgentStatus({
        available: status.available,
        connected: status.connected
      });
    });
    
    return unsubscribe;
  }, []);
  
  const handleExecute = useCallback(async () => {
    if (!agentBridge) return;
    
    setIsExecuting(true);
    setOutput('');
    setExitCode(null);
    
    const request = {
      id: `${stepId}-${Date.now()}`,
      type,
      command,
      context: {
        ...context,
        customerId,
        stepId
      }
    };
    
    let fullOutput = '';
    
    try {
      await agentBridge.execute(request, (update: ExecutionUpdate) => {
        switch (update.type) {
          case 'stdout':
          case 'stderr':
            fullOutput += update.data;
            setOutput(prev => prev + update.data);
            break;
            
          case 'complete':
            setExitCode(update.exitCode ?? null);
            onExecutionComplete?.(update.exitCode === 0, fullOutput);
            
            if (update.exitCode === 0) {
              toast({
                title: 'Execution completed',
                description: `Duration: ${update.duration}ms`
              });
            } else {
              toast({
                title: 'Execution failed',
                description: `Exit code: ${update.exitCode}`,
                variant: 'destructive'
              });
            }
            break;
            
          case 'error':
            toast({
              title: 'Execution error',
              description: update.error,
              variant: 'destructive'
            });
            break;
            
          case 'timeout':
            toast({
              title: 'Execution timeout',
              description: 'Command exceeded maximum duration',
              variant: 'destructive'
            });
            break;
        }
      });
    } catch (err) {
      toast({
        title: 'Failed to execute',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive'
      });
    } finally {
      setIsExecuting(false);
    }
  }, [stepId, customerId, type, command, context, onExecutionComplete, toast]);
  
  // Render different UI based on agent status
  if (!agentStatus.available) {
    return (
      <div className="rounded-md bg-muted p-4">
        <p className="text-sm text-muted-foreground">
          Install the browser extension to enable one-click execution.
        </p>
        <Button variant="outline" size="sm" className="mt-2" asChild>
          <a href="/settings/agent">Install Extension</a>
        </Button>
      </div>
    );
  }
  
  if (!agentStatus.connected) {
    return (
      <div className="rounded-md bg-yellow-50 p-4">
        <p className="text-sm text-yellow-800">
          Local agent is offline. Start it with: docker-compose up agent
        </p>
      </div>
    );
  }
  
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button 
          onClick={handleExecute} 
          disabled={isExecuting}
          className="bg-green-600 hover:bg-green-700"
        >
          {isExecuting ? (
            <>
              <Spinner className="mr-2 h-4 w-4" />
              Executing...
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" />
              Execute
            </>
          )}
        </Button>
        
        {exitCode !== null && (
          <Badge variant={exitCode === 0 ? 'default' : 'destructive'}>
            Exit Code: {exitCode}
          </Badge>
        )}
      </div>
      
      {(output || isExecuting) && (
        <Terminal 
          output={output} 
          isStreaming={isExecuting}
          className="h-64"
        />
      )}
    </div>
  );
}
```

### 4.3 Terminal Component

```typescript
// src/components/ui/terminal.tsx

import { useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import AnsiToHtml from 'ansi-to-html';

interface TerminalProps {
  output: string;
  isStreaming?: boolean;
  className?: string;
}

const ansiConverter = new AnsiToHtml({
  newline: true,
  escapeXML: true,
  fg: '#e4e4e4',
  bg: '#1e1e1e'
});

export function Terminal({ output, isStreaming, className }: TerminalProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current && isStreaming) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [output, isStreaming]);
  
  const html = ansiConverter.toHtml(output);
  
  return (
    <div 
      ref={scrollRef}
      className={cn(
        'rounded-md bg-[#1e1e1e] p-4 font-mono text-sm overflow-auto',
        className
      )}
    >
      <pre 
        className="text-[#e4e4e4] whitespace-pre-wrap break-all"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {isStreaming && (
        <span className="inline-block w-2 h-4 bg-[#e4e4e4] ml-1 animate-pulse" />
      )}
    </div>
  );
}
```

### 4.4 Database Schema Updates

```typescript
// src/lib/db/schema.ts (additions)

import { sqliteTable, integer, text, index } from 'drizzle-orm/sqlite-core';

// ==================== Agent Tokens ====================
export const agentTokens = sqliteTable('agent_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  token: text('token').notNull().unique(),
  userId: integer('user_id'), // For future multi-user
  name: text('name'), // e.g., "Work Laptop"
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// ==================== Step Executions ====================
export const stepExecutions = sqliteTable('step_executions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  stepId: integer('step_id').notNull().references(() => customerSteps.id, { onDelete: 'cascade' }),
  customerId: integer('customer_id').notNull().references(() => customers.id),
  releaseId: integer('release_id').notNull().references(() => releases.id),
  
  // Execution details
  status: text('status', { enum: ['running', 'completed', 'failed', 'cancelled', 'timeout'] }).notNull(),
  command: text('command').notNull(),
  stdout: text('stdout'),
  stderr: text('stderr'),
  exitCode: integer('exit_code'),
  
  // Metadata
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  duration: integer('duration'), // milliseconds
  executedBy: text('executed_by'), // For future multi-user
  
  // Error info
  errorMessage: text('error_message'),
  
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => ({
  stepIdx: index('step_executions_step_idx').on(table.stepId),
  statusIdx: index('step_executions_status_idx').on(table.status),
  createdIdx: index('step_executions_created_idx').on(table.createdAt),
}));

// ==================== Customer SQL Executor Config ====================
export const customerSqlConfig = sqliteTable('customer_sql_config', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  customerId: integer('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  
  // Pod selection
  namespace: text('namespace').notNull(),
  podSelector: text('pod_selector').notNull(), // label selector, e.g., "app=db-client"
  containerName: text('container_name'), // optional
  
  // SQL client type
  sqlClient: text('sql_client', { enum: ['psql', 'mysql', 'mongosh', 'redis-cli'] }).notNull(),
  
  // Environment variable name for connection string in the pod
  connectionEnvVar: text('connection_env_var').default('DATABASE_URL'),
  
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => ({
  uniqueCustomer: index('unique_customer_sql_config').on(table.customerId),
}));
```

---

## 5. Security Architecture

### 5.1 Threat Model

| Threat | Mitigation |
|--------|------------|
| Malicious website calls agent | Extension validates origin, token required |
| Token theft | Token stored in extension storage, not accessible to web pages |
| Command injection | Input validation, whitelist patterns, parameterized commands |
| Privilege escalation | Agent runs in Docker with limited volume mounts |
| Network sniffing | Token in header, use HTTPS if agent exposed (not recommended) |
| Log exposure | Execution logs stored encrypted in database |

### 5.2 Command Whitelist Configuration

```typescript
// agent/src/config.ts

export const config = {
  port: process.env.AGENT_PORT || 3456,
  token: process.env.AGENT_TOKEN!,
  logLevel: process.env.LOG_LEVEL || 'info',
  defaultTimeout: parseInt(process.env.DEFAULT_TIMEOUT || '300'),
  maxConcurrentExecutions: parseInt(process.env.MAX_CONCURRENT_EXECUTIONS || '5'),
  
  // Command whitelist patterns (regex)
  commandWhitelist: [
    // kubectl commands
    /^kubectl\s+(apply|get|describe|logs|exec|port-forward|rollout)/,
    
    // Helm commands
    /^helm\s+(install|upgrade|rollback|list|status)/,
    
    // SQL via kubectl exec (specific pattern)
    /^kubectl\s+exec\s+-n\s+\S+\s+\S+\s+--\s+(psql|mysql|mongosh|redis-cli)/,
    
    // Docker commands
    /^docker\s+(build|push|pull|images|ps)/,
    
    // Git commands
    /^git\s+(clone|pull|fetch|status)/,
    
    // Bash scripts in specific directories
    /^bash\s+-c\s+".\/scripts\//,
  ],
  
  // Blocked patterns (always rejected)
  blockedPatterns: [
    /rm\s+-rf\s+\//,
    />\s*\/etc\/passwd/,
    /curl\s+.*\|\s*bash/,
  ]
};
```

### 5.3 RBAC for Agent

The agent's kubeconfig should have minimal permissions:

```yaml
# kubernetes/agent-rbac.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: release-tracker-agent
  namespace: default
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: release-tracker-agent
rules:
  # Read pods (for finding db-client pods)
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
  # Exec into pods
  - apiGroups: [""]
    resources: ["pods/exec"]
    verbs: ["create"]
  # Read deployments (for rollout status)
  - apiGroups: ["apps"]
    resources: ["deployments", "statefulsets"]
    verbs: ["get", "list", "watch"]
  # Apply changes (limited to specific namespaces via binding)
  - apiGroups: ["*"]
    resources: ["*"]
    verbs: ["get", "list", "apply", "patch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: release-tracker-agent
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: release-tracker-agent
subjects:
  - kind: ServiceAccount
    name: release-tracker-agent
    namespace: default
```

---

## 6. API Reference

### 6.1 Agent REST API

#### Health Check
```
GET /health
Headers: X-Agent-Token: <token>

Response:
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 3600,
  "executions": {
    "active": 2,
    "completed": 150
  }
}
```

#### Execute Command
```
POST /api/v1/execute
Headers: 
  X-Agent-Token: <token>
  Content-Type: application/json

Body:
{
  "id": "exec-123",
  "type": "sql",
  "command": "ALTER TABLE users ADD COLUMN...",
  "context": {
    "namespace": "customer-a-prod",
    "podSelector": "app=db-client",
    "customerId": 1,
    "stepId": 42
  },
  "timeout": 300
}

Response (streaming via WebSocket) or:
{
  "success": true,
  "exitCode": 0,
  "stdout": "ALTER TABLE\nTime: 45.234 ms",
  "stderr": "",
  "duration": 2340
}
```

#### Cancel Execution
```
POST /api/v1/execute/:id/cancel
Headers: X-Agent-Token: <token>

Response:
{
  "success": true,
  "message": "Execution cancelled"
}
```

### 6.2 WebSocket Protocol

```javascript
// Connect
const ws = new WebSocket('ws://localhost:3456/ws');
ws.onopen = () => {
  // Authenticate
  ws.send(JSON.stringify({
    type: 'auth',
    token: 'rt_live_xxx'
  }));
};

// Execute
ws.send(JSON.stringify({
  type: 'execute',
  request: {
    id: 'exec-123',
    type: 'sql',
    command: 'SELECT * FROM users',
    context: { namespace: 'cust-a', podSelector: 'app=db-client' }
  }
}));

// Receive updates
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  switch (msg.type) {
    case 'stdout': console.log(msg.data); break;
    case 'stderr': console.error(msg.data); break;
    case 'complete': console.log('Done:', msg.exitCode); break;
    case 'error': console.error('Error:', msg.error); break;
  }
};
```

---

## 7. Development Workflow

### 7.1 Local Development Setup

```bash
# 1. Start the web app
npm run dev

# 2. Build and load extension (in another terminal)
cd extension
npm install
npm run build
# Load unpacked extension in chrome://extensions

# 3. Start the agent (in another terminal)
cd agent
npm install
npm run dev
# Or use Docker:
docker-compose up agent
```

### 7.2 Extension Development

```bash
cd extension

# Development mode with hot reload
npm run dev

# Build for production
npm run build

# Package for Chrome Web Store
npm run package
```

### 7.3 Agent Development

```bash
cd agent

# Development with hot reload
npm run dev

# Build
npm run build

# Run tests
npm test

# Build Docker image
docker build -t release-tracker-agent .
```

---

## 8. Deployment Checklist

### 8.1 Chrome Web Store Publishing

- [ ] Create Chrome Web Store developer account
- [ ] Prepare extension icons (16x16, 48x48, 128x128)
- [ ] Write extension description and screenshots
- [ ] Build and zip extension package
- [ ] Submit for review (typically 1-3 days)

### 8.2 Agent Deployment

- [ ] Generate secure random token
- [ ] Configure command whitelist
- [ ] Set up log rotation
- [ ] Configure monitoring/alerting
- [ ] Document kubeconfig RBAC requirements

### 8.3 Web App Updates

- [ ] Add agent settings page
- [ ] Update step detail UI with execution panel
- [ ] Add execution history view
- [ ] Update documentation

---

## 9. Monitoring & Observability

### 9.1 Agent Metrics

| Metric | Type | Description |
|--------|------|-------------|
| executions_total | Counter | Total executions by type |
| executions_active | Gauge | Currently running executions |
| execution_duration | Histogram | Execution duration in seconds |
| execution_errors | Counter | Failed executions by error type |
| ws_connections | Gauge | Active WebSocket connections |

### 9.2 Logging

```typescript
// Structured logging format
{
  "timestamp": "2026-02-28T13:45:00Z",
  "level": "info",
  "component": "execution-manager",
  "executionId": "exec-123",
  "type": "sql",
  "customerId": 1,
  "stepId": 42,
  "message": "Execution started",
  "metadata": {
    "namespace": "customer-a-prod",
    "pod": "db-client-xxx"
  }
}
```

---

## 10. Appendix

### 10.1 Glossary

| Term | Definition |
|------|------------|
| Agent | Local Docker container that executes commands |
| Bridge | Browser extension that connects web app to agent |
| Content Script | JavaScript injected into web pages by extension |
| Service Worker | Background script handling extension events |
| Pod Selector | Kubernetes label selector for finding pods |
| db-client | Pod in K8s cluster with database client tools |

### 10.2 File Structure

```
docs/
├── FSD-AGENT-EXECUTION.md       # This document
└── TSD-AGENT-EXECUTION.md       # Technical specification

extension/                       # Browser extension
├── manifest.json
├── src/
│   ├── content.ts              # Content script
│   ├── background.ts           # Service worker
│   ├── injected.ts             # Page API
│   └── popup.ts                # Settings UI
├── popup.html
├── package.json
└── tsconfig.json

agent/                          # Local execution agent
├── src/
│   ├── server.ts               # Express server
│   ├── config.ts               # Configuration
│   ├── middleware/
│   │   └── auth.ts             # Token validation
│   ├── routes/
│   │   ├── execution.ts        # Execute endpoints
│   │   └── status.ts           # Health endpoint
│   ├── services/
│   │   ├── execution-manager.ts
│   │   └── sql-executor.ts
│   └── utils/
│       └── logger.ts
├── Dockerfile
├── docker-compose.yml
├── package.json
└── tsconfig.json

web-app-changes/                # Modifications to main app
├── src/
│   ├── lib/
│   │   └── services/
│   │       └── agent-bridge.ts
│   └── components/
│       ├── ui/
│       │   └── terminal.tsx
│       └── steps/
│           └── step-executor.tsx
```
