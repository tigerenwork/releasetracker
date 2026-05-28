# Technical Specification Document
## Local Agent Execution System

### Version: 1.1
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

---

## 2. Step Type Execution Flows

### 2.1 SQL Execution Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Web App   │────►│  Extension  │────►│    Agent    │────►│     K8s     │
└──────┬──────┘     └─────────────┘     └──────┬──────┘     └──────┬──────┘
       │                                        │                    │
       │ 1. POST /execute                       │                    │
       │    {                                   │                    │
       │      type: "sql",                      │                    │
       │      namespace: "cust-a",              │                    │
       │      podSelector: "app=db-client",     │                    │
       │      sqlClient: "psql",                │                    │
       │      database: "app_prod",             │                    │
       │      query: "ALTER TABLE...",          │                    │
       │      useTransaction: true              │                    │
       │    }                                   │                    │
       │                                        │                    │
       │                                        │ 2. Find pod        │
       │                                        │    kubectl get     │
       │                                        │    pods -l...      │
       │                                        │                    │
       │                                        │ 3. Build command   │
       │                                        │    "psql           │
       │                                        │     $DATABASE_URL  │
       │                                        │     -c '...'"      │
       │                                        │                    │
       │                                        │ 4. kubectl exec    │
       │                                        │    ─────────────►  │
       │                                        │                    │
       │                                        │                    │ 5. Execute
       │                                        │                    │    in pod
       │                                        │                    │
       │                                        │ ◄────────────────  │
       │                                        │    stdout/stderr   │
       │ ◄──────────────────────────────────────│                    │
       │    {success, exitCode, output}         │                    │
```

### 2.2 REST Execution Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Web App   │────►│  Extension  │────►│    Agent    │────►│     K8s     │
└──────┬──────┘     └─────────────┘     └──────┬──────┘     └──────┬──────┘
       │                                        │                    │
       │ 1. POST /execute                       │                    │
       │    {                                   │                    │
       │      type: "rest",                     │                    │
       │      namespace: "cust-a",              │                    │
       │      podSelector: "app=api-client",    │                    │
       │      method: "POST",                   │                    │
       │      url: "/api/v1/migrate",           │                    │
       │      baseUrl: "http://internal-api",   │                    │
       │      payload: {...},                   │                    │
       │      headers: {...}                    │                    │
       │    }                                   │                    │
       │                                        │                    │
       │                                        │ 2. Find pod        │
       │                                        │                    │
       │                                        │ 3. Build curl cmd  │
       │                                        │    "curl -X POST   │
       │                                        │     -d '{...}'     │
       │                                        │     http://..."    │
       │                                        │                    │
       │                                        │ 4. kubectl exec    │
       │                                        │    ─────────────►  │
       │                                        │                    │
       │                                        │                    │ 5. curl
       │                                        │                    │    internal
       │                                        │                    │    service
       │                                        │ ◄────────────────  │
       │                                        │    HTTP response   │
       │ ◄──────────────────────────────────────│                    │
       │    {success, statusCode, body}         │                    │
```

### 2.3 Script Execution Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Web App   │────►│  Extension  │────►│    Agent    │────►│     K8s     │
└──────┬──────┘     └─────────────┘     └──────┬──────┘     └──────┬──────┘
       │                                        │                    │
       │ 1. POST /execute                       │                    │
       │    {                                   │                    │
       │      type: "script",                   │                    │
       │      namespace: "cust-a",              │                    │
       │      podSelector: "app=executor",      │                    │
       │      interpreter: "bash",              │                    │
       │      content: "#!/bin/bash\necho...",  │                    │
       │      environment: {...}                │                    │
       │    }                                   │                    │
       │                                        │                    │
       │                                        │ 2. Find pod        │
       │                                        │                    │
       │                                        │ 3. Stream script   │
       │                                        │    via stdin       │
       │                                        │                    │
       │                                        │ 4. kubectl exec    │
       │                                        │    bash -c         │
       │                                        │    ─────────────►  │
       │                                        │                    │
       │                                        │                    │ 5. Execute
       │                                        │                    │    script
       │                                        │                    │
       │                                        │ ◄────────────────  │
       │                                        │    stdout/stderr   │
       │ ◄──────────────────────────────────────│                    │
       │    {success, exitCode, output}         │                    │
```

---

## 3. Execution API Specification

### 3.1 Request Format

```typescript
interface ExecutionRequest {
  // Common fields for all types
  id: string;                    // Unique execution ID
  type: 'sql' | 'rest' | 'script' | 'text';
  context: {
    customerId: number;
    clusterId: number;
    namespace: string;
    podSelector: string;
    containerName?: string;
    stepId: number;
    releaseId: number;
  };
  timeout?: number;              // Seconds, default: 300
  
  // Type-specific fields (mutually exclusive)
  sql?: SQLExecutionConfig;
  rest?: RESTExecutionConfig;
  script?: ScriptExecutionConfig;
}

interface SQLExecutionConfig {
  client: 'psql' | 'mysql' | 'mongosh' | 'redis-cli';
  database?: string;             // Logical name, resolved to env var
  query: string;
  useTransaction?: boolean;
}

interface RESTExecutionConfig {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;                   // Relative path
  baseUrl?: string;              // Optional override
  payload?: Record<string, any>; // JSON payload
  headers?: Record<string, string>;
  expectJson?: boolean;          // Parse response as JSON
}

interface ScriptExecutionConfig {
  interpreter: 'bash' | 'python' | 'node';
  content: string;               // Script content
  environment?: Record<string, string>;
  workingDir?: string;
}
```

### 3.2 Response Format

```typescript
interface ExecutionResponse {
  success: boolean;
  executionId: string;
  type: 'sql' | 'rest' | 'script';
  
  // Common result fields
  exitCode?: number;
  duration: number;              // Milliseconds
  timestamp: string;             // ISO 8601
  
  // Type-specific outputs
  sql?: SQLResult;
  rest?: RESTResult;
  script?: ScriptResult;
  
  // Error info (if success=false)
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

interface SQLResult {
  stdout: string;
  stderr: string;
  rowCount?: number;
  rows?: any[];                  // For SELECT queries (limited)
  command?: string;              // The actual SQL command executed
}

interface RESTResult {
  statusCode: number;
  statusText?: string;
  headers: Record<string, string>;
  body: string;                  // Raw response body
  json?: any;                    // Parsed JSON (if expectJson=true)
  latency: number;               // Request latency in ms
}

interface ScriptResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;               // The actual command executed
}
```

### 3.3 API Endpoints

#### Execute Command
```
POST /api/v1/execute
Content-Type: application/json
X-Agent-Token: <token>

Body: ExecutionRequest

Response: ExecutionResponse
```

#### Cancel Execution
```
POST /api/v1/execute/:id/cancel
X-Agent-Token: <token>

Response: { success: boolean, message: string }
```

#### Stream Execution (WebSocket)
```
WS /ws/execute?id=<executionId>&token=<token>

// Client -> Server
{ type: "start", request: ExecutionRequest }

// Server -> Client (streaming)
{ type: "stdout", data: "..." }
{ type: "stderr", data: "..." }
{ type: "progress", percent: 50 }
{ type: "complete", result: ExecutionResponse }
{ type: "error", error: {...} }
```

---

## 4. Agent Implementation

### 4.1 Server Structure

```typescript
// agent/src/server.ts

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { SQLExecutor } from './executors/sql';
import { RESTExecutor } from './executors/rest';
import { ScriptExecutor } from './executors/script';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Request routing based on type
app.post('/api/v1/execute', async (req, res) => {
  const { type } = req.body;
  
  try {
    let result;
    switch (type) {
      case 'sql':
        result = await sqlExecutor.execute(req.body);
        break;
      case 'rest':
        result = await restExecutor.execute(req.body);
        break;
      case 'script':
        result = await scriptExecutor.execute(req.body);
        break;
      default:
        throw new Error(`Unknown execution type: ${type}`);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: {
        code: 'EXECUTION_FAILED',
        message: err.message
      }
    });
  }
});
```

### 4.2 SQL Executor

```typescript
// agent/src/executors/sql.ts

import { spawn } from 'child_process';
import { ExecutionRequest, ExecutionResponse } from '../types';

export class SQLExecutor {
  async execute(request: ExecutionRequest): Promise<ExecutionResponse> {
    const { sql, context } = request;
    const startTime = Date.now();
    
    // 1. Find target pod
    const podName = await this.findPod(
      context.namespace,
      context.podSelector
    );
    
    // 2. Build SQL command
    const sqlCommand = this.buildSQLCommand(sql!);
    
    // 3. Build kubectl exec command
    const kubectlArgs = [
      'exec',
      '-n', context.namespace,
      podName,
      ...(context.containerName ? ['-c', context.containerName] : []),
      '--', 'sh', '-c', sqlCommand
    ];
    
    // 4. Execute
    const { stdout, stderr, exitCode } = await this.execKubectl(kubectlArgs);
    
    // 5. Parse result (for SELECT queries)
    const rows = exitCode === 0 ? this.parseRows(sql!.client, stdout) : undefined;
    
    return {
      success: exitCode === 0,
      executionId: request.id,
      type: 'sql',
      exitCode,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      sql: {
        stdout,
        stderr,
        rowCount: rows?.length,
        rows: rows?.slice(0, 1000), // Limit rows
        command: sqlCommand
      }
    };
  }
  
  private buildSQLCommand(sql: SQLExecutionConfig): string {
    const { client, database, query, useTransaction } = sql;
    const escapedQuery = query.replace(/'/g, "'\"'\"'");
    
    let command: string;
    
    switch (client) {
      case 'psql':
        const dbVar = database ? `\${${database.toUpperCase()}_URL}` : '$DATABASE_URL';
        command = `psql "${dbVar}" -c '${escapedQuery}'`;
        break;
        
      case 'mysql':
        command = `mysql -e '${escapedQuery}'`;
        break;
        
      case 'mongosh':
        const mongoVar = database ? `\${${database.toUpperCase()}_URL}` : '$MONGODB_URL';
        command = `mongosh "${mongoVar}" --eval '${escapedQuery}'`;
        break;
        
      case 'redis-cli':
        command = `redis-cli ${escapedQuery}`;
        break;
        
      default:
        throw new Error(`Unsupported SQL client: ${client}`);
    }
    
    // Wrap in transaction if requested
    if (useTransaction && client !== 'redis-cli') {
      command = `sh -c 'set -e; ${command};'`;
    }
    
    return command;
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
  
  private async execKubectl(args: string[]): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    return new Promise((resolve) => {
      const child = spawn('kubectl', args);
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (data) => stdout += data.toString());
      child.stderr.on('data', (data) => stderr += data.toString());
      
      child.on('close', (exitCode) => {
        resolve({ stdout, stderr, exitCode: exitCode || 0 });
      });
    });
  }
  
  private parseRows(client: string, output: string): any[] | undefined {
    // Simple parsing for psql output
    if (client === 'psql') {
      const lines = output.trim().split('\n');
      if (lines.length < 3) return undefined;
      
      // Skip header separator (----+----)
      const dataLines = lines.filter(l => 
        !l.match(/^\s*[\+|\-]+\s*$/) && l.trim()
      );
      
      if (dataLines.length < 2) return undefined;
      
      // Parse pipe-separated rows
      return dataLines.slice(1).map(line => 
        line.split('|').map(v => v.trim())
      );
    }
    return undefined;
  }
}
```

### 4.3 REST Executor

```typescript
// agent/src/executors/rest.ts

import { ExecutionRequest, ExecutionResponse } from '../types';

export class RESTExecutor {
  async execute(request: ExecutionRequest): Promise<ExecutionResponse> {
    const { rest, context } = request;
    const startTime = Date.now();
    
    // 1. Find target pod
    const podName = await this.findPod(
      context.namespace,
      context.podSelector
    );
    
    // 2. Build curl command
    const curlCommand = this.buildCurlCommand(rest!);
    
    // 3. Execute kubectl exec with curl
    const kubectlArgs = [
      'exec',
      '-n', context.namespace,
      podName,
      ...(context.containerName ? ['-c', context.containerName] : []),
      '--', 'sh', '-c', curlCommand
    ];
    
    // 4. Execute
    const { stdout, stderr, exitCode } = await this.execKubectl(kubectlArgs);
    
    // 5. Parse HTTP response from curl output
    const { statusCode, headers, body } = this.parseHttpResponse(stdout);
    
    // 6. Parse JSON if expected
    let json: any;
    if (rest!.expectJson) {
      try {
        json = JSON.parse(body);
      } catch {
        // Ignore parse errors
      }
    }
    
    return {
      success: exitCode === 0 && statusCode >= 200 && statusCode < 300,
      executionId: request.id,
      type: 'rest',
      exitCode,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      rest: {
        statusCode,
        headers,
        body,
        json,
        latency: Date.now() - startTime
      },
      error: exitCode !== 0 || statusCode >= 400 ? {
        code: 'HTTP_ERROR',
        message: `HTTP ${statusCode}: ${body.slice(0, 200)}`
      } : undefined
    };
  }
  
  private buildCurlCommand(rest: RESTExecutionConfig): string {
    const { method, url, baseUrl, payload, headers } = rest;
    
    const fullUrl = baseUrl 
      ? `${baseUrl.replace(/\/$/, '')}${url}`
      : url;
    
    const parts = ['curl', '-s', '-w', '\\n%{http_code}', '-X', method];
    
    // Add headers
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        parts.push('-H', `'${key}: ${value}'`);
      }
    }
    
    // Add content-type for POST/PUT/PATCH
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      parts.push('-H', 'Content-Type: application/json');
    }
    
    // Add payload
    if (payload) {
      const json = JSON.stringify(payload).replace(/'/g, "'\"'\"'");
      parts.push('-d', `'${json}'`);
    }
    
    parts.push(`'${fullUrl}'`);
    
    return parts.join(' ');
  }
  
  private parseHttpResponse(output: string): {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
  } {
    const lines = output.trim().split('\n');
    const statusCode = parseInt(lines[lines.length - 1], 10) || 0;
    const body = lines.slice(0, -1).join('\n');
    
    return {
      statusCode,
      headers: {}, // Could parse from curl -i output if needed
      body
    };
  }
  
  // ... findPod and execKubectl same as SQLExecutor
}
```

### 4.4 Script Executor

```typescript
// agent/src/executors/script.ts

import { ExecutionRequest, ExecutionResponse } from '../types';

export class ScriptExecutor {
  async execute(request: ExecutionRequest): Promise<ExecutionResponse> {
    const { script, context } = request;
    const startTime = Date.now();
    
    // 1. Find target pod
    const podName = await this.findPod(
      context.namespace,
      context.podSelector
    );
    
    // 2. Prepare script execution
    const { command, args } = this.buildScriptCommand(script!);
    
    // 3. Build kubectl exec with stdin for script
    const kubectlArgs = [
      'exec',
      '-n', context.namespace,
      podName,
      ...(context.containerName ? ['-c', context.containerName] : []),
      '-i', // Interactive mode for stdin
      '--', command, ...args
    ];
    
    // 4. Execute with script content via stdin
    const { stdout, stderr, exitCode } = await this.execKubectlWithStdin(
      kubectlArgs,
      script!.content
    );
    
    return {
      success: exitCode === 0,
      executionId: request.id,
      type: 'script',
      exitCode,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      script: {
        stdout,
        stderr,
        exitCode,
        command: `${command} ${args.join(' ')}`
      }
    };
  }
  
  private buildScriptCommand(script: ScriptExecutionConfig): {
    command: string;
    args: string[];
  } {
    const { interpreter } = script;
    
    switch (interpreter) {
      case 'bash':
        return { command: 'bash', args: [] };
      case 'python':
        return { command: 'python', args: [] };
      case 'node':
        return { command: 'node', args: [] };
      default:
        throw new Error(`Unsupported interpreter: ${interpreter}`);
    }
  }
  
  private async execKubectlWithStdin(
    args: string[],
    stdin: string
  ): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    return new Promise((resolve) => {
      const child = spawn('kubectl', args);
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (data) => stdout += data.toString());
      child.stderr.on('data', (data) => stderr += data.toString());
      
      // Send script content via stdin
      child.stdin.write(stdin);
      child.stdin.end();
      
      child.on('close', (exitCode) => {
        resolve({ stdout, stderr, exitCode: exitCode || 0 });
      });
    });
  }
  
  // ... findPod same as SQLExecutor
}
```

---

## 5. Web App Integration

### 5.1 Step Type Rendering

```tsx
// src/components/steps/step-executor.tsx

interface StepExecutorProps {
  step: CustomerStep;
  config: CustomerExecutionConfig;
}

export function StepExecutor({ step, config }: StepExecutorProps) {
  switch (step.type) {
    case 'sql':
      return <SQLStepExecutor step={step} config={config.sql} />;
    case 'rest':
      return <RESTStepExecutor step={step} config={config.rest} />;
    case 'script':
      return <ScriptStepExecutor step={step} config={config.script} />;
    case 'text':
      return <TextStepDisplay step={step} />;
    default:
      return <UnknownStepType step={step} />;
  }
}

// SQL Step
function SQLStepExecutor({ step, config }: { step: CustomerStep; config?: SQLConfig }) {
  if (!config) return <MissingConfig type="sql" />;
  
  const handleExecute = async () => {
    const result = await window.rtAgent!.execute({
      type: 'sql',
      context: {
        namespace: config.namespace,
        podSelector: config.podSelector,
        containerName: config.containerName
      },
      sql: {
        client: config.sqlClient,
        database: config.database,
        query: step.content,
        useTransaction: step.metadata?.useTransaction
      }
    });
    return result;
  };
  
  return (
    <div>
      <Badge variant="outline">SQL ({config.sqlClient})</Badge>
      <CodeBlock code={step.content} language="sql" />
      <ExecuteButton onExecute={handleExecute} />
    </div>
  );
}

// REST Step
function RESTStepExecutor({ step, config }: { step: CustomerStep; config?: RESTConfig }) {
  if (!config) return <MissingConfig type="rest" />;
  
  const method = step.metadata?.method || 'POST';
  const url = step.metadata?.url || '/';
  const payload = step.metadata?.payload;
  
  const handleExecute = async () => {
    const result = await window.rtAgent!.execute({
      type: 'rest',
      context: {
        namespace: config.namespace,
        podSelector: config.podSelector
      },
      rest: {
        method,
        url,
        baseUrl: config.baseUrl,
        payload,
        headers: step.metadata?.headers,
        expectJson: true
      }
    });
    return result;
  };
  
  return (
    <div>
      <Badge variant="outline">REST {method}</Badge>
      <div className="text-sm font-mono">{url}</div>
      {payload && <CodeBlock code={JSON.stringify(payload, null, 2)} language="json" />}
      <ExecuteButton onExecute={handleExecute} />
    </div>
  );
}

// Script Step
function ScriptStepExecutor({ step, config }: { step: CustomerStep; config?: ScriptConfig }) {
  if (!config) return <MissingConfig type="script" />;
  
  const interpreter = step.metadata?.interpreter || 'bash';
  
  const handleExecute = async () => {
    const result = await window.rtAgent!.execute({
      type: 'script',
      context: {
        namespace: config.namespace,
        podSelector: config.podSelector,
        containerName: config.containerName
      },
      script: {
        interpreter,
        content: step.content,
        environment: step.metadata?.environment,
        workingDir: config.workingDir
      }
    });
    return result;
  };
  
  return (
    <div>
      <Badge variant="outline">Script ({interpreter})</Badge>
      <CodeBlock code={step.content} language={interpreter} />
      <ExecuteButton onExecute={handleExecute} />
    </div>
  );
}

// Text Step (manual, no execution)
function TextStepDisplay({ step }: { step: CustomerStep }) {
  return (
    <div>
      <Badge variant="outline">Manual</Badge>
      <div className="prose">{step.content}</div>
      {step.metadata?.checklist && (
        <Checklist items={step.metadata.checklist} />
      )}
      <Button onClick={() => markStepDone(step.id)}>Mark as Done</Button>
    </div>
  );
}
```

### 5.2 Database Schema Updates

```typescript
// src/lib/db/schema.ts (additions)

// ==================== Customer Execution Config ====================
export const customerExecutionConfigs = sqliteTable('customer_execution_configs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  customerId: integer('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  
  // SQL config (JSON)
  sqlConfig: text('sql_config', { mode: 'json' }).$type<{
    namespace: string;
    podSelector: string;
    containerName?: string;
    sqlClient: 'psql' | 'mysql' | 'mongosh' | 'redis-cli';
    connectionEnvVar: string;
  }>(),
  
  // REST config (JSON)
  restConfig: text('rest_config', { mode: 'json' }).$type<{
    namespace: string;
    podSelector: string;
    containerName?: string;
    baseUrl?: string;
  }>(),
  
  // Script config (JSON)
  scriptConfig: text('script_config', { mode: 'json' }).$type<{
    namespace: string;
    podSelector: string;
    containerName?: string;
    workingDir?: string;
  }>(),
  
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// ==================== Step Executions (Extended) ====================
export const stepExecutions = sqliteTable('step_executions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  stepId: integer('step_id').notNull().references(() => customerSteps.id, { onDelete: 'cascade' }),
  customerId: integer('customer_id').notNull().references(() => customers.id),
  releaseId: integer('release_id').notNull().references(() => releases.id),
  
  // Execution details
  type: text('type', { enum: ['sql', 'rest', 'script', 'text'] }).notNull(),
  status: text('status', { enum: ['running', 'completed', 'failed', 'cancelled', 'timeout'] }).notNull(),
  
  // Request details (stored for audit)
  request: text('request', { mode: 'json' }).notNull(),
  
  // Result
  exitCode: integer('exit_code'),
  stdout: text('stdout'),
  stderr: text('stderr'),
  
  // Type-specific results
  sqlResult: text('sql_result', { mode: 'json' }), // { rowCount, rows }
  restResult: text('rest_result', { mode: 'json' }), // { statusCode, body }
  scriptResult: text('script_result', { mode: 'json' }), // { command }
  
  // Metadata
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  duration: integer('duration'),
  
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});
```

---

## 6. Q&A / Clarifications

### Q1: How does the agent handle different SQL dialects?

**A:** The agent delegates to the SQL client installed in the target pod:
- **PostgreSQL**: Uses `psql` with `-c` flag for single commands
- **MySQL**: Uses `mysql` with `-e` flag
- **MongoDB**: Uses `mongosh` with `--eval` flag
- **Redis**: Uses `redis-cli` directly

The agent builds the appropriate command string but the actual execution happens in the pod using the pod's configured client version.

### Q2: What happens if the pod has multiple containers?

**A:** The `containerName` field in the execution config specifies which container to exec into. If not specified:
1. kubectl defaults to the first container in the pod
2. If that container doesn't have the required tool (psql, curl, bash), execution fails
3. Error message suggests checking container configuration

### Q3: How are large SQL results handled?

**A:** 
- Results are streamed but buffered in memory
- Hard limit: 10MB total output
- Row limit: 1000 rows for display
- For large migrations, recommend using `script` type instead
- Full output is always available in execution logs

### Q4: Can REST calls use HTTPS with self-signed certificates?

**A:** Yes, by adding curl flags:
```bash
curl -k https://internal-service/...
```

Configure in step metadata:
```json
{
  "headers": {},
  "curlOptions": ["-k", "--max-time", "30"]
}
```

### Q5: How are script secrets handled?

**A:** Secrets should NOT be passed from the web app. Instead:
1. Mount secrets as environment variables in the target pod
2. Script references them: `$SECRET_API_KEY`
3. Agent never sees the secret values
4. Script content is logged but env vars are not

### Q6: Can scripts be stored and reused?

**A:** Initial implementation: inline scripts only.
Future enhancement: Script Library feature:
- Store scripts in database with versioning
- Reference by ID: `scriptRef: "cleanup-v2"`
- Parameters via templating: `{{ customerId }}`

### Q7: What happens if kubectl is not available on the agent?

**A:** Agent checks for kubectl on startup:
```javascript
const checkKubectl = spawn('kubectl', ['version', '--client']);
```

If missing:
- Logs error: "kubectl not found, mounting kubeconfig not sufficient"
- Health endpoint returns: `{ status: "error", reason: "kubectl not found" }`
- All executions fail with clear error message

### Q8: How do we handle connection drops during long executions?

**A:** 
- The kubectl exec process continues running in the cluster
- Agent tracks execution ID to pod process mapping
- On reconnect, agent can query status (if process still running)
- Web app shows "Connection lost, execution may still be running"
- User can check execution history for final status

### Q9: Can the agent execute on multiple pods simultaneously?

**A:** Yes, each execution is independent:
- Concurrent execution limit configurable (default: 5)
- Each execution gets unique ID
- No locking between executions
- Use with caution for database migrations (recommend sequential)

### Q10: How do we debug failed executions?

**A:** Multiple levels of debugging:
1. **Web App**: Shows stdout/stderr in terminal panel
2. **Agent Logs**: Full kubectl command and output
3. **K8s Logs**: Check target pod logs if execution started
4. **Manual Test**: Copy kubectl command from logs, run locally

Enable debug logging:
```bash
LOG_LEVEL=debug node server.js
```

### Q11: What's the recommended pod setup for executions?

**A:** Recommended pattern:
```yaml
# db-client pod for SQL
apiVersion: v1
kind: Pod
metadata:
  name: db-client
  labels:
    app: db-client
spec:
  containers:
  - name: client
    image: postgres:15-alpine  # Has psql
    env:
    - name: DATABASE_URL
      valueFrom:
        secretKeyRef:
          name: db-credentials
          key: url
    command: ['sleep', 'infinity']  # Keep pod running
```

Similar for api-client (with curl) and executor (with bash/python).

### Q12: How do we handle different environments (dev/staging/prod)?

**A:** Two approaches:

**Option 1: Separate agents**
```bash
# Dev agent on port 3456
AGENT_PORT=3456 AGENT_TOKEN=dev-token node server.js

# Prod agent on port 3457
AGENT_PORT=3457 AGENT_TOKEN=prod-token node server.js
```
Configure extension per environment.

**Option 2: Single agent, cluster context**
Agent uses current kubectl context. User switches context before execution.

### Q13: Can we execute on pods in different clusters?

**A:** Yes, if:
1. kubeconfig has multiple contexts
2. Agent has access to all clusters
3. Execution request includes cluster context
4. Agent switches context: `kubectl --context=<ctx> exec ...`

Not in initial implementation - single cluster per agent.

---

## 7. Security Considerations

### 7.1 Command Injection Prevention

| Layer | Protection |
|-------|------------|
| Web App | Input validation, parameterized queries |
| Extension | No command building, just relay |
| Agent | Strict type checking, whitelist validation |
| kubectl | Kubernetes RBAC on pod exec |

### 7.2 Network Security

- Agent only binds to `127.0.0.1` (localhost)
- No external exposure possible
- Extension validates token on every request
- HTTPS for web app, HTTP only for local agent

### 7.3 Pod Security

- Pods run with minimal permissions
- Service accounts have limited RBAC
- No privileged containers recommended
- Network policies restrict pod-to-pod access

---

## 8. Performance Considerations

| Metric | Target | Notes |
|--------|--------|-------|
| Execution start latency | < 2s | Pod lookup + kubectl exec |
| Stream latency | < 100ms | Real-time output streaming |
| Concurrent executions | 5-10 | Configurable limit |
| Output size limit | 10MB | Per execution |
| Row limit (SQL) | 1000 | Display only |
| Connection timeout | 30s | For status checks |
| Execution timeout | 300-600s | Configurable per type |

---

## 9. Error Codes

| Code | Description | Recovery |
|------|-------------|----------|
| `POD_NOT_FOUND` | No pod matches selector | Check customer config |
| `POD_NOT_READY` | Pod exists but not running | Wait or check pod status |
| `EXEC_TIMEOUT` | Execution exceeded timeout | Increase timeout or optimize |
| `SQL_ERROR` | Database returned error | Check SQL syntax |
| `HTTP_ERROR` | REST call returned 4xx/5xx | Check API docs |
| `SCRIPT_ERROR` | Script exited non-zero | Check script logic |
| `KUBECTL_ERROR` | kubectl command failed | Check kubeconfig |
| `NETWORK_ERROR` | Agent can't reach cluster | Check VPN/network |
