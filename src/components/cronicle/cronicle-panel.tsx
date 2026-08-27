'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  CalendarClock,
  History,
  Loader2,
  Play,
  RefreshCw,
  Settings,
  Square,
} from 'lucide-react';
import {
  agentBridge,
  supportsProxyRequest,
  type AgentStatus,
} from '@/lib/services/agent-bridge';
import {
  abortJob,
  getActiveJobs,
  getCategories,
  getHistory,
  getJobLog,
  getJobStatus,
  getSchedule,
  runEvent,
} from '@/lib/cronicle/client';
import type {
  CronicleCategory,
  CronicleConfig,
  CronicleEvent,
  CronicleHistoryRow,
  CronicleJob,
} from '@/lib/cronicle/types';
import { updateClusterCronicleConfig } from '@/lib/actions/clusters';

const ALL_CATEGORIES = '__all__';

interface CroniclePanelProps {
  clusterId: number;
  clusterName: string;
  config: CronicleConfig;
}

function formatElapsed(seconds?: number): string {
  if (seconds === undefined || seconds === null) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Compact rendering of a Cronicle timing object */
function formatTiming(timing?: CronicleEvent['timing']): string {
  if (!timing) return '—';
  const part = (label: string, arr?: number[]) =>
    arr && arr.length ? `${label} ${arr.join('/')}` : null;
  const parts = [
    part('min', timing.minutes),
    part('hr', timing.hours),
    part('day', timing.days),
    part('mon', timing.months),
    part('wd', timing.weekdays),
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : '—';
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Manage Cronicle for a cluster: schedule (filtered by category), run events,
 * monitor/abort active jobs, history and logs. Talks to the Cronicle API
 * through the extension proxy over a kubectl port-forward.
 */
export function CroniclePanel({ clusterId, clusterName, config }: CroniclePanelProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({ connected: false });

  const [categories, setCategories] = useState<CronicleCategory[]>([]);
  const [events, setEvents] = useState<CronicleEvent[]>([]);
  const [activeJobs, setActiveJobs] = useState<CronicleJob[]>([]);
  const [history, setHistory] = useState<CronicleHistoryRow[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>(
    config.categoryId || ALL_CATEGORIES
  );

  const [loading, setLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [abortingId, setAbortingId] = useState<string | null>(null);

  // Job monitor dialog
  const [monitorJobId, setMonitorJobId] = useState<string | null>(null);
  const [monitorJob, setMonitorJob] = useState<CronicleJob | null>(null);
  const [monitorError, setMonitorError] = useState<string | null>(null);

  // Log viewer dialog
  const [logJobId, setLogJobId] = useState<string | null>(null);
  const [logText, setLogText] = useState<string | null>(null);
  const [logError, setLogError] = useState<string | null>(null);

  // Settings dialog
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    namespace: config.namespace,
    resource: config.resource,
    localPort: String(config.localPort),
    remotePort: String(config.remotePort),
    apiKey: config.apiKey ?? '',
    categoryId: config.categoryId ?? '',
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  // agentBridge only exists in the browser; defer until after mount so
  // server-rendered HTML matches the first client render
  useEffect(() => {
    setMounted(true);
    if (!agentBridge) return;
    return agentBridge.onStatusChange(setAgentStatus);
  }, []);

  // Keep the settings form in sync when the server re-renders with new config
  useEffect(() => {
    setSettingsForm({
      namespace: config.namespace,
      resource: config.resource,
      localPort: String(config.localPort),
      remotePort: String(config.remotePort),
      apiKey: config.apiKey ?? '',
      categoryId: config.categoryId ?? '',
    });
    setSelectedCategory(config.categoryId || ALL_CATEGORIES);
  }, [config]);

  const loadData = useCallback(async () => {
    if (!config.apiKey) return;
    setLoading(true);
    setDataError(null);
    try {
      const [cats, schedule, jobs, hist] = await Promise.all([
        getCategories(clusterName, config),
        getSchedule(clusterName, config),
        getActiveJobs(clusterName, config),
        getHistory(clusterName, config, 50),
      ]);
      setCategories(cats.rows);
      setEvents(schedule.rows);
      setActiveJobs(jobs);
      setHistory(hist.rows);
    } catch (err) {
      setDataError(errMessage(err));
    } finally {
      setLoading(false);
    }
  }, [clusterName, config]);

  const refreshActiveJobs = useCallback(async () => {
    if (!config.apiKey) return;
    try {
      const jobs = await getActiveJobs(clusterName, config);
      setActiveJobs((prev) => {
        // A job disappeared from the active list → it finished; refresh history
        if (prev.length > jobs.length) {
          getHistory(clusterName, config, 50)
            .then((hist) => setHistory(hist.rows))
            .catch(() => {});
        }
        return jobs;
      });
    } catch {
      // Transient failure — keep the last known state
    }
  }, [clusterName, config]);

  const configured = !!config.apiKey;

  // Initial load once the agent is connected and an API key is configured
  useEffect(() => {
    if (!mounted || !agentStatus.connected || !configured) return;
    loadData();
  }, [mounted, agentStatus.connected, configured, loadData]);

  // Poll active jobs while any are running
  useEffect(() => {
    if (!mounted || !agentStatus.connected || !configured) return;
    if (activeJobs.length === 0) return;
    const interval = setInterval(refreshActiveJobs, 5000);
    return () => clearInterval(interval);
  }, [mounted, agentStatus.connected, configured, activeJobs.length, refreshActiveJobs]);

  // Poll the monitored job until it completes
  useEffect(() => {
    if (!monitorJobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const resp = await getJobStatus(clusterName, config, monitorJobId);
        if (stopped) return;
        setMonitorJob(resp.job);
        setMonitorError(null);
        if (resp.job.complete) {
          refreshActiveJobs();
          loadData();
        } else {
          timer = setTimeout(tick, 3000);
        }
      } catch (err) {
        if (!stopped) setMonitorError(errMessage(err));
      }
    };

    setMonitorJob(null);
    setMonitorError(null);
    tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [monitorJobId, clusterName, config, refreshActiveJobs, loadData]);

  const run = async (eventId: string) => {
    if (runningId) return;
    setRunningId(eventId);
    setDataError(null);
    try {
      const resp = await runEvent(clusterName, config, eventId);
      if (resp.ids && resp.ids.length > 0) {
        setMonitorJobId(resp.ids[0]);
        refreshActiveJobs();
      } else {
        setDataError(`Event queued (queue depth ${resp.queue ?? 1}) — it will start when a slot frees up.`);
      }
    } catch (err) {
      setDataError(errMessage(err));
    } finally {
      setRunningId(null);
    }
  };

  const abort = async (jobId: string) => {
    if (abortingId) return;
    setAbortingId(jobId);
    setDataError(null);
    try {
      await abortJob(clusterName, config, jobId);
      await refreshActiveJobs();
    } catch (err) {
      setDataError(errMessage(err));
    } finally {
      setAbortingId(null);
    }
  };

  const openLog = async (jobId: string) => {
    setLogJobId(jobId);
    setLogText(null);
    setLogError(null);
    try {
      const text = await getJobLog(clusterName, config, jobId);
      setLogText(text);
    } catch (err) {
      setLogError(errMessage(err));
    }
  };

  const saveSettings = async () => {
    if (savingSettings) return;
    setSavingSettings(true);
    setSettingsError(null);
    try {
      await updateClusterCronicleConfig(clusterId, {
        namespace: settingsForm.namespace.trim(),
        resource: settingsForm.resource.trim(),
        localPort: parseInt(settingsForm.localPort, 10),
        remotePort: parseInt(settingsForm.remotePort, 10),
        apiKey: settingsForm.apiKey.trim() || undefined,
        categoryId: settingsForm.categoryId || undefined,
      });
      setSettingsOpen(false);
      router.refresh();
    } catch (err) {
      setSettingsError(errMessage(err));
    } finally {
      setSavingSettings(false);
    }
  };

  if (!mounted) return null;
  if (!agentBridge?.isAvailable()) return null;

  if (!supportsProxyRequest()) {
    return (
      <p className="text-sm text-amber-700 bg-amber-50 rounded-md p-3">
        Reload the browser extension (chrome://extensions) and refresh this page to manage
        Cronicle from here.
      </p>
    );
  }

  if (!agentStatus.connected) {
    return (
      <p className="text-sm text-amber-700 bg-amber-50 rounded-md p-3">
        Start the local agent to manage Cronicle.
      </p>
    );
  }

  const categoryTitle = (id: string) =>
    categories.find((c) => c.id === id)?.title ?? id;

  const filteredEvents = events.filter(
    (e) => selectedCategory === ALL_CATEGORIES || e.category === selectedCategory
  );
  const filteredJobs = activeJobs.filter(
    (j) => selectedCategory === ALL_CATEGORIES || j.category === selectedCategory
  );
  const filteredHistory = history
    .filter((h) => !h.action) // skip stub rows (e.g. deleted jobs)
    .filter((h) => selectedCategory === ALL_CATEGORIES || h.category === selectedCategory)
    .slice(0, 10);

  const monitorComplete = !!monitorJob?.complete;
  const monitorSuccess = monitorComplete && monitorJob?.code === 0;

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CATEGORIES}>All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          onClick={loadData}
          disabled={loading || !configured}
          title="Refresh"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setSettingsError(null);
            setSettingsOpen(true);
          }}
          title="Cronicle settings"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </div>

      {!configured && (
        <div className="rounded-md border border-dashed p-6 text-center space-y-3">
          <p className="text-sm text-slate-500">
            Configure a Cronicle API key (Cronicle → Setup → API Keys) to manage events from
            here.
          </p>
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
            <Settings className="h-4 w-4" />
            <span className="ml-2">Configure Cronicle</span>
          </Button>
        </div>
      )}

      {dataError && <p className="text-sm text-red-600">{dataError}</p>}

      {configured && (
        <>
          {/* Active jobs */}
          {filteredJobs.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-medium text-slate-700 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Active Jobs ({filteredJobs.length})
              </h3>
              <div className="divide-y rounded-md border">
                {filteredJobs.map((job) => {
                  const progress = Math.round((job.progress ?? 0) * 100);
                  return (
                    <div key={job.id} className="flex items-center gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <button
                          className="text-sm font-medium truncate hover:text-blue-600 text-left"
                          onClick={() => setMonitorJobId(job.id)}
                          title={`Monitor job ${job.id}`}
                        >
                          {job.event_title || job.event}
                        </button>
                        <div className="mt-1 h-1.5 w-full rounded bg-slate-100">
                          <div
                            className="h-1.5 rounded bg-blue-500 transition-all"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>
                      <span className="text-xs text-slate-400 font-mono shrink-0">
                        {progress}% · {formatElapsed(Date.now() / 1000 - job.time_start)}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => abort(job.id)}
                        disabled={abortingId === job.id}
                        title="Abort job"
                      >
                        {abortingId === job.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Square className="h-4 w-4 text-red-500" />
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Scheduled events */}
          <section className="space-y-2">
            <h3 className="text-sm font-medium text-slate-700 flex items-center gap-2">
              <CalendarClock className="h-4 w-4" />
              Scheduled Events ({filteredEvents.length})
            </h3>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Timing</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-20"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEvents.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-slate-400">
                        {loading ? 'Loading…' : 'No events in this category.'}
                      </TableCell>
                    </TableRow>
                  )}
                  {filteredEvents.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="font-medium">{event.title}</TableCell>
                      <TableCell className="text-xs text-slate-500 font-mono">
                        {formatTiming(event.timing)}
                      </TableCell>
                      <TableCell className="text-sm text-slate-500">
                        {categoryTitle(event.category)}
                      </TableCell>
                      <TableCell>
                        {event.enabled ? (
                          <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                            Enabled
                          </Badge>
                        ) : (
                          <Badge className="bg-slate-100 text-slate-500 hover:bg-slate-100">
                            Disabled
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => run(event.id)}
                          disabled={runningId === event.id}
                          title="Run now"
                        >
                          {runningId === event.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                          <span className="ml-1">Run</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>

          {/* Recent history */}
          <section className="space-y-2">
            <h3 className="text-sm font-medium text-slate-700 flex items-center gap-2">
              <History className="h-4 w-4" />
              Recent History
            </h3>
            <div className="divide-y rounded-md border">
              {filteredHistory.length === 0 && (
                <p className="px-3 py-4 text-center text-sm text-slate-400">
                  No completed jobs yet.
                </p>
              )}
              {filteredHistory.map((row) => (
                <div key={row.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <button
                      className="text-sm font-medium truncate hover:text-blue-600 text-left"
                      onClick={() => openLog(row.id)}
                      title="View job log"
                    >
                      {row.event_title || row.event}
                    </button>
                    <div className="text-xs text-slate-400">
                      {new Date(row.time_start * 1000).toLocaleString()} ·{' '}
                      {formatElapsed(row.elapsed)}
                    </div>
                  </div>
                  {row.code === 0 ? (
                    <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                      Success
                    </Badge>
                  ) : (
                    <Badge className="bg-red-100 text-red-700 hover:bg-red-100" title={row.description}>
                      Failed
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {/* Job monitor dialog */}
      <Dialog open={!!monitorJobId} onOpenChange={(open) => !open && setMonitorJobId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {monitorJob?.event_title || 'Job'} {monitorJob ? `(${monitorJob.id})` : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {monitorError && <p className="text-sm text-red-600">{monitorError}</p>}
            {!monitorJob && !monitorError && (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading job status…
              </div>
            )}
            {monitorJob && (
              <>
                <div className="flex items-center gap-2">
                  {monitorComplete ? (
                    monitorSuccess ? (
                      <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                        Completed successfully
                      </Badge>
                    ) : (
                      <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
                        Failed (exit code {monitorJob.code})
                      </Badge>
                    )
                  ) : (
                    <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      Running
                    </Badge>
                  )}
                  <span className="text-xs text-slate-400 font-mono">
                    {formatElapsed(
                      monitorJob.elapsed ??
                        (monitorComplete
                          ? undefined
                          : Date.now() / 1000 - monitorJob.time_start)
                    )}
                  </span>
                </div>
                {!monitorComplete && (
                  <div className="h-2 w-full rounded bg-slate-100">
                    <div
                      className="h-2 rounded bg-blue-500 transition-all"
                      style={{ width: `${Math.round((monitorJob.progress ?? 0) * 100)}%` }}
                    />
                  </div>
                )}
                {monitorComplete && monitorJob.description && (
                  <p className="text-sm text-slate-600 whitespace-pre-wrap">
                    {monitorJob.description}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  {!monitorComplete && (
                    <Button
                      variant="outline"
                      onClick={() => abort(monitorJob.id)}
                      disabled={abortingId === monitorJob.id}
                    >
                      <Square className="h-4 w-4 text-red-500" />
                      <span className="ml-2">Abort</span>
                    </Button>
                  )}
                  {monitorComplete && (
                    <Button variant="outline" onClick={() => openLog(monitorJob.id)}>
                      View Log
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => setMonitorJobId(null)}>
                    Close
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Log viewer dialog */}
      <Dialog open={!!logJobId} onOpenChange={(open) => !open && setLogJobId(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Job Log {logJobId ? `(${logJobId})` : ''}</DialogTitle>
          </DialogHeader>
          {logError && <p className="text-sm text-red-600">{logError}</p>}
          {!logText && !logError && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading log…
            </div>
          )}
          {logText !== null && (
            <pre className="max-h-[60vh] overflow-auto rounded-md bg-slate-950 p-4 text-xs text-slate-100 whitespace-pre-wrap">
              {logText}
            </pre>
          )}
        </DialogContent>
      </Dialog>

      {/* Settings dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cronicle settings for {clusterName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cr-namespace">Namespace</Label>
                <Input
                  id="cr-namespace"
                  value={settingsForm.namespace}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, namespace: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cr-resource">Resource</Label>
                <Input
                  id="cr-resource"
                  value={settingsForm.resource}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, resource: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cr-local-port">Local Port</Label>
                <Input
                  id="cr-local-port"
                  type="number"
                  value={settingsForm.localPort}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, localPort: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cr-remote-port">Remote Port</Label>
                <Input
                  id="cr-remote-port"
                  type="number"
                  value={settingsForm.remotePort}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, remotePort: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cr-api-key">API Key</Label>
              <Input
                id="cr-api-key"
                type="password"
                value={settingsForm.apiKey}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, apiKey: e.target.value })
                }
                placeholder="Cronicle → Setup → API Keys"
              />
            </div>
            <div className="space-y-2">
              <Label>Default Category</Label>
              <Select
                value={settingsForm.categoryId || ALL_CATEGORIES}
                onValueChange={(v) =>
                  setSettingsForm({
                    ...settingsForm,
                    categoryId: v === ALL_CATEGORIES ? '' : v,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_CATEGORIES}>All categories</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-400">
                Categories group tenants — pick the category matching the namespace you
                usually work with. Requires a loaded API key to list categories.
              </p>
            </div>
            {settingsError && <p className="text-sm text-red-600">{settingsError}</p>}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setSettingsOpen(false)}
                disabled={savingSettings}
              >
                Cancel
              </Button>
              <Button
                onClick={saveSettings}
                disabled={
                  savingSettings ||
                  !settingsForm.namespace.trim() ||
                  !settingsForm.resource.trim() ||
                  !settingsForm.localPort ||
                  !settingsForm.remotePort
                }
              >
                {savingSettings && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
