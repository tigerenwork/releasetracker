# Release Tracker Agent (POC)

Local execution agent that receives commands from the browser extension and executes them.

## Quick Start

```bash
# Using default token
cd agent
npm start

# With custom token
AGENT_TOKEN=my-secret-token npm start

# With custom port
AGENT_PORT=8080 npm start
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_PORT` | `3456` | HTTP server port |
| `AGENT_TOKEN` | `poc-token-123` | Authentication token |
| `LOG_LEVEL` | `info` | Logging level (error, warn, info, debug) |

## API Endpoints

### Health Check
```bash
curl http://127.0.0.1:3456/health
```

### Execute Command
```bash
curl -X POST http://127.0.0.1:3456/execute \
  -H "Content-Type: application/json" \
  -H "X-Agent-Token: poc-token-123" \
  -d '{
    "id": "exec-123",
    "type": "bash",
    "command": "echo hello",
    "context": {"customerId": 1}
  }'
```

## Docker (Optional)

```bash
# Build image
docker build -t release-tracker-agent .

# Run container
docker run -p 3456:3456 -e AGENT_TOKEN=my-token release-tracker-agent
```
