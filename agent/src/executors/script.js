/**
 * Script Executor
 * Executes custom scripts via kubectl exec
 */

const { spawn } = require('child_process');
const { logger } = require('../utils/logger');

class ScriptExecutor {
  /**
   * Execute script
   * @param {import('../types').ExecutionRequest} request
   * @returns {Promise<import('../types').ExecutionResponse>}
   */
  async execute(request) {
    const { script, context, id, timeout = 600 } = request;
    const startTime = Date.now();

    try {
      // 1. Find target pod
      logger.info(`[Script] Finding pod: namespace=${context.namespace}, selector=${context.podSelector}`);
      const podName = await this.findPod(context.namespace, context.podSelector);
      logger.info(`[Script] Found pod: ${podName}`);

      // 2. Prepare command
      const { command, args } = this.buildCommand(script);

      // 3. Build kubectl exec arguments
      const kubectlArgs = [
        'exec',
        '-n', context.namespace,
        podName,
        ...(context.containerName ? ['-c', context.containerName] : []),
        '-i', // Interactive mode for stdin
        '--', command, ...args
      ];

      // 4. Execute with script content via stdin
      logger.info(`[Script] Executing ${script.interpreter} script...`);
      const { stdout, stderr, exitCode } = await this.execKubectlWithStdin(
        kubectlArgs,
        script.content,
        timeout
      );

      const duration = Date.now() - startTime;

      return {
        success: exitCode === 0,
        executionId: id,
        type: 'script',
        exitCode,
        duration,
        timestamp: new Date().toISOString(),
        script: {
          stdout: stdout.slice(0, 10000),
          stderr: stderr.slice(0, 10000),
          exitCode,
          command: `${command} ${args.join(' ')}`
        },
        error: exitCode !== 0 ? {
          code: 'SCRIPT_ERROR',
          message: stderr || 'Script execution failed',
          details: { exitCode }
        } : undefined
      };
    } catch (err) {
      logger.error('[Script] Execution failed:', err.message);
      return {
        success: false,
        executionId: id,
        type: 'script',
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
   * Build command for interpreter
   */
  buildCommand(script) {
    const { interpreter } = script;

    switch (interpreter) {
      case 'bash':
        return { command: 'bash', args: [] };
      case 'python':
        return { command: 'python', args: [] };
      case 'node':
        return { command: 'node', args: [] };
      default:
        throw new Error(`Unsupported interpreter: ${interpreter}`);
    }
  }

  /**
   * Find pod by label selector
   */
  findPod(namespace, selector) {
    return new Promise((resolve, reject) => {
      const kubectl = spawn('kubectl', [
        'get', 'pods',
        '-n', namespace,
        '-l', selector,
        '-o', 'jsonpath={.items[0].metadata.name}'
      ]);

      let stdout = '';
      let stderr = '';

      kubectl.stdout.on('data', (data) => stdout += data.toString());
      kubectl.stderr.on('data', (data) => stderr += data.toString());

      kubectl.on('close', (code) => {
        if (code === 0 && stdout.trim()) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Pod not found: namespace=${namespace}, selector=${selector}, error=${stderr}`));
        }
      });

      kubectl.on('error', (err) => {
        reject(new Error(`Failed to run kubectl: ${err.message}`));
      });
    });
  }

  /**
   * Execute kubectl with script content via stdin
   */
  execKubectlWithStdin(args, stdin, timeoutSeconds) {
    return new Promise((resolve) => {
      const child = spawn('kubectl', args);
      let stdout = '';
      let stderr = '';
      let killed = false;

      // Set timeout
      const timeoutId = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
      }, timeoutSeconds * 1000);

      child.stdout.on('data', (data) => stdout += data.toString());
      child.stderr.on('data', (data) => stderr += data.toString());

      // Send script content via stdin
      child.stdin.write(stdin);
      child.stdin.end();

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

module.exports = { ScriptExecutor };
