# Technical Evaluation & Design Document
## Pod Deploy Config Edit (ConfigMap view/edit from the UI)
### Version: 0.2
### Date: 2026-07-30
### Status: Draft

---

## 1. Overview

### 1.1 Problem Statement

ReleaseTracker can observe and act on pods (list, logs, exec, shell, restart, port-forward) but
cannot edit a workload's deploy configuration. Editing a ConfigMap — a high-frequency ops task,
and the primary source of env variables in the current deploys — still requires dropping to a
terminal and running `kubectl edit configmap` / `kubectl patch` by hand, even though the app
already knows the cluster (kube context), the namespace, and the pod.

### 1.2 Goal

From the Pods UI, let a user:

1. Discover which ConfigMaps a pod's Deployment consumes.
2. View a ConfigMap's data.
3. Edit keys (add / change / delete) and save, applied to the cluster via the local agent.
4. Optionally trigger a rollout restart of **that Deployment only** so pods pick up the change.
5. See when/what the last edit was (last-edit persistence; full history is a future phase).

### 1.3 Non-Goals (v1)

- Secrets editing (sensitive; separate design with explicit guards).
- `binaryData` keys (bridge is JSON-only; needs base64 path).
- Raw whole-manifest YAML editing of arbitrary resources (Deployments, Ingresses, …).
- StatefulSet/DaemonSet support (v1 resolves Deployments via pod-name derivation, §2.3).
- Full audit history of config edits — v1 persists only the **last edit** per ConfigMap
  (§7.4); an append-only audit trail is a future phase.

### 1.4 Why this is feasible today

Everything needed is already in place:

- The bridge is **generic**: `window.rtAgent.execute({id, type, context, ...})` passes any JSON
  untouched from page → content script → background → agent (`extension/injected.js:112`,
  `extension/content.js:29`, `extension/background.js:283`). **Zero extension changes needed.**
- The agent already shells out to `kubectl` with fixed argv via `spawn` (no shell), with
  `context.kubeContext` and `context.namespace` pass-through (`agent/src/executors/pods.js:22`).
- The UI already passes `kubeContext` (cluster name) and `namespace` per pod row
  (`src/components/pods/pod-table.tsx`), and there is an established dialog/action pattern
  (`PodRestartDialog`, `ContainerCommandDialog`) plus version gating
  (`supportsRestart`, `MIN_AGENT_VERSION` in `src/lib/services/agent-bridge.ts:184-211`).

The missing pieces are: (a) no agent executor can read/write K8s resources other than
`kubectl delete pod`; (b) no ConfigMap discovery/read/patch path; (c) no editor UI;
(d) no persistence of config edits.

---

## 2. Technology Evaluation

### 2.1 Execution path options

| Option | Description | Verdict |
|---|---|---|
| **A. New `config` execution type in the agent** | Dedicated executor with structured actions (`describe` / `get` / `apply` / `rolloutRestart`), fixed argv, field validation. | **Recommended.** Matches the existing architecture (one executor per capability: `sql.js`, `rest.js`, `pods.js`, …), keeps the token + type-dispatch security model, no extension change. |
| B. Reuse `script` type (`kubectl apply` inside a pod) | Pipe a manifest through `kubectl exec` to an in-pod kubectl. | Rejected. Requires kubectl + RBAC inside customer pods, fragile, and semantically wrong (config edits are host-side operations). |
| C. Server-side K8s access from Next.js | The web server talks to clusters directly. | Rejected. The server has no cluster credentials; the entire agent architecture exists because clusters are reachable only from the user's machine. |
| D. Raw kubectl passthrough endpoint | Agent accepts an arbitrary kubectl argv/command string. | Rejected. Loses all validation, widens the blast radius of the token to "any kubectl command", and every caller becomes responsible for quoting/safety. The agent's current strength is fixed-argv dispatch. |

### 2.2 Write strategy for saving a ConfigMap

| Strategy | Command | Pros | Cons |
|---|---|---|---|
| Full-object apply | `kubectl apply -f -` (whole manifest on stdin) | Simple, declarative | Client-side `last-applied` annotation noise; conflicts when object changed elsewhere; easy to clobber labels/annotations added by other controllers. |
| `kubectl replace` | `kubectl replace -f -` | Exact state | Same clobbering risk; fails on resourceVersion skew unless fetched fresh. |
| **JSON merge patch (data only)** | `kubectl patch configmap <name> --type=merge -p '{"data":{...}}'` | Touches only `data`; `null` **truly deletes** a key (RFC 7386); immune to unrelated field drift; smallest payload. | Client must diff original vs edited keys to know deletions. Trivial (we hold both copies). |
| Server-side apply | `kubectl apply --server-side --field-manager=rt-agent` | Clean ownership semantics | Overkill for a single map; SSA on `data` with shared field managers can surprise other tooling. |

**Decision: JSON merge patch on `data` only.** Read path uses `kubectl get configmap -o json`;
write path patches exactly the edited keys — key deletion is real deletion via `null` values in
the merge patch. Minimal blast radius; never touches immutable fields, labels, or annotations.

### 2.3 Workload resolution (pod → deployment)

`PodInfo` today carries no labels or owner references (`agent/src/executors/pods.js:131-179`).
Options considered:

- A. Agent-side owner-chain resolution (`get pod` → ReplicaSet → `get rs` → Deployment).
  Accurate, but 2–3 kubectl calls per describe and extra executor complexity.
- **B. Client-side name derivation via `appFromPodName()` (decided).** The existing heuristic
  (`src/lib/grafana.ts:19-27`) strips the replicaset/pod hash suffixes from the pod name,
  yielding the Deployment name directly. The `describe` action takes that name and runs a
  single `kubectl get deployment <name> -o json`; if the lookup fails, the UI reports config
  edit as unsupported for that pod.

**Decision: B** — simplest path, one kubectl call, accurate for the app's managed workloads
(Deployments whose pods follow the standard `<deploy>-<rs-hash>-<pod-hash>` naming).

### 2.4 ConfigMap discovery for a workload

`kubectl get deployment <name> -o json`, then collect references from the pod template spec:

- `spec.template.spec.containers[*].envFrom[*].configMapRef.name`
- `...containers[*].env[*].valueFrom.configMapKeyRef.name`
- `spec.template.spec.volumes[*].configMap.name`

All parsing happens **in the agent executor** (it already parses `kubectl -o json` output in
`pods.js`), returning a clean DTO — the web app never parses raw K8s JSON.

### 2.5 Payload limits

Agent truncates script output at 50k chars; ConfigMaps can be up to 1 MiB. The `config` executor
must set its own cap (recommend 1 MiB) and surface a `truncated` flag like `script.js:54-67`
does. Requests (patches) are small — no concern.

---

## 3. Architecture Overview

```
┌──────────────────────────── Web App (Next.js) ────────────────────────────┐
│ PodTable row  ──►  ConfigEditorDialog                                     │
│   [Config] btn      ├─ appFromPodName(pod) → deployment name              │
│                     ├─ list ConfigMaps (describe)                         │
│                     ├─ key/value editor (get)                             │
│                     ├─ Save: merge patch (+ optional rollout restart)     │
│                     └─ record last edit → server action → SQLite          │
│                              │                                            │
│                     agentBridge.configDescribe / configGet /              │
│                     configApply / rolloutRestart                          │
│                     (src/lib/services/agent-bridge.ts)                    │
└──────────────────────────────│ window.rtAgent.execute ────────────────────┘
                               │  (extension bridge — UNCHANGED)
                               ▼
┌──────────────────────────── Agent (127.0.0.1:3456) ───────────────────────┐
│ POST /api/v1/execute  { type: 'config', config: {action, ...} }           │
│   └── server.js dispatch adds case 'config'                               │
│         └── src/executors/config.js                                       │
│               ├─ describe: kubectl get deploy <name> -o json → CM refs    │
│               ├─ get:      kubectl get cm <name> -o json                  │
│               ├─ apply:    kubectl patch cm <name> --type=merge -p <json> │
│               └─ rolloutRestart: kubectl rollout restart deploy/<name>    │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Execution Flows

### 4.1 Discover (click "Config" on a pod row)

1. UI derives the Deployment name client-side: `appFromPodName(podName)`.
2. UI calls `agentBridge.configDescribe({ kubeContext, namespace, deploymentName })`.
3. Agent: `kubectl get deployment <name> -o json`. If the Deployment is not found (pod not
   Deployment-managed, or the name heuristic missed), return `supported: false` with a reason.
4. Agent extracts ConfigMap references from the pod template (§2.4).
5. Response: Deployment name + referenced ConfigMaps, each annotated with how it's consumed
   (`envFrom` | `env` | `volume`) — `envFrom`/`volume` changes need a rollout restart to take
   effect; the UI uses this to pre-tick the restart checkbox.

### 4.2 Read

1. User selects a ConfigMap from the list.
2. `agentBridge.configGet({ kubeContext, namespace, configMapName })` →
   `kubectl get configmap <name> -o json` → return `{ name, data: {...}, truncated? }`.
3. UI renders a key/value editor (per-key value = monospace textarea, raw multi-line text
   preserved). Keep the pristine copy for diffing.

### 4.3 Save

1. Client diffs original vs edited keys → `{ set: {k: v}, delete: [k] }`.
2. Agent builds the merge patch: `{"data": { ...set, [deletedKey]: null }}` — `null` truly
   deletes the key.
3. `agentBridge.configApply(...)` → agent runs
   `kubectl patch configmap <name> --type=merge -p '<patch>'` (patch passed as a single argv
   element, no shell). Agent validates: name/namespace come from the request context, patch
   body ≤ 1 MiB, keys match `[-._a-zA-Z0-9]+`, values are strings.
4. Response includes applied/deleted key counts + kubectl output.
5. If "rollout restart" was checked: follow with
   `kubectl rollout restart deployment/<name>` — scoped to **this Deployment only** — and
   surface its result.
6. On success, the client calls the `recordConfigMapEdit` server action to persist the last
   edit (§7.4), then refetches pod health (`ClusterPodsCard` already reloads on demand).
7. The save button opens an `AlertDialog` confirm (existing pattern,
   `pod-restart-dialog.tsx:74-114`) summarizing: N keys changed, M keys deleted
   (listed by name), rollout restart yes/no.

---

## 5. Execution API Specification

### 5.1 Request

Extends the existing `ExecutionRequest` (`agent-bridge.ts:69-78`) with one new type and payload:

```ts
type ConfigAction = 'describe' | 'get' | 'apply' | 'rolloutRestart';

interface ConfigPayload {
  action: ConfigAction;
  deploymentName?: string;  // describe / rolloutRestart (derived via appFromPodName)
  configMapName?: string;   // get / apply
  patch?: {                 // apply: diff of data keys
    set: Record<string, string>;
    delete: string[];
  };
}

// ExecutionRequest additions
{ type: 'config', config: ConfigPayload }
```

### 5.2 Response

```ts
interface ConfigResult {
  // describe
  deployment?: string;          // resolved deployment name
  supported?: boolean;          // false when no such Deployment exists
  unsupportedReason?: string;
  configMaps?: Array<{
    name: string;
    consumedAs: Array<'envFrom' | 'env' | 'volume'>;
  }>;
  // get
  data?: Record<string, string>;
  truncated?: boolean;
  // apply / rolloutRestart
  appliedKeys?: number;
  deletedKeys?: number;
  output?: string;              // kubectl stdout
}
```

Standard `ExecutionResponse` envelope (`agent/src/types.js:67-79`) with `result.config` populated,
`exitCode`, `duration`, and existing `error` shape unchanged.

### 5.3 Endpoint

No new HTTP endpoints — everything rides `POST /api/v1/execute` with `type: 'config'`
(dispatch added in `agent/server.js:148-180`). Timeout default 30s.

---

## 6. Agent Implementation Notes

New file `agent/src/executors/config.js`, following the `pods.js` pattern
(`spawn('kubectl', args)`, per-request timeout, output cap, structured result):

- `describe(deploymentName)`: `kubectl get deployment <name> -n <ns> --context <ctx> -o json`;
  extract ConfigMap references (§2.4); on `NotFound` return `supported:false`.
- `get(configMapName)`: `kubectl get configmap <name> -n <ns> --context <ctx> -o json`;
  return `data` only; cap at 1 MiB with `truncated` flag.
- `apply(configMapName, patch)`: builds `{"data": {...set, ...deleted→null}}`, runs
  `kubectl patch configmap <name> --type=merge -p <json>`. Validates key names, rejects empty
  patch, rejects non-string values.
- `rolloutRestart(deploymentName)`: `kubectl rollout restart deployment/<name>` — resource
  kind hardcoded to `deployment` (v1 scope).

Also:

- `agent/src/types.js`: add `config` to request/response typedefs.
- `agent/package.json`: bump to **1.4.0**.
- Web: `CONFIG_EDIT_MIN_VERSION = '1.4.0'` + `supportsConfigEdit` helper in
  `agent-bridge.ts` (same pattern as `RESTART_MIN_VERSION` at line 190); the UI hides/disables
  the Config button with an "upgrade agent" hint when the connected agent is older.

---

## 7. Web App Integration

### 7.1 Entry points

- `src/components/pods/pod-table.tsx`: new row action button (e.g. `FileCog`/`Settings2` icon)
  next to Restart, opening `ConfigEditorDialog`. Receives the same `{ kubeContext, namespace,
  podName }` props the other dialogs already get — works automatically everywhere `PodTable`
  is reused, including `CustomerPodsSheet` on the release page.
- (Optional v1.1) customer-level entry: a "Config" action on the customer row that derives the
  Deployment from any running pod of that customer.

### 7.2 New components

- `src/components/pods/config-editor-dialog.tsx` — Dialog with three states:
  1. **Loading/describe** — Deployment name + ConfigMap list with consumed-as badges
     (`envFrom`/`env`/`volume`).
  2. **Editor** — selected ConfigMap: key list + value textareas (monospace), add/remove key
     rows. Reuse `Textarea` (`ui/textarea.tsx`) and the edit-toggle idiom from
     `step-detail-panel.tsx:110,278-285`. No YAML parser needed — values are edited as raw
     strings; keys holding JSON/INI/YAML stay opaque text. Shows a "Last edited …" line when
     a prior edit record exists (§7.4).
  3. **Confirm save** — `AlertDialog` with diff summary (changed keys, deleted keys listed by
     name) + rollout-restart checkbox (pre-ticked when the ConfigMap is consumed via
     `envFrom`/`volume`; copy states it restarts **only this Deployment**).
- `agent-bridge.ts`: `configDescribe`, `configGet`, `configApply`, `rolloutRestart` wrappers
  (thin, mirroring `restartPod` at lines 394-401).

### 7.3 State/error handling

- Reuse the existing bridge error propagation (rejected promise with message).
- Errors surfaced inline in the dialog (banner pattern from `pod-restart-dialog.tsx`).
- After successful save (+ optional restart): record the edit (§7.4), then reload pods.

### 7.4 Last-edit persistence

v1 persists the **most recent edit per ConfigMap** (upsert, not history). Enough to answer
"what changed here last, and when?"; an append-only audit trail is a future phase and can be
built on the same write path.

New drizzle table in `src/lib/db/schema.ts`:

```ts
export const configMapEdits = sqliteTable('config_map_edits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kubeContext: text('kube_context').notNull(),     // cluster name
  namespace: text('namespace').notNull(),
  configMapName: text('config_map_name').notNull(),
  deploymentName: text('deployment_name'),
  patch: text('patch', { mode: 'json' }).notNull(), // { set: {...}, delete: [...] }
  rolloutRestart: integer('rollout_restart', { mode: 'boolean' }).notNull().default(false),
  editedAt: integer('edited_at', { mode: 'timestamp' }).notNull(),
}, (t) => [unique().on(t.kubeContext, t.namespace, t.configMapName)]);
```

Server actions in `src/lib/actions/config-map-edits.ts`:

- `recordConfigMapEdit(record)` — upsert on `(kubeContext, namespace, configMapName)`; called
  from the dialog after a successful `configApply`.
- `getLastConfigMapEdit(kubeContext, namespace, configMapName)` — fetched when the editor
  opens, to render the "Last edited <date>, N keys changed" line.

Migration: generated via drizzle-kit (repo convention: `drizzle.config.ts` + `scripts/migrate.ts`).

---

## 8. Security Considerations

1. **This is the first arbitrary cluster write beyond pod delete.** Guards, in layers:
   - Agent token (unchanged, `server.js:124-130`) — the only auth; adequate for loopback today,
     but note CORS is `*` and any web page can reach `window.rtAgent` (manifest matches all
     origins). The patch-only, ConfigMap-only, namespace-scoped surface keeps the incremental
     risk small. (A future hardening pass — origin allowlist in the extension — is orthogonal
     and out of scope here.)
   - Fixed argv via `spawn` (no shell) — patch JSON travels as one argv element; no injection.
   - Action/key allowlists in the executor; namespace always comes from `context`, never from
     the patch body; resource kind hardcoded (`configmap`, `deployment`).
   - RBAC: edits run with the user's own kubeconfig rights — same trust level as the existing
     `restart`/`exec` features.
2. **No secrets**: the executor cannot touch `Secret` objects by construction.
3. **Destructive UX**: save requires the explicit `AlertDialog` confirm; deleted keys are
   listed by name in the confirm text.

---

## 9. Error Handling

| Case | Agent behavior | UI behavior |
|---|---|---|
| Agent < 1.4.0 | n/a (old agent rejects unknown type with 400) | Config button hidden; hint "requires agent ≥ 1.4.0" |
| Deployment not found for derived name | `supported:false`, reason | Dialog shows "Config edit not supported for this workload" |
| ConfigMap not found / RBAC denied | kubectl stderr → `error` envelope | Inline error banner |
| Empty patch (nothing changed) | rejected client-side | Save disabled until a change exists |
| Patch > 1 MiB | 400 `EXECUTION_FAILED` | Error banner |
| ConfigMap > 1 MiB on read | `truncated:true` | Editor read-only with warning (no silent data loss on save) |
| Concurrent edit conflict | merge patch is last-writer-wins per key | Note in confirm dialog: "changes apply per key; concurrent edits to the same key are overwritten" |
| `null`-valued key collides with real data | n/a — ConfigMap values are strings only, merge-patch `null` = delete is unambiguous | — |
| Last-edit persistence fails | n/a (server action error) | Non-blocking: edit already applied; log + silent or toast warning |

---

## 10. Q&A / Clarifications

### Q1: Why not `kubectl edit`-style full YAML?
Higher support cost (YAML parser/editor in the UI, full-object conflict handling) for little
gain: in the current deploys ConfigMaps are the major source of env variables, so key/value
editing covers the high-frequency case. Raw YAML of the whole ConfigMap is a possible v2
editor tab.

### Q2: How are key deletions handled?
Real deletion. JSON merge patch (RFC 7386) removes keys set to `null`, and ConfigMap `data`
values are always strings, so `null` can never be a legitimate value. Deleted keys are listed
by name in the save-confirm dialog.

### Q3: How is the workload resolved from a pod?
Via the existing `appFromPodName()` heuristic (`src/lib/grafana.ts:19-27`), which strips the
replicaset/pod hash suffixes — decided over agent-side ownerReference walking (the earlier
candidate) for simplicity: one `kubectl get deployment` call, adequate for the app's managed
workloads. Misses degrade gracefully to "not supported".

### Q4: Rollout restart scope
`kubectl rollout restart deployment/<name>` applies **only to the selected Deployment** — the
one derived from the pod row the user acted on — never namespace-wide. Offered as an explicit
checkbox, pre-ticked when the ConfigMap is consumed via `envFrom`/`volume` (the cases where
running pods don't see the change until recreated).

### Q5: Audit trail?
v1 persists only the **last edit** per ConfigMap (upsert into `config_map_edits`, §7.4). A
full append-only history is a future phase; it can reuse the same write path by switching the
upsert to an insert.

### Q6: Secrets?
Explicitly out of scope. The executor hardcodes `configmap`; adding secrets later requires its
own design (base64 handling, masking in UI, stricter confirm).

---

## 11. Rollout Plan

1. `agent`: new executor + dispatch + types, version **1.4.0**, publish to GitHub Packages.
2. `web`: bridge wrappers + version gate + dialog components + `config_map_edits` table
   (drizzle migration) + server actions. No extension change; bump `AGENT_VERSION` in
   `src/app/setup/page.tsx`.
3. Manual verification path: kind/minikube cluster → create Deployment + ConfigMap →
   describe/get/edit/save (incl. a key deletion) → verify `kubectl get cm` reflects the patch
   → confirm only that Deployment rolled → verify the last-edit record renders on reopen.
