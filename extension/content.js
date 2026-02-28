/**
 * Content Script - Runs in ISOLATED world
 * 
 * Bridges communication between the web page (injected script)
 * and the extension background service worker.
 */

console.log('[RT:Content] Content script loaded on:', window.location.href);

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
  }
});

// Notify that content script is ready
console.log('[RT:Content] Ready for messages');
