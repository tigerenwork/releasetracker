/**
 * Agent Bridge Service
 * 
 * Bridges communication between the web app and the browser extension.
 * Provides type-safe access to the window.rtAgent API.
 */

export interface ExecutionContext {
  customerId: number;
  clusterId?: number;
  namespace: string;
  podSelector: string;
  containerName?: string;
  stepId: number;
  releaseId: number;
}

export interface SQLExecutionConfig {
  client: 'psql' | 'mysql' | 'mongosh' | 'redis-cli';
  database?: string;
  query: string;
  useTransaction?: boolean;
}

export interface RESTExecutionConfig {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  baseUrl?: string;
  payload?: Record<string, any>;
  headers?: Record<string, string>;
  expectJson?: boolean;
}

export interface ScriptExecutionConfig {
  interpreter: 'bash' | 'python' | 'node';
  content: string;
  environment?: Record<string, string>;
  workingDir?: string;
}

export interface ExecutionRequest {
  id: string;
  type: 'sql' | 'rest' | 'script';
  context: ExecutionContext;
  timeout?: number;
  sql?: SQLExecutionConfig;
  rest?: RESTExecutionConfig;
  script?: ScriptExecutionConfig;
}

export interface ExecutionResult {
  success: boolean;
  executionId: string;
  type: 'sql' | 'rest' | 'script';
  exitCode?: number;
  duration: number;
  timestamp: string;
  stdout?: string;
  stderr?: string;
  sql?: {
    stdout: string;
    stderr: string;
    rowCount?: number;
    rows?: any[];
    command?: string;
  };
  rest?: {
    statusCode: number;
    body: string;
    json?: any;
    latency: number;
  };
  script?: {
    stdout: string;
    stderr: string;
    exitCode: number;
    command: string;
  };
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

export interface AgentStatus {
  connected: boolean;
  version?: string;
  agentUrl?: string;
  error?: string;
}

class AgentBridge {
  private statusListeners: ((status: AgentStatus) => void)[] = [];
  private currentStatus: AgentStatus = { connected: false };
  private checkInterval?: NodeJS.Timeout;

  constructor() {
    if (typeof window !== 'undefined') {
      this.startStatusCheck();
    }
  }

  /**
   * Check if extension is available
   */
  isAvailable(): boolean {
    return typeof window !== 'undefined' && !!window.rtAgent;
  }

  /**
   * Get current status
   */
  getStatus(): AgentStatus {
    return this.currentStatus;
  }

  /**
   * Subscribe to status changes
   */
  onStatusChange(callback: (status: AgentStatus) => void): () => void {
    this.statusListeners.push(callback);
    callback(this.currentStatus);
    return () => {
      this.statusListeners = this.statusListeners.filter(cb => cb !== callback);
    };
  }

  private setStatus(status: AgentStatus) {
    this.currentStatus = status;
    this.statusListeners.forEach(cb => cb(status));
  }

  /**
   * Start periodic status checks
   */
  private startStatusCheck() {
    this.checkStatus();
    this.checkInterval = setInterval(() => this.checkStatus(), 5000);
  }

  /**
   * Check connection status
   */
  async checkStatus(): Promise<AgentStatus> {
    if (!this.isAvailable()) {
      this.setStatus({ connected: false, error: 'Extension not installed' });
      return this.currentStatus;
    }

    try {
      const status = await window.rtAgent!.getStatus();
      this.setStatus({
        connected: status.connected,
        version: status.version,
        agentUrl: status.agentUrl,
      });
    } catch (err) {
      this.setStatus({
        connected: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }

    return this.currentStatus;
  }

  /**
   * Execute a command
   */
  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    if (!this.isAvailable()) {
      throw new Error('Agent extension not installed');
    }

    const result = await window.rtAgent!.execute(request);
    return result as ExecutionResult;
  }

  /**
   * Simple ping test
   */
  async ping(): Promise<ExecutionResult> {
    return this.execute({
      id: `ping-${Date.now()}`,
      type: 'script',
      context: {
        customerId: 0,
        namespace: 'default',
        podSelector: 'test',
        stepId: 0,
        releaseId: 0,
      },
      script: {
        interpreter: 'bash',
        content: 'echo "pong"',
      },
      timeout: 10000,
    });
  }

  /**
   * Execute SQL query
   */
  async executeSQL(
    context: ExecutionContext,
    sql: SQLExecutionConfig,
    timeout = 300
  ): Promise<ExecutionResult> {
    return this.execute({
      id: `sql-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'sql',
      context,
      sql,
      timeout,
    });
  }

  /**
   * Execute REST API call
   */
  async executeREST(
    context: ExecutionContext,
    rest: RESTExecutionConfig,
    timeout = 60
  ): Promise<ExecutionResult> {
    return this.execute({
      id: `rest-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'rest',
      context,
      rest,
      timeout,
    });
  }

  /**
   * Execute script
   */
  async executeScript(
    context: ExecutionContext,
    script: ScriptExecutionConfig,
    timeout = 600
  ): Promise<ExecutionResult> {
    return this.execute({
      id: `script-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'script',
      context,
      script,
      timeout,
    });
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
    rtAgent?: {
      version: string;
      isAvailable(): boolean;
      execute(request: ExecutionRequest): Promise<ExecutionResult>;
      getStatus(): Promise<{ connected: boolean; version?: string; agentUrl?: string }>;
      ping(): Promise<ExecutionResult>;
    };
  }
}
