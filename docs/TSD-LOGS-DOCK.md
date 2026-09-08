# Technical Specification Document
## Multi-Pane Logs Viewer

### Version: 2.1
### Date: 2026-09-08
### Status: Draft
### Related: [FSD-LOGS-DOCK.md](./FSD-LOGS-DOCK.md)

---

## 1. Architecture Overview

The log streaming transport (`agentBridge.getLogsStream` → extension `postMessage` lane → local agent `kubectl logs -f`) is multi-instance safe: each call returns an independent `{ promise, cancel }` pair with a unique message id. **No changes to the extension, agent, or bridge are required.**

All changes are in the web app UI layer:

```
src/app/layout.tsx (server)
└── <main>
    └── LogsDockProvider  (client, React context)
        ├── {children}                     (all pages, incl. Pods page)
        │     └── PodTable                 (pods page / jenkins panel / status panel)
        │           └── ContainerLogsButton → useLogsDock().openStream(target)
        └── LogsDock  (client, fixed floating panel)
              └── LogPaneView × 1..2
                    ├── pod/container picker (pods via agentBridge.getPods)
                    └── LogStreamView      (keyed by stream target; remount = retarget)
```

Key design decisions:

- **Pane model, not tabs.** At most 2 panes, both visible when present. No hidden/background viewers, no unread tracking.
- **`LogStreamView` is keyed by stream target** (`key={streamIdOf(target)}`). Retargeting a pane via the picker unmounts the old view — its cleanup cancels the old stream — and mounts a fresh one that auto-starts. Stream lifecycle is therefore entirely driven by React mount/unmount; no imperative restart logic.
- **Single `DockState` object** in one `useState` — panes, focus, layout and panel mode are interdependent and update atomically via functional `setState`.
- **Floating, non-modal**: `fixed bottom-4 right-4 z-50`, no backdrop. Page behind stays interactive.
- **No new dependencies.**

---

## 2. State Model

```typescript
// src/components/pods/logs-dock-context.tsx

export interface LogStreamTarget {
  kubeContext?: string;
  namespace: string;
  podName: string;
  containerName: string;
}

export type LogStreamStatus = 'idle' | 'streaming' | 'ended' | 'error';

export interface LogPane {
  id: string;                     // stable per pane slot (pane-1, pane-2, …)
  context: { kubeContext?: string; namespace: string };  // picker scope, always set
  target: LogStreamTarget | null; // null = empty picker pane
  status: LogStreamStatus;        // reported by LogStreamView
}

export type DockLayout = 'horizontal' | 'vertical' | 'grid';  // N cols | N rows | 2 cols
export const MAX_LOG_PANES = 4;

interface DockState {
  panes: LogPane[];               // 0..4
  layout: DockLayout;
  focusedId: string | null;       // pane replaced when a stream is opened with all panes full
  minimized: boolean;
  maximized: boolean;
}
```

### 2.1 Action semantics

| Action | Transition |
|--------|-----------|
| `openStream(target)` | Same target open → focus its pane, un-minimize. Empty picker pane exists → fill it. 0 panes → create single pane. < 4 panes → append pane, focus it. 4 panes → replace target of the focused pane |
| `addPane(layout?)` | < 4 panes → append empty pane (same `context` as first pane with a target, `target: null`), set layout if given, focus it. 4 panes → just switch layout |
| `closePane(id)` | Remove; focus moves to the remaining pane; last pane closes the panel (layout preference kept) |
| `retargetPane(id, target)` | Replace `target` + `context`, reset status to `idle` (drives `LogStreamView` remount via key) |
| `setLayout / setFocused / setMinimized / toggleMaximized` | Direct field updates |
| `closeAll()` | Reset to empty (layout preference kept) |
| `reportStatus(paneId, status)` | Update pane meta if changed |

`streamIdOf(target)` = `` `${kubeContext}/${namespace}/${podName}/${containerName}` `` — used for dedupe and as the React key for `LogStreamView`.

---

## 3. Component Specifications

### 3.1 `LogsDockProvider` — `src/components/pods/logs-dock-context.tsx`

- Holds `DockState`; pane ids come from a `useRef` counter.
- Memoized context value; all actions are `useCallback` with functional `setState`.
- `useLogsDock()` throws outside the provider (all usages are inside the app shell).

### 3.2 `ContainerLogsButton` — `src/components/pods/logs-dock.tsx`

Ghost icon button (`ScrollText`) calling `openStream(target)`. Dropped into `PodTable` in place of the old `ContainerLogsDialog`; identical props (`kubeContext?`, `namespace`, `podName`, `containerName`).

### 3.3 `LogsDock` — `src/components/pods/logs-dock.tsx`

- `null` when `panes.length === 0`.
- **Minimized**: small floating bar — per-pane status dot + truncated `pod / container`, expand and close-all buttons.
- **Normal/maximized**: floating panel
  - Default geometry: anchored `right: 16, bottom: 16`, width `min(960px, 92vw)` (single / vertical / grid) or `min(1500px, 94vw)` (horizontal split), height `50vh`.
  - **Drag**: `mousedown` on the header (excluding clicks on `button/select/input/a`) snapshots `getBoundingClientRect()` into a local `rect` state and tracks `mousemove` on `window`, clamped to keep ≥120×60 px on-screen. While `rect` is set, positioning switches from right/bottom anchoring to `left/top/width/height`.
  - **Resize**: bottom-right grip (`cursor-nwse-resize`), same window-listener pattern; clamped to min 480×300 and the viewport. Drag/resize are disabled while maximized.
  - **Maximized**: fixed `inset: 16`, ignoring `rect`; un-maximizing restores it. `rect` is local component state — it survives minimize but resets when the panel closes.
  - Header: `Logs` title; layout buttons (`Columns2`, `Rows2`, `LayoutGrid`) — with 1 pane they `addPane(mode)`, with 2+ they `setLayout(mode)`; plus `addPane()` button while `panes.length` is 2–3; maximize, minimize, close-all.
  - Body: CSS grid via **inline style** (Tailwind can't generate dynamic `grid-cols-N`): `repeat(N, minmax(0,1fr))` columns (horizontal) or rows (vertical), or `repeat(2, …)` columns (grid). `divide-x`/`divide-y` for separators. Focused pane gets `ring-2 ring-inset ring-blue-200` when split.

### 3.4 `LogPaneView` — `src/components/pods/logs-dock.tsx`

- Root click sets the pane as focused.
- Fetches the pane-namespace pod list once on mount: `agentBridge.getPods({ namespace, kubeContext, … })` → `result.pods.items` (same call shape as `ClusterPodsCard`). Failures are silent — the picker stays at "Loading pods…".
- Header: status dot, pod `<select>`, container `<select>` (containers of the selected pod), streaming spinner, per-pane ✕ (only when split).
- Pod pick → `retargetPane` with the pod's first container. Container pick → `retargetPane` with same pod, new container.
- Empty pane (`target: null`): hint text; renders no `LogStreamView`.
- Active pane: `<LogStreamView key={streamIdOf(pane.target)} paneId={pane.id} target={pane.target} />`.

### 3.5 `LogStreamView` — `src/components/pods/logs-dock.tsx`

Stream lifecycle carried over from the old `ContainerLogsDialog`, dialog chrome removed:

- State: `tailLines` (200), `logs` (`appendCapped` at `CLIENT_LOG_CAP = 200000`), `streamState`, `errorMessage`, `follow` (true).
- `start()`: `agentBridge.getLogsStream(context, { tailLines }, onChunk)`; stores `stream.cancel` in a ref.
- Auto-start on mount; `cancel()` on unmount — closing/retargeting a pane stops the stream.
- `useEffect` reports `streamState` via `reportStatus(paneId, streamState)`.
- Toolbar per pane: Tail select, Start/Stop, Clear, Download (Blob → `.log`), Follow checkbox, `stream ended` / `error` text.
- `<pre>` styling unchanged (`bg-slate-950 text-slate-50 text-xs`), `flex-1 min-h-0` within the pane.

### 3.6 Integration points

| File | Change |
|------|--------|
| `src/app/layout.tsx` | Wrap `{children}` in `<LogsDockProvider>`, render `<LogsDock />` after children inside `<main>` |
| `src/components/pods/pod-table.tsx` | `ContainerLogsDialog` → `ContainerLogsButton` |
| `src/components/pods/container-logs-dialog.tsx` | **Deleted** (logic moved into `LogStreamView`) |

`PodTable` is used by `cluster-pods-card.tsx` (Pods page), `jenkins-pods-panel.tsx`, and `pod-status-panel.tsx` — all inside the app shell, so all get the panel with no further changes.

---

## 4. Concurrency & Resource Model

| Resource | Per pane | Cap |
|----------|---------|-----|
| Extension `postMessage` lane | 1 (`RT_EXECUTE_STREAM` id) | 4 |
| Agent `kubectl logs -f` process | 1 | 4 |
| Browser buffer | ≤ 200 KB string | ≤ 800 KB total |

Each `getLogsStream` call gets its own id and cancel function; cancelling one pane never affects the other. Streams are client-side only; a full page reload tears everything down.

---

## 5. Q&A / Clarifications

### Q1: Why key-based remount for retargeting?
**A:** It makes stream lifecycle declarative: mount = start, unmount = cancel. The picker never touches stream state directly, so there is no way to leak a `kubectl logs -f` process by forgetting to cancel.

### Q2: Why does the picker fetch pods per pane instead of reusing page data?
**A:** The panel lives at app-shell level and can be opened from pages whose pod data belongs to a different subtree (Jenkins panel, status panel). Fetching by `namespace` + `kubeContext` keeps the pane self-sufficient. One `getPods` call per pane mount is cheap (local agent round-trip).

### Q3: What happens on pages without pod tables?
**A:** Nothing — the panel only renders while at least one pane exists. If panes are open and the user navigates (e.g. Pods → Dashboard), the panel follows them (FSD BR-LD-03).

### Q4: Known limitations (v2)
- Max 4 panes; no tabs/history for previously closed streams.
- Equal-share panes (no per-pane resize); panel position/size reset when the panel closes.
- Picker scoped to the pane's namespace; cross-namespace compare requires opening from that namespace's table row.
