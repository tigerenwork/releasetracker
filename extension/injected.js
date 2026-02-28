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
          const timeout = setTimeout(() => {
            pendingRequests.delete(id);
            reject(new Error('Execution timeout'));
          }, request.timeout || 30000);
          
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
