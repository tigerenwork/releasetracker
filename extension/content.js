/**
 * Content Script - Runs in ISOLATED world
 * 
 * Bridges communication between the web page (injected script)
 * and the extension background service worker.
 */

console.log('[RT:Content] Content script loaded on:', window.location.href);

// Active streaming ports, keyed by request id
const streamPorts = new Map();

// Active shell ports, keyed by request id
const shellPorts = new Map();

// Listen for messages from the injected script (page context)
window.addEventListener('message', async (event) => {
  // Only accept messages from the same window
  if (event.source !== window) return;
  
  // Only handle our message types
  if (!event.data?.type?.startsWith('RT_')) return;
  
  console.log('[RT:Content] Received from page:', event.data.type, event.data.id);
  
  switch (event.data.type) {
    case 'RT_GET_STATUS': {
      try {
        const result = await chrome.runtime.sendMessage({
          action: 'getStatus'
        });
        
        window.postMessage({
          type: 'RT_STATUS_RESPONSE',
          id: event.data.id,
          status: result
        }, '*');
      } catch (err) {
        window.postMessage({
          type: 'RT_STATUS_RESPONSE',
          id: event.data.id,
          status: { connected: false, error: err.message }
        }, '*');
      }
      break;
    }
    
    case 'RT_EXECUTE': {
      try {
        const result = await chrome.runtime.sendMessage({
          action: 'execute',
          request: event.data.payload,
          id: event.data.id
        });
        
        window.postMessage({
          type: 'RT_EXECUTE_RESPONSE',
          id: event.data.id,
          success: result.success,
          result: result.data,
          error: result.error
        }, '*');
      } catch (err) {
        window.postMessage({
          type: 'RT_EXECUTE_RESPONSE',
          id: event.data.id,
          success: false,
          error: err.message
        }, '*');
      }
      break;
    }
    case 'RT_PORT_FORWARD': {
      try {
        const result = await chrome.runtime.sendMessage({
          action: 'portforward',
          op: event.data.payload.op,
          params: event.data.payload.params
        });

        window.postMessage({
          type: 'RT_PORT_FORWARD_RESPONSE',
          id: event.data.id,
          success: result.success,
          result: result.data,
          error: result.error
        }, '*');
      } catch (err) {
        window.postMessage({
          type: 'RT_PORT_FORWARD_RESPONSE',
          id: event.data.id,
          success: false,
          error: err.message
        }, '*');
      }
      break;
    }

    case 'RT_PROXY_REQUEST': {
      try {
        const result = await chrome.runtime.sendMessage({
          action: 'proxyRequest',
          params: event.data.payload
        });

        window.postMessage({
          type: 'RT_PROXY_RESPONSE',
          id: event.data.id,
          success: result.success,
          result: result.data,
          error: result.error
        }, '*');
      } catch (err) {
        window.postMessage({
          type: 'RT_PROXY_RESPONSE',
          id: event.data.id,
          success: false,
          error: err.message
        }, '*');
      }
      break;
    }

    case 'RT_EXECUTE_STREAM': {
      const port = chrome.runtime.connect({ name: 'rt-stream' });
      streamPorts.set(event.data.id, port);

      port.onMessage.addListener((msg) => {
        window.postMessage({
          type: 'RT_EXECUTE_STREAM_CHUNK',
          id: event.data.id,
          chunk: msg
        }, '*');

        if (msg.type === 'done' || msg.type === 'error') {
          streamPorts.delete(event.data.id);
          port.disconnect();
        }
      });

      port.postMessage({
        action: 'executeStream',
        id: event.data.id,
        request: event.data.payload
      });
      break;
    }

    case 'RT_EXECUTE_STREAM_CANCEL': {
      const port = streamPorts.get(event.data.id);
      if (port) {
        streamPorts.delete(event.data.id);
        port.disconnect();
      }
      break;
    }

    case 'RT_SHELL_OPEN': {
      const port = chrome.runtime.connect({ name: 'rt-shell' });
      shellPorts.set(event.data.id, port);

      port.onMessage.addListener((msg) => {
        window.postMessage({
          type: 'RT_SHELL_MSG',
          id: event.data.id,
          msg: msg
        }, '*');
      });

      port.postMessage({
        action: 'open',
        id: event.data.id,
        params: event.data.params
      });
      break;
    }

    case 'RT_SHELL_SEND': {
      const port = shellPorts.get(event.data.id);
      if (port) {
        port.postMessage({ action: 'send', payload: event.data.payload });
      }
      break;
    }

    case 'RT_SHELL_CLOSE': {
      const port = shellPorts.get(event.data.id);
      if (port) {
        shellPorts.delete(event.data.id);
        port.disconnect();
      }
      break;
    }
  }
});

// Notify that content script is ready
console.log('[RT:Content] Ready for messages');
