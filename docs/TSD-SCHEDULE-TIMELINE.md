# Technical Specification Document
## Cronicle Schedule Timeline View

### Version: 1.0
### Date: 2026-09-04
### Status: Draft
### FSD Reference: docs/FSD-SCHEDULE-TIMELINE.md

---

## 1. Architecture Overview

Pure front-end feature. One new pure utility module and one new presentational component, wired into the existing `CroniclePanel`. No API, database, or extension changes.

```
┌────────────────────────────────────────────────────────────────┐
│ CroniclePanel (src/components/cronicle/cronicle-panel.tsx)     │
│                                                                │
│   state: view: 'list' | 'timeline'        (default 'list')     │
│                                                                │
│   Scheduled Events section header:                             │
│     [ List | Timeline ] segmented toggle                       │
│                                                                │
│   view === 'list'     → existing <Table> (unchanged)           │
│   view === 'timeline' → <ScheduleTimeline>                     │
│                          │                                     │
│      props: events={filteredEvents}   ← same filter pipeline   │
│             onEditEvent={setEditEvent}  ← existing dialog      │
└──────────────────────────┼─────────────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────────────┐
│ ScheduleTimeline (src/components/cronicle/schedule-timeline.tsx)│
│   - horizon state: '24h' | '7d' (default '7d')                 │
│   - builds Lane[] via useMemo(events, horizon)                 │
│   - renders axis, lanes, markers, now-line, on-demand strip    │
└──────────────────────────┼─────────────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────────────┐
│ expandTiming (src/lib/cronicle/expand-timing.ts) — pure        │
│   expandTiming(timing, windowStart, windowEnd, timezone?)      │
│     → { fireTimes: number[], truncated: boolean }              │
└────────────────────────────────────────────────────────────────┘
```

---

## 2. Cronicle Scheduler Semantics (verified)

Verified against Cronicle master, `lib/scheduler.js`:

- **Conjunctive matching** — `checkEventTimingMoment()` (scheduler.js:261-271): each field that is present and non-empty must match; otherwise the minute is skipped. Empty/absent array = wildcard. **`days` and `weekdays` are ANDed** when both are set (resolves FSD BR-ST06).
- **Minute granularity** — the scheduler ticks minute-by-minute (scheduler.js:119-134); fire times are always whole minutes.
- **Timezone** — matching evaluates `moment.tz(cursor * 1000, item.timezone || self.tz)` (scheduler.js:126): each event may carry its own `timezone` (IANA name), falling back to the Cronicle server timezone. Our `CronicleEvent` type does not yet declare this field (see §3).
- **Field ranges** (from moment accessors): `minutes` 0–59, `hours` 0–23, `weekdays` 0–6 (0 = Sunday), `days` 1–31 (day of month), `months` 1–12, `years` 4-digit.

---

## 3. Data Model & Types

### 3.1 Type addition (`src/lib/cronicle/types.ts`)

```ts
export interface CronicleEvent {
  // ...existing fields...
  /** IANA timezone name; server timezone applies when absent (Cronicle scheduler.js:126) */
  timezone?: string;
}
```

### 3.2 Lane model (internal to `schedule-timeline.tsx`)

```ts
interface Lane {
  event: CronicleEvent;
  kind: 'scheduled' | 'on-demand';
  fireTimes: number[];      // epoch seconds within window, sorted
  dense: boolean;           // fireTimes.length > DENSE_THRESHOLD
  nextRun: number | null;   // first fire time > now, searching past window if needed
  timingSummary: string;    // existing summarizeTiming(event.timing)
}
```

---

## 4. `expandTiming` Utility

### 4.1 Contract

```ts
// src/lib/cronicle/expand-timing.ts
export interface ExpandResult {
  fireTimes: number[];   // epoch seconds, ascending, within [windowStart, windowEnd)
  truncated: boolean;    // true when capped at MAX_FIRE_TIMES
}

export function expandTiming(
  timing: CronicleEvent['timing'],
  windowStart: number,   // epoch seconds (inclusive)
  windowEnd: number,     // epoch seconds (exclusive)
  timezone?: string      // IANA name; defaults to browser-local
): ExpandResult;
```

Returns `{ fireTimes: [], truncated: false }` for missing/falsy timing (on-demand events — caller handles separately).

### 4.2 Algorithm

Day-level prefilter + cartesian product — no minute-stepping:

```
for each calendar day D in [windowStart, windowEnd), evaluated in `timezone`:
    parts = zonedParts(D)                       // { year, month, day, weekday }
    if timing.years    non-empty and parts.year    ∉ timing.years    → skip
    if timing.months   non-empty and parts.month   ∉ timing.months   → skip
    if timing.days     non-empty and parts.day     ∉ timing.days     → skip
    if timing.weekdays non-empty and parts.weekday ∉ timing.weekdays → skip
    hours   = timing.hours   non-empty ? timing.hours   : 0..23
    minutes = timing.minutes non-empty ? timing.minutes : 0..59
    for h in hours, m in minutes:
        t = epochOf(parts.year, parts.month, parts.day, h, m, timezone)
        if windowStart <= t < windowEnd: emit t
```

- **Day iteration**: step an epoch cursor by exactly 86400s from `windowStart`; the zoned calendar date advances by exactly one per step even across DST transitions (zoned days are 23–25h, so an absolute 24h step can neither repeat nor skip a date).
- **`zonedParts`** fast path: when `timezone` is undefined or equals the browser tz, use plain `Date` getters. Otherwise use `Intl.DateTimeFormat(timezone).formatToParts()` with `hourCycle: 'h23'`.
- **`epochOf`** (wall-clock → epoch in tz): initial guess `Date.UTC(y, mo-1, d, h, m)`, compute zoned parts of the guess, adjust by the difference; repeat up to 3 times (covers DST transitions). On the fall-back ambiguity, take the first occurrence.
- **Constants**: `MAX_FIRE_TIMES = 5000` (cap → `truncated: true`, lane renders dense).
- All functions pure and exported individually for testability.

### 4.3 Correctness notes

- Semantics match §2 exactly: day-level fields conjunctive at day granularity; hour×minute cartesian product reproduces Cronicle's per-minute AND check.
- `nextRun` beyond the window: call `expandTiming(timing, now, now + 366d, tz)` and take the first element. The day-level prefilter keeps this cheap (≤ 400 day checks, emitting minutes only on matching days). If empty: nextRun = null → lane shows "no upcoming run".

---

## 5. `ScheduleTimeline` Component

### 5.1 Props & state

```tsx
interface ScheduleTimelineProps {
  events: CronicleEvent[];                  // already filtered by CroniclePanel
  onEditEvent: (event: CronicleEvent) => void;
}
```

Internal state: `horizon: '24h' | '7d'` (default `'7d'`). No other state; hover tooltips via native `title` attribute (MVP — the panel already uses `title` tooltips throughout, e.g. the Timing column).

### 5.2 Time window

| Horizon | windowStart | windowEnd |
|---------|-------------|-----------|
| 24h | start of current hour minus 1h | windowStart + 25h |
| 7d | start of today | windowStart + 7d |

The lead-in puts a slice of the recent past left of the now-line (Phase 2 will overlay actual runs there).

### 5.3 Rendering approach

Plain absolutely-positioned `div`s inside a relatively-positioned lane track — no charting/SVG dependency:

- Position of a marker: `left = ((t - windowStart) / (windowEnd - windowStart)) * 100%`.
- **Lane row**: fixed-height flex row = label cell (fixed `w-60`, truncated title, click → `onEditEvent`) + track cell (`relative flex-1`) + right cell (`w-40`, next-run label).
- **Marker**: 8px filled dot (`bg-blue-500`) for enabled events; hollow (`border border-slate-400 bg-transparent`) for disabled. `title` = event title + localized fire time + timing summary (FST-009).
- **Dense bar**: when `dense`, a full-width low bar (`h-1.5 bg-blue-200`) across the fire-time span instead of dots; `title` = timing summary (FST-008).
- **Now-line**: absolute full-height `w-px` accent line at `left = now%`, rendered in every lane track; a small "now" chip on the axis row.
- **Axis row** (top): day labels with light vertical gridlines for 7d; hour ticks for 24h. Same percentage math as markers.
- **On-demand strip** (bottom, FST-007): separator label "On demand", one line listing event titles as clickable chips (click → `onEditEvent`). Not rendered when empty.
- **Horizon selector** (FST-003): small segmented control top-right of the timeline ("24 hours | 7 days"), styled like existing outline `Button`s.
- **Disabled lanes**: label and next-run text in `text-slate-400` (FST-006).

### 5.4 Memoization

```ts
const lanes = useMemo<Lane[]>(
  () => events.map(buildLane),
  [events, horizonKey]   // horizonKey = horizon + current day/hour boundary
);
```

`buildLane` calls `expandTiming` for the window and (when the window yields no future fire) once more for the nextRun search. Recomputes only when the filtered event list or horizon changes.

### 5.5 Empty states (FST-012)

- `events.length === 0` → "No events in this category." (mirrors the table's empty row)
- All events on-demand → only the on-demand strip renders.

---

## 6. `CroniclePanel` Integration

Changes confined to `src/components/cronicle/cronicle-panel.tsx`:

1. **State**: `const [view, setView] = useState<'list' | 'timeline'>('list')`.
2. **Section header** (currently `cronicle-panel.tsx:892-895`): append a segmented toggle after "Scheduled Events (N)":
   ```tsx
   <div className="ml-auto flex rounded-md border">
     <Button variant={view === 'list' ? 'secondary' : 'ghost'} size="sm" onClick={() => setView('list')}>List</Button>
     <Button variant={view === 'timeline' ? 'secondary' : 'ghost'} size="sm" onClick={() => setView('timeline')}>Timeline</Button>
   </div>
   ```
3. **Conditional render**: keep the existing table JSX for `view === 'list'`; render
   ```tsx
   <ScheduleTimeline events={filteredEvents} onEditEvent={setEditEvent} />
   ```
   otherwise. `filteredEvents` and `setEditEvent` already exist — filter integration (FST-011) and click-to-edit (FST-010) require no additional wiring.
4. No changes to bulk-selection logic: switching to Timeline clears nothing; selection state persists but the bulk toolbar still swaps in only when `selection.size > 0` (selection is only reachable from List view, acceptable for MVP).

---

## 7. Performance

| Concern | Budget | Basis |
|---------|--------|-------|
| Expansion per event (7d window) | < 1 ms typical | ≤ 8 day checks + hour×minute product; worst case every-minute event = 10 080 emits, still trivial |
| Expansion, nextRun search (366d) | < 5 ms | ≤ 400 day-level checks; minutes emitted only on matching days |
| Recompute trigger | data or horizon change only | `useMemo`; no recompute on poll ticks — `filteredEvents` identity changes only on loadData/filter change |
| Lane count | ≤ few hundred, no virtualization | FSD §6.3; beyond that the panel table itself is already the bottleneck |

Note: `filteredEvents` is recomputed (new array identity) on every render of `CroniclePanel` — including the 5s active-job poll. To keep the memo effective, `CroniclePanel` should wrap `filteredEvents` in its own `useMemo` keyed on `[events, search, selectedServices, selectedEventNames, selectedCategory]` (small, independent improvement included in this change).

---

## 8. Testing & Verification

The project has **no test runner** (`package.json` scripts: dev/build/lint only). Rather than adding a dependency, the expansion util ships with a plain assertion script:

- **`scripts/verify-expand-timing.ts`** — runnable via `npx tsx scripts/verify-expand-timing.ts` (`tsx` is already used by `scripts/migrate.ts`, no new dependency). Uses `node:assert`. Fixtures:
  - wildcard minutes → 60 fire times/day
  - daily at specific hour+minutes → exact expected epochs
  - multiple hours × multiple minutes → cartesian count
  - weekday-restricted → correct weekdays only
  - day-of-month (e.g. 1st) across a month boundary
  - `days` **and** `weekdays` both set → intersection only (the §2 conjunction rule)
  - months + years restricted
  - empty timing → empty result
  - explicit `timezone` (e.g. `America/New_York`) across a DST boundary → correct wall-clock fires, no duplicate/skipped day
  - cap: every-minute event over 7d → `truncated: true`
- **Manual UI verification**: `pnpm dev`, open a cluster's Cronicle panel with a loaded schedule; toggle List/Timeline; compare marker positions against Cronicle's own UI ("Event will run: …" text) for a handful of events.
- `pnpm lint` and `pnpm build` must pass.

---

## 9. File-by-File Change List

| File | Change |
|------|--------|
| `src/lib/cronicle/expand-timing.ts` | **New** — `expandTiming`, `zonedParts`, `epochOf` helpers |
| `src/components/cronicle/schedule-timeline.tsx` | **New** — `ScheduleTimeline` component |
| `src/components/cronicle/cronicle-panel.tsx` | View toggle state + segmented control + conditional render; memoize `filteredEvents` |
| `src/lib/cronicle/types.ts` | Add optional `timezone` to `CronicleEvent` |
| `scripts/verify-expand-timing.ts` | **New** — assertion script (no new deps) |

---

## 10. Out of Scope (Phase 2, per FSD §8)

- Collision density strip, actual-run overlay from history, 30d horizon.
- Rich tooltip component (MVP uses native `title`).
- Server-timezone axis toggle — MVP displays browser-local times; per-event `timezone` *is* honored by `expandTiming` when present, since it affects correctness, not just display.
