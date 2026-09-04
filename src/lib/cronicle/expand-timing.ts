/**
 * Expands a Cronicle event `timing` object into concrete fire times within a
 * window. Semantics mirror Cronicle's scheduler (lib/scheduler.js,
 * checkEventTimingMoment): every non-empty field must match (conjunctive,
 * including days AND weekdays), empty/absent array = wildcard, minute
 * granularity, evaluated in the event's timezone (default: browser-local).
 *
 * Pure module — no React, no API access.
 */

import type { CronicleEvent } from './types';

export interface ExpandResult {
  /** Epoch seconds, ascending, within [windowStart, windowEnd) */
  fireTimes: number[];
  /** True when the result was capped at MAX_FIRE_TIMES */
  truncated: boolean;
}

export const MAX_FIRE_TIMES = 5000;

const DAY_SECONDS = 86400;

interface ZonedDateTime {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  weekday: number; // 0 = Sunday
  hour: number; // 0-23
  minute: number; // 0-59
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

// Intl formatters are expensive to construct — cache one per timezone
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timezone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    });
    formatterCache.set(timezone, fmt);
  }
  return fmt;
}

const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Calendar + clock parts of an instant in the given timezone */
export function zonedDateTime(epochSec: number, timezone?: string): ZonedDateTime {
  const date = new Date(epochSec * 1000);
  if (!timezone || timezone === browserTimezone) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      weekday: date.getDay(),
      hour: date.getHours(),
      minute: date.getMinutes(),
    };
  }
  const parts: Record<string, string> = {};
  for (const p of getFormatter(timezone).formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    weekday: WEEKDAY_INDEX[parts.weekday],
    hour: parseInt(parts.hour, 10) % 24,
    minute: parseInt(parts.minute, 10),
  };
}

/**
 * Epoch of a wall-clock time in the given timezone. For the ambiguous
 * fall-back hour the first occurrence wins; nonexistent spring-forward times
 * resolve to a nearby instant (same as Cronicle's moment.tz behavior).
 */
export function epochOf(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone?: string
): number {
  if (!timezone || timezone === browserTimezone) {
    return new Date(year, month - 1, day, hour, minute).getTime() / 1000;
  }
  const target = Date.UTC(year, month - 1, day, hour, minute) / 1000;
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = zonedDateTime(guess, timezone);
    const actual = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) / 1000;
    const diff = target - actual;
    if (diff === 0) return guess;
    guess += diff;
  }
  return guess;
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

/**
 * Expand `timing` into fire times within [windowStart, windowEnd).
 * Day-level fields (years/months/days/weekdays) filter whole days first —
 * conjunctive, matching Cronicle — then the hours × minutes cartesian product
 * produces the day's fire times.
 */
export function expandTiming(
  timing: CronicleEvent['timing'],
  windowStart: number,
  windowEnd: number,
  timezone?: string
): ExpandResult {
  const fireTimes: number[] = [];
  if (!timing) return { fireTimes, truncated: false };

  const hours = timing.hours?.length ? timing.hours : range(0, 23);
  const minutes = timing.minutes?.length ? timing.minutes : range(0, 59);
  let truncated = false;
  let lastDateKey = -1;

  // Step the cursor in absolute 24h increments. Across a DST transition the
  // zoned time-of-day shifts by ±1h, so a step can land on the same calendar
  // date twice (25h day) — the date-key dedupe handles repeats, and the loop
  // extends one day past windowEnd so a stalled step never drops the final
  // day. A step can never skip a date (the shift is at most ±1h).
  outer: for (let cursor = windowStart; cursor < windowEnd + DAY_SECONDS; cursor += DAY_SECONDS) {
    const p = zonedDateTime(cursor, timezone);
    const dateKey = p.year * 10000 + p.month * 100 + p.day;
    if (dateKey === lastDateKey) continue;
    lastDateKey = dateKey;

    if (timing.years?.length && !timing.years.includes(p.year)) continue;
    if (timing.months?.length && !timing.months.includes(p.month)) continue;
    if (timing.days?.length && !timing.days.includes(p.day)) continue;
    if (timing.weekdays?.length && !timing.weekdays.includes(p.weekday)) continue;

    for (const h of hours) {
      for (const m of minutes) {
        const t = epochOf(p.year, p.month, p.day, h, m, timezone);
        if (t >= windowStart && t < windowEnd) {
          fireTimes.push(t);
          if (fireTimes.length >= MAX_FIRE_TIMES) {
            truncated = true;
            break outer;
          }
        }
      }
    }
  }

  fireTimes.sort((a, b) => a - b);
  return { fireTimes, truncated };
}
