# Agent Distribution Guide (Phase 2: npm package)

This guide covers how the local execution agent is packaged, published, and installed
on operator workstations. For developing the agent itself, keep using
`cd agent && npm start` from the repo — no packaging needed day to day.

## Overview

| Piece | Mechanism |
|-------|-----------|
| Package | `@tigerenwork/agent` on GitHub Packages (npm registry) |
| Install | `npm i -g @tigerenwork/agent` → `rt-agent` CLI |
| Autostart | `rt-agent install` (launchd on macOS, systemd user on Linux) |
| Auth | Per-user token in `~/.config/rt-agent/config.json` (generated on first run) |
| Updates | `npm update -g @tigerenwork/agent` + version handshake in the UI |
| Logs | `~/.local/state/rt-agent.log` (via launchd/systemd redirection) |

Prerequisites on every operator machine: **Node.js ≥ 18** and **kubectl**
(with kubeconfig contexts for the clusters they operate).

---

## 1. One-time publisher setup

1. The package is scoped `@tigerenwork` (matching the GitHub repo owner, as
   required by GitHub Packages) and `agent/package.json` has
   `publishConfig.registry = https://npm.pkg.github.com`. If the repo ever moves
   to a different owner, update the scope in both `package.json` and this doc.

2. Create a GitHub PAT with `write:packages` scope, and put it in your
   **personal** `~/.npmrc` (never in the repo):

   ```
   //npm.pkg.github.com/:_authToken=ghp_xxxxxxxxxxxx
   ```

## 2. Publishing a release

```bash
cd agent
# bump version
npm version patch   # or minor / major — updates package.json + git tag
npm publish
```

Versioning rule of thumb: bump **minor** when you add capabilities the web app
can use (new execution type, new endpoint), **patch** for fixes. If the web app
*requires* the new capability, also bump `MIN_AGENT_VERSION` in
`src/lib/services/agent-bridge.ts` — users on older agents will then see an
"Outdated" badge instead of a confusing failure.

> CI option: the two commands above are all a GitHub Actions publish job needs
> (`npm publish` with `NODE_AUTH_TOKEN` from a `write:packages` secret).

## 3. Operator setup (what each user does)

```bash
# 1. Point npm at GitHub Packages for the scope (one time).
#    NOTE: ensure ~/.npmrc ends with a newline BEFORE appending, otherwise
#    this line glues onto the previous one and corrupts both.
printf '\n@tigerenwork:registry=https://npm.pkg.github.com\n' >> ~/.npmrc
#    (plus the authToken line if the package is private — see step 1.2)

# 2. Install the agent
npm i -g @tigerenwork/agent

# 3. Register autostart and start it
rt-agent install
```

`rt-agent install` will:

- Register a launchd agent (`~/Library/LaunchAgents/xyz.releasetracker.agent.plist`)
  on macOS, or a systemd user unit (`~/.config/systemd/user/rt-agent.service`) on Linux
- Start the agent immediately and on every login (KeepAlive / Restart=always)
- Generate a per-user auth token (first run) into `~/.config/rt-agent/config.json`
- Print the token — **paste it into the browser extension's settings** (popup → token),
  replacing any old shared token. You can reprint it later with `rt-agent token`.

Useful commands:

```bash
rt-agent status      # is it running? (also warns if kubectl is missing)
rt-agent token       # print the auth token
rt-agent start       # run in the foreground (debugging)
rt-agent uninstall   # remove autostart registration
```

Logs: `~/.local/state/rt-agent.log` (written by launchd/systemd redirection).
When running in the foreground, logs go to the terminal as before.

## 4. Updating

```bash
npm update -g @tigerenwork/agent
```

The autostarted process keeps the old version until restarted:

- macOS: `launchctl kickstart -k gui/$(id -u)/xyz.releasetracker.agent`
- Linux: `systemctl --user restart rt-agent`

The web app checks the agent version on every status poll (`/health` reports the
version from `package.json`). If the agent is older than `MIN_AGENT_VERSION`,
an "Outdated" badge is shown on the agent-test page — no silent breakage.

## 5. Configuration reference

Precedence: environment variable → `~/.config/rt-agent/config.json` → default.

| Setting | Env var | Config key | Default |
|---------|---------|------------|---------|
| Bind host | `AGENT_HOST` | `host` | `127.0.0.1` (never change without a good reason) |
| Port | `AGENT_PORT` | `port` | `3456` |
| Auth token | `AGENT_TOKEN` | `token` | generated on first run |

`/health` (unauthenticated) returns `version`, `uptime`, and `checks.kubectl` —
handy for monitoring and for `rt-agent status`.

## 6. Security notes

- The agent binds to `127.0.0.1` only; it is not reachable from other machines.
- Every request requires the `X-Agent-Token` header; WebSocket shell sessions
  require `?token=`. The token is per-user, generated with 192 bits of
  randomness, stored with `0600` permissions.
- The agent executes `kubectl` with the **operator's own kubeconfig** — access
  is exactly what that user already has, nothing more. Treat the token as
  equivalent to shell access on the workstation: never share it, never commit it.

## 7. Troubleshooting

| Symptom | Check |
|---------|-------|
| Extension says "Agent not reachable" | `rt-agent status`; if not running, `rt-agent start` and read the error |
| `kubectl not found on PATH` | install kubectl; ensure it's on PATH for GUI apps too (launchd: `launchctl setenv PATH ...`) |
| 401 / "Authentication failed" | token mismatch — reprint with `rt-agent token` and update the extension |
| "Pod not found" / wrong cluster | the request's `kubeContext` must match a context in `kubectl config get-contexts` |
| Old version after update | restart the service (see §4) |
