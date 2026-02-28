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

// Initialize
chrome.runtime.onStartup.addListener(init);
chrome.runtime.onInstalled.addListener(init);

async function init() {
  console.log('[RT:Background] Initializing...');
  
  // Load saved settings
  const saved = await chrome.storage.local.get(['agentUrl', 'token']);
  connectionState.agentUrl = saved.agentUrl || DEFAULT_AGENT_URL;
  connectionState.token = saved.token || 'poc-token-123';
  
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

async function handleMessage(request) {
  console.log('[RT:Background] Received action:', request.action);
  
  switch (request.action) {
    case 'getStatus':
      return await checkConnection();
      
    case 'execute':
      return await executeCommand(request.request, request.id);
      
    case 'updateSettings':
      connectionState.agentUrl = request.agentUrl || connectionState.agentUrl;
      connectionState.token = request.token || connectionState.token;
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
  if (!connectionState.connected) {
    // Try to reconnect
    const status = await checkConnection();
    if (!status.connected) {
      throw new Error('Agent not connected. Is it running?');
    }
  }
  
  const response = await fetch(`${connectionState.agentUrl}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Token': connectionState.token
    },
    body: JSON.stringify({
      id: id,
      type: request.type,
      command: request.command,
      context: request.context || {},
      timeout: request.timeout || 300
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

// Periodic connection check (every 30 seconds)
setInterval(() => {
  checkConnection();
}, 30000);

console.log('[RT:Background] Service worker loaded');
