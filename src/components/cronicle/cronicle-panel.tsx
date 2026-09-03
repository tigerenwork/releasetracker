'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  CalendarClock,
  ChevronDown,
  History,
  Loader2,
  Pencil,
  Play,
  RefreshCw,
  Search,
  Settings,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  agentBridge,
  supportsProxyRequest,
  type AgentStatus,
} from '@/lib/services/agent-bridge';
import {
  abortJob,
  deleteEvent,
  getActiveJobs,
  getCategories,
  getEventHistory,
  getHistory,
  getJobLog,
  getJobStatus,
  getSchedule,
  runEvent,
  updateEvent,
} from '@/lib/cronicle/client';
import type {
  CronicleCategory,
  CronicleConfig,
  CronicleEvent,
  CronicleHistoryRow,
  CronicleJob,
} from '@/lib/cronicle/types';
import { EventEditDialog } from '@/components/cronicle/event-edit-dialog';
import { summarizeTiming } from '@/components/cronicle/timing-editor';
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
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [selectedCategory, setSelectedCategoryState] = useState<string>(
    config.categoryId || ALL_CATEGORIES
  );

  // Free-text event filter; while set, it applies across all categories
  const [search, setSearch] = useState('');
  // Filter by service (the part before the first ':'); empty set = all services
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set());
  // Filter by event name (the part after the last ':'); empty set = all names
  const [selectedEventNames, setSelectedEventNames] = useState<Set<string>>(new Set());

  // Per-event history dialog
  const [eventHistoryFor, setEventHistoryFor] = useState<{ id: string; title: string } | null>(null);
  const [eventHistoryRows, setEventHistoryRows] = useState<CronicleHistoryRow[]>([]);
  const [eventHistoryTotal, setEventHistoryTotal] = useState(0);
  const [eventHistoryLoading, setEventHistoryLoading] = useState(false);
  const [eventHistoryError, setEventHistoryError] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [abortingId, setAbortingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [editEvent, setEditEvent] = useState<CronicleEvent | null>(null);

  // Bulk selection
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [moveTarget, setMoveTarget] = useState('');
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [bulkMessage, setBulkMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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

  const setSelectedCategory = (category: string) => {
    setSelectedCategoryState(category);
    // Selection refers to the visible rows — drop it when the filter changes
    setSelection(new Set());
    setBulkMessage(null);
  };

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
    setSelectedCategoryState(config.categoryId || ALL_CATEGORIES);
    setSelection(new Set());
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
      setCategories([...cats.rows].sort((a, b) => a.title.localeCompare(b.title)));
      setEvents(schedule.rows);
      setActiveJobs(jobs);
      setHistory(hist.rows);
      setHistoryTotal(hist.list.length);
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
            .then((hist) => {
              setHistory(hist.rows);
              setHistoryTotal(hist.list.length);
            })
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

  /**
   * Run an event immediately with param overrides (from the edit dialog).
   * The overrides are merged into this run only — the event is not saved.
   */
  const runWithParams = async (eventId: string, params: Record<string, string>) => {
    const resp = await runEvent(clusterName, config, eventId, { params });
    setEditEvent(null);
    if (resp.ids && resp.ids.length > 0) {
      setMonitorJobId(resp.ids[0]);
      refreshActiveJobs();
    } else {
      setDataError(`Event queued (queue depth ${resp.queue ?? 1}) — it will start when a slot frees up.`);
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

  const toggleEnabled = async (event: CronicleEvent) => {
    if (togglingId) return;
    const next: 0 | 1 = event.enabled ? 0 : 1;
    setTogglingId(event.id);
    setDataError(null);
    // Optimistic update; revert on failure
    setEvents((prev) => prev.map((e) => (e.id === event.id ? { ...e, enabled: next } : e)));
    try {
      await updateEvent(clusterName, config, event.id, { enabled: next });
    } catch (err) {
      setEvents((prev) =>
        prev.map((e) => (e.id === event.id ? { ...e, enabled: event.enabled } : e))
      );
      setDataError(errMessage(err));
    } finally {
      setTogglingId(null);
    }
  };

  const toggleSelect = (eventId: string, checked: boolean) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (checked) next.add(eventId);
      else next.delete(eventId);
      return next;
    });
    setBulkMessage(null);
  };

  const bulkApply = async (action: 'enable' | 'disable' | 'move' | 'delete') => {
    if (bulk || selection.size === 0) return;
    if (action === 'move' && !moveTarget) return;
    const ids = [...selection];
    setBulk({ done: 0, total: ids.length });
    setBulkMessage(null);
    setDataError(null);
    let failed = 0;
    let firstError = '';
    for (let i = 0; i < ids.length; i++) {
      try {
        if (action === 'delete') {
          await deleteEvent(clusterName, config, ids[i]);
        } else {
          await updateEvent(
            clusterName,
            config,
            ids[i],
            action === 'move'
              ? { category: moveTarget }
              : { enabled: action === 'enable' ? 1 : 0 }
          );
        }
      } catch (err) {
        failed++;
        if (!firstError) firstError = errMessage(err);
      }
      setBulk({ done: i + 1, total: ids.length });
    }
    setBulk(null);
    const ok = ids.length - failed;
    const verb = action === 'delete' ? 'Deleted' : 'Updated';
    setBulkMessage(
      failed === 0
        ? { error: false, text: `${verb} ${ok} event${ok === 1 ? '' : 's'}.` }
        : { error: true, text: `${verb} ${ok}/${ids.length} — first error: ${firstError}` }
    );
    setSelection(new Set());
    setMoveTarget('');
    await loadData();
  };

  const loadMoreHistory = async () => {
    if (historyLoadingMore) return;
    setHistoryLoadingMore(true);
    try {
      const resp = await getHistory(clusterName, config, 50, history.length);
      setHistory((prev) => [...prev, ...resp.rows]);
      setHistoryTotal(resp.list.length);
    } catch (err) {
      setDataError(errMessage(err));
    } finally {
      setHistoryLoadingMore(false);
    }
  };

  const openEventHistory = async (event: CronicleEvent) => {
    setEventHistoryFor({ id: event.id, title: event.title });
    setEventHistoryRows([]);
    setEventHistoryTotal(0);
    setEventHistoryError(null);
    setEventHistoryLoading(true);
    try {
      const resp = await getEventHistory(clusterName, config, event.id, 0, 20);
      setEventHistoryRows(resp.rows);
      setEventHistoryTotal(resp.list.length);
    } catch (err) {
      setEventHistoryError(errMessage(err));
    } finally {
      setEventHistoryLoading(false);
    }
  };

  const loadMoreEventHistory = async () => {
    if (!eventHistoryFor || eventHistoryLoading) return;
    setEventHistoryLoading(true);
    try {
      const resp = await getEventHistory(
        clusterName,
        config,
        eventHistoryFor.id,
        eventHistoryRows.length,
        20
      );
      setEventHistoryRows((prev) => [...prev, ...resp.rows]);
      setEventHistoryTotal(resp.list.length);
    } catch (err) {
      setEventHistoryError(errMessage(err));
    } finally {
      setEventHistoryLoading(false);
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

  // Event titles look like "<service>:<category>:<event_name>"
  const eventNameOf = (title: string) => title.split(':').pop() ?? title;
  const serviceOf = (title: string) => title.split(':')[0];

  const allServices = [...new Set(events.map((e) => serviceOf(e.title)))].sort();
  // Event names offered for picking are scoped by the selected services
  const allEventNames = [
    ...new Set(
      events
        .filter((e) => selectedServices.size === 0 || selectedServices.has(serviceOf(e.title)))
        .map((e) => eventNameOf(e.title))
    ),
  ].sort();

  const toggleSetValue = (set: Set<string>, value: string, checked: boolean) => {
    const next = new Set(set);
    if (checked) next.add(value);
    else next.delete(value);
    return next;
  };

  // Free-text search applies across all categories; otherwise filter by category
  const searchLower = search.trim().toLowerCase();
  const filteredEvents = events
    .filter((e) => {
      if (selectedServices.size > 0 && !selectedServices.has(serviceOf(e.title))) return false;
      if (selectedEventNames.size > 0 && !selectedEventNames.has(eventNameOf(e.title))) return false;
      if (searchLower) {
        return e.title.toLowerCase().includes(searchLower);
      }
      return selectedCategory === ALL_CATEGORIES || e.category === selectedCategory;
    })
    .sort((a, b) => a.title.localeCompare(b.title));
  const filteredJobs = activeJobs.filter(
    (j) => selectedCategory === ALL_CATEGORIES || j.category === selectedCategory
  );
  const filteredHistory = history
    .filter((h) => !h.action) // skip stub rows (e.g. deleted jobs)
    .filter((h) => selectedCategory === ALL_CATEGORIES || h.category === selectedCategory);

  const allFilteredSelected =
    filteredEvents.length > 0 && filteredEvents.every((e) => selection.has(e.id));
  const someFilteredSelected = filteredEvents.some((e) => selection.has(e.id));

  const monitorComplete = !!monitorJob?.complete;
  const monitorSuccess = monitorComplete && monitorJob?.code === 0;

  const renderHistoryRow = (row: CronicleHistoryRow) => (
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
          {new Date(row.time_start * 1000).toLocaleString()} · {formatElapsed(row.elapsed)}
        </div>
      </div>
      {row.code === 0 ? (
        <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Success</Badge>
      ) : (
        <Badge className="bg-red-100 text-red-700 hover:bg-red-100" title={row.description}>
          Failed
        </Badge>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Toolbar: swaps to bulk actions while events are selected */}
      {selection.size > 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
          <span className="text-sm font-medium text-blue-900">
            {bulk ? `Working ${bulk.done}/${bulk.total}…` : `${selection.size} selected`}
          </span>
          {bulk && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            disabled={!!bulk}
            onClick={() => bulkApply('enable')}
          >
            Enable
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!!bulk}
            onClick={() => bulkApply('disable')}
          >
            Disable
          </Button>
          <Select value={moveTarget} onValueChange={setMoveTarget} disabled={!!bulk}>
            <SelectTrigger className="w-48 bg-white">
              <SelectValue placeholder="Move to category…" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            disabled={!!bulk || !moveTarget}
            onClick={() => bulkApply('move')}
          >
            Move
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
            disabled={!!bulk}
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Delete
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!!bulk}
            onClick={() => {
              setSelection(new Set());
              setBulkMessage(null);
            }}
            title="Clear selection"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-44 justify-between font-normal">
                <span className="truncate">
                  {selectedServices.size === 0
                    ? 'All services'
                    : `${selectedServices.size} service${selectedServices.size === 1 ? '' : 's'}`}
                </span>
                <ChevronDown className="h-4 w-4 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56 max-h-72 overflow-y-auto">
              {allServices.map((svc) => (
                <DropdownMenuCheckboxItem
                  key={svc}
                  checked={selectedServices.has(svc)}
                  onCheckedChange={(checked) =>
                    setSelectedServices((prev) => toggleSetValue(prev, svc, checked === true))
                  }
                  onSelect={(e) => e.preventDefault()}
                >
                  {svc}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-48 justify-between font-normal">
                <span className="truncate">
                  {selectedEventNames.size === 0
                    ? 'All event names'
                    : `${selectedEventNames.size} name${selectedEventNames.size === 1 ? '' : 's'}`}
                </span>
                <ChevronDown className="h-4 w-4 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="min-w-72 w-auto max-w-[480px] max-h-72 overflow-y-auto">
              {allEventNames.map((name) => (
                <DropdownMenuCheckboxItem
                  key={name}
                  checked={selectedEventNames.has(name)}
                  onCheckedChange={(checked) =>
                    setSelectedEventNames((prev) => toggleSetValue(prev, name, checked === true))
                  }
                  onSelect={(e) => e.preventDefault()}
                  title={name}
                >
                  <span className="font-mono text-xs whitespace-nowrap">{name}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="relative w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              className="pl-8 pr-7"
              placeholder="Search events…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              title="Filter events by name — applies across all categories"
            />
            {search && (
              <button
                className="absolute right-2 top-2.5 text-slate-400 hover:text-slate-600"
                onClick={() => setSearch('')}
                title="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
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
      )}

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
      {bulkMessage && (
        <p className={`text-sm ${bulkMessage.error ? 'text-red-600' : 'text-green-700'}`}>
          {bulkMessage.text}
        </p>
      )}

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
            <div className="rounded-md border overflow-x-auto">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={
                          allFilteredSelected
                            ? true
                            : someFilteredSelected
                              ? 'indeterminate'
                              : false
                        }
                        onCheckedChange={(checked) =>
                          setSelection(
                            checked ? new Set(filteredEvents.map((e) => e.id)) : new Set()
                          )
                        }
                        title="Select all"
                      />
                    </TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Timing</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="w-32"></TableHead>
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
                      <TableCell>
                        <Checkbox
                          checked={selection.has(event.id)}
                          onCheckedChange={(checked) =>
                            toggleSelect(event.id, checked === true)
                          }
                          title={`Select ${event.title}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium min-w-[220px]">
                        <div className="flex items-start gap-2 min-w-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-1.5 shrink-0"
                            onClick={() => toggleEnabled(event)}
                            disabled={togglingId === event.id}
                            title={event.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                          >
                            {togglingId === event.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <span
                                className={`h-2 w-2 rounded-full ${
                                  event.enabled ? 'bg-green-500' : 'bg-slate-300'
                                }`}
                              />
                            )}
                            <span
                              className={`ml-1.5 text-xs font-normal hidden lg:inline-block w-14 text-left ${
                                event.enabled ? 'text-green-700' : 'text-slate-400'
                              }`}
                            >
                              {event.enabled ? 'Enabled' : 'Disabled'}
                            </span>
                          </Button>
                          <button
                            className="min-w-0 break-all text-left hover:text-blue-600 hover:underline"
                            onClick={() => setEditEvent(event)}
                            title={`${event.title} — click to edit`}
                          >
                            {event.title}
                          </button>
                        </div>
                      </TableCell>
                      <TableCell
                        className="text-xs text-slate-500 whitespace-nowrap"
                        title={formatTiming(event.timing)}
                      >
                        {summarizeTiming(event.timing)}
                      </TableCell>
                      <TableCell className="text-sm text-slate-500 whitespace-nowrap">
                        {categoryTitle(event.category)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="flex items-center gap-1">
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
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEventHistory(event)}
                            title="Event history"
                          >
                            <History className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditEvent(event)}
                            title="Edit event"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </div>
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
              {filteredHistory.map(renderHistoryRow)}
            </div>
            {history.length < historyTotal && (
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadMoreHistory}
                  disabled={historyLoadingMore}
                >
                  {historyLoadingMore && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Load more ({history.length} / {historyTotal})
                </Button>
              </div>
            )}
          </section>
        </>
      )}

      {/* Bulk delete confirmation */}
      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selection.size} event{selection.size === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected events from the schedule and cannot be
              undone. Events with active jobs cannot be deleted and will be skipped with an
              error.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => bulkApply('delete')}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Event edit dialog */}
      {editEvent && (
        <EventEditDialog
          clusterName={clusterName}
          config={config}
          event={editEvent}
          categories={categories}
          open={!!editEvent}
          onOpenChange={(open) => !open && setEditEvent(null)}
          onSaved={loadData}
          onRun={(params) => runWithParams(editEvent.id, params)}
        />
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

      {/* Per-event history dialog */}
      <Dialog
        open={!!eventHistoryFor}
        onOpenChange={(open) => !open && setEventHistoryFor(null)}
      >
        <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>History — {eventHistoryFor?.title}</DialogTitle>
          </DialogHeader>
          {eventHistoryError && <p className="text-sm text-red-600">{eventHistoryError}</p>}
          {!eventHistoryError && eventHistoryRows.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              {eventHistoryLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading history…
                </>
              ) : (
                'No completed jobs for this event yet.'
              )}
            </div>
          )}
          {eventHistoryRows.length > 0 && (
            <div className="divide-y rounded-md border">
              {eventHistoryRows.map(renderHistoryRow)}
            </div>
          )}
          {eventHistoryRows.length < eventHistoryTotal && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={loadMoreEventHistory}
                disabled={eventHistoryLoading}
              >
                {eventHistoryLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Load more ({eventHistoryRows.length} / {eventHistoryTotal})
              </Button>
            </div>
          )}
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
