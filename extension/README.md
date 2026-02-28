# Release Tracker Agent Bridge (Extension)

Browser extension that bridges the Release Tracker web app to the local agent.

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Extension configuration (Manifest V3) |
| `injected.js` | Injected into page context, provides `window.rtAgent` API |
| `content.js` | Content script, bridges page ↔ extension |
| `background.js` | Service worker, handles HTTP to agent |
| `popup.html/js` | Extension popup UI for settings |
| `icons/` | Extension icons |

## Installation

### Development (Unpacked)

1. Open Chrome → `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right)
3. Click "Load unpacked"
4. Select this `extension/` folder
5. Extension icon appears in toolbar

### Configuration

1. Click extension icon in toolbar
2. Enter Agent URL (default: `http://localhost:3456`)
3. Enter Auth Token (default: `poc-token-123`)
4. Click "Save Settings"
5. Click "Test Connection" to verify

## Architecture

```
Web Page (your-app.vercel.app)
    ↓ postMessage
Injected Script (window.rtAgent)
    ↓ window.postMessage
Content Script (content.js)
    ↓ chrome.runtime.sendMessage
Background Script (background.js)
    ↓ fetch()
Local Agent (localhost:3456)
```

## API Usage (from Web App)

```javascript
// Check if extension is available
if (window.rtAgent?.isAvailable?.()) {
  console.log('Extension installed!');
}

// Execute command
const result = await window.rtAgent.execute({
  type: 'bash',
  command: 'echo hello',
  context: { customerId: 1 },
  timeout: 30000
});

// Check agent status
const status = await window.rtAgent.getStatus();
// { connected: true, version: 'poc-1.0' }
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Extension not detected | Refresh page, check DevTools console |
| "Agent not connected" | Start agent: `cd agent && node server.js` |
| "Invalid token" | Match token in extension with AGENT_TOKEN env var |
| CORS errors | Extension should bypass CORS, reload extension |
