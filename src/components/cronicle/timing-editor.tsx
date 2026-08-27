'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { CronicleEvent } from '@/lib/cronicle/types';

export type TimingKey = 'years' | 'months' | 'days' | 'weekdays' | 'hours' | 'minutes';

/** `false` = on demand (no schedule); otherwise full timing state (empty array = wildcard) */
export type TimingValue = false | Record<TimingKey, number[]>;

type Preset = 'demand' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';

const TIMING_KEYS: TimingKey[] = ['years', 'months', 'days', 'weekdays', 'hours', 'minutes'];

const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => {
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${ampm}`;
});
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const COMMON_MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

/** Which chip groups each preset shows (mirrors Cronicle's own event editor) */
const PRESET_GROUPS: Record<Exclude<Preset, 'demand'>, TimingKey[]> = {
  hourly: ['minutes'],
  daily: ['hours', 'minutes'],
  weekly: ['weekdays', 'hours', 'minutes'],
  monthly: ['days', 'hours', 'minutes'],
  yearly: ['months', 'days', 'hours', 'minutes'],
  custom: ['years', 'months', 'days', 'weekdays', 'hours', 'minutes'],
};

const PRESET_LABELS: [Preset, string][] = [
  ['demand', 'On Demand'],
  ['custom', 'Custom'],
  ['yearly', 'Yearly'],
  ['monthly', 'Monthly'],
  ['weekly', 'Weekly'],
  ['daily', 'Daily'],
  ['hourly', 'Hourly'],
];

/** Normalize an API timing object into full TimingValue state */
export function normalizeTiming(timing?: CronicleEvent['timing'] | false | null): TimingValue {
  if (!timing) return false;
  return {
    years: timing.years ?? [],
    months: timing.months ?? [],
    days: timing.days ?? [],
    weekdays: timing.weekdays ?? [],
    hours: timing.hours ?? [],
    minutes: timing.minutes ?? [],
  };
}

/** Convert TimingValue into the sparse object the API expects */
export function buildTiming(value: TimingValue): CronicleEvent['timing'] | false {
  if (value === false) return false;
  const out: Record<string, number[]> = {};
  for (const key of TIMING_KEYS) {
    if (value[key].length > 0) out[key] = value[key];
  }
  return out;
}

/** Preset detection, mirroring Cronicle's Schedule.class.js */
function detectPreset(value: TimingValue): Preset {
  if (value === false) return 'demand';
  const has = (k: TimingKey) => value[k].length > 0;
  if (has('years')) return 'custom';
  if (has('months') && has('weekdays')) return 'custom';
  if (has('days') && has('weekdays')) return 'custom';
  if (has('months')) return 'yearly';
  if (has('weekdays')) return 'weekly';
  if (has('days')) return 'monthly';
  if (has('hours')) return 'daily';
  return 'hourly';
}

/** Sane defaults when switching presets (mirrors Cronicle's change_edit_timing) */
function defaultsForPreset(preset: Preset, current: TimingValue): TimingValue {
  if (preset === 'demand') return false;
  const now = new Date();
  const base: Record<TimingKey, number[]> =
    current === false
      ? { years: [], months: [], days: [], weekdays: [], hours: [], minutes: [] }
      : { ...current };

  const minutes = base.minutes.length ? base.minutes : [0];
  const hours = base.hours.length ? base.hours : [now.getHours()];
  const days = base.days.length ? base.days : [now.getDate()];
  const months = base.months.length ? base.months : [now.getMonth() + 1];
  const weekdays = base.weekdays.length ? base.weekdays : [now.getDay()];

  switch (preset) {
    case 'hourly':
      return { ...base, years: [], months: [], days: [], weekdays: [], hours: [], minutes };
    case 'daily':
      return { ...base, years: [], months: [], days: [], weekdays: [], hours, minutes };
    case 'weekly':
      return { ...base, years: [], months: [], days: [], weekdays, hours, minutes };
    case 'monthly':
      return { ...base, years: [], months: [], weekdays: [], days, hours, minutes };
    case 'yearly':
      return { ...base, years: [], weekdays: [], months, days, hours, minutes };
    case 'custom':
      return { ...base, minutes };
  }
}

function formatTime(hour: number, minute: number): string {
  const ampm = hour < 12 ? 'am' : 'pm';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, '0')}${ampm}`;
}

function joinList(items: string[]): string {
  if (items.length <= 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "The event will run: …" summary */
function summarize(value: TimingValue, preset: Preset): string {
  if (value === false || preset === 'demand') return 'Manually, on demand only';

  const times = () => {
    const hours = value.hours.length ? value.hours : null;
    const minutes = value.minutes.length ? value.minutes : null;
    if (!hours && !minutes) return 'every minute';
    const hs = hours ?? Array.from({ length: 24 }, (_, i) => i);
    const ms = minutes ?? [0];
    const combos = hs.flatMap((h) => ms.map((m) => formatTime(h, m)));
    const shown = combos.slice(0, 4);
    const suffix = combos.length > 4 ? ` (+${combos.length - 4} more)` : '';
    const prefix = !hours ? 'every hour at ' : '';
    return prefix + joinList(shown) + suffix;
  };

  const minuteList = (cap: number) => {
    const mins = value.minutes.map((m) => `:${String(m).padStart(2, '0')}`);
    const shown = mins.slice(0, cap);
    return joinList(shown) + (mins.length > cap ? ` (+${mins.length - cap} more)` : '');
  };

  switch (preset) {
    case 'hourly':
      return `Hourly, at ${value.minutes.length ? minuteList(6) : 'every minute'} past the hour`;
    case 'daily':
      return `Daily at ${times()}`;
    case 'weekly':
      return `Weekly on ${value.weekdays.length ? joinList(value.weekdays.map((d) => WEEKDAY_LABELS[d])) : 'every day'} at ${times()}`;
    case 'monthly':
      return `Monthly on day ${value.days.length ? joinList(value.days.map(String)) : 'every day'} at ${times()}`;
    case 'yearly':
      return `Yearly on ${value.months.length ? joinList(value.months.map((m) => MONTH_LABELS[m - 1])) : 'every month'} ${value.days.length ? joinList(value.days.map(String)) : 'every day'} at ${times()}`;
    case 'custom':
      return 'Custom schedule';
  }
}

/** Human-readable schedule summary for an API timing object, e.g. "Daily at 6:45am" */
export function summarizeTiming(timing?: CronicleEvent['timing'] | false | null): string {
  const value = normalizeTiming(timing);
  return summarize(value, detectPreset(value));
}

function Chip({
  label,
  selected,
  onToggle,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'rounded border px-1.5 py-0.5 text-xs font-mono transition-colors',
        selected
          ? 'border-blue-600 bg-blue-600 text-white'
          : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
      )}
    >
      {label}
    </button>
  );
}

interface TimingEditorProps {
  value: TimingValue;
  onChange: (value: TimingValue) => void;
}

/**
 * Cronicle-native visual timing editor: preset dropdown + checkbox-chip grids,
 * mirroring Cronicle's own event editor (presets, defaults, empty = wildcard).
 */
export function TimingEditor({ value, onChange }: TimingEditorProps) {
  const [preset, setPreset] = useState<Preset>(() => detectPreset(value));
  const [showAllMinutes, setShowAllMinutes] = useState(false);
  const [yearsText, setYearsText] = useState(() =>
    value === false ? '' : value.years.join(', ')
  );

  const arrays: Record<TimingKey, number[]> =
    value === false
      ? { years: [], months: [], days: [], weekdays: [], hours: [], minutes: [] }
      : value;

  const changePreset = (next: Preset) => {
    setPreset(next);
    onChange(defaultsForPreset(next, value));
  };

  const toggle = (key: TimingKey, n: number) => {
    if (value === false) return;
    const current = value[key];
    const next = current.includes(n)
      ? current.filter((v) => v !== n)
      : [...current, n].sort((a, b) => a - b);
    onChange({ ...value, [key]: next });
  };

  const applyYears = (raw: string) => {
    setYearsText(raw);
    if (value === false) return;
    const years = raw
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    onChange({ ...value, years: [...new Set(years)].sort((a, b) => a - b) });
  };

  const groups = preset === 'demand' ? [] : PRESET_GROUPS[preset];
  const minuteValues = showAllMinutes ? Array.from({ length: 60 }, (_, i) => i) : COMMON_MINUTES;

  const chipGroup = (key: TimingKey, label: string, values: number[], labels: string[]) => (
    <div key={key} className="space-y-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <div className="flex flex-wrap gap-1">
        {values.map((n) => (
          <Chip
            key={n}
            label={labels[n]}
            selected={arrays[key].includes(n)}
            onToggle={() => toggle(key, n)}
          />
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <Select value={preset} onValueChange={(v) => changePreset(v as Preset)}>
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRESET_LABELS.map(([p, label]) => (
            <SelectItem key={p} value={p}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {preset !== 'demand' && (
        <div className="space-y-3 rounded-md border p-3">
          {groups.includes('years') && (
            <div className="space-y-1">
              <Label className="text-xs text-slate-500">Years (comma-separated)</Label>
              <Input
                value={yearsText}
                onChange={(e) => applyYears(e.target.value)}
                placeholder="e.g. 2026, 2027 — empty means every year"
              />
            </div>
          )}
          {groups.includes('months') &&
            chipGroup('months', 'Months', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], ['', ...MONTH_LABELS])}
          {groups.includes('days') &&
            chipGroup(
              'days',
              'Days',
              Array.from({ length: 31 }, (_, i) => i + 1),
              Array.from({ length: 32 }, (_, i) => String(i))
            )}
          {groups.includes('weekdays') &&
            chipGroup('weekdays', 'Weekdays', [0, 1, 2, 3, 4, 5, 6], WEEKDAY_LABELS)}
          {groups.includes('hours') &&
            chipGroup('hours', 'Hours', Array.from({ length: 24 }, (_, i) => i), HOUR_LABELS)}
          {groups.includes('minutes') && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-slate-500">
                Minutes{' '}
                <button
                  type="button"
                  className="text-blue-600 hover:underline font-normal"
                  onClick={() => setShowAllMinutes(!showAllMinutes)}
                >
                  ({showAllMinutes ? 'Show Common' : 'Show All'})
                </button>
              </span>
              <div className="flex flex-wrap gap-1">
                {minuteValues.map((n) => (
                  <Chip
                    key={n}
                    label={`:${String(n).padStart(2, '0')}`}
                    selected={arrays.minutes.includes(n)}
                    onToggle={() => toggle('minutes', n)}
                  />
                ))}
              </div>
            </div>
          )}
          <p className="text-xs text-slate-500">
            The event will run: <span className="font-medium">{summarize(value, preset)}</span>
          </p>
        </div>
      )}
      {preset === 'demand' && (
        <p className="text-xs text-slate-500">
          The event will run: <span className="font-medium">{summarize(value, preset)}</span>
        </p>
      )}
    </div>
  );
}
