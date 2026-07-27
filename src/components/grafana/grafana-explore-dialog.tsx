'use client';

import { useState, useEffect, useId } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BarChart3 } from 'lucide-react';
import { getGrafanaSettings } from '@/lib/actions/grafana';
import { buildGrafanaExploreUrl, buildLogExpr } from '@/lib/grafana';

interface GrafanaExploreDialogProps {
  /** Loki `cluster` label (the k8s cluster name) */
  cluster?: string;
  /** Loki `namespace` label */
  namespace?: string;
  /** Prefilled app label (derived from the pod name on pod rows) */
  defaultApp?: string;
  /** Optional app suggestions (e.g. apps of the currently loaded pods) */
  apps?: string[];
}

const RANGES = [
  { value: 'now-15m', label: 'Last 15 minutes' },
  { value: 'now-1h', label: 'Last 1 hour' },
  { value: 'now-6h', label: 'Last 6 hours' },
  { value: 'now-24h', label: 'Last 24 hours' },
  { value: 'custom', label: 'Custom…' },
];

/**
 * "Open logs in Grafana" button + dialog: builds a Loki Explore deep link for
 * the given cluster/namespace/app with an optional line-contains filter.
 * Disabled until Grafana is configured on the /jenkins settings page.
 */
export function GrafanaExploreDialog({ cluster, namespace, defaultApp, apps }: GrafanaExploreDialogProps) {
  const [settings, setSettings] = useState<{ baseUrl: string; datasourceUid: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [app, setApp] = useState(defaultApp || '');
  const [lineContains, setLineContains] = useState('');
  const [range, setRange] = useState('now-1h');
  // Custom absolute range (datetime-local values)
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const appsDatalistId = useId();

  useEffect(() => {
    getGrafanaSettings()
      .then((s) => setSettings(s))
      .catch(() => setSettings(null))
      .finally(() => setLoaded(true));
  }, []);

  const configured = !!settings?.baseUrl && !!settings?.datasourceUid;

  const customRangeValid =
    range !== 'custom' ||
    (!!customFrom && !!customTo && new Date(customFrom).getTime() < new Date(customTo).getTime());

  const handleOpen = () => {
    if (!settings || !customRangeValid) return;
    const expr = buildLogExpr({
      app: app.trim() || undefined,
      cluster,
      namespace,
      lineContains,
    });
    // Grafana accepts relative ranges ('now-1h') and epoch-ms strings alike
    const from = range === 'custom' ? String(new Date(customFrom).getTime()) : range;
    const to = range === 'custom' ? String(new Date(customTo).getTime()) : 'now';
    const url = buildGrafanaExploreUrl(settings, { expr, from, to });
    window.open(url, '_blank', 'noopener,noreferrer');
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title={loaded && !configured ? 'Configure Grafana on the /jenkins settings page first' : 'Open logs in Grafana'}
          disabled={!loaded || !configured}
          onClick={(e) => e.stopPropagation()}
        >
          <BarChart3 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Open logs in Grafana</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-sm text-slate-500 font-mono">
            {`{${[app.trim() && `app="…"`, cluster && `cluster="${cluster}"`, namespace && `namespace="${namespace}"`]
              .filter(Boolean)
              .join(', ')}}`}
          </div>

          <div className="space-y-2">
            <Label htmlFor="grafana-app">App (optional)</Label>
            <Input
              id="grafana-app"
              list={apps?.length ? appsDatalistId : undefined}
              value={app}
              onChange={(e) => setApp(e.target.value)}
              placeholder="e.g., aldebaran — empty for all apps"
            />
            {apps && apps.length > 0 && (
              <datalist id={appsDatalistId}>
                {apps.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="grafana-line">Line contains (optional)</Label>
            <Input
              id="grafana-line"
              value={lineContains}
              onChange={(e) => setLineContains(e.target.value)}
              placeholder='Filter log lines, e.g., ERROR'
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleOpen();
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>Time range</Label>
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {range === 'custom' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="grafana-from">From</Label>
                <Input
                  id="grafana-from"
                  type="datetime-local"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="grafana-to">To</Label>
                <Input
                  id="grafana-to"
                  type="datetime-local"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleOpen} disabled={!customRangeValid}>Open in Grafana</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
