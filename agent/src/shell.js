/**
 * Interactive Shell Session Manager
 *
 * Bridges a WebSocket connection to an interactive `kubectl exec -i -t`
 * session inside a specific pod container.
 *
 * Protocol (JSON text frames):
 *   client -> server: { type: 'stdin', data: string }
 *                     { type: 'resize', cols: number, rows: number }  (best effort)
 *   server -> client: { type: 'output', data: string }
 *                     { type: 'exit', code: number }
 *                     { type: 'error', message: string }
 */

const { spawn } = require('child_process');
const { logger } = require('./utils/logger');

// Shells allowed for interactive sessions
const ALLOWED_SHELLS = new Set(['sh', 'bash']);

/**
 * @param {import('ws').WebSocket} socket
 * @param {{kubeContext?: string, namespace: string, pod: string, container?: string,
 *          shell?: string, cols?: number, rows?: number}} params
 */
function handleConnection(socket, params) {
  const {
    kubeContext,
    namespace,
    pod,
    container,
    shell = 'bash',
    cols = 80,
    rows = 24
  } = params;

  if (!namespace || !pod) {
    sendJson(socket, { type: 'error', message: 'Missing required params: namespace, pod' });
    socket.close();
    return;
  }

  if (!ALLOWED_SHELLS.has(shell)) {
    sendJson(socket, { type: 'error', message: `Unsupported shell: ${shell}` });
    socket.close();
    return;
  }

  logger.info(`[Shell] Opening session: context=${kubeContext || 'current'}, namespace=${namespace}, pod=${pod}, container=${container || 'default'}, shell=${shell}`);

  // stty sets the initial terminal size (kubectl exec has no resize channel).
  // Plain interactive shell (NOT a login shell): `bash -l` would read
  // /etc/profile, which typically resets PATH and drops the image's ENV
  // entries (e.g. /opt/venv/bin) — plain `bash` preserves them.
  const initCommand = `stty cols ${cols} rows ${rows} 2>/dev/null; exec ${shell}`;

  // Wrap kubectl in `script` to give it a PTY as stdin — `kubectl exec -t`
  // only allocates a remote TTY when its own stdin is a terminal. The `< <(cat)`
  // shim turns node's socketpair stdin into a real pipe: macOS `script` aborts
  // on tcgetattr(ENOTSOCK) from a socketpair but tolerates a pipe. `script` is
  // the main command so the child exits when the remote shell exits.
  const kubectlArgs = [
    'kubectl',
    'exec', '-i', '-t',
    ...(kubeContext ? ['--context', kubeContext] : []),
    '-n', namespace,
    pod,
    ...(container ? ['-c', container] : []),
    '--', 'sh', '-c', initCommand
  ];

  // detached: own process group so cleanup can kill cat/script/kubectl together
  const child = spawn(
    'bash',
    ['-c', 'script -q /dev/null "$@" < <(cat)', 'bash', ...kubectlArgs],
    { detached: true }
  );
  let closed = false;

  const cleanup = () => {
    if (!closed) {
      closed = true;
      try {
        // Kill the whole process group (sh, cat, script, kubectl)
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    }
  };

  child.stdout.on('data', (data) => {
    sendJson(socket, { type: 'output', data: data.toString() });
  });
  child.stderr.on('data', (data) => {
    sendJson(socket, { type: 'output', data: data.toString() });
  });

  child.on('close', (code) => {
    closed = true;
    logger.info(`[Shell] Session ended: pod=${pod}, exit=${code}`);
    sendJson(socket, { type: 'exit', code: code ?? 0 });
    try {
      socket.close();
    } catch {
      // Socket already closed
    }
  });

  child.on('error', (err) => {
    closed = true;
    sendJson(socket, { type: 'error', message: `Failed to run kubectl: ${err.message}` });
    try {
      socket.close();
    } catch {
      // Socket already closed
    }
  });

  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'stdin' && typeof msg.data === 'string') {
      child.stdin.write(msg.data);
    }
    // resize: no kubectl channel — accepted for protocol compatibility, ignored
  });

  socket.on('close', cleanup);
  socket.on('error', cleanup);
}

function sendJson(socket, obj) {
  try {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(obj));
    }
  } catch {
    // Socket already closed
  }
}

module.exports = { handleConnection };
