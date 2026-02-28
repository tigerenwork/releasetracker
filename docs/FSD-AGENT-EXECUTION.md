# Functional Specification Document
## Local Agent Execution System

### Version: 1.0
### Date: 2026-02-28
### Status: Draft

---

## 1. Overview

### 1.1 Purpose
Enable the Release Tracker web application to execute deployment commands (kubectl, bash scripts, SQL queries) on local Kubernetes clusters via a Browser Extension Bridge and Local Agent architecture.

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
- **No Cloud Infrastructure Changes**: Uses existing K8s cluster resources
- **Secure by Default**: Token-based auth, no external ports exposed
- **Progressive Enhancement**: Works without extension (manual copy-paste fallback)

---

## 2. User Stories

### Persona: Release Manager

| ID | User Story |
|----|-----------|
| US-AE-001 | As a release manager, I want to execute a bash step with a single click so that I don't need to copy-paste into terminal |
| US-AE-002 | As a release manager, I want to execute SQL migrations via an existing db-client pod so that I don't need to manage DB credentials locally |
| US-AE-003 | As a release manager, I want to see real-time command output in the web interface so that I can monitor long-running operations |
| US-AE-004 | As a release manager, I want the system to auto-detect if the local agent is available so that I know when execution mode is enabled |
| US-AE-005 | As a release manager, I want to set up the agent once per workstation so that I don't need to configure it repeatedly |
| US-AE-006 | As a release manager, I want execution history with logs stored per step so that I can audit what was run |
| US-AE-007 | As a release manager, I want to cancel a running execution so that I can stop hung commands |
| US-AE-008 | As a release manager, I want automatic retry on connection failures so that transient network issues don't fail my deployment |

### Persona: System Administrator

| ID | User Story |
|----|-----------|
| US-AE-009 | As an admin, I want the agent to run in an isolated Docker container so that I control its access and dependencies |
| US-AE-010 | As an admin, I want to configure which commands are allowed so that I can enforce security policies |
| US-AE-011 | As an admin, I want all executions logged with full command and output so that I can audit for compliance |

---

## 3. Core Concepts

### 3.1 Architecture Components

#### Browser Extension (Chrome/Firefox)
- **Content Script**: Injected into Release Tracker pages, provides `window.releaseTrackerAgent` API
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

### 3.2 Execution Types

| Type | Target | Example |
|------|--------|---------|
| `kubectl` | K8s cluster | `kubectl apply -f deployment.yaml -n customer-a` |
| `bash` | Local agent | `helm upgrade --install myapp ./chart` |
| `sql` | DB via K8s pod | `kubectl exec -n customer-a db-client -- psql -c "SELECT..."` |
| `docker` | Local Docker | `docker build -t myapp:latest .` |

### 3.3 SQL Execution Model (Pod-Based)

Instead of connecting directly to databases, SQL commands are executed by:

1. Finding the db-client pod in the customer's namespace
2. Executing `kubectl exec` into that pod
3. Running the SQL client (psql, mysql, etc.) inside the pod
4. The pod has existing DB connections via K8s secrets

```
Web App: "Execute SQL migration"
    │
    ▼
Agent: "kubectl exec -n customer-a-prod db-client-xxx -- psql $DATABASE_URL -f /tmp/migration.sql"
    │
    ▼
Pod (in cluster): psql connects to DB via internal DNS
    │
    ▼
Database: Executes migration
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

### 4.3 Web App Agent Integration

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

### 4.4 Step Execution UI

| ID | Feature | Description |
|----|---------|-------------|
| FSE-001 | Pre-execution Preview | Modal showing exact command to be executed for confirmation |
| FSE-002 | Customer Context Display | Shows cluster and namespace context before execution |
| FSE-003 | Dry Run Option | "Dry Run" mode that shows command without executing |
| FSE-004 | Multi-step Execution | "Execute All" for sequential execution of multiple pending steps |
| FSE-005 | Batch Confirmation | Confirm before executing destructive commands (DROP, DELETE) |
| FSE-006 | Execution Metadata | Captures execution time, duration, exit code, executor identity |

### 4.5 SQL Execution Specifics

| ID | Feature | Description |
|----|---------|-------------|
| FSQL-001 | Pod Discovery | Agent automatically finds db-client pod by label selector |
| FSQL-002 | SQL Validation | Basic syntax validation before execution (if client supports it) |
| FSQL-003 | Transaction Safety | Option to wrap SQL in transaction with automatic rollback on error |
| FSQL-004 | Result Display | Tabular display of SELECT query results |
| FSQL-005 | File Upload | Upload .sql files to execute (stored temporarily in agent) |

---

## 5. UI/UX Design

### 5.1 Agent Status Indicator

```
┌─────────────────────────────────────────────────────────────────┐
│  Release: v2.5.0                                    [🟢 Agent]  │
│                                                     Connected   │
└─────────────────────────────────────────────────────────────────┘
```

States:
- 🟢 **Connected**: Agent reachable, authenticated
- 🟡 **Connecting**: Attempting connection
- 🔴 **Disconnected**: Agent unreachable
- ⚪ **Not Installed**: Extension not detected

### 5.2 Step Detail Panel with Execution

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Step: Run Migration SQL                                        [X] Close │
├──────────────────────────────────────────────────────────────────────────┤
│  Customer: customer-a (prod-us/cust-a-prod)                              │
│  Category: Deploy | Type: SQL | Status: 🔄 Pending                       │
├──────────────────────────────────────────────────────────────────────────┤
│  CONTENT:                                                                │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ ALTER TABLE users ADD COLUMN migration_id VARCHAR(50);          │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│  [📋 Copy] [⬇️ Download]                                                 │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ ⚠️ EXECUTION PREVIEW                                            │    │
│  │                                                                 │    │
│  │ Target: kubectl exec -n cust-a-prod db-client-7d9f2 -- psql    │    │
│  │ Command: psql "$DATABASE_URL" -c "ALTER TABLE..."              │    │
│  │                                                                 │    │
│  │ [🚀 Execute]  [🧪 Dry Run]  [❌ Cancel]                         │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  EXECUTION OUTPUT:                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ $ kubectl exec -n cust-a-prod ...                               │    │
│  │ ALTER TABLE                                                     │    │
│  │ Time: 45.234 ms                                                 │    │
│  │ Exit Code: 0                                                    │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  EXECUTION HISTORY:                                                      │
│  • 2024-01-15 10:30:00 - Exit 0 (45ms) - by admin@company.com          │
│  • 2024-01-14 09:15:22 - Exit 1 (timeout) - by admin@company.com       │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 5.3 Terminal Output Panel

```
┌─────────────────────────────────────────────────────────────────┐
│  Terminal Output                                      [−] [×]   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  $ kubectl exec -n customer-a-prod db-client-abc123 -- \        │
│    psql "$DATABASE_URL" -c "ALTER TABLE users ADD COLUMN..."   │
│                                                                 │
│  ALTER TABLE                                                    │
│  Time: 123.456 ms                                               │
│                                                                 │
│  $ echo $?                                                      │
│  0                                                              │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│  ✅ Execution completed successfully (Exit Code: 0)             │
│  Duration: 2.34s | 2024-01-15 10:30:00 UTC                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 5.4 Settings - Agent Configuration

```
┌─────────────────────────────────────────────────────────────────┐
│  Settings                                               [Save]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  LOCAL AGENT CONFIGURATION                                      │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  Agent Status:                                                  │
│  🟢 Connected to localhost:3456                                 │
│                                                                  │
│  Authentication Token:                                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ rt_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx      │    │
│  └─────────────────────────────────────────────────────────┘    │
│  [Regenerate Token] [Copy to Extension]                         │
│                                                                  │
│  Installation:                                                  │
│  [1] Install Browser Extension from Chrome Web Store            │
│  [2] Paste token into extension settings                        │
│  [3] Start local agent: docker-compose up agent                 │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│  COMMAND WHITELIST                                              │
│  Only allow commands matching these patterns:                   │
│  ☑️ kubectl exec.*psql                                          │
│  ☑️ kubectl exec.*mysql                                         │
│  ☑️ kubectl apply.*                                             │
│  ☐ kubectl delete.*                                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
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

### 6.3 SQL Execution Rules

| ID | Rule |
|----|------|
| BR-SQL-01 | SQL execution requires `sqlExecutorPod` configuration on customer |
| BR-SQL-02 | Pod must exist and be running before SQL execution |
| BR-SQL-03 | Database connection is always via pod's environment/secret, never direct |
| BR-SQL-04 | SQL files are cleaned from agent immediately after execution |
| BR-SQL-05 | Large result sets (>1000 rows) are truncated with warning |

---

## 7. Workflow Scenarios

### 7.1 First-Time Setup

```
1. User opens Release Tracker in browser
   └─→ Web app shows "Install Extension" banner

2. User clicks banner, installs from Chrome Web Store
   └─→ Extension adds content script to Release Tracker domain

3. User goes to Settings → Agent Configuration
   └─→ Generates new agent token
   └─→ Copies token to clipboard

4. User opens extension popup, pastes token
   └─→ Extension stores token securely

5. User starts local agent
   └─→ docker-compose up agent
   └─→ Agent loads token from environment

6. Extension auto-detects agent
   └─→ Web app shows "🟢 Agent Connected"
   └─→ Execute buttons appear on steps
```

### 7.2 Execute Kubectl Command

```
1. User clicks step "Deploy App v2.5.0"
   └─→ Step detail panel opens

2. User clicks [🚀 Execute] button
   └─→ Modal shows command preview:
       kubectl apply -f deployment-v2.5.0.yaml -n cust-a-prod

3. User confirms execution
   └─→ Web app sends message to extension
   └─→ Extension POSTs to agent /execute

4. Agent spawns kubectl process
   └─→ Uses user's local kubeconfig (~/.kube/config)
   └─→ Streams stdout/stderr back

5. Web app receives streaming output
   └─→ Terminal panel shows real-time progress

6. Command completes (exit 0)
   └─→ Agent returns final output and exit code
   └─→ Extension relays to web app
   └─→ Step automatically marked as Done
   └─→ Execution log stored in database
```

### 7.3 Execute SQL Migration

```
1. User clicks SQL step "Run Migration"
   └─→ Step detail panel shows SQL content

2. User clicks [🚀 Execute]
   └─→ Web app determines execution context:
       - Customer: customer-a
       - Namespace: cust-a-prod
       - SQL Client: psql

3. Agent receives request
   └─→ Finds db-client pod in cust-a-prod namespace
   └─→ Prepares kubectl exec command:
       kubectl exec -n cust-a-prod db-client-xxx -- \
         psql "$DATABASE_URL" -c "ALTER TABLE..."

4. Pod executes SQL
   └─→ psql connects to DB using pod's DATABASE_URL env var
   └─→ SQL executes within cluster network
   └─→ Output returned via kubectl exec

5. Result displayed in web app
   └─→ Output shows: "ALTER TABLE | Time: 45ms"
   └─→ Step marked as Done

Note: At no point does the agent or browser see actual DB credentials
```

### 7.4 Handling Agent Disconnection

```
1. User initiates long-running execution
   └─→ Command starts streaming output

2. Agent crashes or network drops
   └─→ WebSocket connection closed
   └─→ Extension detects disconnection

3. Web app shows error
   └─→ "Connection to agent lost"
   └─→ Partial output preserved
   └─→ [Retry] button available

4. User restarts agent
   └─→ Extension reconnects automatically

5. User clicks [Retry]
   └─→ Execution resumes from beginning
   └─→ New execution log entry created
```

---

## 8. Error Handling Matrix

| Scenario | User Message | Action |
|----------|--------------|--------|
| Extension not installed | "Install browser extension to enable execution" | Show install banner |
| Agent offline | "Local agent is offline. Start with: docker-compose up agent" | Show start command |
| Invalid token | "Agent authentication failed. Check token in extension settings." | Link to settings |
| Command timeout | "Execution timed out after 5 minutes" | Offer [Continue] or [Cancel] |
| Kubectl not found | "kubectl not found in agent. Ensure kubeconfig is mounted." | Show setup docs |
| Pod not found | "db-client pod not found in namespace customer-a-prod" | Suggest checking configuration |
| Command blocked | "Command not allowed by security policy" | Show whitelist rules |
| Exit code non-zero | "Command failed with exit code 1" | Show full output, offer retry |

---

## 9. Data Retention

| Data Type | Retention | Notes |
|-----------|-----------|-------|
| Execution logs | 90 days | Includes command, output, exit code |
| Token history | Until expiry | 30 days from last use |
| Pending executions | Until completion | Or manual cleanup |
| SQL temp files | Immediate delete | After execution completes |

---

## 10. Future Enhancements

| Feature | Description | Priority |
|---------|-------------|----------|
| Multi-agent support | Connect to multiple agents (dev/prod) | Medium |
| Execution scheduling | Queue executions for specific time | Low |
| Parallel execution | Execute on multiple customers simultaneously | Medium |
| Approval workflow | Require approval for destructive commands | Low |
| Execution templates | Predefined parameterized commands | Medium |
| SSH execution | Execute on remote hosts via SSH | Low |
