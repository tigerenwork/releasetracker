'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import { Settings2, Loader2, Trash2, ChevronLeft, Plus } from 'lucide-react';
import {
  agentBridge,
  supportsConfigEdit,
  CONFIG_EDIT_MIN_VERSION,
  type ConfigMapRef,
  type ConfigPatch,
  type ExecutionContext,
} from '@/lib/services/agent-bridge';
import { appFromPodName } from '@/lib/grafana';
import { formatRelativeTime } from '@/components/pods/pod-utils';
import {
  recordConfigMapEdit,
  getLastConfigMapEdit,
} from '@/lib/actions/config-map-edits';

interface ConfigEditorDialogProps {
  kubeContext?: string;
  namespace: string;
  podName: string;
  onSaved?: () => void;
}

type LastEdit = {
  deploymentName: string | null;
  rolloutRestart: boolean;
  editedAt: string;
  setKeys: number;
  deletedKeys: number;
};

type Phase = 'describe' | 'list' | 'editor';

// ConfigMap data keys — the agent enforces the same allowlist
const KEY_RE = /^[-._a-zA-Z0-9]+$/;

function ErrorBanner({ message }: { message: string }) {
  return <div className="p-3 bg-red-50 text-red-600 rounded-md text-sm">{message}</div>;
}

/**
 * View/edit the ConfigMaps consumed by a pod's Deployment.
 * Disabled when the connected agent is older than CONFIG_EDIT_MIN_VERSION.
 */
export function ConfigEditorDialog({ kubeContext, namespace, podName, onSaved }: ConfigEditorDialogProps) {
  // agentBridge only exists in the browser; defer the check until after mount
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('describe');
  const [error, setError] = useState<string | null>(null);

  // describe result
  const deploymentName = useMemo(() => appFromPodName(podName), [podName]);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [unsupportedReason, setUnsupportedReason] = useState<string | null>(null);
  const [configMaps, setConfigMaps] = useState<ConfigMapRef[]>([]);

  // editor state
  const [selected, setSelected] = useState<ConfigMapRef | null>(null);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [pristine, setPristine] = useState<Record<string, string> | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [truncated, setTruncated] = useState(false);
  const [lastEdit, setLastEdit] = useState<LastEdit | null>(null);
  const [newKey, setNewKey] = useState('');

  // save flow
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rolloutRestart, setRolloutRestart] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Diff pristine vs edited keys → { set, delete }
  const diff = useMemo((): ConfigPatch => {
    const set: Record<string, string> = {};
    const del: string[] = [];
    if (pristine) {
      for (const [key, value] of Object.entries(values)) {
        if (!(key in pristine) || pristine[key] !== value) set[key] = value;
      }
      for (const key of Object.keys(pristine)) {
        if (!(key in values)) del.push(key);
      }
    }
    return { set, delete: del };
  }, [pristine, values]);

  if (!mounted) return null;

  const version = agentBridge?.getStatus().version;
  const agentSupported = !!agentBridge?.isAvailable() && supportsConfigEdit(version);

  const bridgeContext = (): ExecutionContext => ({
    customerId: 0,
    namespace,
    podSelector: '',
    podName,
    kubeContext,
    stepId: 0,
    releaseId: 0,
  });

  const reset = () => {
    setPhase('describe');
    setError(null);
    setSupported(null);
    setUnsupportedReason(null);
    setConfigMaps([]);
    setSelected(null);
    setPristine(null);
    setValues({});
    setTruncated(false);
    setLastEdit(null);
    setNewKey('');
    setConfirmOpen(false);
    setSaving(false);
    setSaveMessage(null);
  };

  const describe = async () => {
    if (!agentBridge) return;
    reset();
    try {
      const res = await agentBridge.configDescribe(bridgeContext(), deploymentName);
      if (!res.success) {
        setError(res.error?.message || 'Failed to describe deployment');
        return;
      }
      const cfg = res.config;
      if (cfg?.supported === false) {
        setSupported(false);
        setUnsupportedReason(cfg.unsupportedReason || null);
      } else {
        setSupported(true);
        setConfigMaps(cfg?.configMaps ?? []);
      }
      setPhase('list');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to describe deployment');
    }
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) describe();
  };

  const selectConfigMap = async (cm: ConfigMapRef) => {
    if (!agentBridge) return;
    setSelected(cm);
    setPhase('editor');
    setLoadingKeys(true);
    setError(null);
    setSaveMessage(null);
    setLastEdit(null);
    setPristine(null);
    setValues({});
    setTruncated(false);

    try {
      const res = await agentBridge.configGet(bridgeContext(), cm.name);
      if (!res.success) {
        setError(res.error?.message || 'Failed to read ConfigMap');
        return;
      }
      const data = res.config?.data ?? {};
      setPristine(data);
      setValues({ ...data });
      setTruncated(!!res.config?.truncated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read ConfigMap');
    } finally {
      setLoadingKeys(false);
    }

    // Last-edit record is best-effort context, not required for editing
    try {
      const edit = await getLastConfigMapEdit(kubeContext ?? '', namespace, cm.name);
      setLastEdit(edit);
    } catch {
      // ignore — the editor still works without it
    }
  };

  // Diff pristine vs edited keys → { set, delete }
  const changedKeys = Object.keys(diff.set).sort();
  const deletedKeys = [...diff.delete].sort();
  const hasChanges = changedKeys.length > 0 || deletedKeys.length > 0;

  const addKey = () => {
    const key = newKey.trim();
    if (!key || !KEY_RE.test(key) || key in values) return;
    setValues((prev) => ({ ...prev, [key]: '' }));
    setNewKey('');
  };

  const openConfirm = () => {
    // envFrom/volume consumers don't see the change until pods are recreated
    setRolloutRestart(
      !!selected?.consumedAs.some((c) => c === 'envFrom' || c === 'volume')
    );
    setConfirmOpen(true);
  };

  const handleSave = async () => {
    if (!agentBridge || !selected || !hasChanges) return;
    setSaving(true);
    setError(null);
    setSaveMessage(null);

    try {
      const applyRes = await agentBridge.configApply(bridgeContext(), selected.name, diff);
      if (!applyRes.success) {
        setError(applyRes.error?.message || 'Failed to apply ConfigMap changes');
        return;
      }

      let restarted = false;
      if (rolloutRestart) {
        const restartRes = await agentBridge.rolloutRestart(bridgeContext(), deploymentName);
        if (!restartRes.success) {
          // The edit is already applied — surface the restart failure without
          // presenting the whole save as failed
          setError(
            `Changes saved, but rollout restart failed: ${
              restartRes.error?.message || 'unknown error'
            }`
          );
        } else {
          restarted = true;
        }
      }

      // Persist the last edit — non-blocking: the edit is already applied
      try {
        await recordConfigMapEdit({
          kubeContext: kubeContext ?? '',
          namespace,
          configMapName: selected.name,
          deploymentName,
          patch: diff,
          rolloutRestart: restarted,
        });
      } catch (persistErr) {
        console.error('Failed to record ConfigMap edit:', persistErr);
      }

      const now = new Date().toISOString();
      setLastEdit({
        deploymentName,
        rolloutRestart: restarted,
        editedAt: now,
        setKeys: changedKeys.length,
        deletedKeys: deletedKeys.length,
      });
      setSaveMessage(
        `Saved ${changedKeys.length} key${changedKeys.length === 1 ? '' : 's'}` +
          (deletedKeys.length > 0
            ? `, deleted ${deletedKeys.length} key${deletedKeys.length === 1 ? '' : 's'}`
            : '') +
          (restarted ? ` — rollout restart of ${deploymentName} triggered` : '')
      );
      // The applied state becomes the new pristine copy for further edits
      setPristine({ ...values });
      setConfirmOpen(false);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply ConfigMap changes');
    } finally {
      setSaving(false);
    }
  };

  const readOnly = truncated;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title={
            agentSupported
              ? 'View/edit deployment config (ConfigMaps)'
              : `Config edit requires agent >= ${CONFIG_EDIT_MIN_VERSION}`
          }
          disabled={!agentSupported}
          onClick={(e) => e.stopPropagation()}
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-2xl w-[92vw] max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle className="font-mono text-sm break-all">
            {deploymentName} <span className="text-slate-400 font-normal">config</span>
          </DialogTitle>
          <DialogDescription>
            ConfigMaps consumed by this Deployment in namespace{' '}
            <span className="font-mono">{namespace}</span>
          </DialogDescription>
        </DialogHeader>

        {phase === 'describe' && !error && (
          <div className="flex items-center gap-2 text-sm text-slate-500 py-6 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading ConfigMaps…
          </div>
        )}

        {error && <ErrorBanner message={error} />}

        {phase === 'list' && supported === false && (
          <div className="p-3 bg-amber-50 text-amber-700 rounded-md text-sm">
            Config edit not supported for this workload
            {unsupportedReason ? `: ${unsupportedReason}` : ''}
          </div>
        )}

        {phase === 'list' && supported && (
          <div className="space-y-2">
            {configMaps.length === 0 && (
              <p className="text-sm text-slate-500 py-4 text-center">
                This Deployment does not reference any ConfigMaps.
              </p>
            )}
            {configMaps.map((cm) => (
              <button
                key={cm.name}
                type="button"
                className="w-full flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left hover:bg-slate-50"
                onClick={() => selectConfigMap(cm)}
              >
                <span className="font-mono text-xs break-all">{cm.name}</span>
                <span className="flex items-center gap-1 shrink-0">
                  {cm.consumedAs.map((c) => (
                    <Badge key={c} variant="secondary" className="text-[10px]">
                      {c}
                    </Badge>
                  ))}
                </span>
              </button>
            ))}
          </div>
        )}

        {phase === 'editor' && selected && (
          <div className="space-y-3 min-w-0">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPhase('list');
                  setSelected(null);
                  setError(null);
                  setSaveMessage(null);
                }}
              >
                <ChevronLeft className="h-4 w-4" />
                All ConfigMaps
              </Button>
              <span className="font-mono text-xs break-all">{selected.name}</span>
              <span className="flex items-center gap-1">
                {selected.consumedAs.map((c) => (
                  <Badge key={c} variant="secondary" className="text-[10px]">
                    {c}
                  </Badge>
                ))}
              </span>
            </div>

            {lastEdit && (
              <p className="text-xs text-slate-500">
                Last edited {formatRelativeTime(lastEdit.editedAt)} — {lastEdit.setKeys} key
                {lastEdit.setKeys === 1 ? '' : 's'} changed
                {lastEdit.deletedKeys > 0
                  ? `, ${lastEdit.deletedKeys} key${lastEdit.deletedKeys === 1 ? '' : 's'} deleted`
                  : ''}
                {lastEdit.rolloutRestart ? ', rollout restarted' : ''}
              </p>
            )}

            {truncated && (
              <div className="p-3 bg-amber-50 text-amber-700 rounded-md text-sm">
                This ConfigMap is too large to display in full (truncated). Editing is disabled
                to avoid silent data loss.
              </div>
            )}

            {saveMessage && (
              <div className="p-3 bg-emerald-50 text-emerald-700 rounded-md text-sm">
                {saveMessage}
              </div>
            )}

            {loadingKeys ? (
              <div className="flex items-center gap-2 text-sm text-slate-500 py-6 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading keys…
              </div>
            ) : (
              pristine && (
                <>
                  <div className="space-y-3">
                    {Object.keys(values)
                      .sort()
                      .map((key) => (
                        <div key={key} className="flex items-start gap-2">
                          <span
                            className="w-44 shrink-0 pt-2 font-mono text-xs break-all"
                            title={key}
                          >
                            {key}
                          </span>
                          <Textarea
                            value={values[key]}
                            onChange={(e) =>
                              setValues((prev) => ({ ...prev, [key]: e.target.value }))
                            }
                            className="font-mono text-xs min-h-9 flex-1"
                            disabled={readOnly}
                            spellCheck={false}
                          />
                          {!readOnly && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0 text-red-600 hover:text-red-700"
                              title={`Delete key ${key}`}
                              onClick={() =>
                                setValues((prev) => {
                                  const next = { ...prev };
                                  delete next[key];
                                  return next;
                                })
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                  </div>

                  {!readOnly && (
                    <div className="flex items-center gap-2">
                      <Input
                        value={newKey}
                        onChange={(e) => setNewKey(e.target.value)}
                        placeholder="new-key"
                        className="font-mono text-xs w-44"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addKey();
                          }
                        }}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={addKey}
                        disabled={
                          !newKey.trim() || !KEY_RE.test(newKey.trim()) || newKey.trim() in values
                        }
                      >
                        <Plus className="h-4 w-4" />
                        Add key
                      </Button>
                    </div>
                  )}

                  {!readOnly && (
                    <div className="flex justify-end">
                      <Button onClick={openConfirm} disabled={!hasChanges || saving}>
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save changes'}
                      </Button>
                    </div>
                  )}
                </>
              )
            )}
          </div>
        )}
      </DialogContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Apply changes to <span className="font-mono">{selected?.name}</span>?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {changedKeys.length} key{changedKeys.length === 1 ? '' : 's'} changed
                  {changedKeys.length > 0 && (
                    <span className="font-mono"> ({changedKeys.join(', ')})</span>
                  )}
                  {deletedKeys.length > 0 && (
                    <>
                      {' '}
                      — {deletedKeys.length} key{deletedKeys.length === 1 ? '' : 's'} deleted
                      <span className="font-mono"> ({deletedKeys.join(', ')})</span>
                    </>
                  )}
                  .
                </p>
                <p>
                  Changes apply per key; concurrent edits to the same key are overwritten.
                  This affects production.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <Checkbox
              checked={rolloutRestart}
              onCheckedChange={(checked) => setRolloutRestart(checked === true)}
            />
            Rollout restart deployment <span className="font-mono">{deploymentName}</span>{' '}
            (only this Deployment)
          </label>
          {error && <ErrorBanner message={error} />}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Keep the dialog open while the async save runs
                e.preventDefault();
                handleSave();
              }}
              disabled={saving}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
