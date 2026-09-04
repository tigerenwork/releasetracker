# Functional Specification Document
## Cronicle Schedule Timeline View

### Version: 1.0
### Date: 2026-09-04
### Status: Draft

---

## 1. Overview

### 1.1 Purpose
Add a visual timeline view to the Cronicle panel so that the schedule of events (per selected category, or any active filter) can be understood at a glance.

### 1.2 Problem Statement
Today the Cronicle panel renders each event's schedule as a one-line text summary (e.g. "Daily at 6:45am") in a table column. For a category with many events, the user cannot answer basic scheduling questions without reading every row and doing mental math:

- When does anything run today / this week? What runs next?
- Do multiple jobs fire at the same time (resource contention on the Cronicle server)?
- Where are the dead windows and the overloaded windows?
- Which events are disabled and will not fire?

### 1.3 Solution Overview
A **List | Timeline** view toggle inside the existing Cronicle panel. The Timeline renders one swimlane per event with markers at each computed fire time over a selectable horizon (24h / 7 days). The view is fed by the panel's existing filter state (category, services, event names, search), so "show me the schedule for category X" is simply the filtered state flowing into the visualization.

No new Cronicle API calls are required: fire times are expanded client-side from the `timing` object already returned by `get_schedule`, and history data already fetched for the panel can overlay actual past runs.

### 1.4 Scope

| Phase | Contents |
|-------|----------|
| MVP (this document) | View toggle, swimlane timeline, 24h/7d horizons, now-line, next-run label per lane, disabled/on-demand handling, marker tooltip + click-to-edit |
| Phase 2 (out of scope) | Density strip with collision highlighting, actual-run overlay (✓/✗ from history), 30d horizon, server/local timezone toggle |

---

## 2. User Stories

### Persona: Release Manager

| ID | User Story |
|----|-----------|
| US-ST-001 | As a release manager, I want to see all events of a category plotted on a timeline so that I understand how the schedule is distributed |
| US-ST-002 | As a release manager, I want to see which event fires next so that I know what is coming up |
| US-ST-003 | As a release manager, I want to visually distinguish disabled events so that I don't mistake them for upcoming runs |
| US-ST-004 | As a release manager, I want on-demand events separated from scheduled ones so that they don't clutter the timeline |
| US-ST-005 | As a release manager, I want to switch the time horizon between 24 hours and 7 days so that both dense and sparse schedules are readable |
| US-ST-006 | As a release manager, I want to hover a marker to see the exact fire time, and click it to edit the event, so that I can act on what I see |
| US-ST-007 | As a release manager, I want the timeline to respect the active category/service/name/search filters so that I can isolate exactly the events I care about |

---

## 3. Feature Specifications

| ID | Feature | Description |
|----|---------|-------------|
| FST-001 | View Toggle | The Scheduled Events section header gains a `List \| Timeline` toggle. List is the current table and stays the default |
| FST-002 | Swimlane Timeline | Timeline view renders one horizontal lane per filtered event, with markers at every fire time inside the horizon window |
| FST-003 | Horizon Selector | `24 hours \| 7 days` selector; default 7 days. Window starts at the beginning of the current day minus a small lead-in so recent past is visible |
| FST-004 | Now-Line | A vertical line marks the current time; axis labels show day + hour ticks appropriate to the horizon |
| FST-005 | Next-Run Label | Each lane shows the event's next fire time after now (e.g. "next: Fri 06:45"); events with no fire time in the horizon show the first fire time after the horizon (e.g. "Jun 1") |
| FST-006 | Disabled Events | Disabled events render hollow/greyed markers and a greyed lane label |
| FST-007 | On-Demand Strip | Events without timing are grouped in a separate strip at the bottom labeled "On demand", one row listing their names (no markers) |
| FST-008 | Dense Schedules | When an event fires more than a threshold number of times in the horizon (e.g. every-minute/hourly jobs), its lane renders a continuous bar instead of individual markers; the tooltip shows the cadence summary |
| FST-009 | Marker Tooltip | Hovering a marker shows: event title, exact fire time (localized), and the existing `summarizeTiming()` text |
| FST-010 | Click to Edit | Clicking a marker or lane label opens the existing event edit dialog (`EventEditDialog`) |
| FST-011 | Filter Integration | The timeline consumes the same `filteredEvents` list as the table; changing category/service/name/search filters updates the timeline immediately |
| FST-012 | Empty States | No events after filtering: "No events in this category." All events on-demand: only the on-demand strip renders |

---

## 4. UI/UX Design

### 4.1 Placement

The toggle lives in the Scheduled Events section header of the Cronicle panel (`/cronicle` page and the cluster detail page share this component). No navigation changes.

### 4.2 Timeline View Wireframe

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 🕑 Scheduled Events (12)     View: ( List | Timeline )   [ 7 days ▾ ]    │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│                    Thu        Fri        Sat        Sun        Mon       │
│  payments:daily-settlement  ──●──────────●──────────●──────────●──────   │
│                               next: Fri 06:45                            │
│  payments:hourly-recon      ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬   │
│                               hourly at :15                              │
│  payments:weekly-report     ──○──────────────────────────○────────────   │  ← disabled
│                               disabled                                   │
│  payments:monthly-close     ──────────────────────────────────────────   │
│                               next: Jun 1 (outside horizon)              │
│                              ▲                                           │
│                             now (Thu 14:38)                              │
│  ── On demand ──────────────────────────────────────────────────────     │
│  payments:adhoc-export · payments:manual-backfill                        │
└──────────────────────────────────────────────────────────────────────────┘
```

### 4.3 Layout Anatomy

```
┌──────────────┬─────────────────────────────────────────────┬──────────────┐
│ Lane label   │  Timeline area (scrollable horizontally     │  Next-run    │
│ (event title,│  on narrow screens; day dividers + hour     │  label /     │
│ truncated,   │  ticks; markers positioned by fire time)    │  cadence     │
│ click = edit)│                                             │              │
└──────────────┴─────────────────────────────────────────────┴──────────────┘
```

- Lane label column: fixed width (~240px), title truncated with ellipsis, full title on hover.
- Marker: filled dot (enabled) / hollow dot (disabled). Dense cadence: continuous bar.
- Now-line: full-height vertical accent line with a small "now" label.
- Axis: top row with day labels (7d horizon) or hour labels (24h horizon); light vertical gridlines.

### 4.4 Interaction Details

| Interaction | Result |
|-------------|--------|
| Hover marker | Tooltip: event title, fire time, timing summary |
| Hover dense bar | Tooltip: cadence summary (e.g. "Hourly, at :15 past the hour") |
| Click marker / lane label | Opens `EventEditDialog` for that event |
| Switch List ↔ Timeline | Instant, no refetch (same in-memory event data) |
| Change horizon | Recomputes fire-time expansion only; no API call |

---

## 5. Business Rules

- **BR-ST01**: The Timeline view never mutates data; all edits go through the existing edit dialog.
- **BR-ST02**: Disabled events remain visible in the timeline (greyed) — hiding them would silently drop information the user may be looking for.
- **BR-ST03**: Events with no `timing` (on demand) never render markers; they are listed in the on-demand strip.
- **BR-ST04**: The marker density threshold (collapse to bar) is a display concern only; the underlying expansion is always computed the same way.
- **BR-ST05**: Fire times are displayed in the browser's local timezone. MVP assumption: Cronicle server timezone == user timezone for the target audience; a server/local toggle is deferred to Phase 2 and must be revisited if servers run in a different timezone.
- **BR-ST06**: The fire-time expansion must mirror Cronicle's scheduler semantics exactly — empty timing array = wildcard, all specified fields conjunctive. The interaction of `days` and `weekdays` when both are set must be verified against Cronicle source before implementation (see TSD).

---

## 6. Data & Technical Notes

### 6.1 Data Sources (all existing)

| Data | Source | Use |
|------|--------|-----|
| Event list + `timing` objects | `getSchedule` (already loaded in `CroniclePanel`) | Fire-time expansion, lane labels, enabled state |
| Filtered event set | existing `filteredEvents` in `CroniclePanel` | Drives lanes — filter integration is free |
| Edit dialog | existing `EventEditDialog` | Click-through from timeline |

### 6.2 Fire-Time Expansion

A new pure utility expands a `CronicleEvent['timing']` object into concrete fire times within `[windowStart, windowEnd]`:

```
expandTiming(timing, windowStart, windowEnd) → epochSeconds[]
```

- Input semantics mirror the existing `TimingEditor`: keys `years, months, days, weekdays, hours, minutes`; empty/absent array = wildcard.
- Implementation iterates minute-by-minute (or hour-day pruned) over the window; a 7-day window is ~10k iterations worst case per event — trivial in the browser.
- Pure function, unit-testable without the Cronicle API. Test fixtures should cover: wildcard minutes, multiple hours/minutes, weekday-restricted, day-of-month, monthly, and the `days`+`weekdays` combined case (pending BR-ST06 verification).

### 6.3 Performance Boundaries

- Expansion runs in a `useMemo` keyed on `[filteredEvents, horizon]`; recomputed only when data or horizon changes.
- Lanes render as plain SVG/divs; with ≤ a few hundred events this needs no virtualization in MVP. If a category exceeds that, render the first N lanes with a "show all" expander.

---

## 7. Workflow Scenarios

### 7.1 Inspect a Category's Schedule

```
1. Open cluster page → Cronicle panel
2. Select category "Payments" in the category filter
3. Click "Timeline" in the Scheduled Events header
   └─→ One lane per Payments event; markers show the week's fire times
   └─→ Now-line shows current position; each lane shows its next run
4. Hover a marker → exact fire time
5. Click the marker → edit dialog opens
```

### 7.2 Find a Schedule Gap

```
1. Switch to 24 hours horizon
2. Scan lanes for empty stretches
   └─→ Dense bars reveal continuous cadences; isolated dots reveal sparse ones
3. Adjust an event's timing via click-through to the edit dialog
```

---

## 8. Future Extensibility (Phase 2+)

| Feature | Description | Current Preparation |
|---------|-------------|---------------------|
| Collision density strip | Runs-per-hour histogram under the timeline; hotspots highlighted | Expansion util already returns all fire times; aggregation is a reduce |
| Actual-run overlay | ✓/✗ ticks from `getHistory` plotted into the past portion of lanes | History rows already fetched; needs time-window alignment with lanes |
| 30-day horizon | Month-scale planning | Horizon selector is a parameter; needs perf check on expansion count |
| Timezone toggle | Server-local vs browser-local axis | BR-ST05 flags the assumption; expansion util should take timezone as a parameter from the start |
| Week heatmap | 7×24 grid for pattern spotting | Same expansion util feeds it |
