/** Smoke render of ScheduleTimeline with fixture events. Run: npx tsx scripts/verify-schedule-timeline.tsx */
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { ScheduleTimeline } from '../src/components/cronicle/schedule-timeline';
import type { CronicleEvent } from '../src/lib/cronicle/types';

const events: CronicleEvent[] = [
  {
    id: 'e1',
    title: 'payments:prod:daily-settlement',
    category: 'c1',
    plugin: 'p',
    target: 't',
    enabled: 1,
    timing: { hours: [6], minutes: [45] },
  },
  {
    id: 'e2',
    title: 'payments:prod:hourly-recon',
    category: 'c1',
    plugin: 'p',
    target: 't',
    enabled: 1,
    timing: { minutes: [15] },
  },
  {
    id: 'e3',
    title: 'payments:prod:weekly-report',
    category: 'c1',
    plugin: 'p',
    target: 't',
    enabled: 0,
    timing: { weekdays: [5], hours: [18], minutes: [0] },
  },
  {
    id: 'e4',
    title: 'payments:prod:ny-only-job',
    category: 'c1',
    plugin: 'p',
    target: 't',
    enabled: 1,
    timing: { hours: [9], minutes: [0] },
    timezone: 'America/New_York',
  },
  {
    id: 'e5',
    title: 'payments:prod:adhoc-export',
    category: 'c1',
    plugin: 'p',
    target: 't',
    enabled: 1,
  },
];

const html = renderToString(
  createElement(ScheduleTimeline, { events, onEditEvent: () => {} })
);

for (const needle of [
  'daily-settlement',
  'hourly-recon',
  'weekly-report',
  'ny-only-job',
  'adhoc-export',
  'On demand',
  'disabled',
  'next:',
  'now',
  '24 hours',
  '7 days',
]) {
  if (!html.includes(needle)) {
    console.error(`MISSING: ${needle}`);
    process.exit(1);
  }
}

const empty = renderToString(
  createElement(ScheduleTimeline, { events: [], onEditEvent: () => {} })
);
if (!empty.includes('No events in this category.')) {
  console.error('MISSING: empty state');
  process.exit(1);
}

console.log('schedule timeline smoke render OK');
