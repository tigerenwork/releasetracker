/**
 * Agent Configuration
 *
 * Loads settings from (in order of precedence):
 *   1. Environment variables (AGENT_HOST, AGENT_PORT, AGENT_TOKEN)
 *   2. Config file: ~/.config/rt-agent/config.json
 *   3. Built-in defaults
 *
 * On first run a random per-user token is generated into the config file,
 * so the agent never runs with a publicly-known default token.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const CONFIG_DIR = path.join(os.homedir(), '.config', 'rt-agent');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function saveConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
}

function loadConfig() {
  let fileConfig = {};
  try {
    fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    // Missing or invalid config file — start fresh
  }

  // First run: generate a per-user token and persist it
  if (!fileConfig.token && !process.env.AGENT_TOKEN) {
    fileConfig.token = crypto.randomBytes(24).toString('hex');
    try {
      saveConfig(fileConfig);
    } catch {
      // Read-only home dir: keep the token in memory only
    }
  }

  return {
    host: process.env.AGENT_HOST || fileConfig.host || '127.0.0.1',
    port: parseInt(process.env.AGENT_PORT || fileConfig.port || '3456', 10),
    token: process.env.AGENT_TOKEN || fileConfig.token || null,
  };
}

module.exports = { loadConfig, saveConfig, CONFIG_DIR, CONFIG_FILE };
