/**
 * REST Executor
 * Executes REST API calls via kubectl exec using curl
 */

const { spawn } = require('child_process');
const { logger } = require('../utils/logger');

class RESTExecutor {
  /**
   * Execute REST API call
   * @param {import('../types').ExecutionRequest} request
   * @returns {Promise<import('../types').ExecutionResponse>}
   */
  async execute(request) {
    const { rest, context, id, timeout = 60 } = request;
    const startTime = Date.now();

    try {
      // 1. Find target pod
      logger.info(`[REST] Finding pod: namespace=${context.namespace}, selector=${context.podSelector}`);
      const podName = await this.findPod(context.namespace, context.podSelector);
      logger.info(`[REST] Found pod: ${podName}`);

      // 2. Build curl command
      const curlCommand = this.buildCurlCommand(rest);
      logger.debug(`[REST] Command: ${curlCommand}`);

      // 3. Build kubectl exec arguments
      const kubectlArgs = [
        'exec',
        '-n', context.namespace,
        podName,
        ...(context.containerName ? ['-c', context.containerName] : []),
        '--', 'sh', '-c', curlCommand
      ];

      // 4. Execute
      logger.info(`[REST] Executing kubectl exec...`);
      const { stdout, stderr, exitCode } = await this.execKubectl(kubectlArgs, timeout);

      // 5. Parse HTTP response
      const { statusCode, body } = this.parseHttpResponse(stdout);

      // 6. Parse JSON if expected
      let json;
      if (rest.expectJson) {
        try {
          json = JSON.parse(body);
        } catch {
          // Ignore parse errors
        }
      }

      const duration = Date.now() - startTime;
      const success = exitCode === 0 && statusCode >= 200 && statusCode < 300;

      return {
        success,
        executionId: id,
        type: 'rest',
        exitCode,
        duration,
        timestamp: new Date().toISOString(),
        rest: {
          statusCode,
          headers: {}, // Could parse from -D flag if needed
          body: body.slice(0, 10000), // Limit size
          json,
          latency: duration
        },
        error: !success ? {
          code: statusCode >= 400 ? 'HTTP_ERROR' : 'REQUEST_FAILED',
          message: statusCode >= 400
            ? `HTTP ${statusCode}: ${body.slice(0, 200)}`
            : (stderr || 'Request failed'),
          details: { statusCode, exitCode }
        } : undefined
      };
    } catch (err) {
      logger.error('[REST] Execution failed:', err.message);
      return {
        success: false,
        executionId: id,
        type: 'rest',
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
   * Build curl command
   */
  buildCurlCommand(rest) {
    const { method, url, baseUrl, payload, headers } = rest;

    // Build full URL
    const fullUrl = baseUrl
      ? `${baseUrl.replace(/\/$/, '')}${url}`
      : url;

    const parts = ['curl', '-s', '-w', '\\n%{http_code}', '-X', method];

    // Add headers
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        parts.push('-H', `'${key}: ${value}'`);
      }
    }

    // Add content-type for POST/PUT/PATCH
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      parts.push('-H', 'Content-Type: application/json');
    }

    // Add payload
    if (payload) {
      const json = JSON.stringify(payload).replace(/'/g, "'\"'\"'");
      parts.push('-d', `'${json}'`);
    }

    parts.push(`'${fullUrl}'`);

    return parts.join(' ');
  }

  /**
   * Parse HTTP response from curl output
   * curl -w '\n%{http_code}' outputs body followed by status code on last line
   */
  parseHttpResponse(output) {
    const lines = output.trim().split('\n');
    const statusCode = parseInt(lines[lines.length - 1], 10) || 0;
    const body = lines.slice(0, -1).join('\n');

    return { statusCode, body };
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
   * Execute kubectl command with timeout
   */
  execKubectl(args, timeoutSeconds) {
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

module.exports = { RESTExecutor };
