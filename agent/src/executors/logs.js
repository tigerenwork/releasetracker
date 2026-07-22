/**
 * Logs Executor
 * Streams container logs via kubectl logs -f
 */

const { spawn } = require('child_process');
const { logger } = require('../utils/logger');

class LogsExecutor {
  /**
   * Stream container logs
   * Each stdout/stderr data event is passed to emit() as it arrives.
   * Returns { promise, kill } — promise resolves when the stream ends,
   * kill() terminates the kubectl child (used on client disconnect).
   *
   * @param {import('../types').ExecutionRequest} request
   * @param {(chunk: {type: 'stdout'|'stderr', data: string}) => void} emit
   */
  executeStream(request, emit) {
    const { context, id, logs = {} } = request;
    // timeout 0/undefined = no timeout (logs -f is long-lived)
    const timeout = request.timeout || 0;
    const startTime = Date.now();
    const tailLines = logs.tailLines ?? 200;

    let child = null;
    let cancelled = false;

    const promise = (async () => {
      try {
        if (!context.podName) {
          throw new Error('Logs streaming requires context.podName');
        }

        logger.info(`[Logs] Streaming logs: context=${context.kubeContext || 'current'}, namespace=${context.namespace}, pod=${context.podName}, container=${context.containerName || 'default'}, tail=${tailLines}`);

        const kubectlArgs = [
          'logs', '-f',
          `--tail=${tailLines}`,
          ...(context.kubeContext ? ['--context', context.kubeContext] : []),
          '-n', context.namespace,
          context.podName,
          ...(context.containerName ? ['-c', context.containerName] : []),
          ...(logs.timestamps ? ['--timestamps'] : [])
        ];

        return await new Promise((resolve) => {
          child = spawn('kubectl', kubectlArgs);
          let stdout = '';
          let stderr = '';
          let timedOut = false;

          const timeoutId = timeout > 0 ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
          }, timeout * 1000) : null;

          child.stdout.on('data', (data) => {
            const text = data.toString();
            stdout += text;
            emit({ type: 'stdout', data: text });
          });
          child.stderr.on('data', (data) => {
            const text = data.toString();
            stderr += text;
            emit({ type: 'stderr', data: text });
          });

          child.on('close', (rawExitCode) => {
            clearTimeout(timeoutId);
            const exitCode = timedOut ? 124 : (rawExitCode || 0);

            resolve({
              success: !timedOut && !cancelled && exitCode === 0,
              executionId: id,
              type: 'logs',
              exitCode,
              duration: Date.now() - startTime,
              timestamp: new Date().toISOString(),
              error: (timedOut || cancelled || exitCode !== 0) ? {
                code: timedOut ? 'TIMEOUT' : cancelled ? 'CANCELLED' : 'LOGS_ERROR',
                message: timedOut
                  ? `Log stream timed out after ${timeout}s`
                  : cancelled
                    ? 'Log stream cancelled'
                    : (stderr || 'kubectl logs failed'),
                details: { exitCode }
              } : undefined
            });
          });

          child.on('error', (err) => {
            clearTimeout(timeoutId);
            resolve({
              success: false,
              executionId: id,
              type: 'logs',
              duration: Date.now() - startTime,
              timestamp: new Date().toISOString(),
              error: {
                code: 'EXECUTION_FAILED',
                message: err.message,
                details: err.stack
              }
            });
          });
        });
      } catch (err) {
        logger.error('[Logs] Stream failed:', err.message);
        return {
          success: false,
          executionId: id,
          type: 'logs',
          duration: Date.now() - startTime,
          timestamp: new Date().toISOString(),
          error: {
            code: 'EXECUTION_FAILED',
            message: err.message,
            details: err.stack
          }
        };
      }
    })();

    return {
      promise,
      kill: () => {
        cancelled = true;
        if (child) child.kill('SIGTERM');
      }
    };
  }
}

module.exports = { LogsExecutor };
