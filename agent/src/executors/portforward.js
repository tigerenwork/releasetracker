/**
 * Port-Forward Manager
 * Manages long-running `kubectl port-forward` processes so the web app can
 * connect/disconnect cluster service proxies on demand.
 */

const { spawn } = require('child_process');
const { logger } = require('../utils/logger');

let counter = 0;

function generateId() {
  return `pf-${Date.now()}-${++counter}`;
}

function isValidPort(port) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

class PortForwardManager {
  constructor() {
    /** @type {Map<string, object>} id -> entry */
    this.forwards = new Map();
  }

  /**
   * Start a kubectl port-forward process.
   * @param {object} params
   * @param {string} [params.kubeContext] kubectl context (cluster name); omitted when falsy
   * @param {string} params.namespace
   * @param {string} params.resource e.g. "service/cronicle" or "pod/foo"
   * @param {number} params.localPort
   * @param {number} params.remotePort
   * @returns {object} the new entry (without the child process)
   */
  start({ kubeContext, namespace, resource, localPort, remotePort }) {
    if (!namespace || typeof namespace !== 'string') {
      throw new Error('namespace is required');
    }
    if (!resource || typeof resource !== 'string') {
      throw new Error('resource is required (e.g. service/cronicle)');
    }
    localPort = Number(localPort);
    remotePort = Number(remotePort);
    if (!isValidPort(localPort) || !isValidPort(remotePort)) {
      throw new Error('localPort and remotePort must be integers between 1 and 65535');
    }
    for (const entry of this.forwards.values()) {
      if (entry.localPort === localPort && entry.status !== 'failed') {
        throw new Error(`local port ${localPort} is already used by forward ${entry.id}`);
      }
    }

    const args = [
      'port-forward',
      ...(kubeContext ? ['--context', kubeContext] : []),
      '-n', namespace,
      resource,
      `${localPort}:${remotePort}`
    ];

    const id = generateId();
    logger.info(`[PortForward] Starting: id=${id}, kubectl ${args.join(' ')}`);

    const child = spawn('kubectl', args);

    const entry = {
      id,
      kubeContext: kubeContext || undefined,
      namespace,
      resource,
      localPort,
      remotePort,
      status: 'starting',
      startedAt: new Date().toISOString(),
      error: undefined,
      child
    };
    this.forwards.set(id, entry);

    let stderr = '';
    let stdoutBuffer = '';

    child.stdout.on('data', (data) => {
      stdoutBuffer += data.toString();
      // kubectl prints "Forwarding from 127.0.0.1:3012 -> 3012" once ready
      if (entry.status === 'starting' && stdoutBuffer.includes('Forwarding from')) {
        entry.status = 'ready';
        logger.info(`[PortForward] Ready: id=${id}, localhost:${localPort} -> ${resource}:${remotePort}`);
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const onExit = (detail) => {
      if (!this.forwards.has(id)) return; // already stopped via stop()
      if (entry.status === 'starting') {
        entry.status = 'failed';
        entry.error = (stderr.trim() || detail || 'port-forward failed to start').slice(0, 500);
        entry.child = null;
        logger.error(`[PortForward] Failed: id=${id}, ${entry.error}`);
      } else {
        // Was ready and the process died — the proxy is gone, drop the entry
        this.forwards.delete(id);
        logger.info(`[PortForward] Process exited, removed: id=${id}`);
      }
    };

    child.on('close', (code) => onExit(`kubectl exited with code ${code}`));
    child.on('error', (err) => onExit(err.message));

    return this.toInfo(entry);
  }

  /**
   * Stop a port-forward by id.
   */
  stop(id) {
    const entry = this.forwards.get(id);
    if (!entry) {
      throw new Error(`Port-forward not found: ${id}`);
    }
    if (entry.child) {
      entry.child.kill('SIGTERM');
    }
    this.forwards.delete(id);
    logger.info(`[PortForward] Stopped: id=${id}`);
    return { id, stopped: true };
  }

  /**
   * List all tracked forwards (without child processes).
   */
  list() {
    return [...this.forwards.values()].map((entry) => this.toInfo(entry));
  }

  /**
   * Kill every forward — called on agent shutdown.
   */
  stopAll() {
    for (const entry of this.forwards.values()) {
      if (entry.child) {
        try {
          entry.child.kill('SIGTERM');
        } catch {
          // Already dead
        }
      }
    }
    this.forwards.clear();
  }

  toInfo(entry) {
    const { child, ...info } = entry;
    return info;
  }
}

module.exports = { PortForwardManager };
