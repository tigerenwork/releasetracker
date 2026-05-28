/**
 * SQL Executor
 * Executes SQL queries via kubectl exec into database client pods
 */

const { spawn } = require('child_process');
const { logger } = require('../utils/logger');

class SQLExecutor {
  /**
   * Execute SQL query
   * @param {import('../types').ExecutionRequest} request
   * @returns {Promise<import('../types').ExecutionResponse>}
   */
  async execute(request) {
    const { sql, context, id, timeout = 300 } = request;
    const startTime = Date.now();

    try {
      // 1. Find target pod
      logger.info(`[SQL] Finding pod: namespace=${context.namespace}, selector=${context.podSelector}`);
      const podName = await this.findPod(context.namespace, context.podSelector);
      logger.info(`[SQL] Found pod: ${podName}`);

      // 2. Build SQL command
      const sqlCommand = this.buildSQLCommand(sql);
      logger.debug(`[SQL] Command: ${sqlCommand}`);

      // 3. Build kubectl exec arguments
      const kubectlArgs = [
        'exec',
        '-n', context.namespace,
        podName,
        ...(context.containerName ? ['-c', context.containerName] : []),
        '--', 'sh', '-c', sqlCommand
      ];

      // 4. Execute
      logger.info(`[SQL] Executing kubectl exec...`);
      const { stdout, stderr, exitCode } = await this.execKubectl(kubectlArgs, timeout);

      // 5. Parse result
      const rows = exitCode === 0 ? this.parseRows(sql.client, stdout) : undefined;

      const duration = Date.now() - startTime;

      return {
        success: exitCode === 0,
        executionId: id,
        type: 'sql',
        exitCode,
        duration,
        timestamp: new Date().toISOString(),
        sql: {
          stdout: stdout.slice(0, 10000), // Limit output
          stderr: stderr.slice(0, 10000),
          rowCount: rows?.length,
          rows: rows?.slice(0, 1000), // Limit rows
          command: sqlCommand
        },
        error: exitCode !== 0 ? {
          code: 'SQL_ERROR',
          message: stderr || stdout || 'SQL execution failed',
          details: { exitCode }
        } : undefined
      };
    } catch (err) {
      logger.error('[SQL] Execution failed:', err.message);
      return {
        success: false,
        executionId: id,
        type: 'sql',
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
   * Build SQL command for target client
   */
  buildSQLCommand(sql) {
    const { client, database, query, useTransaction } = sql;
    
    // Escape single quotes for shell
    const escapedQuery = query.replace(/'/g, "'\"'\"'");
    
    let command;

    switch (client) {
      case 'psql':
        const dbVar = database ? `\${${database.toUpperCase()}_URL}` : '$DATABASE_URL';
        command = `psql "${dbVar}" -c '${escapedQuery}'`;
        break;

      case 'mysql':
        command = `mysql -e '${escapedQuery}'`;
        break;

      case 'mongosh':
        const mongoVar = database ? `\${${database.toUpperCase()}_URL}` : '$MONGODB_URL';
        command = `mongosh "${mongoVar}" --eval '${escapedQuery}'`;
        break;

      case 'redis-cli':
        command = `redis-cli ${escapedQuery}`;
        break;

      default:
        throw new Error(`Unsupported SQL client: ${client}`);
    }

    // Wrap in transaction wrapper if requested (not for redis)
    if (useTransaction && client !== 'redis-cli') {
      command = `sh -c 'set -e; ${command}'`;
    }

    return command;
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

  /**
   * Parse rows from SQL output (simple parsing for psql)
   */
  parseRows(client, output) {
    if (client !== 'psql') return undefined;

    const lines = output.trim().split('\n');
    if (lines.length < 3) return undefined;

    // Skip header separator (----+----)
    const dataLines = lines.filter(l =>
      !l.match(/^\s*[\+|\-]+\s*$/) && l.trim()
    );

    if (dataLines.length < 2) return undefined;

    // Parse pipe-separated rows
    return dataLines.slice(1).map(line =>
      line.split('|').map(v => v.trim())
    );
  }
}

module.exports = { SQLExecutor };
