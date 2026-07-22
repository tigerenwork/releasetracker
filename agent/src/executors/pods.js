/**
 * Pods Executor
 * Fetches pod status via kubectl get pods
 */

const { spawn } = require('child_process');
const { logger } = require('../utils/logger');

class PodsExecutor {
  /**
   * List pods with status details
   * @param {import('../types').ExecutionRequest} request
   * @returns {Promise<import('../types').ExecutionResponse>}
   */
  async execute(request) {
    const { context, id, timeout = 30 } = request;
    const startTime = Date.now();

    try {
      logger.info(`[Pods] Listing pods: context=${context.kubeContext || 'current'}, namespace=${context.namespace}, selector=${context.podSelector || '(all)'}`);

      const args = [
        'get', 'pods',
        ...(context.kubeContext ? ['--context', context.kubeContext] : []),
        '-n', context.namespace,
        ...(context.podSelector ? ['-l', context.podSelector] : []),
        '-o', 'json'
      ];

      const { stdout, stderr, exitCode } = await this.execKubectl(args, timeout);

      if (exitCode !== 0) {
        throw new Error(stderr || 'kubectl get pods failed');
      }

      const data = JSON.parse(stdout);
      const pods = (data.items || []).map((pod) => this.parsePod(pod));

      logger.info(`[Pods] Found ${pods.length} pods`);

      return {
        success: true,
        executionId: id,
        type: 'pods',
        exitCode: 0,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        pods: {
          count: pods.length,
          items: pods
        }
      };
    } catch (err) {
      logger.error('[Pods] Execution failed:', err.message);
      return {
        success: false,
        executionId: id,
        type: 'pods',
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        error: {
          code: 'EXECUTION_FAILED',
          message: err.message,
          details: err.stack
        }
      };
    }
  }

  /**
   * Extract status details from a pod object
   */
  parsePod(pod) {
    const containerStatuses = pod.status?.containerStatuses || [];
    const readyCount = containerStatuses.filter((c) => c.ready).length;
    const restarts = containerStatuses.reduce((sum, c) => sum + (c.restartCount || 0), 0);

    // Display status: surface waiting/terminated reasons (e.g. CrashLoopBackOff)
    let status = pod.status?.phase || 'Unknown';
    for (const c of containerStatuses) {
      if (c.state?.waiting?.reason) { status = c.state.waiting.reason; break; }
      if (c.state?.terminated?.reason) { status = c.state.terminated.reason; break; }
    }
    if (pod.metadata?.deletionTimestamp) status = 'Terminating';

    // Last restart: latest container start time when restarts occurred
    let lastRestartAt = null;
    if (restarts > 0) {
      for (const c of containerStatuses) {
        const started = c.state?.running?.startedAt;
        if (started && (!lastRestartAt || started > lastRestartAt)) {
          lastRestartAt = started;
        }
      }
    }

    // Per-container status details
    const containers = containerStatuses.map((c) => ({
      name: c.name,
      ready: !!c.ready,
      restartCount: c.restartCount || 0,
      state: c.state?.running
        ? 'Running'
        : c.state?.waiting?.reason || c.state?.terminated?.reason || 'Unknown',
      startedAt: c.state?.running?.startedAt || null,
      lastTerminatedAt: c.lastState?.terminated?.finishedAt || null,
      lastTerminatedReason: c.lastState?.terminated?.reason || null
    }));

    return {
      name: pod.metadata?.name,
      status,
      ready: `${readyCount}/${containerStatuses.length}`,
      restarts,
      lastRestartAt,
      createdAt: pod.metadata?.creationTimestamp,
      node: pod.spec?.nodeName,
      ip: pod.status?.podIP,
      containers
    };
  }

  /**
   * Execute kubectl command with timeout
   */
  execKubectl(args, timeoutSeconds) {
    return new Promise((resolve) => {
      const child = spawn('kubectl', args);
      let stdout = '';
      let stderr = '';
      let killed = false;

      const timeoutId = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
      }, timeoutSeconds * 1000);

      child.stdout.on('data', (data) => stdout += data.toString());
      child.stderr.on('data', (data) => stderr += data.toString());

      child.on('close', (exitCode) => {
        clearTimeout(timeoutId);

        if (killed) {
          resolve({
            stdout,
            stderr: stderr + '\n[Execution timed out after ' + timeoutSeconds + 's]',
            exitCode: 124
          });
        } else {
          resolve({ stdout, stderr, exitCode: exitCode || 0 });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeoutId);
        resolve({
          stdout,
          stderr: stderr + '\n[Process error: ' + err.message + ']',
          exitCode: 1
        });
      });
    });
  }
}

module.exports = { PodsExecutor };
