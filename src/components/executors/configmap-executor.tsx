'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import {
  agentBridge,
  supportsConfigEdit,
  CONFIG_EDIT_MIN_VERSION,
  type ConfigMapRef,
  type ExecutionContext,
  type PodInfo,
} from '@/lib/services/agent-bridge';
import { appFromPodName } from '@/lib/grafana';
import { recordConfigMapEdit } from '@/lib/actions/config-map-edits';
import { parseConfigMapContent } from '@/lib/configmap-content';

interface ConfigMapExecutorProps {
  stepId: number;
  customerId: number;
  releaseId: number;
  content: string;
  namespace: string;
  kubeContext?: string;
}

export function ConfigMapExecutor({ stepId, customerId, releaseId, content, namespace, kubeContext }: ConfigMapExecutorProps) {
  // agentBridge only exists in the browser; defer the check until after mount
  // so server-rendered HTML matches the first client render
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const available = mounted && !!agentBridge?.isAvailable();
  const version = mounted ? agentBridge?.getStatus().version : undefined;
  const agentSupported = available && supportsConfigEdit(version);

  const { set: vars, delete: delKeys, invalid } = useMemo(() => parseConfigMapContent(content), [content]);
  const varEntries = Object.entries(vars);
  const hasChanges = varEntries.length > 0 || delKeys.length > 0;

  // pod loading
  const [pods, setPods] = useState<PodInfo[] | null>(null);
  const [loadingPods, setLoadingPods] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [podName, setPodName] = useState('');

  // describe → ConfigMap picker
  const [describing, setDescribing] = useState(false);
  const [describeError, setDescribeError] = useState<string | null>(null);
  const [unsupportedReason, setUnsupportedReason] = useState<string | null>(null);
  const [configMaps, setConfigMaps] = useState<ConfigMapRef[] | null>(null);
  const [configMapName, setConfigMapName] = useState('');

  // apply / restart
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartMessage, setRestartMessage] = useState<string | null>(null);

  const deploymentName = useMemo(() => (podName ? appFromPodName(podName) : ''), [podName]);

  const bridgeContext = (): ExecutionContext => ({
    customerId,
    namespace,
    podSelector: '',
    podName,
    kubeContext,
    stepId,
    releaseId,
  });

  const loadPods = async () => {
    if (!agentBridge) return;
    setLoadingPods(true);
    setLoadError(null);
    try {
      const res = await agentBridge.getPods({
        customerId,
        namespace,
        podSelector: '',
        kubeContext,
        stepId,
        releaseId,
      });
      if (res.success && res.pods) {
        setPods(res.pods.items);
        if (res.pods.items.length === 1) handlePodChange(res.pods.items[0].name);
      } else {
        setLoadError(res.error?.message || 'Failed to load pods');
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load pods');
    } finally {
      setLoadingPods(false);
    }
  };

  const handlePodChange = (name: string) => {
    setPodName(name);
    setConfigMaps(null);
    setConfigMapName('');
    setDescribeError(null);
    setUnsupportedReason(null);
    setApplied(false);
    setApplyError(null);
    setRestartMessage(null);
  };

  // Resolve the pod's Deployment and list the ConfigMaps it consumes
  const describeDeployment = async () => {
    if (!agentBridge || !deploymentName) return;
    setDescribing(true);
    setDescribeError(null);
    setUnsupportedReason(null);
    setConfigMaps(null);
    setConfigMapName('');
    try {
      const res = await agentBridge.configDescribe(bridgeContext(), deploymentName);
      if (!res.success) {
        setDescribeError(res.error?.message || 'Failed to describe deployment');
        return;
      }
      const cfg = res.config;
      if (cfg?.supported === false) {
        setUnsupportedReason(cfg.unsupportedReason || 'Config edit not supported for this workload');
        return;
      }
      const refs = cfg?.configMaps ?? [];
      setConfigMaps(refs);
      if (refs.length === 1) setConfigMapName(refs[0].name);
    } catch (err) {
      setDescribeError(err instanceof Error ? err.message : 'Failed to describe deployment');
    } finally {
      setDescribing(false);
    }
  };

  const handleApply = async () => {
    if (!agentBridge || !configMapName || !hasChanges) return;
    setApplying(true);
    setApplyError(null);
    setApplied(false);
    setRestartMessage(null);

    const patch = { set: vars, delete: delKeys };
    try {
      const res = await agentBridge.configApply(bridgeContext(), configMapName, patch);
      if (!res.success) {
        setApplyError(res.error?.message || 'Failed to apply ConfigMap changes');
        return;
      }
      setApplied(true);

      // Persist the last edit — non-blocking: the edit is already applied
      try {
        await recordConfigMapEdit({
          kubeContext: kubeContext ?? '',
          namespace,
          configMapName,
          deploymentName,
          patch,
          rolloutRestart: false,
        });
      } catch (persistErr) {
        console.error('Failed to record ConfigMap edit:', persistErr);
      }
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Failed to apply ConfigMap changes');
    } finally {
      setApplying(false);
    }
  };

  const handleRolloutRestart = async () => {
    if (!agentBridge || !deploymentName) return;
    setRestarting(true);
    setRestartMessage(null);
    try {
      const res = await agentBridge.rolloutRestart(bridgeContext(), deploymentName);
      setRestartMessage(
        res.success
          ? `Rollout restart of ${deploymentName} triggered`
          : `Rollout restart failed: ${res.error?.message || 'unknown error'}`
      );
    } catch (err) {
      setRestartMessage(`Rollout restart failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setRestarting(false);
    }
  };

  if (!mounted) return null;

  if (!available || !agentSupported) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-amber-700 bg-amber-50 rounded-md p-3">
            {!available
              ? 'Agent extension not detected. Install the browser extension and start the local agent to execute this step in the cluster.'
              : `ConfigMap edit requires agent >= ${CONFIG_EDIT_MIN_VERSION}. Please update the local agent.`}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <Badge variant="outline" className="bg-amber-50">ConfigMap Env</Badge>
          <Button
            size="sm"
            onClick={handleApply}
            disabled={applying || !configMapName || !hasChanges}
            className="bg-green-600 hover:bg-green-700"
          >
            {applying && <Loader2 className="h-4 w-4 animate-spin" />}
            <span className="ml-2">Apply to ConfigMap</span>
          </Button>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Parsed variables from the step content */}
        <div className="space-y-2">
          <p className="text-sm text-slate-500">
            {varEntries.length} variable{varEntries.length === 1 ? '' : 's'} to set
            {delKeys.length > 0 && `, ${delKeys.length} key${delKeys.length === 1 ? '' : 's'} to delete`}
            {invalid.length > 0 && ` — ${invalid.length} line${invalid.length === 1 ? '' : 's'} skipped`}
          </p>

          {!hasChanges && (
            <div className="p-3 bg-red-50 text-red-600 rounded-md text-sm">
              No valid KEY=VALUE or -KEY lines in the step content. Nothing to apply.
            </div>
          )}

          {invalid.length > 0 && (
            <div className="p-3 bg-amber-50 text-amber-700 rounded-md text-sm space-y-1">
              <p className="font-medium">Skipped lines:</p>
              {invalid.map((s, i) => (
                <p key={i} className="font-mono text-xs">
                  {s.line} ({s.reason})
                </p>
              ))}
            </div>
          )}
        </div>

        {/* Pod picker */}
        {pods === null ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={loadPods} disabled={loadingPods}>
              {loadingPods && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Load Pods
            </Button>
            {loadError && (
              <span className="text-sm text-red-600">{loadError}</span>
            )}
          </div>
        ) : pods.length === 0 ? (
          <p className="text-sm text-slate-500">No pods found in namespace {namespace}.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Pod</Label>
              <Select value={podName} onValueChange={handlePodChange} disabled={applying}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a pod" />
                </SelectTrigger>
                <SelectContent>
                  {pods.map((p) => (
                    <SelectItem key={p.name} value={p.name}>
                      {p.name} ({p.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {podName && (
              <div className="space-y-2">
                <Label>ConfigMap</Label>
                {configMaps === null ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={describeDeployment}
                    disabled={describing}
                  >
                    {describing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    List ConfigMaps of {deploymentName}
                  </Button>
                ) : configMaps.length === 0 ? (
                  <p className="text-sm text-slate-500 pt-2">
                    Deployment {deploymentName} does not reference any ConfigMaps.
                  </p>
                ) : (
                  <Select value={configMapName} onValueChange={setConfigMapName} disabled={applying}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a ConfigMap" />
                    </SelectTrigger>
                    <SelectContent>
                      {configMaps.map((cm) => (
                        <SelectItem key={cm.name} value={cm.name}>
                          {cm.name} ({cm.consumedAs.join(', ')})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
          </div>
        )}

        {describeError && (
          <div className="p-3 bg-red-50 text-red-600 rounded-md text-sm">{describeError}</div>
        )}
        {unsupportedReason && (
          <div className="p-3 bg-amber-50 text-amber-700 rounded-md text-sm">{unsupportedReason}</div>
        )}

        {/* Preview */}
        {configMapName && varEntries.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-slate-500">
              Will be set on <span className="font-mono">{configMapName}</span> — existing keys
              with the same name are overwritten:
            </p>
            <pre className="text-xs bg-slate-50 p-3 rounded-md overflow-x-auto max-h-40 font-mono">
              {varEntries.map(([k, v]) => `${k}=${v}`).join('\n')}
            </pre>
          </div>
        )}

        {configMapName && delKeys.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-amber-700">
              Will be deleted from <span className="font-mono">{configMapName}</span> — deletion
              is permanent on apply:
            </p>
            <pre className="text-xs bg-amber-50 border border-amber-200 p-3 rounded-md overflow-x-auto max-h-40 font-mono text-amber-800">
              {delKeys.map((k) => `-${k}`).join('\n')}
            </pre>
          </div>
        )}

        {/* Apply result */}
        {applyError && (
          <div className="p-3 bg-red-50 text-red-600 rounded-md text-sm flex items-center gap-2">
            <XCircle className="h-4 w-4 shrink-0" />
            {applyError}
          </div>
        )}

        {applied && (
          <div className="p-3 bg-green-50 rounded-md text-sm space-y-3">
            <div className="flex items-center gap-2 text-green-800">
              <CheckCircle className="h-4 w-4 shrink-0" />
              Applied {varEntries.length} key{varEntries.length === 1 ? '' : 's'}
              {delKeys.length > 0 &&
                `, deleted ${delKeys.length} key${delKeys.length === 1 ? '' : 's'}`}{' '}
              on <span className="font-mono">{configMapName}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRolloutRestart}
                disabled={restarting}
              >
                {restarting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Rollout Restart Deployment
              </Button>
              {restartMessage && (
                <span className="text-sm text-slate-600">{restartMessage}</span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
