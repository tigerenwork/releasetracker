/**
 * Popup UI Script
 * 
 * Handles the extension popup interface for configuring
 * and testing the agent connection.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM elements
  const header = document.getElementById('header');
  const statusEl = document.getElementById('status');
  const agentUrlDisplay = document.getElementById('agentUrlDisplay');
  const agentUrlInput = document.getElementById('agentUrl');
  const tokenInput = document.getElementById('token');
  const saveBtn = document.getElementById('saveBtn');
  const testBtn = document.getElementById('testBtn');
  const messageEl = document.getElementById('message');
  
  // Load saved settings
  async function loadSettings() {
    const saved = await chrome.storage.local.get(['agentUrl', 'token']);
    
    if (saved.agentUrl) {
      agentUrlInput.value = saved.agentUrl;
    }
    if (saved.token) {
      tokenInput.value = saved.token;
    }
    
    agentUrlDisplay.textContent = saved.agentUrl || 'http://localhost:3456';
  }
  
  // Show message
  function showMessage(text, type) {
    messageEl.textContent = text;
    messageEl.className = type;
    messageEl.classList.remove('hidden');
    
    setTimeout(() => {
      messageEl.classList.add('hidden');
    }, 3000);
  }
  
  // Update status display
  function updateStatus(status) {
    if (status.connected) {
      statusEl.textContent = 'Connected';
      statusEl.className = 'status-value connected';
      header.className = 'connected';
    } else {
      statusEl.textContent = status.error || 'Disconnected';
      statusEl.className = 'status-value disconnected';
      header.className = 'disconnected';
    }
    
    agentUrlDisplay.textContent = status.agentUrl || agentUrlInput.value;
  }
  
  // Check connection status
  async function checkStatus() {
    statusEl.textContent = 'Checking...';
    
    try {
      const status = await chrome.runtime.sendMessage({ action: 'getStatus' });
      updateStatus(status);
      return status;
    } catch (err) {
      updateStatus({ connected: false, error: 'Extension error' });
      return { connected: false };
    }
  }
  
  // Save settings
  saveBtn.addEventListener('click', async () => {
    const agentUrl = agentUrlInput.value.trim();
    const token = tokenInput.value.trim();
    
    if (!agentUrl) {
      showMessage('Please enter agent URL', 'error');
      return;
    }
    
    if (!token) {
      showMessage('Please enter auth token', 'error');
      return;
    }
    
    try {
      await chrome.runtime.sendMessage({
        action: 'updateSettings',
        agentUrl: agentUrl,
        token: token
      });
      
      // Also save to local storage for persistence
      await chrome.storage.local.set({ agentUrl, token });
      
      showMessage('Settings saved!', 'success');
      agentUrlDisplay.textContent = agentUrl;
      
      // Re-check connection with new settings
      await checkStatus();
    } catch (err) {
      showMessage('Failed to save: ' + err.message, 'error');
    }
  });
  
  // Test connection
  testBtn.addEventListener('click', async () => {
    statusEl.textContent = 'Testing...';
    testBtn.disabled = true;
    
    try {
      const status = await checkStatus();
      if (status.connected) {
        showMessage(`Connected! Agent v${status.version}`, 'success');
      } else {
        showMessage(status.error || 'Connection failed', 'error');
      }
    } catch (err) {
      showMessage('Test failed: ' + err.message, 'error');
    } finally {
      testBtn.disabled = false;
    }
  });
  
  // Initialize
  await loadSettings();
  await checkStatus();
});
