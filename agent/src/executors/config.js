/**
 * Config Executor
 * Reads and edits ConfigMaps consumed by a Deployment via kubectl
 * (describe / get / apply / rolloutRestart)
 */

const { spawn } = require('child_process');
const { logger } = require('../utils/logger');

// ConfigMap data can be up to 1 MiB; cap serialized payloads at that size
const MAX_DATA_BYTES = 1024 * 1024;
// ConfigMap data key names (same character set as Kubernetes allows)
const KEY_PATTERN = /^[-._a-zA-Z0-9]+$/;

class ConfigExecutor {
  /**
   * Execute a config action
   * @param {import('../types').ExecutionRequest} request
   * @returns {Promise<import('../types').ExecutionResponse>}
   */
  async execute(request) {
    const { config, context, id, timeout = 30 } = request;
    const startTime = Date.now();

    try {
      if (!config || !config.action) {
        throw new Error('Missing config action');
      }

      let result;
      switch (config.action) {
        case 'describe':
          result = await this.describe(config, context, timeout);
          break;
        case 'get':
          result = await this.get(config, context, timeout);
          break;
        case 'apply':
          result = await this.apply(config, context, timeout);
          break;
        case 'rolloutRestart':
          result = await this.rolloutRestart(config, context, timeout);
          break;
        default:
          throw new Error(`Unknown config action: ${config.action}`);
      }

      return {
        success: true,
        executionId: id,
        type: 'config',
        exitCode: 0,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        config: result
      };
    } catch (err) {
      logger.error(`[Config] ${config?.action || 'unknown'} failed:`, err.message);
      return {
        success: false,
        executionId: id,
        type: 'config',
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
   * Describe a Deployment: list the ConfigMaps its pod template consumes
   */
  async describe(config, context, timeout) {
    const { deploymentName } = config;
    if (!deploymentName) {
      throw new Error('deploymentName is required for describe');
    }

    logger.info(`[Config] Describing deployment: context=${context.kubeContext || 'current'}, namespace=${context.namespace}, deployment=${deploymentName}`);

    const args = [
      'get', 'deployment', deploymentName,
      ...(context.kubeContext ? ['--context', context.kubeContext] : []),
      '-n', context.namespace,
      '-o', 'json'
    ];

    const { stdout, stderr, exitCode } = await this.execKubectl(args, timeout);

    if (exitCode !== 0) {
      // A missing Deployment means config edit is not supported for this
      // workload (e.g. not Deployment-managed) — not an execution error
      if (/notfound/i.test(stderr)) {
        logger.info(`[Config] Deployment not found: ${deploymentName}`);
        return { supported: false, unsupportedReason: stderr.trim() };
      }
      throw new Error(stderr || 'kubectl get deployment failed');
    }

    const deployment = JSON.parse(stdout);
    const configMaps = this.extractConfigMaps(deployment);

    logger.info(`[Config] Deployment ${deploymentName} consumes ${configMaps.length} ConfigMaps`);

    return {
      deployment: deployment.metadata?.name || deploymentName,
      supported: true,
      configMaps
    };
  }

  /**
   * Read a ConfigMap's data (data only, no metadata)
   */
  async get(config, context, timeout) {
    const { configMapName } = config;
    if (!configMapName) {
      throw new Error('configMapName is required for get');
    }

    logger.info(`[Config] Reading configmap: context=${context.kubeContext || 'current'}, namespace=${context.namespace}, configmap=${configMapName}`);

    const args = [
      'get', 'configmap', configMapName,
      ...(context.kubeContext ? ['--context', context.kubeContext] : []),
      '-n', context.namespace,
      '-o', 'json'
    ];

    const { stdout, stderr, exitCode } = await this.execKubectl(args, timeout);

    if (exitCode !== 0) {
      throw new Error(stderr || 'kubectl get configmap failed');
    }

    const configMap = JSON.parse(stdout);
    const data = configMap.data || {};

    // Never return partial data — oversized maps come back as truncated only
    if (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_DATA_BYTES) {
      logger.warn(`[Config] ConfigMap ${configMapName} data exceeds 1 MiB, returning truncated flag`);
      return { data: undefined, truncated: true };
    }

    return { data };
  }

  /**
   * Apply a key-level diff to a ConfigMap via JSON merge patch
   * (null values in a merge patch truly delete keys, RFC 7386)
   */
  async apply(config, context, timeout) {
    const { configMapName, patch } = config;
    if (!configMapName) {
      throw new Error('configMapName is required for apply');
    }
    if (!patch || typeof patch !== 'object') {
      throw new Error('patch is required for apply');
    }

    const set = patch.set || {};
    const del = patch.delete || [];

    if (Object.keys(set).length === 0 && del.length === 0) {
      throw new Error('patch is empty: at least one set or delete key is required');
    }

    for (const key of [...Object.keys(set), ...del]) {
      if (!KEY_PATTERN.test(key)) {
        throw new Error(`Invalid config key: ${key}`);
      }
    }
    for (const [key, value] of Object.entries(set)) {
      if (typeof value !== 'string') {
        throw new Error(`Invalid value for key ${key}: must be a string`);
      }
    }

    const mergeData = { ...set };
    for (const key of del) {
      mergeData[key] = null;
    }
    const patchJson = JSON.stringify({ data: mergeData });

    if (Buffer.byteLength(patchJson, 'utf8') > MAX_DATA_BYTES) {
      throw new Error('Patch exceeds 1 MiB limit');
    }

    logger.info(`[Config] Patching configmap: context=${context.kubeContext || 'current'}, namespace=${context.namespace}, configmap=${configMapName}, set=${Object.keys(set).length}, delete=${del.length}`);

    const args = [
      'patch', 'configmap', configMapName,
      ...(context.kubeContext ? ['--context', context.kubeContext] : []),
      '-n', context.namespace,
      '--type=merge',
      '-p', patchJson
    ];

    const { stdout, stderr, exitCode } = await this.execKubectl(args, timeout);

    if (exitCode !== 0) {
      throw new Error(stderr || 'kubectl patch configmap failed');
    }

    return {
      appliedKeys: Object.keys(set).length,
      deletedKeys: del.length,
      output: stdout.slice(0, 2000)
    };
  }

  /**
   * Rollout restart a Deployment (resource kind hardcoded to deployment)
   */
  async rolloutRestart(config, context, timeout) {
    const { deploymentName } = config;
    if (!deploymentName) {
      throw new Error('deploymentName is required for rolloutRestart');
    }

    logger.info(`[Config] Rollout restart: context=${context.kubeContext || 'current'}, namespace=${context.namespace}, deployment=${deploymentName}`);

    const args = [
      'rollout', 'restart', `deployment/${deploymentName}`,
      ...(context.kubeContext ? ['--context', context.kubeContext] : []),
      '-n', context.namespace
    ];

    const { stdout, stderr, exitCode } = await this.execKubectl(args, timeout);

    if (exitCode !== 0) {
      throw new Error(stderr || 'kubectl rollout restart failed');
    }

    return { output: stdout.slice(0, 2000) };
  }

  /**
   * Extract ConfigMap references from a Deployment's pod template,
   * annotated with how each ConfigMap is consumed
   */
  extractConfigMaps(deployment) {
    const refs = new Map(); // name -> Set of consumedAs
    const add = (name, consumedAs) => {
      if (!name) return;
      if (!refs.has(name)) refs.set(name, new Set());
      refs.get(name).add(consumedAs);
    };

    const podSpec = deployment.spec?.template?.spec || {};
    const containers = [...(podSpec.containers || []), ...(podSpec.initContainers || [])];

    for (const container of containers) {
      for (const envFrom of container.envFrom || []) {
        add(envFrom.configMapRef?.name, 'envFrom');
      }
      for (const env of container.env || []) {
        add(env.valueFrom?.configMapKeyRef?.name, 'env');
      }
    }
    for (const volume of podSpec.volumes || []) {
      add(volume.configMap?.name, 'volume');
    }

    return [...refs.entries()].map(([name, consumedAs]) => ({
      name,
      consumedAs: [...consumedAs]
    }));
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

module.exports = { ConfigExecutor };
