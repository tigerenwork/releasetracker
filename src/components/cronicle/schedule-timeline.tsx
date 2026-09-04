'use client';

import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import type { CronicleEvent } from '@/lib/cronicle/types';
import { expandTiming } from '@/lib/cronicle/expand-timing';
import { summarizeTiming } from '@/components/cronicle/timing-editor';

type Horizon = '24h' | '7d';

/** Lanes with more fire times than this in the window render as a bar */
const DENSE_THRESHOLD = 48;
/** How far past the window to search for the next upcoming run */
const NEXT_RUN_SEARCH_SECONDS = 366 * 86400;

interface Lane {
  event: CronicleEvent;
  fireTimes: number[];
  dense: boolean;
  nextRun: number | null;
  summary: string;
}

interface Tick {
  /** 0–1 position within the window */
  pos: number;
  label: string;
}

function computeWindow(horizon: Horizon, now: number): [number, number] {
  if (horizon === '24h') {
    // One hour of lead-in so the recent past is visible left of the now-line
    const start = Math.floor(now / 3600) * 3600 - 3600;
    return [start, start + 25 * 3600];
  }
  const d = new Date(now * 1000);
  d.setHours(0, 0, 0, 0);
  const start = d.getTime() / 1000;
  return [start, start + 7 * 86400];
}

function buildLane(event: CronicleEvent, windowStart: number, windowEnd: number, now: number): Lane {
  const summary = summarizeTiming(event.timing);
  const { fireTimes, truncated } = expandTiming(event.timing, windowStart, windowEnd, event.timezone);
  let nextRun = fireTimes.find((t) => t > now) ?? null;
  if (nextRun === null) {
    // Nothing left in the window — look ahead so the lane can still say when
    const future = expandTiming(event.timing, now, now + NEXT_RUN_SEARCH_SECONDS, event.timezone);
    nextRun = future.fireTimes[0] ?? null;
  }
  return {
    event,
    fireTimes,
    dense: truncated || fireTimes.length > DENSE_THRESHOLD,
    nextRun,
    summary,
  };
}

function formatNextRun(nextRun: number, windowEnd: number): string {
  const d = new Date(nextRun * 1000);
  if (nextRun < windowEnd) {
    return `next: ${d.toLocaleString(undefined, {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    })}`;
  }
  return `next: ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

interface ScheduleTimelineProps {
  /** Events to plot — the panel's filtered list, so all filters apply */
  events: CronicleEvent[];
  onEditEvent: (event: CronicleEvent) => void;
}

/**
 * Visual schedule for the filtered Cronicle events (FSD-SCHEDULE-TIMELINE):
 * one swimlane per event with markers at each computed fire time.
 * Read-only — edits go through onEditEvent (the panel's edit dialog).
 */
export function ScheduleTimeline({ events, onEditEvent }: ScheduleTimelineProps) {
  const [horizon, setHorizon] = useState<Horizon>('7d');
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  // Keep the now-line moving; the window only shifts on the hour/day boundary
  useEffect(() => {
    const interval = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 60_000);
    return () => clearInterval(interval);
  }, []);

  const { lanes, windowStart, windowEnd } = useMemo(() => {
    const [ws, we] = computeWindow(horizon, now);
    return {
      lanes: events.filter((e) => e.timing).map((e) => buildLane(e, ws, we, now)),
      windowStart: ws,
      windowEnd: we,
    };
  }, [events, horizon, now]);

  const onDemand = events.filter((e) => !e.timing);

  const ticks = useMemo<Tick[]>(() => {
    const span = windowEnd - windowStart;
    const out: Tick[] = [];
    if (horizon === '7d') {
      for (let i = 0; i < 7; i++) {
        const t = windowStart + i * 86400;
        out.push({
          pos: (i * 86400) / span,
          label: new Date(t * 1000).toLocaleDateString(undefined, {
            weekday: 'short',
            day: 'numeric',
          }),
        });
      }
    } else {
      for (let t = windowStart; t < windowEnd; t += 2 * 3600) {
        out.push({
          pos: (t - windowStart) / span,
          label: new Date(t * 1000).toLocaleTimeString(undefined, { hour: 'numeric' }),
        });
      }
    }
    return out;
  }, [horizon, windowStart, windowEnd]);

  const span = windowEnd - windowStart;
  const nowPct = Math.min(100, Math.max(0, ((now - windowStart) / span) * 100));
  const posPct = (t: number) => ((t - windowStart) / span) * 100;

  if (events.length === 0) {
    return (
      <div className="rounded-md border px-3 py-4 text-center text-sm text-slate-400">
        No events in this category.
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      {/* Horizon selector */}
      <div className="flex items-center justify-end gap-2 px-2 py-1.5">
        <div className="flex rounded-md border">
          {(
            [
              ['24h', '24 hours'],
              ['7d', '7 days'],
            ] as const
          ).map(([h, label]) => (
            <button
              key={h}
              className={cn(
                'px-2 py-1 text-xs transition-colors',
                horizon === h ? 'bg-slate-100 font-medium' : 'text-slate-500 hover:text-slate-700'
              )}
              onClick={() => setHorizon(h)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          {/* Axis row */}
          <div className="flex h-6 items-center">
            <div className="w-60 shrink-0" />
            <div className="relative h-full flex-1">
              {ticks.map((t, i) => (
                <span
                  key={i}
                  className="absolute top-1 -translate-x-1/2 text-[10px] text-slate-400 whitespace-nowrap"
                  style={{ left: `${t.pos * 100}%` }}
                >
                  {t.label}
                </span>
              ))}
              <span
                className="absolute top-1 -translate-x-1/2 text-[10px] font-medium text-red-500 whitespace-nowrap"
                style={{ left: `${nowPct}%` }}
              >
                now
              </span>
            </div>
            <div className="w-40 shrink-0" />
          </div>

          {/* Lanes */}
          {lanes.map((lane) => {
            const enabled = !!lane.event.enabled;
            return (
              <div key={lane.event.id} className="flex h-9 items-center border-t">
                <button
                  className={cn(
                    'w-60 shrink-0 truncate px-2 text-left text-xs hover:text-blue-600',
                    enabled ? 'text-slate-700' : 'text-slate-400'
                  )}
                  title={`${lane.event.title} — click to edit`}
                  onClick={() => onEditEvent(lane.event)}
                >
                  {lane.event.title}
                </button>
                <div className="relative h-full flex-1">
                  {ticks.map((t, i) => (
                    <div
                      key={i}
                      className="absolute inset-y-0 w-px bg-slate-100"
                      style={{ left: `${t.pos * 100}%` }}
                    />
                  ))}
                  {lane.dense ? (
                    <div
                      className={cn(
                        'absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded',
                        enabled ? 'bg-blue-200' : 'bg-slate-200'
                      )}
                      title={`${lane.event.title}\n${lane.summary}`}
                    />
                  ) : (
                    lane.fireTimes.map((t) => (
                      <button
                        key={t}
                        className={cn(
                          'absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full',
                          enabled
                            ? 'bg-blue-500 hover:bg-blue-600'
                            : 'border border-slate-400 bg-transparent'
                        )}
                        style={{ left: `${posPct(t)}%` }}
                        title={`${lane.event.title}\n${new Date(t * 1000).toLocaleString()}\n${lane.summary}`}
                        onClick={() => onEditEvent(lane.event)}
                      />
                    ))
                  )}
                  <div
                    className="absolute inset-y-0 w-px bg-red-400"
                    style={{ left: `${nowPct}%` }}
                  />
                </div>
                <div className="w-40 shrink-0 px-2 text-xs text-slate-500 whitespace-nowrap">
                  {!enabled ? (
                    <span className="text-slate-400">disabled</span>
                  ) : lane.nextRun !== null ? (
                    formatNextRun(lane.nextRun, windowEnd)
                  ) : (
                    'no upcoming run'
                  )}
                </div>
              </div>
            );
          })}

          {/* On-demand strip */}
          {onDemand.length > 0 && (
            <div className="border-t px-2 py-2">
              <div className="mb-1 text-xs font-medium text-slate-500">On demand</div>
              <div className="flex flex-wrap gap-1">
                {onDemand.map((e) => (
                  <button
                    key={e.id}
                    className={cn(
                      'rounded border px-1.5 py-0.5 text-xs hover:border-slate-400',
                      e.enabled ? 'text-slate-600' : 'text-slate-400'
                    )}
                    title={`${e.title} — click to edit`}
                    onClick={() => onEditEvent(e)}
                  >
                    {e.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
