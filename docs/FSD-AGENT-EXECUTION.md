# Functional Specification Document
## Local Agent Execution System

### Version: 1.1
### Date: 2026-02-28
### Status: Draft

---

## 1. Overview

### 1.1 Purpose
Enable the Release Tracker web application to execute deployment commands (SQL queries, REST API calls, custom scripts) on local Kubernetes clusters via a Browser Extension Bridge and Local Agent architecture.

### 1.2 Problem Statement
The current Release Tracker is a pure tracking tool - users must manually copy commands and execute them in their terminal. This leads to:
- Context switching between browser and terminal
- Risk of executing wrong commands on wrong customers
- No audit trail of actual command execution
- No centralized view of execution output

### 1.3 Solution Overview
A three-tier architecture that bridges the cloud-deployed web app to local execution environment:

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  Web App        │────►│  Browser         │────►│  Local Agent        │
│  (Vercel)       │     │  Extension       │     │  (Docker Container) │
└─────────────────┘     └──────────────────┘     └─────────────────────┘
     HTTPS                    Chrome API               HTTP/WebSocket
                              (privileged)              localhost:3456
```

### 1.4 Key Features
- **Zero DB Credential Storage**: SQL execution via `kubectl exec` into existing database client pods
- **Zero API Token Storage**: REST calls executed from within cluster pods
- **No Cloud Infrastructure Changes**: Uses existing K8s cluster resources
- **Secure by Default**: Token-based auth, no external ports exposed
- **Progressive Enhancement**: Works without extension (manual copy-paste fallback)

---

## 2. User Stories

### Persona: Release Manager

| ID | User Story |
|----|-----------|
| US-AE-001 | As a release manager, I want to execute SQL migrations via an existing db-client pod so that I don't need to manage DB credentials locally |
| US-AE-002 | As a release manager, I want to trigger REST API calls to internal services from within the cluster so that I don't need to expose APIs externally |
| US-AE-003 | As a release manager, I want to run custom scripts in customer pods so that I can automate complex deployment tasks |
| US-AE-004 | As a release manager, I want to see real-time command output in the web interface so that I can monitor long-running operations |
| US-AE-005 | As a release manager, I want the system to auto-detect if the local agent is available so that I know when execution mode is enabled |
| US-AE-006 | As a release manager, I want to set up the agent once per workstation so that I don't need to configure it repeatedly |
| US-AE-007 | As a release manager, I want execution history with logs stored per step so that I can audit what was run |
| US-AE-008 | As a release manager, I want to cancel a running execution so that I can stop hung commands |
| US-AE-009 | As a release manager, I want automatic retry on connection failures so that transient network issues don't fail my deployment |

### Persona: System Administrator

| ID | User Story |
|----|-----------|
| US-AE-010 | As an admin, I want the agent to run in an isolated Docker container so that I control its access and dependencies |
| US-AE-011 | As an admin, I want to configure which commands are allowed so that I can enforce security policies |
| US-AE-012 | As an admin, I want all executions logged with full command and output so that I can audit for compliance |

---

## 3. Core Concepts

### 3.1 Architecture Components

#### Browser Extension (Chrome/Firefox)
- **Content Script**: Injected into Release Tracker pages, provides `window.rtAgent` API
- **Background Service Worker**: Handles cross-origin requests to localhost, manages authentication
- **Popup UI**: Configuration panel for agent URL and auth token

#### Local Agent (Docker Container)
- **HTTP Server**: Express.js server accepting execution requests
- **Command Executor**: Spawns subprocesses for kubectl/docker commands
- **Stream Handler**: Real-time stdout/stderr streaming via WebSocket/SSE
- **Auth Middleware**: Validates tokens on every request

#### Web App Integration
- **Agent Bridge Service**: Detects extension, manages connection, handles fallbacks
- **Execution UI**: Buttons, terminal output panel, status indicators
- **Execution History**: Stores command output and exit codes per step

### 3.2 Automated Step Types

The system supports three types of automated execution steps, all following the same pattern: Web App → Extension → Agent → kubectl exec → Pod.

| Type | Description | Target Pod | Execution Flow |
|------|-------------|------------|----------------|
| `sql` | Execute SQL queries against customer database | db-client pod | Agent execs into pod, runs SQL client (psql/mysql) |
| `rest` | Execute REST API calls to internal services | api-client pod | Agent execs into pod, runs curl with payload |
| `script` | Execute custom bash/python scripts | app pod or dedicated executor pod | Agent execs into pod, runs script |
| `text` | Manual description step (no automation) | N/A | Display only, reserved for un-automated steps |

### 3.3 Unified Execution Model

All automated step types follow the same execution pattern:

```
Web App (Step Definition)
    ↓ Send execution request
Browser Extension
    ↓ Relay with auth token
Local Agent
    ↓ kubectl exec -n <namespace> <pod-selector>
Target Pod (in K8s cluster)
    ↓ Execute command (sql/curl/script)
Database / API / System
```

### 3.4 SQL Execution Model (Pod-Based)

SQL commands are executed by:

1. Finding the db-client pod in the customer's namespace
2. Executing `kubectl exec` into that pod
3. Running the SQL client (psql, mysql, etc.) inside the pod
4. The pod has existing DB connections via K8s secrets

```
Web App: "Execute SQL: ALTER TABLE..."
    │
    ▼
Agent: "kubectl exec -n customer-a-prod db-client-xxx -- psql $DATABASE_URL -c 'ALTER TABLE...'"
    │
    ▼
Pod (in cluster): psql connects to DB via internal DNS
    │
    ▼
Database: Executes query
```

### 3.5 REST Execution Model (Pod-Based)

REST API calls are executed by:

1. Finding the api-client pod in the customer's namespace
2. Executing `kubectl exec` into that pod
3. Running `curl` with the payload inside the pod
4. The pod has internal cluster network access to services

```
Web App: "POST /api/v1/migrate with payload {...}"
    │
    ▼
Agent: "kubectl exec -n customer-a-prod api-client-xxx -- curl -X POST ..."
    │
    ▼
Pod (in cluster): curl calls internal service via cluster DNS
    │
    ▼
Internal API: Processes request
```

### 3.6 Script Execution Model (Pod-Based)

Custom scripts are executed by:

1. Finding the target pod (app pod or dedicated executor pod)
2. Writing script to temporary file (via stdin or ConfigMap)
3. Executing `kubectl exec` to run the script
4. Capturing output and exit code

```
Web App: "Execute script: ./migrate-data.sh"
    │
    ▼
Agent: "kubectl exec -n customer-a-prod app-pod -- bash -c '...script content...'"
    │
    ▼
Pod (in cluster): Script executes with pod's environment/permissions
    │
    ▼
Result: Output returned to web app
```

---

## 4. Feature Specifications

### 4.1 Extension Installation & Setup

| ID | Feature | Description |
|----|---------|-------------|
| FES-001 | Chrome Web Store | Extension published to Chrome Web Store for easy installation |
| FES-002 | Manual Install | Load unpacked extension for development/internal use |
| FES-003 | Auto-Detection | Web app detects extension presence and shows appropriate UI |
| FES-004 | Token Configuration | User copies token from web app settings, pastes into extension |
| FES-005 | Agent URL Config | Extension configurable to point to different agent URLs (default: localhost:3456) |
| FES-006 | Connection Test | Extension provides "Test Connection" button with status feedback |

### 4.2 Local Agent Management

| ID | Feature | Description |
|----|---------|-------------|
| FLA-001 | Docker Compose | One-command startup: `docker-compose up agent` |
| FLA-002 | Health Endpoint | Agent exposes `/health` for connectivity checks |
| FLA-003 | Token Auth | All endpoints require `X-Agent-Token` header |
| FLA-004 | Command Whitelist | Configurable regex patterns for allowed commands |
| FLA-005 | Execution Timeout | Default 5 min timeout, configurable per command |
| FLA-006 | Concurrent Limits | Max N concurrent executions to prevent resource exhaustion |
| FLA-007 | Log Rotation | Execution logs rotated to prevent disk fill |

### 4.3 Step Type Configuration

#### 4.3.1 SQL Step Configuration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Must be `"sql"` |
| `client` | enum | Yes | SQL client type: `psql`, `mysql`, `mongosh`, `redis-cli` |
| `database` | string | No | Logical database name (env var resolved in pod) |
| `query` | string | Yes | SQL query to execute |
| `useTransaction` | boolean | No | Wrap in transaction for rollback on error |

#### 4.3.2 REST Step Configuration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Must be `"rest"` |
| `method` | enum | Yes | HTTP method: `POST`, `PUT`, `PATCH` |
| `url` | string | Yes | API endpoint path (e.g., `/api/v1/migrate`) |
| `payload` | object | No | JSON payload to send |
| `headers` | object | No | Additional HTTP headers |
| `timeout` | number | No | Request timeout in seconds |

#### 4.3.3 Script Step Configuration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Must be `"script"` |
| `interpreter` | enum | Yes | `bash`, `python`, `node` |
| `content` | string | Yes | Script content to execute |
| `environment` | object | No | Environment variables to set |
| `timeout` | number | No | Script timeout in seconds |

#### 4.3.4 Text Step Configuration (Non-Automated)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Must be `"text"` |
| `content` | string | Yes | Description/instructions for manual step |
| `checklist` | array | No | List of items to verify manually |

### 4.4 Web App Agent Integration

| ID | Feature | Description |
|----|---------|-------------|
| FWA-001 | Connection Indicator | UI shows agent status: Connected / Disconnected / Error |
| FWA-002 | Execute Button | "Execute" button appears on steps when agent is available |
| FWA-003 | Terminal Panel | Slide-out panel showing command output with ANSI color support |
| FWA-004 | Execution Progress | Spinner/progress bar during command execution |
| FWA-005 | Cancel Action | Button to cancel running command (sends SIGTERM) |
| FWA-006 | Output History | Previous executions viewable per step |
| FWA-007 | Error Handling | Clear error messages for common failures (agent offline, auth failed, timeout) |
| FWA-008 | Fallback Mode | When agent unavailable, shows "Copy to Clipboard" button |
| FWA-009 | Step Type Icons | Visual indicators for SQL, REST, Script, Text step types |

### 4.5 Customer Pod Configuration

Each customer needs pod selector configuration for automated execution:

```typescript
interface CustomerExecutionConfig {
  sql?: {
    namespace: string;
    podSelector: string;      // e.g., "app=db-client"
    containerName?: string;   // default: first container
    sqlClient: 'psql' | 'mysql' | 'mongosh' | 'redis-cli';
    connectionEnvVar: string; // e.g., "DATABASE_URL"
  };
  
  rest?: {
    namespace: string;
    podSelector: string;      // e.g., "app=api-client"
    containerName?: string;
    baseUrl?: string;         // e.g., "http://internal-api:8080"
  };
  
  script?: {
    namespace: string;
    podSelector: string;      // e.g., "app=executor" or "app=main-app"
    containerName?: string;
    workingDir?: string;      // e.g., "/app/scripts"
  };
}
```

---

## 5. UI/UX Design

### 5.1 Step Type Indicators

```
┌─────────────────────────────────────────────────────────┐
│  Step 1: Run Migration SQL                      [SQL]  │
│  Customer: customer-a (prod-us/cust-a-prod)             │
│  Status: 🔄 Pending                                      │
│  [🚀 Execute] [📋 Copy]                                 │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  Step 2: Trigger Webhook                        [REST] │
│  Customer: customer-a (prod-us/cust-a-prod)             │
│  POST /api/v1/migrate                                   │
│  Status: ✅ Done                                         │
│  [📋 Copy]                                              │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  Step 3: Run Data Cleanup Script               [SCRIPT] │
│  Customer: customer-a (prod-us/cust-a-prod)             │
│  bash: ./cleanup-old-records.sh                         │
│  Status: 🔄 Pending                                      │
│  [🚀 Execute] [📋 Copy]                                 │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  Step 4: Verify Email Notifications              [TEXT] │
│  Customer: customer-a (prod-us/cust-a-prod)             │
│  Manually verify email queue is processing              │
│  ☐ Queue is empty                                       │
│  ☐ No failed messages                                   │
│  [Mark Done] [Skip]                                     │
└─────────────────────────────────────────────────────────┘
```

### 5.2 Execution Preview Modal

Before executing, show a preview of what will run:

```
┌─────────────────────────────────────────────────────────┐
│  Execute Step: Run Migration SQL              [X]       │
├─────────────────────────────────────────────────────────┤
│  Target: customer-a (cust-a-prod)                       │
│                                                         │
│  EXECUTION DETAILS:                                     │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Type: SQL                                        │   │
│  │ Pod: db-client-7d9f2a (namespace: cust-a-prod) │   │
│  │ Client: psql                                     │   │
│  │                                                  │   │
│  │ Command:                                         │   │
│  │ psql "$DATABASE_URL" -c "ALTER TABLE users     │   │
│  │   ADD COLUMN migration_id VARCHAR(50);"         │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ⚠️ This will modify database schema.                   │
│                                                         │
│  [Cancel]  [🚀 Execute]                                 │
└─────────────────────────────────────────────────────────┘
```

### 5.3 Terminal Output Panel

```
┌─────────────────────────────────────────────────────────┐
│  Execution Output                            [−] [×]   │
├─────────────────────────────────────────────────────────┤
│  $ kubectl exec -n cust-a-prod db-client-7d9f2a -- \   │
│    psql "$DATABASE_URL" -c "ALTER TABLE..."            │
│                                                         │
│  ALTER TABLE                                            │
│  Time: 123.456 ms                                       │
│                                                         │
│  $ echo $?                                              │
│  0                                                      │
│  ─────────────────────────────────────────────────     │
│  ✅ Execution completed successfully (Exit Code: 0)    │
│  Duration: 2.34s | 2024-01-15 10:30:00 UTC             │
└─────────────────────────────────────────────────────────┘
```

---

## 6. Business Rules

### 6.1 Security Rules

| ID | Rule |
|----|------|
| BR-SEC-01 | All agent requests must include valid `X-Agent-Token` header |
| BR-SEC-02 | Tokens are unique per user and expire after 30 days of inactivity |
| BR-SEC-03 | Commands must match whitelist patterns or be explicitly allowed |
| BR-SEC-04 | SQL commands containing DROP or DELETE require explicit confirmation |
| BR-SEC-05 | Agent only accepts connections from localhost (127.0.0.1) |
| BR-SEC-06 | Execution output is stored encrypted in the database |
| BR-SEC-07 | REST calls to external URLs (non-cluster) are blocked by default |
| BR-SEC-08 | Script execution is limited to specific pod selectors |

### 6.2 Execution Rules

| ID | Rule |
|----|------|
| BR-EXE-01 | Only steps with status `pending` or `reverted` can be executed |
| BR-EXE-02 | Executing a step automatically marks it as `in_progress` |
| BR-EXE-03 | Successful execution (exit 0) automatically marks step as `done` |
| BR-EXE-04 | Failed execution preserves status as `pending` with error log |
| BR-EXE-05 | Step cannot be executed if agent is offline or unauthenticated |
| BR-EXE-06 | Concurrent execution of the same step is prevented (optimistic locking) |
| BR-EXE-07 | Execution timeout defaults to 300 seconds, configurable per step type |
| BR-EXE-08 | `text` type steps cannot be executed (manual only) |

### 6.3 SQL Execution Rules

| ID | Rule |
|----|------|
| BR-SQL-01 | SQL execution requires `sql` configuration on customer |
| BR-SQL-02 | Pod must exist and be running before SQL execution |
| BR-SQL-03 | Database connection is always via pod's environment/secret, never direct |
| BR-SQL-04 | Multi-line SQL is wrapped in a transaction if `useTransaction=true` |
| BR-SQL-05 | Large result sets (>1000 rows) are truncated with warning |

### 6.4 REST Execution Rules

| ID | Rule |
|----|------|
| BR-REST-01 | REST execution requires `rest` configuration on customer |
| BR-REST-02 | URL must be relative path (e.g., `/api/v1/migrate`) not full URL |
| BR-REST-03 | Base URL is constructed from pod's environment or customer config |
| BR-REST-04 | Response body is captured up to 1MB limit |
| BR-REST-05 | HTTP error responses (4xx, 5xx) are treated as execution failures |

### 6.5 Script Execution Rules

| ID | Rule |
|----|------|
| BR-SCRIPT-01 | Script execution requires `script` configuration on customer |
| BR-SCRIPT-02 | Script content is passed via stdin, not written to disk |
| BR-SCRIPT-03 | Script timeout defaults to 600 seconds (10 minutes) |
| BR-SCRIPT-04 | Scripts have access to pod's environment variables |
| BR-SCRIPT-05 | Scripts run with pod's service account permissions |

---

## 7. Workflow Scenarios

### 7.1 SQL Migration Execution

```
1. User navigates to release matrix
2. Clicks SQL step for customer-a
3. Step detail panel opens showing SQL content
4. User clicks [🚀 Execute]
5. System shows execution preview:
   - Target pod: db-client-7d9f2a in namespace cust-a-prod
   - Command: psql "$DATABASE_URL" -c "ALTER TABLE..."
6. User confirms
7. Web app sends execute request to extension
8. Extension relays to agent with auth token
9. Agent executes:
   kubectl exec -n cust-a-prod db-client-7d9f2a -- \
     psql "$DATABASE_URL" -c "ALTER TABLE..."
10. Pod executes SQL, returns output
11. Agent returns result to extension
12. Extension relays to web app
13. Web app shows output in terminal panel
14. Step automatically marked as Done (if exit 0)
```

### 7.2 REST API Trigger

```
1. User clicks REST step "Trigger Data Migration"
2. Step detail panel shows:
   - Method: POST
   - URL: /api/v1/migrate
   - Payload: {...}
3. User clicks [🚀 Execute]
4. System shows preview:
   - Target pod: api-client-xxx in namespace cust-a-prod
   - Command: curl -X POST http://internal-api:8080/api/v1/migrate ...
5. User confirms
6. Agent executes curl command in pod
7. Pod makes HTTP request to internal service
8. Response captured and returned
9. Web app shows response body in terminal
```

### 7.3 Custom Script Execution

```
1. User clicks Script step "Cleanup Old Records"
2. Step detail panel shows script content (bash)
3. User clicks [🚀 Execute]
4. System shows preview with full script
5. User confirms
6. Agent executes script via kubectl exec:
   kubectl exec -n cust-a-prod executor-pod -- bash -c '...script...'
7. Script runs with pod's environment
8. Output streamed back to web app
9. Exit code captured for success/failure
```

### 7.4 Manual Text Step

```
1. User clicks Text step "Verify Email Queue"
2. Step detail panel shows description and checklist
3. User manually checks email queue in external tool
4. User returns to web app, clicks [Mark Done]
5. No agent execution - purely tracking
```

---

## 8. Error Handling Matrix

| Scenario | User Message | Action |
|----------|--------------|--------|
| Extension not installed | "Install browser extension to enable execution" | Show install banner |
| Agent offline | "Local agent is offline. Start with: docker-compose up agent" | Show start command |
| Invalid token | "Agent authentication failed. Check token in extension settings." | Link to settings |
| Pod not found | "Target pod not found. Check customer configuration." | Link to customer settings |
| SQL syntax error | "SQL execution failed: [error from database]" | Show full error, allow retry |
| REST timeout | "API call timed out after N seconds" | Offer retry with longer timeout |
| Script timeout | "Script execution timed out" | Show partial output, offer cancel/retry |
| HTTP 4xx/5xx | "API returned error: [status] [body]" | Show response, allow retry |
| Command blocked | "Command not allowed by security policy" | Show whitelist rules |
| Network error | "Network error communicating with agent" | Auto-retry once, then show error |

---

## 9. Q&A / Clarifications

### Q1: Why execute SQL/REST/Script via kubectl exec instead of directly from the agent?

**A:** Several reasons:
- **Security**: No DB credentials or API tokens need to be stored on the local machine
- **Network Access**: The agent may not have VPN/network access to the cluster's internal services
- **Environment Consistency**: Commands run in the same environment as the applications
- **Audit Trail**: Kubernetes audit logs capture all `kubectl exec` commands
- **RBAC**: Pod service accounts have appropriate permissions, not the user's local machine

### Q2: What if the target pod doesn't exist or is not running?

**A:** The agent will:
1. Attempt to find the pod by label selector
2. If no pod found, return error: "Pod with selector 'app=db-client' not found in namespace"
3. If pod exists but not ready, wait up to 30 seconds
4. If still not ready, return error: "Pod exists but is not in Running state"

### Q3: How are long-running SQL queries or scripts handled?

**A:** 
- Default timeout: 300 seconds for SQL/REST, 600 seconds for scripts
- Configurable per-step in the step definition
- User can cancel execution via "Cancel" button (sends SIGTERM to the process)
- Output is streamed in real-time, not buffered

### Q4: Can I execute steps on multiple customers simultaneously?

**A:** Not in the initial implementation. Each step execution is single-customer. Future enhancement could add "Batch Execute" mode that:
- Queues executions for selected customers
- Runs them sequentially (safer) or in parallel (faster)
- Shows combined progress view

### Q5: What happens if the browser/extension crashes during execution?

**A:**
- The kubectl exec process continues running in the cluster
- Web app shows "Connection lost" error
- User can refresh and check execution history
- Agent logs the completion, but web app may miss the final result
- Manual reconciliation may be needed

### Q6: How do I add a new customer for automated execution?

**A:** 
1. Ensure customer has appropriate pods (db-client, api-client, or executor)
2. Go to Customer Settings → Execution Configuration
3. Configure pod selectors for each execution type (sql/rest/script)
4. Save configuration
5. Test with a dry-run execution

### Q7: Can REST calls be made to external APIs (outside the cluster)?

**A:** By default, no. For security, REST calls should be:
- Internal cluster services only (via service DNS)
- If external access needed, configure explicit allowlist in agent
- Consider using an internal proxy/gateway pod instead

### Q8: What script interpreters are supported?

**A:** Initially:
- `bash` (available in most pods)
- `python` (requires python in target pod)
- `node` (requires node in target pod)

The pod must have the interpreter installed. Check via:
```bash
kubectl exec -n <namespace> <pod> -- which bash
```

### Q9: How are script environment variables handled?

**A:**
- Scripts inherit the pod's environment variables
- Additional variables can be passed via `environment` field in step config
- Secrets should be mounted as env vars in the pod, not passed from web app
- No local machine env vars are exposed to the script

### Q10: What's the difference between `text` and other step types?

**A:**
- `sql`, `rest`, `script`: Automated, requires agent, executable
- `text`: Manual, no agent required, not executable

Use `text` for:
- Human verification steps
- External process coordination
- Documentation/instructions
- Steps that can't be automated yet

---

## 10. Data Retention

| Data Type | Retention | Notes |
|-----------|-----------|-------|
| Execution logs | 90 days | Includes command, output, exit code |
| Token history | Until expiry | 30 days from last use |
| Pending executions | Until completion | Or manual cleanup |
| SQL temp files | Immediate delete | After execution completes |
| REST response bodies | 30 days | Truncated to 1MB |

---

## 11. Future Enhancements

| Feature | Description | Priority |
|---------|-------------|----------|
| Multi-agent support | Connect to multiple agents (dev/prod) | Medium |
| Execution scheduling | Queue executions for specific time | Low |
| Parallel execution | Execute on multiple customers simultaneously | Medium |
| Approval workflow | Require approval for destructive commands | Low |
| Execution templates | Predefined parameterized commands | Medium |
| Script library | Store and reuse common scripts | Medium |
| REST response validation | JSON Schema validation for API responses | Low |
| SQL rollback scripts | Auto-generate rollback for migrations | Low |
