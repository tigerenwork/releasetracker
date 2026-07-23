#!/usr/bin/env node

/**
 * rt-agent — Release Tracker local execution agent CLI
 *
 * Usage:
 *   rt-agent start       Start the agent in the foreground (default)
 *   rt-agent install     Register autostart (launchd on macOS, systemd user on Linux)
 *   rt-agent uninstall   Remove autostart registration
 *   rt-agent token       Print the auth token (paste into the browser extension)
 *   rt-agent status      Check whether the agent is running
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { execSync, spawn } = require('child_process');
const { loadConfig } = require('../src/config');

const SERVER_PATH = path.join(__dirname, '..', 'server.js');
const pkg = require('../package.json');

const LABEL = 'xyz.releasetracker.agent';
const LOG_DIR = path.join(os.homedir(), '.local', 'state');
const LOG_FILE = path.join(LOG_DIR, 'rt-agent.log');

const command = process.argv[2] || 'start';

switch (command) {
  case 'start':
    require(SERVER_PATH);
    break;

  case 'token': {
    const config = loadConfig();
    if (config.token) {
      console.log(config.token);
    } else {
      console.error('No token configured. Start the agent once to generate one.');
      process.exit(1);
    }
    break;
  }

  case 'status': {
    const config = loadConfig();
    const req = http.get(`http://${config.host}:${config.port}/health`, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          console.log(`Agent is running (v${data.version}, uptime ${Math.round(data.uptime)}s)`);
          if (data.checks && !data.checks.kubectl) {
            console.log('WARNING: kubectl not found on PATH');
          }
        } catch {
          console.log('Agent responded with an unexpected payload');
        }
      });
    });
    req.on('error', () => {
      console.log('Agent is not running');
      process.exitCode = 1;
    });
    req.setTimeout(3000, () => {
      req.destroy();
      console.log('Agent is not running (timeout)');
      process.exitCode = 1;
    });
    break;
  }

  case 'install':
    install();
    break;

  case 'uninstall':
    uninstall();
    break;

  default:
    console.log(`rt-agent v${pkg.version}\n`);
    console.log('Usage: rt-agent [start|install|uninstall|token|status]');
    process.exit(command === 'help' || command === '--help' ? 0 : 1);
}

function install() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const config = loadConfig();

  if (process.platform === 'darwin') {
    const plistDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
    const plistPath = path.join(plistDir, `${LABEL}.plist`);
    fs.mkdirSync(plistDir, { recursive: true });

    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${SERVER_PATH}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_FILE}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_FILE}</string>
</dict>
</plist>
`;
    fs.writeFileSync(plistPath, plist);
    try {
      execSync(`launchctl unload "${plistPath}" 2>/dev/null || true`, { shell: '/bin/sh' });
      execSync(`launchctl load "${plistPath}"`);
      console.log(`Installed and started via launchd: ${plistPath}`);
    } catch (err) {
      console.error(`Wrote ${plistPath} but failed to load it: ${err.message}`);
      process.exit(1);
    }
  } else if (process.platform === 'linux') {
    const unitDir = path.join(os.homedir(), '.config', 'systemd', 'user');
    const unitPath = path.join(unitDir, 'rt-agent.service');
    fs.mkdirSync(unitDir, { recursive: true });

    const unit = `[Unit]
Description=Release Tracker Agent

[Service]
ExecStart=${process.execPath} ${SERVER_PATH}
Restart=always
RestartSec=3
StandardOutput=append:${LOG_FILE}
StandardError=append:${LOG_FILE}

[Install]
WantedBy=default.target
`;
    fs.writeFileSync(unitPath, unit);
    try {
      execSync('systemctl --user daemon-reload');
      execSync('systemctl --user enable --now rt-agent.service');
      console.log(`Installed and started via systemd: ${unitPath}`);
    } catch (err) {
      console.error(`Wrote ${unitPath} but failed to enable it: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.error(`Autostart is not supported on ${process.platform}. Run 'rt-agent start' manually.`);
    process.exit(1);
  }

  console.log(`\nAgent v${pkg.version} listening on http://${config.host}:${config.port}`);
  console.log(`Logs: ${LOG_FILE}`);
  console.log(`\nNext step — paste this token into the browser extension settings:\n`);
  console.log(`  ${config.token}\n`);
}

function uninstall() {
  if (process.platform === 'darwin') {
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
    if (fs.existsSync(plistPath)) {
      try {
        execSync(`launchctl unload "${plistPath}"`);
      } catch {
        // Already unloaded
      }
      fs.unlinkSync(plistPath);
      console.log(`Removed ${plistPath}`);
    } else {
      console.log('Not installed.');
    }
  } else if (process.platform === 'linux') {
    const unitPath = path.join(os.homedir(), '.config', 'systemd', 'user', 'rt-agent.service');
    if (fs.existsSync(unitPath)) {
      try {
        execSync('systemctl --user disable --now rt-agent.service');
      } catch {
        // Already disabled
      }
      fs.unlinkSync(unitPath);
      execSync('systemctl --user daemon-reload');
      console.log(`Removed ${unitPath}`);
    } else {
      console.log('Not installed.');
    }
  } else {
    console.error(`Not supported on ${process.platform}.`);
    process.exit(1);
  }
}
