'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Braces, Loader2, Play, Plus, X } from 'lucide-react';
import { updateEvent, type EventUpdate } from '@/lib/cronicle/client';
import type { CronicleCategory, CronicleConfig, CronicleEvent } from '@/lib/cronicle/types';
import { JsonEditor } from '@/components/cronicle/json-editor';
import {
  TimingEditor,
  buildTiming,
  normalizeTiming,
  type TimingValue,
} from '@/components/cronicle/timing-editor';

interface EventEditDialogProps {
  clusterName: string;
  config: CronicleConfig;
  /** The event being edited; dialog content resets when it changes */
  event: CronicleEvent;
  categories: CronicleCategory[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  /** Run the event once with the given params — the edits are not saved */
  onRun: (params: Record<string, string>) => Promise<void>;
}

const TIMING_FIELDS = [
  { key: 'minutes', label: 'Minutes', min: 0, max: 59 },
  { key: 'hours', label: 'Hours', min: 0, max: 23 },
  { key: 'days', label: 'Days', min: 1, max: 31 },
  { key: 'months', label: 'Months', min: 1, max: 12 },
  { key: 'weekdays', label: 'Weekdays (0=Sun)', min: 0, max: 6 },
] as const;

type RawTimingKey = (typeof TIMING_FIELDS)[number]['key'];

/** Plugin params promoted to a dedicated "Request" section (HTTP-style plugins) */
const PROMOTED_PARAMS = ['method', 'url', 'data'] as const;
type PromotedKey = (typeof PROMOTED_PARAMS)[number];

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

interface ParamRow {
  key: string;
  value: string;
}

function formatNumList(arr?: number[]): string {
  return arr && arr.length ? arr.join(', ') : '';
}

/** Parse "0, 15, 30" into [0,15,30]; throws on bad input or out-of-range values */
function parseNumList(raw: string, min: number, max: number, label: string): number[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const values = trimmed.split(',').map((s) => {
    const n = Number(s.trim());
    if (!Number.isInteger(n)) throw new Error(`${label}: "${s.trim()}" is not a whole number`);
    if (n < min || n > max) throw new Error(`${label}: ${n} is out of range (${min}–${max})`);
    return n;
  });
  return [...new Set(values)].sort((a, b) => a - b);
}

function rawTimingFromEvent(event: CronicleEvent): Record<RawTimingKey, string> {
  return {
    minutes: formatNumList(event.timing?.minutes),
    hours: formatNumList(event.timing?.hours),
    days: formatNumList(event.timing?.days),
    months: formatNumList(event.timing?.months),
    weekdays: formatNumList(event.timing?.weekdays),
  };
}

/**
 * Edit a Cronicle event: title, category, timing and plugin params.
 * `update_event` replaces timing/params wholesale when sent, so the form is
 * always prefilled with the full current values; omitted fields are preserved.
 */
export function EventEditDialog({
  clusterName,
  config,
  event,
  categories,
  open,
  onOpenChange,
  onSaved,
  onRun,
}: EventEditDialogProps) {
  const [title, setTitle] = useState(event.title);
  const [category, setCategory] = useState(event.category);

  // Timing: visual (Cronicle-native) editor by default, raw lists on toggle
  const [timingMode, setTimingMode] = useState<'visual' | 'raw'>('visual');
  const [timingValue, setTimingValue] = useState<TimingValue>(() =>
    normalizeTiming(event.timing)
  );
  const [rawTiming, setRawTiming] = useState<Record<RawTimingKey, string>>(() =>
    rawTimingFromEvent(event)
  );

  // Promoted request params (method/url/data) get dedicated full-width fields
  const [promoted, setPromoted] = useState<Record<PromotedKey, string>>({
    method: '',
    url: '',
    data: '',
  });
  const [promotedPresent, setPromotedPresent] = useState<Set<PromotedKey>>(new Set());
  const [params, setParams] = useState<ParamRow[]>([]);

  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Reset the form whenever a different event is opened
  useEffect(() => {
    if (!open) return;
    setTitle(event.title);
    setCategory(event.category);
    setTimingMode('visual');
    setTimingValue(normalizeTiming(event.timing));
    setRawTiming(rawTimingFromEvent(event));

    const present = new Set<PromotedKey>();
    const promotedValues = { method: '', url: '', data: '' };
    const rest: ParamRow[] = [];
    for (const [key, value] of Object.entries(event.params ?? {})) {
      if ((PROMOTED_PARAMS as readonly string[]).includes(key)) {
        present.add(key as PromotedKey);
        promotedValues[key as PromotedKey] = String(value);
      } else {
        rest.push({ key, value: String(value) });
      }
    }
    setPromotedPresent(present);
    setPromoted(promotedValues);
    setParams(rest);
    setError(null);
    setJsonError(null);
  }, [open, event]);

  const formatData = () => {
    try {
      setPromoted({ ...promoted, data: JSON.stringify(JSON.parse(promoted.data), null, 2) });
      setJsonError(null);
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : String(err));
    }
  };

  const switchTimingMode = (next: 'visual' | 'raw') => {
    if (next === timingMode) return;
    if (next === 'raw') {
      // Visual → raw: render the current selection as comma-separated lists
      setRawTiming({
        minutes: timingValue === false ? '' : formatNumList(timingValue.minutes),
        hours: timingValue === false ? '' : formatNumList(timingValue.hours),
        days: timingValue === false ? '' : formatNumList(timingValue.days),
        months: timingValue === false ? '' : formatNumList(timingValue.months),
        weekdays: timingValue === false ? '' : formatNumList(timingValue.weekdays),
      });
      setError(null);
      setTimingMode('raw');
    } else {
      // Raw → visual: the raw lists must parse cleanly first
      try {
        const parsed = {} as Record<RawTimingKey, number[]>;
        for (const field of TIMING_FIELDS) {
          parsed[field.key] = parseNumList(rawTiming[field.key], field.min, field.max, field.label);
        }
        const allEmpty = TIMING_FIELDS.every((f) => parsed[f.key].length === 0);
        setTimingValue(allEmpty ? false : { years: [], ...parsed });
        setError(null);
        setTimingMode('visual');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  /** Merge the param rows and promoted request params into one object */
  const buildParams = (): Record<string, string> => {
    const paramObj: Record<string, string> = {};
    for (const row of params) {
      const key = row.key.trim();
      if (key) paramObj[key] = row.value;
    }
    // Promoted params: keep them if they were already on the event, or were filled in
    for (const key of PROMOTED_PARAMS) {
      if (promotedPresent.has(key) || promoted[key].trim()) {
        paramObj[key] = promoted[key];
      }
    }
    return paramObj;
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const updates: EventUpdate = { title: title.trim(), category };

      if (timingMode === 'visual') {
        updates.timing = buildTiming(timingValue);
      } else {
        const parsed = {} as Record<RawTimingKey, number[]>;
        for (const field of TIMING_FIELDS) {
          parsed[field.key] = parseNumList(rawTiming[field.key], field.min, field.max, field.label);
        }
        // Only send timing when at least one field is set — omitting it
        // preserves the existing timing on the Cronicle side
        if (TIMING_FIELDS.some((f) => parsed[f.key].length > 0)) {
          updates.timing = Object.fromEntries(
            TIMING_FIELDS.filter((f) => parsed[f.key].length > 0).map((f) => [f.key, parsed[f.key]])
          );
        }
      }

      updates.params = buildParams();

      await updateEvent(clusterName, config, event.id, updates);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  /** Run the event once with the current form values, without saving them */
  const runOnce = async () => {
    if (running || saving) return;
    setRunning(true);
    setError(null);
    try {
      await onRun(buildParams());
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const showRequestSection = promotedPresent.size > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-5xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Event</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ee-title">Title</Label>
            <Input
              id="ee-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {showRequestSection && (
            <div className="space-y-3 rounded-md border p-4">
              <Label>Request</Label>
              <div className="space-y-1">
                <span className="text-xs text-slate-400">Method</span>
                <Select
                  value={promoted.method}
                  onValueChange={(v) => setPromoted({ ...promoted, method: v })}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="GET" />
                  </SelectTrigger>
                  <SelectContent>
                    {(HTTP_METHODS.includes(promoted.method) || !promoted.method
                      ? HTTP_METHODS
                      : [...HTTP_METHODS, promoted.method]
                    ).map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-slate-400">URL</span>
                <Input
                  className="font-mono"
                  value={promoted.url}
                  onChange={(e) => setPromoted({ ...promoted, url: e.target.value })}
                  placeholder="http://…"
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center">
                  <span className="text-xs text-slate-400">Data (JSON)</span>
                  <div className="flex-1" />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={formatData}
                    title="Format JSON"
                  >
                    <Braces className="h-3.5 w-3.5" />
                    <span className="ml-1">Format</span>
                  </Button>
                </div>
                <JsonEditor
                  value={promoted.data}
                  onChange={(v) => {
                    setPromoted({ ...promoted, data: v });
                    setJsonError(null);
                  }}
                />
                {jsonError && <p className="text-xs text-red-600">Invalid JSON: {jsonError}</p>}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label>Timing</Label>
              <div className="flex-1" />
              <div className="flex rounded-md border text-xs overflow-hidden">
                <button
                  type="button"
                  className={`px-2 py-1 ${
                    timingMode === 'visual'
                      ? 'bg-slate-900 text-white'
                      : 'bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                  onClick={() => switchTimingMode('visual')}
                >
                  Visual
                </button>
                <button
                  type="button"
                  className={`px-2 py-1 ${
                    timingMode === 'raw'
                      ? 'bg-slate-900 text-white'
                      : 'bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                  onClick={() => switchTimingMode('raw')}
                >
                  Raw lists
                </button>
              </div>
            </div>

            {timingMode === 'visual' ? (
              <TimingEditor value={timingValue} onChange={setTimingValue} />
            ) : (
              <>
                <div className="grid grid-cols-5 gap-2">
                  {TIMING_FIELDS.map((field) => (
                    <div key={field.key} className="space-y-1">
                      <span className="text-xs text-slate-400">{field.label}</span>
                      <Input
                        value={rawTiming[field.key]}
                        onChange={(e) =>
                          setRawTiming({ ...rawTiming, [field.key]: e.target.value })
                        }
                        placeholder="*"
                      />
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-400">
                  Comma-separated numbers; empty means &quot;every&quot;. All fields empty keeps
                  the current timing unchanged.
                </p>
              </>
            )}
          </div>

          <div className="space-y-2">
            <Label>Params</Label>
            <div className="space-y-2">
              {params.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    className="w-48"
                    placeholder="key"
                    value={row.key}
                    onChange={(e) =>
                      setParams(params.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))
                    }
                  />
                  <Input
                    className="flex-1 font-mono"
                    placeholder="value"
                    value={row.value}
                    onChange={(e) =>
                      setParams(
                        params.map((r, j) => (j === i ? { ...r, value: e.target.value } : r))
                      )
                    }
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setParams(params.filter((_, j) => j !== i))}
                    title="Remove param"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setParams([...params, { key: '', value: '' }])}
              >
                <Plus className="h-4 w-4" />
                <span className="ml-1">Add param</span>
              </Button>
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving || running}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={runOnce}
              disabled={saving || running}
              title="Run the event now with the current edits, without saving them"
            >
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Run
            </Button>
            <Button onClick={save} disabled={saving || running || !title.trim() || !category}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
