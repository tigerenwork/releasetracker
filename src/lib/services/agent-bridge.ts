/**
 * Agent Bridge Service
 * 
 * Bridges communication between the web app and the browser extension.
 * Provides type-safe access to the window.rtAgent API.
 */

export interface ExecutionContext {
  customerId: number;
  clusterId?: number;
  kubeContext?: string;
  namespace: string;
  podSelector: string;
  podName?: string;
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
  interpreter: 'sh' | 'bash' | 'python' | 'node';
  content: string;
  environment?: Record<string, string>;
  workingDir?: string;
}

export interface LogsExecutionConfig {
  tailLines?: number;
  timestamps?: boolean;
}

export type ConfigAction = 'describe' | 'get' | 'apply' | 'rolloutRestart';

export interface ConfigPatch {
  set: Record<string, string>;
  delete: string[];
}

export interface ConfigPayload {
  action: ConfigAction;
  /** describe / rolloutRestart (derived via appFromPodName) */
  deploymentName?: string;
  /** get / apply */
  configMapName?: string;
  /** apply: diff of data keys */
  patch?: ConfigPatch;
}

export interface ConfigMapRef {
  name: string;
  consumedAs: Array<'envFrom' | 'env' | 'volume'>;
}

export interface ConfigResult {
  // describe
  deployment?: string;
  supported?: boolean;
  unsupportedReason?: string;
  configMaps?: ConfigMapRef[];
  // get
  data?: Record<string, string>;
  truncated?: boolean;
  // apply / rolloutRestart
  appliedKeys?: number;
  deletedKeys?: number;
  output?: string;
}

export interface PortForwardRequest {
  kubeContext?: string;
  namespace: string;
  /** e.g. "service/cronicle" or "pod/my-pod" */
  resource: string;
  localPort: number;
  remotePort: number;
}

export interface PortForwardInfo {
  id: string;
  kubeContext?: string;
  namespace: string;
  resource: string;
  localPort: number;
  remotePort: number;
  status: 'starting' | 'ready' | 'failed';
  startedAt: string;
  error?: string;
}

export interface ProxyRequest {
  /** Loopback URL only (http://127.0.0.1:* or http://localhost:*) */
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  /** Per-request timeout in ms (default 30000) */
  timeoutMs?: number;
}

export interface ProxyResponse {
  status: number;
  body: string;
}

export interface ExecutionRequest {
  id: string;
  type: 'sql' | 'rest' | 'script' | 'pods' | 'logs' | 'restart' | 'config';
  context: ExecutionContext;
  timeout?: number;
  sql?: SQLExecutionConfig;
  rest?: RESTExecutionConfig;
  script?: ScriptExecutionConfig;
  logs?: LogsExecutionConfig;
  config?: ConfigPayload;
}

export interface ContainerInfo {
  name: string;
  ready: boolean;
  restartCount: number;
  state: string;
  startedAt: string | null;
  lastTerminatedAt: string | null;
  lastTerminatedReason: string | null;
}

export interface PodInfo {
  name: string;
  status: string;
  ready: string;
  restarts: number;
  lastRestartAt: string | null;
  createdAt: string;
  node?: string;
  ip?: string;
  containers: ContainerInfo[];
}

export interface ScriptStreamChunk {
  type: 'stdout' | 'stderr';
  data: string;
}

export interface ShellParams {
  kubeContext?: string;
  namespace: string;
  podName: string;
  containerName?: string;
  shell?: 'sh' | 'bash';
  cols?: number;
  rows?: number;
}

export interface ShellCallbacks {
  onOutput?: (data: string) => void;
  onExit?: (code: number) => void;
  onError?: (message: string) => void;
}

export interface ShellSession {
  send(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

export interface ExecutionResult {
  success: boolean;
  executionId: string;
  type: 'sql' | 'rest' | 'script' | 'pods' | 'restart' | 'config';
  exitCode?: number;
  duration: number;
  timestamp: string;
  stdout?: string;
  stderr?: string;
  pods?: {
    count: number;
    items: PodInfo[];
  };
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
    stdoutTruncated?: boolean;
    stderrTruncated?: boolean;
    exitCode: number;
    command: string;
  };
  restart?: {
    stdout: string;
    stderr: string;
  };
  config?: ConfigResult;
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
  /** true when the agent is older than MIN_AGENT_VERSION */
  outdated?: boolean;
  error?: string;
}

/** Minimum agent version this web app requires */
export const MIN_AGENT_VERSION = '1.1.0';

/** Minimum agent version that supports port-forward proxies */
export const PORT_FORWARD_MIN_VERSION = '1.2.0';

/** Minimum agent version that supports pod restart */
export const RESTART_MIN_VERSION = '1.3.0';

/** Minimum agent version that supports ConfigMap view/edit (type: 'config') */
export const CONFIG_EDIT_MIN_VERSION = '1.4.0';

/** Compare two semver-ish versions: -1 / 0 / 1 */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** True when the connected agent supports port-forward proxies */
export function supportsPortForward(version?: string): boolean {
  return !!version && compareVersions(version, PORT_FORWARD_MIN_VERSION) >= 0;
}

/** True when the connected agent supports pod restart */
export function supportsRestart(version?: string): boolean {
  return !!version && compareVersions(version, RESTART_MIN_VERSION) >= 0;
}

/** True when the connected agent supports ConfigMap view/edit */
export function supportsConfigEdit(version?: string): boolean {
  return !!version && compareVersions(version, CONFIG_EDIT_MIN_VERSION) >= 0;
}

/** True when the loaded extension exposes the loopback HTTP proxy relay */
export function supportsProxyRequest(): boolean {
  return typeof window !== 'undefined' && typeof window.rtAgent?.proxyRequest === 'function';
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
        outdated:
          status.connected && !!status.version
            ? compareVersions(status.version, MIN_AGENT_VERSION) < 0
            : false,
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
        namespace: 'test',
        podSelector: 'app=redis',
        kubeContext: 'volcengine',
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

  /**
   * List pods with status details
   */
  async getPods(context: ExecutionContext, timeout = 30): Promise<ExecutionResult> {
    return this.execute({
      id: `pods-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'pods',
      context,
      timeout,
    });
  }

  /**
   * Restart a pod by deleting it (the workload controller recreates it).
   * Requires agent >= 1.3.0.
   */
  async restartPod(context: ExecutionContext, timeout = 60): Promise<ExecutionResult> {
    return this.execute({
      id: `restart-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'restart',
      context,
      timeout,
    });
  }

  /**
   * Describe a Deployment: resolve it and list the ConfigMaps it consumes.
   * Requires agent >= 1.4.0.
   */
  async configDescribe(
    context: ExecutionContext,
    deploymentName: string,
    timeout = 30
  ): Promise<ExecutionResult> {
    return this.execute({
      id: `config-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'config',
      context,
      config: { action: 'describe', deploymentName },
      timeout,
    });
  }

  /**
   * Read a ConfigMap's data. Requires agent >= 1.4.0.
   */
  async configGet(
    context: ExecutionContext,
    configMapName: string,
    timeout = 30
  ): Promise<ExecutionResult> {
    return this.execute({
      id: `config-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'config',
      context,
      config: { action: 'get', configMapName },
      timeout,
    });
  }

  /**
   * Apply a merge patch to a ConfigMap's data (set/delete keys).
   * Requires agent >= 1.4.0.
   */
  async configApply(
    context: ExecutionContext,
    configMapName: string,
    patch: ConfigPatch,
    timeout = 30
  ): Promise<ExecutionResult> {
    return this.execute({
      id: `config-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'config',
      context,
      config: { action: 'apply', configMapName, patch },
      timeout,
    });
  }

  /**
   * Rollout restart a single Deployment. Requires agent >= 1.4.0.
   */
  async rolloutRestart(
    context: ExecutionContext,
    deploymentName: string,
    timeout = 30
  ): Promise<ExecutionResult> {
    return this.execute({
      id: `config-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'config',
      context,
      config: { action: 'rolloutRestart', deploymentName },
      timeout,
    });
  }

  /**
   * Execute script with streaming output.
   * onChunk is called as stdout/stderr data arrives; the returned promise
   * resolves to the final result. Call cancel() to abort mid-stream.
   */
  executeScriptStream(
    context: ExecutionContext,
    script: ScriptExecutionConfig,
    onChunk: (chunk: ScriptStreamChunk) => void,
    timeout = 60
  ): { promise: Promise<ExecutionResult>; cancel: () => void } {
    if (!this.isAvailable()) {
      throw new Error('Agent extension not installed');
    }

    const stream = window.rtAgent!.executeStream(
      {
        id: `script-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: 'script',
        context,
        script,
        timeout,
      },
      onChunk
    );

    return { promise: stream, cancel: () => stream.cancel() };
  }

  /**
   * Stream container logs (kubectl logs -f).
   * No page-side timeout — call cancel() to stop the stream.
   */
  getLogsStream(
    context: ExecutionContext,
    logs: LogsExecutionConfig,
    onChunk: (chunk: ScriptStreamChunk) => void
  ): { promise: Promise<ExecutionResult>; cancel: () => void } {
    if (!this.isAvailable()) {
      throw new Error('Agent extension not installed');
    }

    const stream = window.rtAgent!.executeStream(
      {
        id: `logs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: 'logs',
        context,
        logs,
        timeout: 0,
      },
      onChunk
    );

    return { promise: stream, cancel: () => stream.cancel() };
  }

  /**
   * Open an interactive shell session (WebSocket via extension)
   */
  openShell(params: ShellParams, callbacks: ShellCallbacks): ShellSession {
    if (!this.isAvailable()) {
      throw new Error('Agent extension not installed');
    }
    return window.rtAgent!.openShell(params, callbacks);
  }

  /**
   * Start a kubectl port-forward proxy on the agent
   */
  async startPortForward(request: PortForwardRequest): Promise<PortForwardInfo> {
    if (!this.isAvailable()) {
      throw new Error('Agent extension not installed');
    }
    const result = await window.rtAgent!.portForward('start', request);
    return (result as { forward: PortForwardInfo }).forward;
  }

  /**
   * Stop a port-forward proxy by id
   */
  async stopPortForward(id: string): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('Agent extension not installed');
    }
    await window.rtAgent!.portForward('stop', { id });
  }

  /**
   * List active port-forward proxies on the agent
   */
  async listPortForwards(): Promise<PortForwardInfo[]> {
    if (!this.isAvailable()) {
      throw new Error('Agent extension not installed');
    }
    const result = await window.rtAgent!.portForward('list');
    return (result as { forwards: PortForwardInfo[] }).forwards;
  }

  /**
   * Proxy an HTTP request to a loopback service (e.g. a port-forward)
   * via the extension's background worker. Requires extension >= 1.1.0.
   */
  async proxyRequest(request: ProxyRequest): Promise<ProxyResponse> {
    if (!this.isAvailable() || typeof window.rtAgent!.proxyRequest !== 'function') {
      throw new Error('Agent extension does not support proxy requests — reload the extension');
    }
    return window.rtAgent!.proxyRequest(request) as Promise<ProxyResponse>;
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
      executeStream(
        request: ExecutionRequest,
        onChunk: (chunk: ScriptStreamChunk) => void
      ): Promise<ExecutionResult> & { cancel(): void };
      openShell(params: ShellParams, callbacks: ShellCallbacks): ShellSession;
      portForward(op: 'start', params: PortForwardRequest): Promise<unknown>;
      portForward(op: 'stop', params: { id: string }): Promise<unknown>;
      portForward(op: 'list', params?: Record<string, never>): Promise<unknown>;
      proxyRequest?(params: ProxyRequest): Promise<unknown>;
      getStatus(): Promise<{ connected: boolean; version?: string; agentUrl?: string }>;
      ping(): Promise<ExecutionResult>;
    };
  }
}
