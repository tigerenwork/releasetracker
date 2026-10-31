/**
 * Popup UI Script
 *
 * Handles the extension popup interface for configuring
 * the agent connection and Jenkins credentials (stored on the agent).
 */

document.addEventListener('DOMContentLoaded', async () => {
  const header = document.getElementById('header');
  const statusEl = document.getElementById('status');
  const agentUrlDisplay = document.getElementById('agentUrlDisplay');
  const agentUrlInput = document.getElementById('agentUrl');
  const tokenInput = document.getElementById('token');
  const saveBtn = document.getElementById('saveBtn');
  const testBtn = document.getElementById('testBtn');
  const messageEl = document.getElementById('message');

  const jenkinsStatusEl = document.getElementById('jenkinsStatus');
  const jenkinsBaseUrlInput = document.getElementById('jenkinsBaseUrl');
  const jenkinsUsernameInput = document.getElementById('jenkinsUsername');
  const jenkinsApiTokenInput = document.getElementById('jenkinsApiToken');
  const jenkinsSaveBtn = document.getElementById('jenkinsSaveBtn');
  const jenkinsTestBtn = document.getElementById('jenkinsTestBtn');
  const jenkinsMessageEl = document.getElementById('jenkinsMessage');

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

  function showMessage(el, text, type) {
    el.textContent = text;
    el.className = type;
    el.classList.remove('hidden');

    setTimeout(() => {
      el.classList.add('hidden');
    }, 4000);
  }

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

  async function loadJenkinsSettings() {
    jenkinsStatusEl.textContent = 'Loading…';
    jenkinsStatusEl.className = 'status-value';
    try {
      const result = await chrome.runtime.sendMessage({ action: 'jenkinsSettingsGet' });
      if (!result.success) {
        throw new Error(result.error || 'Failed to load Jenkins settings');
      }
      const s = result.data || {};
      jenkinsBaseUrlInput.value = s.baseUrl || '';
      jenkinsUsernameInput.value = s.username || '';
      jenkinsApiTokenInput.value = '';
      jenkinsApiTokenInput.placeholder = s.hasApiToken
        ? '••••••••  (leave blank to keep current token)'
        : 'Jenkins API token';
      if (s.configured) {
        jenkinsStatusEl.textContent = 'Configured';
        jenkinsStatusEl.className = 'status-value connected';
      } else {
        jenkinsStatusEl.textContent = 'Not configured';
        jenkinsStatusEl.className = 'status-value disconnected';
      }
    } catch (err) {
      jenkinsStatusEl.textContent = err.message || 'Unavailable';
      jenkinsStatusEl.className = 'status-value disconnected';
    }
  }

  saveBtn.addEventListener('click', async () => {
    const agentUrl = agentUrlInput.value.trim();
    const token = tokenInput.value.trim();

    if (!agentUrl) {
      showMessage(messageEl, 'Please enter agent URL', 'error');
      return;
    }

    if (!token) {
      showMessage(messageEl, 'Please enter auth token', 'error');
      return;
    }

    try {
      await chrome.runtime.sendMessage({
        action: 'updateSettings',
        agentUrl: agentUrl,
        token: token
      });

      await chrome.storage.local.set({ agentUrl, token });

      showMessage(messageEl, 'Settings saved!', 'success');
      agentUrlDisplay.textContent = agentUrl;

      await checkStatus();
      await loadJenkinsSettings();
    } catch (err) {
      showMessage(messageEl, 'Failed to save: ' + err.message, 'error');
    }
  });

  testBtn.addEventListener('click', async () => {
    statusEl.textContent = 'Testing...';
    testBtn.disabled = true;

    try {
      const status = await checkStatus();
      if (status.connected) {
        showMessage(messageEl, `Connected! Agent v${status.version}`, 'success');
        await loadJenkinsSettings();
      } else {
        showMessage(messageEl, status.error || 'Connection failed', 'error');
      }
    } catch (err) {
      showMessage(messageEl, err.message, 'error');
    } finally {
      testBtn.disabled = false;
    }
  });

  jenkinsSaveBtn.addEventListener('click', async () => {
    const baseUrl = jenkinsBaseUrlInput.value.trim();
    const username = jenkinsUsernameInput.value.trim();
    const apiToken = jenkinsApiTokenInput.value.trim();

    if (!baseUrl) {
      showMessage(jenkinsMessageEl, 'Please enter Jenkins base URL', 'error');
      return;
    }

    jenkinsSaveBtn.disabled = true;
    try {
      const result = await chrome.runtime.sendMessage({
        action: 'jenkinsSettingsPut',
        settings: {
          baseUrl,
          username,
          // Only send token when the user typed one — agent keeps existing otherwise
          ...(apiToken ? { apiToken } : {}),
        },
      });
      if (!result.success) {
        throw new Error(result.error || 'Save failed');
      }
      jenkinsApiTokenInput.value = '';
      showMessage(jenkinsMessageEl, 'Jenkins settings saved on agent', 'success');
      await loadJenkinsSettings();
    } catch (err) {
      showMessage(jenkinsMessageEl, err.message || 'Save failed', 'error');
    } finally {
      jenkinsSaveBtn.disabled = false;
    }
  });

  jenkinsTestBtn.addEventListener('click', async () => {
    jenkinsTestBtn.disabled = true;
    try {
      const result = await chrome.runtime.sendMessage({ action: 'jenkinsSettingsTest' });
      if (!result.success) {
        throw new Error(result.error || 'Test failed');
      }
      const data = result.data || {};
      const suffix = data.version ? ` (Jenkins ${data.version})` : '';
      showMessage(jenkinsMessageEl, `Connected${suffix}`, 'success');
      jenkinsStatusEl.textContent = 'Configured';
      jenkinsStatusEl.className = 'status-value connected';
    } catch (err) {
      showMessage(jenkinsMessageEl, err.message || 'Test failed', 'error');
    } finally {
      jenkinsTestBtn.disabled = false;
    }
  });

  await loadSettings();
  const status = await checkStatus();
  if (status.connected) {
    await loadJenkinsSettings();
  } else {
    jenkinsStatusEl.textContent = 'Agent offline';
    jenkinsStatusEl.className = 'status-value disconnected';
  }
});
