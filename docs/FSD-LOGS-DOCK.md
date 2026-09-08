# Functional Specification Document
## Multi-Pane Logs Viewer

### Version: 2.1
### Date: 2026-09-08
### Status: Draft

---

## 1. Overview

### 1.1 Purpose
Allow users to watch live logs (`kubectl logs -f`) from one — and occasionally two — pods/containers at the same time, so they can observe calls flowing between services (e.g. backend → celery) in one screen.

### 1.2 Problem Statement
The original log viewer (`ContainerLogsDialog`) was a **modal dialog**: only one container's logs could be viewed at a time, and the modal blocked the pod table. A first redesign pinned a multi-tab dock to the bottom of the page content, but in practice:

- The dock sat at the end of a long pod list — users had to scroll all the way down to see it.
- Most of the time only **one** output is needed; the tab strip added weight without value.
- Adding a second stream required going back to the table — there was no way to pick another pod from within the viewer.

### 1.3 Solution Overview
A **floating, non-modal logs panel** that stays on top of the page regardless of scroll position (picture-in-picture style, anchored bottom-right by default):

- **Default = single viewer**, visually identical in spirit to the old dialog (same controls, same log view).
- **Movable and resizable**: drag the header to reposition, drag the bottom-right grip to resize.
- **Up to 4 panes**: split buttons add panes — side-by-side (horizontal), stacked (vertical), or 2×2 (grid).
- **Per-pane pod/container picker**: each pane header has pod and container dropdowns (populated from the pane's namespace via the agent), so another service's logs can be opened without touching the table behind the panel.
- Clicking a container's log icon in any pod table still works: first click opens the panel, further clicks fill additional panes.

### 1.4 Key Properties
- **Always on top**: `fixed` positioning — never buried under page scroll.
- **Non-modal**: the pod table behind the panel stays interactive.
- **Bounded**: at most 4 panes (each pane = one live `kubectl logs -f` on the local agent plus a 200 KB browser buffer).
- **Session-scoped**: streams survive in-app navigation and minimize; never a page reload.

---

## 2. User Stories

### Persona: Release Manager / On-call Engineer

| ID | User Story |
|----|-----------|
| US-LD-001 | As an engineer, I want to open one container's logs in a floating window so that I don't lose my scroll position in the pod list |
| US-LD-002 | As an engineer, I want to split the viewer side-by-side or stacked so that I can align timestamps between a caller and a callee |
| US-LD-003 | As an engineer, I want to pick any pod/container of the namespace from within a pane so that I can compare services without closing the viewer |
| US-LD-004 | As an engineer, I want clicking another container's log icon to fill an additional pane so that adding a stream is one click |
| US-LD-004a | As an engineer, I want to move and resize the panel so that it fits alongside whatever else I'm looking at |
| US-LD-004b | As an engineer, I want up to 4 panes in a 2×2 grid so that I can watch a whole request path (e.g. frontend → backend → worker → db) at once |
| US-LD-005 | As an engineer, I want per-pane controls (tail, stop/start, clear, download, follow) identical to the old dialog so that I don't relearn anything |
| US-LD-006 | As an engineer, I want a per-pane status indicator (streaming / ended / error) so that I can spot a crashed pod's stream at a glance |
| US-LD-007 | As an engineer, I want to minimize the panel to a small floating bar while streams keep running |
| US-LD-008 | As an engineer, I want opening the same container's logs twice to focus the existing pane, not start a duplicate stream |

---

## 3. Core Concepts

### 3.1 Panel
A floating window anchored to the bottom-right of the viewport by default; draggable by its header and resizable from its bottom-right grip. It exists only while at least one pane is open; closing the last pane removes it. Non-modal: no backdrop, page behind stays usable.

### 3.2 Pane
One pane = one live `kubectl logs -f` for a `(kubeContext, namespace, pod, container)` tuple, with its own toolbar and log view. Maximum 4 panes.

A pane can be **empty** (created via a layout/add-pane button): it shows a pod picker and starts streaming once a pod is chosen.

### 3.3 Layout
| Layout | Arrangement | Use case |
|--------|-------------|----------|
| `horizontal` | Panes side by side (N columns) | Comparing services line-by-line |
| `vertical` | Panes stacked (N rows) | Wide log lines (stack traces, JSON) |
| `grid` | 2 columns, rows as needed (2×2 at 4 panes) | Watching a full request path |

Layout is switchable at any time while multiple panes are open.

### 3.4 Panel Modes
| Mode | Behavior |
|------|----------|
| normal | ~50vh tall, floating bottom-right; user-adjustable position and size |
| maximized | Fills the viewport (16px inset); drag/resize disabled |
| minimized | Small floating bar (pane names + status dots); streams keep running |

---

## 4. Feature Specifications

### 4.1 Opening Streams

| ID | Feature | Description |
|----|---------|-------------|
| FLD-001 | Open from container row | Log icon on a container row (Pods page, Jenkins panel, pod status panel) opens the panel with that stream |
| FLD-002 | Dedupe | Opening an already-open target focuses its pane instead of duplicating the stream |
| FLD-003 | Second stream | With one pane open, a different target opens as a second pane (side-by-side by default) |
| FLD-004 | Pane limit | With 2 panes open, a new target replaces the stream in the focused pane |
| FLD-005 | Auto-start | A stream starts as soon as a pane has a target |

### 4.2 Panes & Layout

| ID | Feature | Description |
|----|---------|-------------|
| FLD-010 | Layout buttons | ⧉ (horizontal) / ⬓ (vertical) / ▦ (2×2 grid). With one pane: clicking adds an empty pane in that layout. With multiple panes: switches layout |
| FLD-011 | Empty pane | Shows "Select pod…" picker; starts streaming when a pod is chosen; can also be filled by clicking a container row's log icon |
| FLD-012 | Add pane | Plus button (2–3 panes open) appends an empty pane, up to 4 total |
| FLD-013 | Fixed ratio | Panes share space equally; no per-pane drag-to-resize |

### 4.3 Panel Window

| ID | Feature | Description |
|----|---------|-------------|
| FLD-015 | Drag | Dragging the header moves the panel anywhere in the viewport (clamped on-screen) |
| FLD-016 | Resize | Bottom-right grip resizes the panel (min ~480×300) |
| FLD-017 | Maximize | Toggle between user size/position and full-viewport |

### 4.4 Per-Pane Picker

| ID | Feature | Description |
|----|---------|-------------|
| FLD-020 | Pod dropdown | Lists pods in the pane's namespace (fetched via the agent); switching pod stops the current stream and starts the new one (first container by default) |
| FLD-021 | Container dropdown | Lists containers of the selected pod |
| FLD-022 | Namespace scope | The picker is scoped to the pane's namespace (the namespace of the stream that opened the pane); cross-namespace comparison = open from that namespace's table row |

### 4.5 Panel Controls

| ID | Feature | Description |
|----|---------|-------------|
| FLD-030 | Minimize | Collapse to a floating bar showing pane names + status dots; streams keep running |
| FLD-032 | Close pane | Per-pane ✕ (visible with 2+ panes) stops that stream |
| FLD-033 | Close all | Header ✕ stops all streams and removes the panel |

### 4.6 Per-Stream Controls (unchanged from old dialog)

| ID | Feature | Description |
|----|---------|-------------|
| FLD-040 | Tail selector | 100 / 200 (default) / 500 / 1000 lines; disabled while streaming |
| FLD-041 | Start / Stop | Restart or cancel the stream |
| FLD-042 | Clear | Empty the visible buffer |
| FLD-043 | Download | Save the buffered logs as a `.log` file |
| FLD-044 | Follow | Auto-scroll to bottom on new output |
| FLD-045 | Buffer cap | 200 000 characters per stream client-side (oldest data dropped) |

---

## 5. UI/UX Design

### 5.1 Single pane (default)

```
                                    ┌─ pods page, fully interactive ─┐
                                    │                                │
              ┌─────────────────────┴─────────────────────────────┐  │
              │ Logs                 [⧉][⬓][▦] [⤢][╍][✕]          │  │
              ├───────────────────────────────────────────────────┤  │
              │ ● opencode-synapse-… ▾  / opencode-agent ▾   ⟳    │  │
              │ Tail 200 ▾ │ Stop │ 🗑 │ ⬇ │ ☑ Follow             │  │
              │ ┌───────────────────────────────────────────────┐ │  │
              │ │ INFO 03:37:19 search_kb called with query=…   │ │  │
              │ │ INFO 03:37:22 POST http://backend:8000/… 500  │ │  │
              │ └───────────────────────────────────────────────┘ │  │
              └───────────────────────────────────────────────────┘  │
              (floating bottom-right, stays on top while scrolling)
```

### 5.2 Two panes — horizontal split

```
┌────────────────────────────────────────────────────────────────┐
│ Logs                        [⧉][⬓][▦][+] [⤢][╍][✕]             │
├───────────────────────────────┬────────────────────────────────┤
│ ● ai-backend-… ▾ /ai-backend ▾│ ● aldebaran-… ▾ / celery ▾  ✕ │
│ Tail 200 ▾ Stop 🗑 ⬇ ☑Follow │ Tail 200 ▾ Stop 🗑 ⬇ ☑Follow  │
│ INFO 03:37:19 search_kb…      │ INFO 03:37:22 POST /api/v1/…   │
│ INFO 03:37:22 500 error…      │ ERROR 03:37:22 timeout…        │
└───────────────────────────────┴────────────────────────────────┘
```

### 5.3 Four panes — 2×2 grid

```
┌───────────────────────────────┬────────────────────────────────┐
│ ● frontend-… ▾ / frontend ▾ ✕│ ● base-api-… ▾ / base-api ▾ ✕ │
├───────────────────────────────┼────────────────────────────────┤
│ ● ai-backend-… ▾/ai-backend ✕│ ● aldebaran-… ▾ / celery ▾  ✕ │
└───────────────────────────────┴────────────────────────────────┘
```

### 5.4 Empty pane (after a layout/add-pane button)

```
│ ● Select pod… ▾                                               ✕ │
│                                                                 │
│        Pick a pod above to start streaming, or click a          │
│        container's log icon in the table.                       │
```

### 5.5 Minimized

```
        ┌──────────────────────────────────────────────┐
        │ ● ai-backend-…/ai-backend  ● aldebaran/celery │ [⤢][✕]
        └──────────────────────────────────────────────┘
```

---

## 6. Business Rules

| ID | Rule |
|----|------|
| BR-LD-01 | A pane holds at most one stream; at most 4 panes |
| BR-LD-02 | Opening an already-open target focuses its pane; duplicates never start |
| BR-LD-03 | Streams keep running while the panel is minimized or the user navigates within the app |
| BR-LD-04 | Closing a pane, retargeting it (picker), or closing the panel cancels its `kubectl logs -f` immediately |
| BR-LD-05 | The focused pane (ring highlight) is the one replaced when a stream is opened with all 4 panes full |
| BR-LD-06 | Streams never survive a full page reload (same as the old dialog) |
| BR-LD-07 | Without the browser extension / local agent, a stream shows the same error state as the old dialog |

---

## 7. Error Handling Matrix

| Scenario | User Feedback |
|----------|---------------|
| Agent offline / extension missing | Pane shows red status dot + error message |
| Pod list for picker fails to load | Pod dropdown stays at "Loading pods…"; table-based opening still works |
| Stream ends (pod deleted, kubectl exits) | Gray status dot, "stream ended", buffer preserved |
| Stream error | Red status dot, error message, buffer preserved |
| Close last pane | Panel disappears; no orphaned streams |

---

## 8. Q&A / Clarifications

### Q1: Why floating instead of docked at the page bottom?
**A:** The pods page is a long scrollable list; a dock at the content bottom forced users to scroll to find their logs. A `fixed` floating panel is always in the same place, on top, regardless of scroll.

### Q2: Why max 4 panes instead of N tabs?
**A:** The dominant case is one stream; comparison is two; a full request path (frontend → backend → worker → db) is four. Beyond that, screen space and per-stream cost (one `kubectl logs -f` each) outweigh the value. The per-pane picker makes retargeting fast enough that more panes add little.

### Q3: Why a picker inside the pane?
**A:** When the viewer floats above the table, reaching another container's log icon can mean scrolling the table behind the panel. The picker (pods of the pane's namespace) makes the second stream self-service.

### Q4: Why non-modal?
**A:** A modal would block the pod table — the natural entry point for opening streams — and recreate the original problem.

---

## 9. Future Enhancements

| Feature | Description | Priority |
|---------|-------------|----------|
| Persist panel position/size | Remember drag/resize across sessions | Low |
| Synchronized scrolling | Scroll panes together by timestamp | Medium |
| Cross-namespace picker | Cluster/namespace selectors in the pane header | Medium |
| Search / highlight | Filter within a stream | Medium |
