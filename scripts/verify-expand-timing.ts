/**
 * Assertion script for src/lib/cronicle/expand-timing.ts (no test runner in
 * this project). Run with: npx tsx scripts/verify-expand-timing.ts
 */

import assert from 'node:assert/strict';
import { expandTiming, epochOf, MAX_FIRE_TIMES } from '../src/lib/cronicle/expand-timing';

const HOUR = 3600;
const DAY = 86400;
// 2026-01-05 is a Monday; 2026-01-01 is a Thursday
const MON_JAN5 = Date.UTC(2026, 0, 5, 0, 0) / 1000;

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok ${passed} — ${name}`);
}

test('undefined timing → no fire times', () => {
  assert.deepEqual(expandTiming(undefined, MON_JAN5, MON_JAN5 + DAY, 'UTC'), {
    fireTimes: [],
    truncated: false,
  });
});

test('wildcard hours+minutes → 1440 fire times per day', () => {
  const { fireTimes } = expandTiming({}, MON_JAN5, MON_JAN5 + DAY, 'UTC');
  assert.equal(fireTimes.length, 1440);
  assert.equal(fireTimes[0], MON_JAN5);
});

test('daily at fixed hour+minutes → exact epochs', () => {
  const { fireTimes } = expandTiming(
    { hours: [6], minutes: [30, 45] },
    MON_JAN5,
    MON_JAN5 + DAY,
    'UTC'
  );
  assert.deepEqual(fireTimes, [
    Date.UTC(2026, 0, 5, 6, 30) / 1000,
    Date.UTC(2026, 0, 5, 6, 45) / 1000,
  ]);
});

test('hours × minutes cartesian product', () => {
  const { fireTimes } = expandTiming(
    { hours: [1, 2, 3], minutes: [0, 30] },
    MON_JAN5,
    MON_JAN5 + 2 * DAY,
    'UTC'
  );
  assert.equal(fireTimes.length, 12);
});

test('weekday-restricted: Mondays only', () => {
  const { fireTimes } = expandTiming(
    { weekdays: [1], hours: [9], minutes: [0] },
    MON_JAN5,
    MON_JAN5 + 7 * DAY,
    'UTC'
  );
  assert.deepEqual(fireTimes, [Date.UTC(2026, 0, 5, 9, 0) / 1000]);
});

test('day-of-month across a month boundary', () => {
  const start = Date.UTC(2026, 0, 1) / 1000;
  const { fireTimes } = expandTiming(
    { days: [1], hours: [0], minutes: [0] },
    start,
    Date.UTC(2026, 1, 15) / 1000,
    'UTC'
  );
  assert.deepEqual(fireTimes, [Date.UTC(2026, 0, 1) / 1000, Date.UTC(2026, 1, 1) / 1000]);
});

test('days AND weekdays are conjunctive (Cronicle scheduler.js:261-271)', () => {
  const start = Date.UTC(2026, 0, 1) / 1000;
  const end = Date.UTC(2026, 1, 1) / 1000;
  // Jan 5 2026 is both the 5th and a Monday → fires
  const hit = expandTiming({ days: [5], weekdays: [1], hours: [12], minutes: [0] }, start, end, 'UTC');
  assert.deepEqual(hit.fireTimes, [Date.UTC(2026, 0, 5, 12, 0) / 1000]);
  // Jan 6 2026 is the 6th but a Tuesday → no day matches both
  const miss = expandTiming({ days: [6], weekdays: [1], hours: [12], minutes: [0] }, start, end, 'UTC');
  assert.equal(miss.fireTimes.length, 0);
});

test('months + years restriction', () => {
  const start = Date.UTC(2026, 0, 1) / 1000;
  const { fireTimes } = expandTiming(
    { years: [2027], months: [2], days: [14], hours: [8], minutes: [0] },
    start,
    Date.UTC(2028, 0, 1) / 1000,
    'UTC'
  );
  assert.deepEqual(fireTimes, [Date.UTC(2027, 1, 14, 8, 0) / 1000]);
});

test('window bounds: start inclusive, end exclusive', () => {
  const { fireTimes } = expandTiming(
    { hours: [10], minutes: [0] },
    Date.UTC(2026, 0, 5, 10, 0) / 1000,
    Date.UTC(2026, 0, 6, 10, 0) / 1000,
    'UTC'
  );
  assert.deepEqual(fireTimes, [Date.UTC(2026, 0, 5, 10, 0) / 1000]);
});

test('timezone: America/New_York across spring-forward DST (2026-03-08)', () => {
  const start = Date.UTC(2026, 2, 6, 5, 0) / 1000; // Mar 6 00:00 EST (UTC-5)
  const { fireTimes } = expandTiming(
    { hours: [6], minutes: [30] },
    start,
    start + 4 * DAY,
    'America/New_York'
  );
  assert.deepEqual(fireTimes, [
    Date.UTC(2026, 2, 6, 11, 30) / 1000, // EST (UTC-5)
    Date.UTC(2026, 2, 7, 11, 30) / 1000, // EST
    Date.UTC(2026, 2, 8, 10, 30) / 1000, // EDT (UTC-4) after spring forward
    Date.UTC(2026, 2, 9, 10, 30) / 1000, // EDT
  ]);
});

test('timezone: America/New_York fall-back keeps wall-clock time (2026-11-01)', () => {
  const start = Date.UTC(2026, 9, 31, 4, 0) / 1000; // Oct 31 00:00 EDT (UTC-4)
  const { fireTimes } = expandTiming(
    { hours: [1], minutes: [30] },
    start,
    start + 3 * DAY,
    'America/New_York'
  );
  assert.deepEqual(fireTimes, [
    Date.UTC(2026, 9, 31, 5, 30) / 1000, // EDT (UTC-4)
    Date.UTC(2026, 10, 1, 5, 30) / 1000, // ambiguous hour → first occurrence (EDT)
    Date.UTC(2026, 10, 2, 6, 30) / 1000, // EST (UTC-5)
  ]);
});

test('epochOf round-trips through zoned wall-clock', () => {
  const t = epochOf(2026, 6, 15, 14, 45, 'America/New_York');
  assert.equal(t, Date.UTC(2026, 5, 15, 18, 45) / 1000); // EDT (UTC-4)
});

test('every-minute event over 7 days → capped and flagged truncated', () => {
  const { fireTimes, truncated } = expandTiming({}, MON_JAN5, MON_JAN5 + 7 * DAY, 'UTC');
  assert.equal(truncated, true);
  assert.equal(fireTimes.length, MAX_FIRE_TIMES);
});

test('fires before the window on a matching day are excluded', () => {
  // Day matches, but the fire time precedes windowStart
  const { fireTimes } = expandTiming(
    { hours: [6], minutes: [0] },
    MON_JAN5 + 12 * HOUR, // window starts at noon
    MON_JAN5 + DAY,
    'UTC'
  );
  assert.equal(fireTimes.length, 0);
});

console.log(`\n${passed} assertions passed`);
