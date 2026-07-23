/**
 * Background Service Worker
 * 
 * Handles communication with the local agent via HTTP.
 * Persists connection to the agent across page navigations.
 */

const DEFAULT_AGENT_URL = 'http://127.0.0.1:3456';

// Connection state
let connectionState = {
  agentUrl: DEFAULT_AGENT_URL,
  token: null,
  connected: false,
  lastChecked: null
};

// Tracks whether settings have been hydrated from chrome.storage.local in this
// worker lifetime. An MV3 service worker is stopped after ~30s of idleness and
// re-spun on the next message, resetting module state (including
// connectionState.token) to null. onStartup/onInstalled do NOT fire on a
// wake, so we must lazily reload settings before issuing any authenticated
// request — otherwise we send `X-Agent-Token: null` and the agent returns 401.
let settingsLoaded = false;

/**
 * Ensure connectionState is hydrated from chrome.storage.local before any
 * request that depends on it. Safe to call repeatedly — it only hits storage
 * once per worker lifetime (or after settings are explicitly invalidated).
 */
async function ensureSettings() {
  if (settingsLoaded) return;
  const saved = await chrome.storage.local.get(['agentUrl', 'token']);
  connectionState.agentUrl = saved.agentUrl || DEFAULT_AGENT_URL;
  connectionState.token = saved.token || null;
  settingsLoaded = true;
}

// Initialize
chrome.runtime.onStartup.addListener(init);
chrome.runtime.onInstalled.addListener(init);

async function init() {
  console.log('[RT:Background] Initializing...');

  // Load saved settings
  await ensureSettings();

  console.log('[RT:Background] Loaded settings:', {
    agentUrl: connectionState.agentUrl,
    hasToken: !!connectionState.token
  });

  // Check initial connection
  await checkConnection();

  console.log('[RT:Background] Initialized, agent:', connectionState.agentUrl);
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request).then(sendResponse).catch(err => {
    console.error('[RT:Background] Error:', err);
    sendResponse({ success: false, error: err.message });
  });
  return true; // Keep channel open for async
});

// Handle streaming connections from content script
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'rt-stream') return;

  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());

  port.onMessage.addListener(async (msg) => {
    if (msg.action !== 'executeStream') return;

    const send = (obj) => {
      try {
        port.postMessage({ id: msg.id, ...obj });
      } catch {
        // Port already disconnected
      }
    };

    try {
      await ensureSettings();
      if (!connectionState.connected) {
        await checkConnection();
      }

      const response = await fetch(`${connectionState.agentUrl}/api/v1/execute/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-Token': connectionState.token
        },
        body: JSON.stringify({ ...msg.request, id: msg.id }),
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text();
        send({
          type: 'error',
          message: response.status === 401
            ? 'Authentication failed. Check your token.'
            : `Agent error: ${text}`
        });
        return;
      }

      // Read NDJSON stream line by line
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            send(JSON.parse(line));
          } catch {
            // Skip malformed line
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        send({ type: 'error', message: err.message });
      }
    }
  });
});

// Handle interactive shell connections from content script (WebSocket relay)
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'rt-shell') return;

  let ws = null;

  const send = (obj) => {
    try {
      port.postMessage(obj);
    } catch {
      // Port already disconnected
    }
  };

  port.onMessage.addListener(async (msg) => {
    if (msg.action === 'open') {
      await ensureSettings();
      const params = new URLSearchParams({
        token: connectionState.token,
        ...msg.params
      });
      const wsUrl = connectionState.agentUrl.replace(/^http/, 'ws') + '/ws/shell?' + params.toString();

      console.log('[RT:Background] Opening shell WebSocket:', wsUrl.replace(/token=[^&]+/, 'token=***'));
      ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          send({ id: msg.id, ...JSON.parse(event.data) });
        } catch {
          // Skip malformed frame
        }
      };
      ws.onerror = () => {
        send({ id: msg.id, type: 'error', message: 'WebSocket connection failed. Is the agent running?' });
      };
      ws.onclose = (event) => {
        if (!event.wasClean) {
          send({ id: msg.id, type: 'error', message: `Connection closed unexpectedly (${event.code})` });
        }
      };
    } else if (msg.action === 'send' && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg.payload));
    }
  });

  port.onDisconnect.addListener(() => {
    if (ws) ws.close();
  });
});

async function handleMessage(request) {
  console.log('[RT:Background] Received action:', request.action);
  
  switch (request.action) {
    case 'getStatus':
      return await checkConnection();
      
    case 'execute':
      return await executeCommand(request.request, request.id);

    case 'portforward':
      return await portForwardCommand(request.op, request.params);
      
    case 'updateSettings':
      connectionState.agentUrl = request.agentUrl || connectionState.agentUrl;
      connectionState.token = request.token || connectionState.token;
      settingsLoaded = true;
      await chrome.storage.local.set({
        agentUrl: connectionState.agentUrl,
        token: connectionState.token
      });
      return { success: true };
      
    default:
      throw new Error(`Unknown action: ${request.action}`);
  }
}

/**
 * Check connection to agent
 */
async function checkConnection() {
  await ensureSettings();
  console.log('[RT:Background] Checking connection to:', connectionState.agentUrl);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    const url = `${connectionState.agentUrl}/health`;
    console.log('[RT:Background] Fetching:', url);
    
    const response = await fetch(url, {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data = await response.json();
      connectionState.connected = true;
      connectionState.lastChecked = Date.now();
      
      console.log('[RT:Background] Connected to agent:', data.version);
      
      return {
        connected: true,
        version: data.version,
        agentUrl: connectionState.agentUrl
      };
    } else {
      console.log('[RT:Background] Health check failed:', response.status);
    }
  } catch (err) {
    console.log('[RT:Background] Connection check failed:', err.message);
  }
  
  connectionState.connected = false;
  connectionState.lastChecked = Date.now();
  
  return {
    connected: false,
    agentUrl: connectionState.agentUrl,
    error: 'Agent not reachable'
  };
}

/**
 * Execute command on agent
 */
async function executeCommand(request, id) {
  await ensureSettings();
  if (!connectionState.connected) {
    // Try to reconnect
    const status = await checkConnection();
    if (!status.connected) {
      throw new Error('Agent not connected. Is it running?');
    }
  }
  
  const response = await fetch(`${connectionState.agentUrl}/api/v1/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Token': connectionState.token
    },
    body: JSON.stringify({
      ...request,
      id: id
    })
  });
  
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Authentication failed. Check your token.');
    }
    const error = await response.text();
    throw new Error(`Agent error: ${error}`);
  }
  
  const data = await response.json();
  return { success: true, data };
}

/**
 * Port-forward operations on agent (start / stop / list)
 */
async function portForwardCommand(op, params) {
  await ensureSettings();
  if (!connectionState.connected) {
    const status = await checkConnection();
    if (!status.connected) {
      throw new Error('Agent not connected. Is it running?');
    }
  }

  let url = `${connectionState.agentUrl}/api/v1/portforward`;
  let method = 'GET';
  let body = null;

  if (op === 'start') {
    method = 'POST';
    body = JSON.stringify(params);
  } else if (op === 'stop') {
    method = 'DELETE';
    url += `/${encodeURIComponent(params.id)}`;
  } else if (op !== 'list') {
    throw new Error(`Unknown port-forward op: ${op}`);
  }

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Token': connectionState.token
    },
    body
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Authentication failed. Check your token.');
    }
    let message = `Agent error: HTTP ${response.status}`;
    try {
      const errData = await response.json();
      if (errData?.error?.message) message = errData.error.message;
    } catch {
      // Keep generic message
    }
    throw new Error(message);
  }

  const data = await response.json();
  return { success: true, data };
}

// Periodic connection check (every 30 seconds)
setInterval(() => {
  checkConnection();
}, 30000);

console.log('[RT:Background] Service worker loaded');
