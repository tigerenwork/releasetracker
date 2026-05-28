/**
 * Agent Type Definitions
 * @typedef {Object} ExecutionContext
 * @property {number} customerId
 * @property {number} [clusterId]
 * @property {string} namespace
 * @property {string} podSelector
 * @property {string} [containerName]
 * @property {number} stepId
 * @property {number} releaseId
 * 
 * @typedef {Object} SQLExecutionConfig
 * @property {'psql'|'mysql'|'mongosh'|'redis-cli'} client
 * @property {string} [database]
 * @property {string} query
 * @property {boolean} [useTransaction]
 * 
 * @typedef {Object} RESTExecutionConfig
 * @property {'GET'|'POST'|'PUT'|'PATCH'|'DELETE'} method
 * @property {string} url
 * @property {string} [baseUrl]
 * @property {Object} [payload]
 * @property {Object} [headers]
 * @property {boolean} [expectJson]
 * 
 * @typedef {Object} ScriptExecutionConfig
 * @property {'bash'|'python'|'node'} interpreter
 * @property {string} content
 * @property {Object} [environment]
 * @property {string} [workingDir]
 * 
 * @typedef {Object} ExecutionRequest
 * @property {string} id
 * @property {'sql'|'rest'|'script'} type
 * @property {ExecutionContext} context
 * @property {number} [timeout]
 * @property {SQLExecutionConfig} [sql]
 * @property {RESTExecutionConfig} [rest]
 * @property {ScriptExecutionConfig} [script]
 * 
 * @typedef {Object} ExecutionResponse
 * @property {boolean} success
 * @property {string} executionId
 * @property {'sql'|'rest'|'script'} type
 * @property {number} [exitCode]
 * @property {number} duration
 * @property {string} timestamp
 * @property {Object} [sql]
 * @property {Object} [rest]
 * @property {Object} [script]
 * @property {Object} [error]
 */

module.exports = {};
