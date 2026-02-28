# Proof of Concept: Browser Extension Agent Bridge

A minimal implementation to prove the web app → browser extension → local agent communication chain works.

---

## Architecture (Minimal)

```
┌──────────────────┐     postMessage      ┌──────────────────┐     fetch()      ┌──────────────────┐
│   Web App        │◄────────────────────►│  Browser         │◄───────────────►│  Local Agent     │
│   (Vercel)       │                      │  Extension       │   HTTP POST     │  (localhost:3456)│
│                  │                      │                  │                 │                  │
│  Send command    │                      │  Relay message   │                 │  Execute echo    │
│  Receive result  │                      │  Add auth token  │                 │  Return output   │
└──────────────────┘                      └──────────────────┘                 └──────────────────┘
```

---

## Components

### 1. Local Agent (Node.js)

**File:** `poc/agent/server.js`

```javascript
const http = require('http');

const PORT = 3456;
const TOKEN = process.env.AGENT_TOKEN || 'poc-token-123';

const server = http.createServer((req, res) => {
  // Enable CORS for extension
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Agent-Token');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', version: 'poc-1.0' }));
    return;
  }
  
  if (req.url === '/execute' && req.method === 'POST') {
    // Check token
    const authHeader = req.headers['x-agent-token'];
    if (authHeader !== TOKEN) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid token' }));
      return;
    }
    
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        console.log('[AGENT] Received:', data);
        
        // Simulate execution
        const result = {
          success: true,
          message: `Executed: ${data.command}`,
          timestamp: new Date().toISOString(),
          yourData: data
        };
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }
  
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`[AGENT] Running on http://localhost:${PORT}`);
  console.log(`[AGENT] Token: ${TOKEN}`);
});
```

**Run:**
```bash
cd poc/agent
node server.js
```

---

### 2. Browser Extension

**File:** `poc/extension/manifest.json`

```json
{
  "manifest_version": 3,
  "name": "POC Agent Bridge",
  "version": "1.0.0",
  "permissions": ["storage", "activeTab"],
  "host_permissions": ["http://localhost:3456/*"],
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["injected.js", "content.js"],
      "run_at": "document_start"
    }
  ],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html"
  }
}
```

**File:** `poc/extension/injected.js` (runs in page context)

```javascript
(function() {
  if (window.pocAgent) return;
  
  window.pocAgent = {
    isAvailable: () => document.querySelector('meta[name="poc-extension"]') !== null,
    
    async execute(command) {
      return new Promise((resolve, reject) => {
        const id = Math.random().toString(36).slice(2);
        const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);
        
        const handler = (e) => {
          if (e.data?.type === 'POC_RESULT' && e.data.id === id) {
            clearTimeout(timeout);
            window.removeEventListener('message', handler);
            e.data.success ? resolve(e.data.result) : reject(new Error(e.data.error));
          }
        };
        
        window.addEventListener('message', handler);
        window.postMessage({ type: 'POC_EXECUTE', id, command }, '*');
      });
    },
    
    async ping() {
      const result = await this.execute('ping');
      return result;
    }
  };
  
  // Signal presence
  const meta = document.createElement('meta');
  meta.name = 'poc-extension';
  meta.content = '1.0';
  document.head.appendChild(meta);
  
  console.log('[POC] Extension API injected');
})();
```

**File:** `poc/extension/content.js` (content script)

```javascript
// Relay messages from page to background
window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  if (!event.data?.type?.startsWith('POC_')) return;
  
  if (event.data.type === 'POC_EXECUTE') {
    try {
      const result = await chrome.runtime.sendMessage({
        action: 'execute',
        command: event.data.command,
        id: event.data.id
      });
      
      window.postMessage({
        type: 'POC_RESULT',
        id: event.data.id,
        success: result.success,
        result: result.data,
        error: result.error
      }, '*');
    } catch (err) {
      window.postMessage({
        type: 'POC_RESULT',
        id: event.data.id,
        success: false,
        error: err.message
      }, '*');
    }
  }
});
```

**File:** `poc/extension/background.js` (service worker)

```javascript
const AGENT_URL = 'http://localhost:3456';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleRequest(request).then(sendResponse).catch(err => {
    sendResponse({ success: false, error: err.message });
  });
  return true;
});

async function handleRequest(request) {
  const { token } = await chrome.storage.local.get(['token']);
  
  if (request.action === 'execute') {
    const response = await fetch(`${AGENT_URL}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agent-Token': token || 'poc-token-123'
      },
      body: JSON.stringify({
        command: request.command,
        id: request.id,
        timestamp: Date.now()
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Agent error: ${error}`);
    }
    
    const data = await response.json();
    return { success: true, data };
  }
  
  if (request.action === 'check') {
    try {
      const response = await fetch(`${AGENT_URL}/health`, {
        signal: AbortSignal.timeout(3000)
      });
      const data = await response.json();
      return { connected: true, data };
    } catch {
      return { connected: false };
    }
  }
}

// Check connection periodically
setInterval(async () => {
  const status = await handleRequest({ action: 'check' });
  console.log('[POC] Agent status:', status);
}, 30000);
```

**File:** `poc/extension/popup.html`

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { width: 200px; padding: 10px; font-family: sans-serif; }
    input { width: 100%; margin: 5px 0; }
    button { width: 100%; margin-top: 10px; }
    #status { margin-top: 10px; font-size: 12px; }
  </style>
</head>
<body>
  <h3>POC Agent Bridge</h3>
  <label>Token:</label>
  <input type="text" id="token" placeholder="poc-token-123">
  <button id="save">Save</button>
  <button id="test">Test Connection</button>
  <div id="status"></div>
  <script src="popup.js"></script>
</body>
</html>
```

**File:** `poc/extension/popup.js`

```javascript
document.addEventListener('DOMContentLoaded', async () => {
  const tokenInput = document.getElementById('token');
  const statusDiv = document.getElementById('status');
  
  // Load saved token
  const saved = await chrome.storage.local.get(['token']);
  tokenInput.value = saved.token || '';
  
  // Save token
  document.getElementById('save').addEventListener('click', async () => {
    await chrome.storage.local.set({ token: tokenInput.value });
    statusDiv.textContent = 'Saved!';
  });
  
  // Test connection
  document.getElementById('test').addEventListener('click', async () => {
    statusDiv.textContent = 'Testing...';
    const result = await chrome.runtime.sendMessage({ action: 'check' });
    statusDiv.textContent = result.connected 
      ? `✅ Connected: ${result.data.version}`
      : '❌ Not connected';
  });
});
```

**Load Extension:**
1. Open Chrome → `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `poc/extension` folder

---

### 3. Web App Test Page

**File:** `poc/web-test/page.tsx` (add to your Next.js app)

```tsx
'use client';

import { useState, useEffect } from 'react';

export default function PocTestPage() {
  const [status, setStatus] = useState<string>('Checking...');
  const [result, setResult] = useState<any>(null);
  const [command, setCommand] = useState('hello from web');
  
  useEffect(() => {
    checkExtension();
  }, []);
  
  const checkExtension = () => {
    const available = typeof window !== 'undefined' && window.pocAgent?.isAvailable?.();
    setStatus(available ? '✅ Extension installed' : '❌ Extension not found');
  };
  
  const handleExecute = async () => {
    if (!window.pocAgent) {
      alert('Extension not available');
      return;
    }
    
    try {
      setResult({ loading: true });
      const response = await window.pocAgent.execute(command);
      setResult(response);
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  };
  
  const handlePing = async () => {
    try {
      const response = await window.pocAgent.ping();
      alert(`Pong! Agent says: ${JSON.stringify(response)}`);
    } catch (err) {
      alert(`Ping failed: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  };
  
  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">POC: Agent Bridge</h1>
      
      <div className="mb-6 p-4 bg-gray-100 rounded">
        <p className="font-medium">Extension Status: {status}</p>
        <button 
          onClick={checkExtension}
          className="mt-2 px-4 py-2 bg-blue-500 text-white rounded"
        >
          Refresh
        </button>
      </div>
      
      <div className="mb-6">
        <h2 className="font-semibold mb-2">Test 1: Simple Ping</h2>
        <button 
          onClick={handlePing}
          className="px-4 py-2 bg-green-500 text-white rounded"
        >
          Ping Agent
        </button>
      </div>
      
      <div className="mb-6">
        <h2 className="font-semibold mb-2">Test 2: Execute Command</h2>
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          className="w-full p-2 border rounded mb-2"
        />
        <button 
          onClick={handleExecute}
          className="px-4 py-2 bg-purple-500 text-white rounded"
        >
          Execute via Agent
        </button>
      </div>
      
      {result && (
        <div className="p-4 bg-gray-50 rounded">
          <h3 className="font-semibold mb-2">Result:</h3>
          <pre className="text-sm overflow-auto">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
      
      <div className="mt-8 text-sm text-gray-500">
        <h3 className="font-semibold">Setup:</h3>
        <ol className="list-decimal ml-5 mt-2 space-y-1">
          <li>Start agent: <code>node poc/agent/server.js</code></li>
          <li>Load extension in Chrome (developer mode)</li>
          <li>Configure token in extension popup (default: poc-token-123)</li>
          <li>Refresh this page</li>
        </ol>
      </div>
    </div>
  );
}

// Type declarations
declare global {
  interface Window {
    pocAgent?: {
      isAvailable(): boolean;
      execute(command: string): Promise<any>;
      ping(): Promise<any>;
    };
  }
}
```

---

## Testing the POC

### Step 1: Start the Agent

```bash
cd poc/agent
node server.js

# Output:
# [AGENT] Running on http://localhost:3456
# [AGENT] Token: poc-token-123
```

### Step 2: Load Extension

1. Chrome → `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `poc/extension/` folder
5. Extension icon appears in toolbar

### Step 3: Configure Token

1. Click extension icon
2. Enter token: `poc-token-123`
3. Click "Save"
4. Click "Test Connection"
5. Should show: "✅ Connected: poc-1.0"

### Step 4: Test Web Integration

1. Add the test page to your Next.js app
2. Navigate to `/poc-test` (or wherever you placed it)
3. Page should show: "✅ Extension installed"
4. Click "Ping Agent" → Should show alert with response
5. Enter text, click "Execute via Agent" → Should show result

### Expected Result

```json
{
  "success": true,
  "message": "Executed: hello from web",
  "timestamp": "2026-02-28T14:30:00.000Z",
  "yourData": {
    "command": "hello from web",
    "id": "abc123",
    "timestamp": 1740741000000
  }
}
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Extension not detected | Refresh page, check console for `[POC] Extension API injected` |
| Connection refused | Ensure agent is running on port 3456 |
| 401 Invalid token | Match token in extension popup with AGENT_TOKEN env var |
| CORS error | Extension should bypass CORS, check manifest host_permissions |
| Service Worker inactive | Click extension icon to wake it up |

---

## Next Steps (After POC)

Once the link is proven:

1. **Add streaming** - WebSocket for real-time output
2. **Add command execution** - Actually run kubectl/bash instead of echo
3. **Add SQL support** - kubectl exec into db-client pods
4. **Add authentication** - Proper token generation/management
5. **Add security** - Command whitelist, RBAC

---

## File Structure

```
agent/                          # Local execution agent
├── package.json
├── server.js                   # HTTP server
└── README.md

extension/                      # Browser extension
├── manifest.json               # Extension config
├── injected.js                 # Page API (window.rtAgent)
├── content.js                  # Content script bridge
├── background.js               # Service worker
├── popup.html                  # Settings UI
├── popup.js
├── icons/                      # Extension icons
│   ├── icon16.svg
│   ├── icon48.svg
│   └── icon128.svg
└── README.md

src/app/agent-test/
└── page.tsx                    # Web app test page

docs/
└── POC-AGENT-BRIDGE.md         # This document
```
