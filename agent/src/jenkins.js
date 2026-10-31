/**
 * Jenkins settings + outbound request proxy.
 *
 * Credentials live only in ~/.config/rt-agent/config.json (never on the
 * Release Tracker server). The web app calls /api/v1/jenkins/request with a
 * path/method/body; this module attaches Basic auth and fetches from the
 * operator's machine (e.g. via Netbird).
 */

const { loadConfig, saveConfig, readFileConfig } = require('./config');
const { logger } = require('./utils/logger');

const REQUEST_TIMEOUT_MS = 15000;
const MAX_BODY = 10 * 1024 * 1024;

/** @type {{ baseUrl?: string, username?: string, apiToken?: string } | null} */
let jenkinsCache = null;

function getJenkinsSettings() {
  if (!jenkinsCache) {
    const cfg = loadConfig();
    jenkinsCache = cfg.jenkins || {};
  }
  return jenkinsCache;
}

function publicJenkinsSettings() {
  const j = getJenkinsSettings();
  return {
    configured: !!(j.baseUrl && j.apiToken),
    baseUrl: j.baseUrl || '',
    username: j.username || '',
    hasApiToken: !!j.apiToken,
  };
}

/**
 * Persist Jenkins connection settings. Empty apiToken keeps the existing token.
 * @param {{ baseUrl: string, username?: string, apiToken?: string }} data
 */
function updateJenkinsSettings(data) {
  const baseUrl = (data.baseUrl || '').trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('Jenkins base URL is required');
  }
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('Jenkins base URL is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Jenkins base URL must be http(s)');
  }

  const fileConfig = readFileConfig();
  const prev = fileConfig.jenkins || {};
  const apiToken = (data.apiToken || '').trim() || prev.apiToken || '';
  if (!apiToken) {
    throw new Error('Jenkins API token is required');
  }

  fileConfig.jenkins = {
    baseUrl,
    username: (data.username || '').trim(),
    apiToken,
  };
  saveConfig(fileConfig);
  jenkinsCache = { ...fileConfig.jenkins };
  logger.info(`[Jenkins] Settings saved (baseUrl=${baseUrl}, hasToken=true)`);
  return publicJenkinsSettings();
}

/**
 * Resolve request URL: absolute http(s) URLs pass through; otherwise join baseUrl + path.
 * @param {string} path
 * @param {{ baseUrl: string }} settings
 */
function resolveUrl(path, settings) {
  if (/^https?:\/\//i.test(path)) {
    const target = new URL(path);
    const base = new URL(settings.baseUrl);
    // Only allow absolute URLs on the same origin as the configured Jenkins
    if (target.origin !== base.origin) {
      throw new Error(`Jenkins request blocked: ${target.origin} is not the configured Jenkins host`);
    }
    return target.toString();
  }
  const base = settings.baseUrl.replace(/\/+$/, '');
  const rel = path.startsWith('/') ? path : `/${path}`;
  return `${base}${rel}`;
}

/**
 * @param {{ path: string, method?: string, headers?: Record<string, string>, body?: string, timeoutMs?: number }} req
 */
async function jenkinsRequest(req) {
  const settings = getJenkinsSettings();
  if (!settings.baseUrl || !settings.apiToken) {
    throw new Error(
      'Jenkins is not configured on this agent. Open the browser extension popup and save Jenkins settings.'
    );
  }

  const url = resolveUrl(req.path, settings);
  const method = (req.method || 'GET').toUpperCase();
  const timeoutMs = req.timeoutMs || REQUEST_TIMEOUT_MS;
  const auth = Buffer.from(`${settings.username || ''}:${settings.apiToken}`).toString('base64');

  const headers = {
    Authorization: `Basic ${auth}`,
    ...(req.headers || {}),
  };

  logger.info(`[Jenkins] ${method} ${url}`);

  const res = await fetch(url, {
    method,
    headers,
    body: req.body !== undefined && req.body !== null ? req.body : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });

  const declared = parseInt(res.headers.get('content-length') || '0', 10);
  if (declared > MAX_BODY) {
    throw new Error(`Jenkins response too large (${declared} bytes)`);
  }

  const body = await res.text();
  if (body.length > MAX_BODY) {
    throw new Error(`Jenkins response too large (${body.length} bytes)`);
  }

  // Expose headers the web client needs (Location for build queue, X-Jenkins for version)
  const outHeaders = {};
  const location = res.headers.get('Location') || res.headers.get('location');
  if (location) outHeaders.location = location;
  const xJenkins = res.headers.get('x-jenkins');
  if (xJenkins) outHeaders['x-jenkins'] = xJenkins;

  return {
    status: res.status,
    headers: outHeaders,
    body,
  };
}

async function testJenkinsConnection() {
  const result = await jenkinsRequest({ path: '/api/json', method: 'GET' });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Jenkins request failed: ${result.status}`);
  }
  let nodeName;
  try {
    nodeName = JSON.parse(result.body).nodeName;
  } catch {
    // ignore
  }
  return {
    ok: true,
    nodeName,
    version: result.headers['x-jenkins'] || undefined,
  };
}

module.exports = {
  getJenkinsSettings,
  publicJenkinsSettings,
  updateJenkinsSettings,
  jenkinsRequest,
  testJenkinsConnection,
};
