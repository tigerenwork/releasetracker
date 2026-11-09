# Functional Specification Document
## ConfigMap Edit History / Audit Trail

### Version: 1.0
### Date: 2026-11-09
### Status: Implemented

---

## 1. Overview

### 1.1 Purpose
Let operators see **when** and **what** changed in a ConfigMap’s env/data keys — added, updated, or deleted — so env drift is traceable without relying on memory or cluster-side events.

### 1.2 Problem Statement
ReleaseTracker already supports editing ConfigMaps from the Pods UI and release steps, but only the **last** edit per ConfigMap was persisted. Earlier changes were overwritten, so it was easy to lose track of who/what changed an env var and when.

### 1.3 Solution Overview
Every successful ConfigMap apply appends an audit row (patch + metadata). The Config editor shows an **Edit history** panel with a timeline of changes and expandable key-level diffs.

### 1.4 Non-Goals (v1)
- Restore / rollback of a past patch
- Actor / user identity (no user model yet)
- Capturing edits made outside ReleaseTracker (`kubectl` elsewhere)
- Secrets

---

## 2. User Stories

| ID | User Story |
|----|-----------|
| US-CMH-001 | As an engineer, after I edit a ConfigMap I want that change kept in history so I can revisit it later |
| US-CMH-002 | As an engineer, I want to open Edit history on a ConfigMap and see past edits newest-first |
| US-CMH-003 | As an engineer, I want each history entry to show which keys were set or deleted, with previous→new values when known |
| US-CMH-003a | As an engineer, when I make the first tracked edit, I want the pre-edit values saved as an Initial baseline |
| US-CMH-004 | As an engineer, I want to know whether the edit came from the Pods UI, a release step, or auto-run |
| US-CMH-005 | As an engineer, I still want the “Last edited …” summary so I do not need to open history for a quick check |

---

## 3. Behavior

### 3.1 Recording
On every successful `configApply` from:
- Pods Config editor (`pods-ui`)
- Release ConfigMap step (`release-step`)
- Auto-runner (`auto-runner`)

…the app inserts one history row and upserts the last-edit cache.

### 3.2 History UI
Inside the Config editor (selected ConfigMap):
- Collapsible **Edit history** section
- Each entry: relative time, source badge, set/delete counts, optional rollout badge
- Expand to see key-level `set` values and `deleted` keys

### 3.3 Backfill
Existing last-edit cache rows are seeded into history once (if no history exists for that ConfigMap yet).

---

## 4. Acceptance Criteria

- [ ] Saving from Pods UI creates a new history entry (does not overwrite prior ones)
- [ ] Release-step and auto-runner applies also create history entries with the correct `source`
- [ ] Edit history lists entries newest-first with expandable key diffs
- [ ] “Last edited …” line still reflects the most recent edit
- [ ] History load failure does not block editing
