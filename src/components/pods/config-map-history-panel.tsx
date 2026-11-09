'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ChevronDown, History, Loader2, RefreshCw } from 'lucide-react';
import { formatRelativeTime } from '@/components/pods/pod-utils';
import {
  getConfigMapEditHistory,
  type ConfigMapHistoryEntry,
} from '@/lib/actions/config-map-edits';

const SOURCE_LABEL: Record<ConfigMapHistoryEntry['source'], string> = {
  'pods-ui': 'Pods UI',
  'release-step': 'Release step',
  'auto-runner': 'Auto-run',
  init: 'Initial',
};

function truncateValue(value: string, max = 120): string {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= max) return singleLine;
  return `${singleLine.slice(0, max)}…`;
}

function ValueBlock({ value, muted }: { value: string; muted?: boolean }) {
  return (
    <pre
      className={`whitespace-pre-wrap break-all rounded px-2 py-1 font-mono text-[11px] ${
        muted ? 'bg-slate-100 text-slate-500 line-through' : 'bg-slate-50 text-slate-700'
      }`}
    >
      {truncateValue(value, 400)}
    </pre>
  );
}

function HistoryEntry({ entry }: { entry: ConfigMapHistoryEntry }) {
  const [open, setOpen] = useState(false);
  const isInit = entry.source === 'init';
  const setEntries = Object.entries(entry.patch.set ?? {}).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  const deleted = [...(entry.patch.delete ?? [])].sort();
  const before = entry.patch.before ?? {};

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-50"
        >
          <ChevronDown
            className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${
              open ? '' : '-rotate-90'
            }`}
          />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-slate-700">
                {formatRelativeTime(entry.editedAt)}
              </span>
              <Badge variant="secondary" className="text-[10px]">
                {SOURCE_LABEL[entry.source] ?? entry.source}
              </Badge>
              {entry.rolloutRestart && (
                <Badge variant="outline" className="text-[10px]">
                  rollout
                </Badge>
              )}
            </div>
            <p className="text-[11px] text-slate-500">
              {isInit
                ? `Baseline · ${entry.setKeys} key${entry.setKeys === 1 ? '' : 's'}`
                : `${entry.setKeys} key${entry.setKeys === 1 ? '' : 's'} set${
                    entry.deletedKeys > 0
                      ? `, ${entry.deletedKeys} deleted`
                      : ''
                  }`}
              {entry.deploymentName ? ` · ${entry.deploymentName}` : ''}
            </p>
          </div>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-3 py-2 space-y-2">
        {setEntries.length === 0 && deleted.length === 0 && (
          <p className="text-xs text-slate-500">No key changes recorded.</p>
        )}
        {isInit &&
          setEntries.map(([key, value]) => (
            <div key={`init-${key}`} className="space-y-0.5">
              <div className="flex items-center gap-1.5">
                <Badge className="bg-slate-200 text-slate-700 hover:bg-slate-200 text-[10px]">
                  was
                </Badge>
                <span className="font-mono text-[11px] break-all">{key}</span>
              </div>
              <ValueBlock value={value} />
            </div>
          ))}
        {!isInit &&
          setEntries.map(([key, value]) => {
            const prev = before[key];
            const isNewKey = prev === undefined;
            return (
              <div key={`set-${key}`} className="space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 text-[10px]">
                    {isNewKey ? 'added' : 'set'}
                  </Badge>
                  <span className="font-mono text-[11px] break-all">{key}</span>
                </div>
                {prev !== undefined && <ValueBlock value={prev} muted />}
                <ValueBlock value={value} />
              </div>
            );
          })}
        {!isInit &&
          deleted.map((key) => {
            const prev = before[key];
            return (
              <div key={`del-${key}`} className="space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <Badge className="bg-red-100 text-red-800 hover:bg-red-100 text-[10px]">
                    deleted
                  </Badge>
                  <span className="font-mono text-[11px] break-all line-through text-slate-500">
                    {key}
                  </span>
                </div>
                {prev !== undefined && <ValueBlock value={prev} muted />}
              </div>
            );
          })}
        <p className="text-[10px] text-slate-400">
          {new Date(entry.editedAt).toLocaleString()}
          {entry.releaseId != null ? ` · release #${entry.releaseId}` : ''}
          {entry.stepId != null ? ` · step #${entry.stepId}` : ''}
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface ConfigMapHistoryPanelProps {
  kubeContext: string;
  namespace: string;
  configMapName: string;
  /** Bump after a successful save so the list refreshes */
  refreshKey?: number | string;
}

export function ConfigMapHistoryPanel({
  kubeContext,
  namespace,
  configMapName,
  refreshKey,
}: ConfigMapHistoryPanelProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<ConfigMapHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!kubeContext || !namespace || !configMapName) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await getConfigMapEditHistory(kubeContext, namespace, configMapName);
      setEntries(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [kubeContext, namespace, configMapName]);

  // Lazy-load when first opened; also refresh when refreshKey changes while open
  useEffect(() => {
    if (open) {
      void load();
    }
  }, [open, refreshKey, load]);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border bg-slate-50/50">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex flex-1 items-center gap-1.5 text-left text-xs text-slate-600 hover:text-slate-900"
          >
            <History className="h-3.5 w-3.5" />
            <span className="font-medium">Edit history</span>
            {entries && (
              <span className="text-slate-400">({entries.length})</span>
            )}
            <ChevronDown
              className={`ml-auto h-3.5 w-3.5 text-slate-400 transition-transform ${
                open ? '' : '-rotate-90'
              }`}
            />
          </button>
        </CollapsibleTrigger>
        {open && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Refresh history"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
      </div>
      <CollapsibleContent className="px-2 pb-2 space-y-2">
        {loading && entries === null && (
          <div className="flex items-center gap-2 py-3 justify-center text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading history…
          </div>
        )}
        {error && (
          <div className="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-600">{error}</div>
        )}
        {!loading && entries && entries.length === 0 && (
          <p className="py-2 text-center text-xs text-slate-500">
            No edits recorded for this ConfigMap yet.
          </p>
        )}
        {entries?.map((entry) => (
          <HistoryEntry key={entry.id} entry={entry} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
