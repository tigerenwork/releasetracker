# Release Tracker Agent

Local execution agent that receives commands from the browser extension and
executes them via `kubectl` against Kubernetes clusters.

## Quick Start (development)

```bash
cd agent
npm install
npm start
```

On first run a per-user auth token is generated into
`~/.config/rt-agent/config.json`. Print it with:

```bash
./bin/rt-agent.js token    # or: rt-agent token (when installed globally)
```

Paste the token into the browser extension's settings.

## CLI

| Command | Description |
|---------|-------------|
| `rt-agent start` | Start the agent in the foreground |
| `rt-agent install` | Register autostart (launchd / systemd user) and start |
| `rt-agent uninstall` | Remove autostart registration |
| `rt-agent token` | Print the auth token |
| `rt-agent status` | Check whether the agent is running |

## Configuration

Precedence: environment variable → `~/.config/rt-agent/config.json` → default.

| Setting | Env var | Default |
|---------|---------|---------|
| `host` | `AGENT_HOST` | `127.0.0.1` |
| `port` | `AGENT_PORT` | `3456` |
| `token` | `AGENT_TOKEN` | generated on first run |
| — | `LOG_LEVEL` | `info` |

## API

- `GET /health` — status, version, uptime, `checks.kubectl` (no auth)
- `POST /api/v1/execute` — one-shot execution (`sql`, `rest`, `script`, `pods`)
- `POST /api/v1/execute/stream` — NDJSON streaming (`script`, `logs`)
- `GET /ws/shell?...&token=` — WebSocket interactive shell
- `GET /api/v1/portforward` — list active port-forward proxies
- `POST /api/v1/portforward` — start a proxy (`{ kubeContext?, namespace, resource, localPort, remotePort }`)
- `DELETE /api/v1/portforward/:id` — stop a proxy

All endpoints except `/health` require the `X-Agent-Token` header (or `?token=`
for the WebSocket).

## Distribution

See [docs/AGENT-DISTRIBUTION.md](../docs/AGENT-DISTRIBUTION.md) for packaging,
publishing, and operator setup.
