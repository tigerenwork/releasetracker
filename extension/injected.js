/**
 * Injected Script - Runs in the page context (MAIN world)
 * 
 * This script injects the `window.rtAgent` API that the web app uses
 * to communicate with the extension.
 */

(function() {
  'use strict';
  
  try {
    console.log('[RT:Injected] Script starting on:', window.location.href);
    
    // Prevent double-injection
    if (window.rtAgent) {
      console.log('[RT:Injected] Already initialized');
      return;
    }
    
    console.log('[RT:Injected] Initializing...');
    
    const pendingRequests = new Map();
    let requestCounter = 0;
    
    /**
     * Generate unique request ID
     */
    function generateId() {
      return `${Date.now()}-${++requestCounter}-${Math.random().toString(36).slice(2, 7)}`;
    }
    
    /**
     * Main API exposed to web app
     */
    window.rtAgent = {
      version: '1.0.0-poc',
      
      /**
       * Check if extension is installed and available
       */
      isAvailable() {
        return true; // If this object exists, extension is available
      },
      
      /**
       * Get connection status from agent
       */
      async getStatus() {
        return new Promise((resolve, reject) => {
          const id = generateId();
          const timeout = setTimeout(() => {
            pendingRequests.delete(id);
            reject(new Error('Status check timeout'));
          }, 5000);
          
          const handler = (event) => {
            if (event.source !== window) return;
            if (event.data?.type !== 'RT_STATUS_RESPONSE') return;
            if (event.data.id !== id) return;
            
            clearTimeout(timeout);
            window.removeEventListener('message', handler);
            pendingRequests.delete(id);
            
            resolve(event.data.status);
          };
          
          window.addEventListener('message', handler);
          pendingRequests.set(id, { handler, timeout });
          
          window.postMessage({
            type: 'RT_GET_STATUS',
            id: id
          }, '*');
        });
      },
      
      /**
       * Execute a command through the agent
       */
      async execute(request) {
        return new Promise((resolve, reject) => {
          const id = generateId();
          // request.timeout is in seconds (agent-side); wait slightly longer
          // so the agent's own timeout response can still arrive first
          const timeoutMs = (request.timeout || 30) * 1000 + 5000;
          console.log('[RT:Injected] Executing', request.type, 'id:', id, 'timeout:', timeoutMs, 'ms');
          const timeout = setTimeout(() => {
            pendingRequests.delete(id);
            reject(new Error('Execution timeout'));
          }, timeoutMs);
          
          const handler = (event) => {
            if (event.source !== window) return;
            if (event.data?.type !== 'RT_EXECUTE_RESPONSE') return;
            if (event.data.id !== id) return;
            
            clearTimeout(timeout);
            window.removeEventListener('message', handler);
            pendingRequests.delete(id);
            
            if (event.data.success) {
              resolve(event.data.result);
            } else {
              reject(new Error(event.data.error || 'Execution failed'));
            }
          };
          
          window.addEventListener('message', handler);
          pendingRequests.set(id, { handler, timeout });
          
          window.postMessage({
            type: 'RT_EXECUTE',
            id: id,
            payload: request
          }, '*');
        });
      },
      
      /**
       * Execute a command through the agent with streaming output.
       * onChunk({type: 'stdout'|'stderr', data}) is called as output arrives.
       * Returns a promise for the final result, with an attached cancel() method.
       */
      executeStream(request, onChunk) {
        const id = generateId();
        // request.timeout is in seconds (agent-side); wait slightly longer.
        // timeout 0/undefined = no page-side timeout (long-lived streams like logs -f)
        const timeoutMs = request.timeout ? request.timeout * 1000 + 5000 : 0;

        let cleanup = () => {};
        let settled = false;
        let resolvePromise = () => {};

        const promise = new Promise((resolve, reject) => {
          resolvePromise = resolve;

          const timeout = timeoutMs > 0 ? setTimeout(() => {
            cleanup();
            window.postMessage({ type: 'RT_EXECUTE_STREAM_CANCEL', id }, '*');
            reject(new Error('Execution timeout'));
          }, timeoutMs) : null;

          const handler = (event) => {
            if (event.source !== window) return;
            if (event.data?.type !== 'RT_EXECUTE_STREAM_CHUNK') return;
            if (event.data.id !== id) return;

            const chunk = event.data.chunk || {};

            if (chunk.type === 'done') {
              cleanup();
              resolve(chunk.result);
            } else if (chunk.type === 'error') {
              cleanup();
              reject(new Error(chunk.message || 'Execution failed'));
            } else if (chunk.type === 'stdout' || chunk.type === 'stderr') {
              try {
                onChunk && onChunk(chunk);
              } catch {
                // Ignore chunk handler errors
              }
            }
          };

          cleanup = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            window.removeEventListener('message', handler);
            pendingRequests.delete(id);
          };

          window.addEventListener('message', handler);
          pendingRequests.set(id, { handler, timeout });

          window.postMessage({
            type: 'RT_EXECUTE_STREAM',
            id: id,
            payload: request
          }, '*');
        });

        // Expose cancel so callers can abort mid-stream
        promise.cancel = () => {
          cleanup();
          window.postMessage({ type: 'RT_EXECUTE_STREAM_CANCEL', id }, '*');
          resolvePromise({
            success: false,
            executionId: id,
            type: request.type,
            duration: 0,
            timestamp: new Date().toISOString(),
            error: { code: 'CANCELLED', message: 'Execution cancelled' }
          });
        };

        return promise;
      },

      /**
       * Open an interactive shell session.
       * params: { kubeContext?, namespace, podName, containerName?, shell?, cols?, rows? }
       * callbacks: { onOutput(data), onExit(code), onError(message) }
       * Returns { send(data), resize(cols, rows), close() }
       */
      openShell(params, callbacks) {
        const id = generateId();

        const handler = (event) => {
          if (event.source !== window) return;
          if (event.data?.type !== 'RT_SHELL_MSG') return;
          if (event.data.id !== id) return;

          const msg = event.data.msg || {};

          if (msg.type === 'output') {
            callbacks.onOutput && callbacks.onOutput(msg.data);
          } else if (msg.type === 'exit') {
            cleanup();
            callbacks.onExit && callbacks.onExit(msg.code);
          } else if (msg.type === 'error') {
            callbacks.onError && callbacks.onError(msg.message);
          }
        };

        const cleanup = () => {
          window.removeEventListener('message', handler);
          pendingRequests.delete(id);
        };

        window.addEventListener('message', handler);
        pendingRequests.set(id, { handler });

        window.postMessage({
          type: 'RT_SHELL_OPEN',
          id: id,
          params: {
            kubeContext: params.kubeContext,
            namespace: params.namespace,
            pod: params.podName,
            container: params.containerName,
            shell: params.shell || 'bash',
            cols: params.cols || 80,
            rows: params.rows || 24
          }
        }, '*');

        return {
          send: (data) => window.postMessage({
            type: 'RT_SHELL_SEND',
            id: id,
            payload: { type: 'stdin', data: data }
          }, '*'),
          resize: (cols, rows) => window.postMessage({
            type: 'RT_SHELL_SEND',
            id: id,
            payload: { type: 'resize', cols: cols, rows: rows }
          }, '*'),
          close: () => {
            cleanup();
            window.postMessage({ type: 'RT_SHELL_CLOSE', id: id }, '*');
          }
        };
      },

      /**
       * Port-forward operations through the agent.
       * op: 'start' (params: { kubeContext?, namespace, resource, localPort, remotePort }),
       *     'stop'  (params: { id }),
       *     'list'  (no params)
       */
      async portForward(op, params = {}) {
        return new Promise((resolve, reject) => {
          const id = generateId();
          const timeout = setTimeout(() => {
            pendingRequests.delete(id);
            reject(new Error('Port-forward request timeout'));
          }, 10000);

          const handler = (event) => {
            if (event.source !== window) return;
            if (event.data?.type !== 'RT_PORT_FORWARD_RESPONSE') return;
            if (event.data.id !== id) return;

            clearTimeout(timeout);
            window.removeEventListener('message', handler);
            pendingRequests.delete(id);

            if (event.data.success) {
              resolve(event.data.result);
            } else {
              reject(new Error(event.data.error || 'Port-forward request failed'));
            }
          };

          window.addEventListener('message', handler);
          pendingRequests.set(id, { handler, timeout });

          window.postMessage({
            type: 'RT_PORT_FORWARD',
            id: id,
            payload: { op, params }
          }, '*');
        });
      },

      /**
       * Generic HTTP proxy to a loopback service (e.g. a kubectl port-forward).
       * params: { url, method?, headers?, body?, timeoutMs? }
       * Resolves to { status, body } (body as text).
       */
      async proxyRequest(params) {
        return new Promise((resolve, reject) => {
          const id = generateId();
          const timeout = setTimeout(() => {
            pendingRequests.delete(id);
            reject(new Error('Proxy request timeout'));
          }, (params.timeoutMs || 30000) + 5000);

          const handler = (event) => {
            if (event.source !== window) return;
            if (event.data?.type !== 'RT_PROXY_RESPONSE') return;
            if (event.data.id !== id) return;

            clearTimeout(timeout);
            window.removeEventListener('message', handler);
            pendingRequests.delete(id);

            if (event.data.success) {
              resolve(event.data.result);
            } else {
              reject(new Error(event.data.error || 'Proxy request failed'));
            }
          };

          window.addEventListener('message', handler);
          pendingRequests.set(id, { handler, timeout });

          window.postMessage({
            type: 'RT_PROXY_REQUEST',
            id: id,
            payload: params
          }, '*');
        });
      },

      /**
       * Simple ping to test connectivity
       */
      async ping() {
        return this.execute({
          type: 'bash',
          command: 'ping',
          context: {},
          timeout: 5000
        });
      }
    };
    
    // Signal that extension is present - use a simple property instead of meta tag
    // to avoid issues with document timing
    try {
      if (typeof document !== 'undefined' && document && document.body) {
        const meta = document.createElement('meta');
        meta.name = 'rt-extension-ready';
        meta.content = window.rtAgent.version;
        document.head?.appendChild(meta);
      }
    } catch (e) {
      // Ignore meta tag errors - the API object is what matters
    }
    
    // Dispatch event for apps that want to listen
    try {
      window.dispatchEvent(new CustomEvent('rt-agent-ready', {
        detail: { version: window.rtAgent.version }
      }));
    } catch (e) {
      // Ignore event dispatch errors
    }
    
    console.log('[RT:Injected] API ready, version:', window.rtAgent.version);
    
  } catch (err) {
    console.error('[RT:Injected] Failed to initialize:', err);
  }
})();
