'use client';

import { useState, useEffect } from 'react';
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
import { Loader2, Play, CheckCircle, XCircle } from 'lucide-react';
import { agentBridge, type ExecutionResult, type PodInfo } from '@/lib/services/agent-bridge';
import {
  getLastScriptExecution,
  saveScriptExecution,
} from '@/lib/actions/step-executions';

interface BashExecutorProps {
  stepId: number;
  customerId: number;
  releaseId: number;
  content: string;
  namespace: string;
  kubeContext?: string;
}

function toDisplayResult(last: {
  success: boolean;
  exitCode?: number | null;
  duration: number;
  stdout: string;
  stderr: string;
  errorMessage?: string;
}): ExecutionResult {
  return {
    success: last.success,
    executionId: '',
    type: 'script',
    exitCode: last.exitCode ?? undefined,
    duration: last.duration,
    timestamp: '',
    script: {
      stdout: last.stdout,
      stderr: last.stderr,
      exitCode: last.exitCode ?? (last.success ? 0 : 1),
      command: '',
    },
    error: last.success
      ? undefined
      : { code: 'FAILED', message: last.errorMessage || 'Failed' },
  };
}

export function BashExecutor({ stepId, customerId, releaseId, content, namespace, kubeContext }: BashExecutorProps) {
  // agentBridge only exists in the browser; defer the check until after mount
  // so server-rendered HTML matches the first client render
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const available = mounted && !!agentBridge?.isAvailable();

  const [pods, setPods] = useState<PodInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [podName, setPodName] = useState('');
  const [containerName, setContainerName] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [execError, setExecError] = useState<string | null>(null);
  const [completedAt, setCompletedAt] = useState<string | null>(null);
  // Pod/container from last run — applied once pods finish loading
  const [restoredTarget, setRestoredTarget] = useState<{ podName?: string; containerName?: string } | null>(null);
  const [restoreReady, setRestoreReady] = useState(false);

  // Restore last execution output when the panel opens
  useEffect(() => {
    getLastScriptExecution(stepId, 'script')
      .then((last) => {
        if (!last) return;
        setResult(toDisplayResult(last));
        setCompletedAt(last.completedAt);
        const req = last.request as { podName?: string; containerName?: string };
        setRestoredTarget({ podName: req.podName, containerName: req.containerName });
      })
      .catch(() => {})
      .finally(() => setRestoreReady(true));
  }, [stepId]);

  // Load the namespace's pods once the extension is available
  useEffect(() => {
    if (!available || !agentBridge) return;
    agentBridge
      .getPods({ customerId, namespace, podSelector: '', kubeContext, stepId, releaseId })
      .then((res) => {
        if (res.success && res.pods) {
          setPods(res.pods.items);
        } else {
          setLoadError(res.error?.message || 'Failed to load pods');
        }
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load pods'));
  }, [available, customerId, namespace, kubeContext, stepId, releaseId]);

  // Prefer last-run pod/container when still present; otherwise pick the only pod
  useEffect(() => {
    if (!restoreReady || !pods?.length || podName) return;
    const restoredPod = restoredTarget?.podName;
    if (restoredPod && pods.some((p) => p.name === restoredPod)) {
      setPodName(restoredPod);
      const pod = pods.find((p) => p.name === restoredPod);
      const restoredContainer = restoredTarget?.containerName;
      if (restoredContainer && pod?.containers.some((c) => c.name === restoredContainer)) {
        setContainerName(restoredContainer);
      } else if (pod?.containers.length === 1) {
        setContainerName(pod.containers[0].name);
      }
    } else if (pods.length === 1) {
      setPodName(pods[0].name);
      if (pods[0].containers.length === 1) {
        setContainerName(pods[0].containers[0].name);
      }
    }
  }, [pods, restoredTarget, podName, restoreReady]);

  const selectedPod = pods?.find((p) => p.name === podName) || null;
  const containers = selectedPod?.containers || [];

  const handlePodChange = (name: string) => {
    setPodName(name);
    const pod = pods?.find((p) => p.name === name);
    // Pre-select the container only when the pod has exactly one
    setContainerName(pod?.containers.length === 1 ? pod.containers[0].name : '');
  };

  const handleExecute = async () => {
    if (!agentBridge || !podName) return;
    setIsExecuting(true);
    setResult(null);
    setExecError(null);
    setCompletedAt(null);

    try {
      const executionResult = await agentBridge.executeScript(
        {
          customerId,
          namespace,
          podSelector: '',
          podName,
          containerName: containerName || undefined,
          kubeContext,
          stepId,
          releaseId,
        },
        { interpreter: 'bash', content }
      );
      setResult(executionResult);
      setCompletedAt(new Date().toISOString());

      try {
        await saveScriptExecution({
          stepId,
          customerId,
          releaseId,
          type: 'script',
          request: { podName, containerName: containerName || undefined, kubeContext, namespace },
          success: executionResult.success,
          exitCode: executionResult.exitCode ?? executionResult.script?.exitCode,
          duration: executionResult.duration,
          stdout: executionResult.script?.stdout,
          stderr: executionResult.script?.stderr,
          errorMessage: executionResult.error?.message,
        });
      } catch (persistErr) {
        console.error('Failed to save bash execution:', persistErr);
      }
    } catch (err) {
      setExecError(err instanceof Error ? err.message : 'Execution failed');
    } finally {
      setIsExecuting(false);
    }
  };

  if (!mounted) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <Badge variant="outline" className="bg-amber-50">Bash Execute</Badge>
          {available && (
            <Button
              size="sm"
              onClick={handleExecute}
              disabled={isExecuting || !podName || (containers.length > 1 && !containerName)}
              className="bg-green-600 hover:bg-green-700"
            >
              {isExecuting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              <span className="ml-2">Execute</span>
            </Button>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {!available && (
          <p className="text-sm text-amber-700 bg-amber-50 rounded-md p-3">
            Agent extension not detected. Install the browser extension and start the local
            agent to execute this step in the cluster.
          </p>
        )}

        {available && loadError && (
          <div className="p-3 bg-red-50 text-red-600 rounded-md text-sm">
            {loadError}
          </div>
        )}

        {available && !loadError && pods === null && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading pods in {namespace}...
          </div>
        )}

        {available && pods && pods.length === 0 && (
          <p className="text-sm text-slate-500">No pods found in namespace {namespace}.</p>
        )}

        {available && pods && pods.length > 0 && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Pod</Label>
              <Select value={podName} onValueChange={handlePodChange} disabled={isExecuting}>
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

            {containers.length > 1 && (
              <div className="space-y-2">
                <Label>Container</Label>
                <Select value={containerName} onValueChange={setContainerName} disabled={isExecuting}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a container" />
                  </SelectTrigger>
                  <SelectContent>
                    {containers.map((c) => (
                      <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        {execError && (
          <div className="p-3 bg-red-50 text-red-600 rounded-md text-sm">
            {execError}
          </div>
        )}

        {result && (
          <div className={`rounded-md p-4 ${result.success ? 'bg-green-50' : 'bg-red-50'}`}>
            <div className="flex items-center gap-2 mb-2">
              {result.success ? (
                <CheckCircle className="h-5 w-5 text-green-600" />
              ) : (
                <XCircle className="h-5 w-5 text-red-600" />
              )}
              <span className={result.success ? 'text-green-800' : 'text-red-800'}>
                {result.success ? 'Success' : (result.error?.message || 'Failed')}
                {result.exitCode !== undefined && ` (Exit Code: ${result.exitCode})`}
              </span>
              <span className="text-slate-500 text-sm ml-auto">
                {completedAt ? `${new Date(completedAt).toLocaleString()} · ` : ''}
                {result.duration}ms
              </span>
            </div>

            {result.script?.stdout && (
              <div className="mt-2">
                <p className="text-xs font-medium text-slate-500 mb-1">Output:</p>
                <pre className="text-xs bg-white/50 p-2 rounded overflow-x-auto max-h-60 font-mono">
                  {result.script.stdout}
                </pre>
              </div>
            )}

            {result.script?.stderr && (
              <div className="mt-2">
                <p className="text-xs font-medium text-red-600 mb-1">Stderr:</p>
                <pre className="text-xs bg-white/50 p-2 rounded overflow-x-auto max-h-40 text-red-700 font-mono">
                  {result.script.stderr}
                </pre>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
