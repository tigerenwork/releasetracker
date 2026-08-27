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
import { Loader2, Plus, X } from 'lucide-react';
import { updateEvent } from '@/lib/cronicle/client';
import type { CronicleCategory, CronicleConfig, CronicleEvent } from '@/lib/cronicle/types';

interface EventEditDialogProps {
  clusterName: string;
  config: CronicleConfig;
  /** The event being edited; dialog content resets when it changes */
  event: CronicleEvent;
  categories: CronicleCategory[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

const TIMING_FIELDS = [
  { key: 'minutes', label: 'Minutes', min: 0, max: 59 },
  { key: 'hours', label: 'Hours', min: 0, max: 23 },
  { key: 'days', label: 'Days', min: 1, max: 31 },
  { key: 'months', label: 'Months', min: 1, max: 12 },
  { key: 'weekdays', label: 'Weekdays (0=Sun)', min: 0, max: 6 },
] as const;

type TimingKey = (typeof TIMING_FIELDS)[number]['key'];

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
}: EventEditDialogProps) {
  const [title, setTitle] = useState(event.title);
  const [category, setCategory] = useState(event.category);
  const [timing, setTiming] = useState<Record<TimingKey, string>>({
    minutes: formatNumList(event.timing?.minutes),
    hours: formatNumList(event.timing?.hours),
    days: formatNumList(event.timing?.days),
    months: formatNumList(event.timing?.months),
    weekdays: formatNumList(event.timing?.weekdays),
  });
  const [params, setParams] = useState<ParamRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form whenever a different event is opened
  useEffect(() => {
    if (!open) return;
    setTitle(event.title);
    setCategory(event.category);
    setTiming({
      minutes: formatNumList(event.timing?.minutes),
      hours: formatNumList(event.timing?.hours),
      days: formatNumList(event.timing?.days),
      months: formatNumList(event.timing?.months),
      weekdays: formatNumList(event.timing?.weekdays),
    });
    setParams(
      Object.entries(event.params ?? {}).map(([key, value]) => ({
        key,
        value: String(value),
      }))
    );
    setError(null);
  }, [open, event]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const parsed = {} as Record<TimingKey, number[]>;
      for (const field of TIMING_FIELDS) {
        parsed[field.key] = parseNumList(timing[field.key], field.min, field.max, field.label);
      }
      // Only send timing when at least one field is set — omitting it
      // preserves the existing timing on the Cronicle side
      const hasTiming = TIMING_FIELDS.some((f) => parsed[f.key].length > 0);

      const paramObj: Record<string, string> = {};
      for (const row of params) {
        const key = row.key.trim();
        if (key) paramObj[key] = row.value;
      }

      await updateEvent(clusterName, config, event.id, {
        title: title.trim(),
        category,
        ...(hasTiming
          ? {
              timing: Object.fromEntries(
                TIMING_FIELDS.filter((f) => parsed[f.key].length > 0).map((f) => [
                  f.key,
                  parsed[f.key],
                ])
              ),
            }
          : {}),
        params: paramObj,
      });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Event</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
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
                <SelectTrigger>
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
          </div>

          <div className="space-y-2">
            <Label>Timing</Label>
            <div className="grid grid-cols-5 gap-2">
              {TIMING_FIELDS.map((field) => (
                <div key={field.key} className="space-y-1">
                  <span className="text-xs text-slate-400">{field.label}</span>
                  <Input
                    value={timing[field.key]}
                    onChange={(e) => setTiming({ ...timing, [field.key]: e.target.value })}
                    placeholder="*"
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400">
              Comma-separated numbers; empty means &quot;every&quot;. All fields empty keeps the
              current timing unchanged.
            </p>
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
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !title.trim() || !category}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
