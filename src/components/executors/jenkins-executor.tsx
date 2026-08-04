'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Play, CheckCircle, XCircle, ExternalLink } from 'lucide-react';
import {
  listServices,
  getDeployParams,
  triggerDeploy,
  getDeployStatus,
  getLastDeploy,
  type DeployStatus,
} from '@/lib/actions/jenkins';
import { JenkinsPodsPanel } from '@/components/executors/jenkins-pods-panel';

interface JenkinsExecutorProps {
  customerStepId: number;
  customerId: number;
  namespace: string;
  kubeContext?: string;
}

const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

export function JenkinsExecutor({ customerStepId, customerId, namespace, kubeContext }: JenkinsExecutorProps) {
  const [services, setServices] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [service, setService] = useState<string>('');
  const [branchChoices, setBranchChoices] = useState<string[] | null>(null);
  const [branchType, setBranchType] = useState<string | null>(null);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [branch, setBranch] = useState<string>('');
  const [isDeploying, setIsDeploying] = useState(false);
  const [status, setStatus] = useState<DeployStatus | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Branch of the restored last deploy, applied once the branch param loads
  const restoredBranchRef = useRef<string | null>(null);

  // Load services and restore the last deploy (persisted in step_executions)
  useEffect(() => {
    (async () => {
      try {
        const [list, last] = await Promise.all([
          listServices(customerId),
          getLastDeploy(customerStepId).catch(() => null),
        ]);
        setServices(list);
        if (last?.service && list.includes(last.service)) {
          restoredBranchRef.current = last.branch;
          setService(last.service);
        } else if (list.length === 1) {
          setService(list[0]);
        }
        if (last) {
          const state: DeployStatus['state'] =
            last.state === 'running' ? 'running' :
            last.state === 'completed' ? 'completed' : 'failed';
          setStatus({
            state,
            result: last.result || (state === 'failed' ? last.state.toUpperCase() : null),
            buildUrl: last.buildUrl || undefined,
            duration: last.duration ?? undefined,
          });
          // A deploy left in flight when the panel was closed — resume tracking it
          if (last.state === 'running') startPolling(last.executionId);
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load services');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, customerStepId]);

  // Load the branch parameter whenever the selected service changes
  useEffect(() => {
    if (!service) return;
    setBranchChoices(null);
    setBranchType(null);
    setBranchError(null);
    setBranch('');
    getDeployParams(customerId, service)
      .then((params) => {
        setBranchChoices(params.choices);
        setBranchType(params.type);
        setBranch(restoredBranchRef.current || params.default || params.choices?.[0] || '');
        restoredBranchRef.current = null;
      })
      .catch((err) => {
        // Fall back to free-text branch entry, but surface why choices failed to load
        setBranchChoices(null);
        setBranchError(err instanceof Error ? err.message : 'Failed to load branch parameter');
      });
  }, [customerId, service]);

  // Stop polling when the component unmounts
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startPolling = (executionId: number) => {
    const startedAt = Date.now();
    pollRef.current = setInterval(async () => {
      try {
        const next = await getDeployStatus(executionId);
        setStatus(next);
        if (next.state === 'completed' || next.state === 'failed' || Date.now() - startedAt > POLL_TIMEOUT_MS) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch (err) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setDeployError(err instanceof Error ? err.message : 'Failed to poll build status');
      }
    }, POLL_INTERVAL_MS);
  };

  const handleDeploy = async () => {
    setIsDeploying(true);
    setDeployError(null);
    setStatus(null);

    try {
      const { executionId } = await triggerDeploy(customerStepId, service, branch);
      setStatus({ state: 'queued' });
      startPolling(executionId);
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : 'Failed to trigger deploy');
    } finally {
      setIsDeploying(false);
    }
  };

  const isRunning = status?.state === 'queued' || status?.state === 'running';

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <Badge variant="outline" className="bg-blue-50">Jenkins Deploy</Badge>
          <Button
            size="sm"
            onClick={handleDeploy}
            disabled={isDeploying || isRunning || !service}
            className="bg-green-600 hover:bg-green-700"
          >
            {isDeploying || isRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            <span className="ml-2">Deploy</span>
          </Button>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {loadError && (
          <div className="p-3 bg-red-50 text-red-600 rounded-md text-sm">
            {loadError}
          </div>
        )}

        {!loadError && services === null && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading services from Jenkins...
          </div>
        )}

        {services && services.length > 0 && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Service</Label>
              <Select value={service} onValueChange={setService} disabled={isRunning}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a service" />
                </SelectTrigger>
                <SelectContent>
                  {services.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Branch</Label>
              {branchChoices ? (
                <Select value={branch} onValueChange={setBranch} disabled={isRunning}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {branchChoices.map((b) => (
                      <SelectItem key={b} value={b}>{b}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="e.g., main"
                  disabled={isRunning}
                />
              )}
              {!branchChoices && !branchError && branchType && /git/i.test(branchType) && (
                <p className="text-xs text-slate-500">
                  Jenkins does not expose branch values for git parameters via its API — type the branch manually.
                </p>
              )}
              {branchError && (
                <p className="text-xs text-red-600">{branchError}</p>
              )}
            </div>
          </div>
        )}

        {deployError && (
          <div className="p-3 bg-red-50 text-red-600 rounded-md text-sm">
            {deployError}
          </div>
        )}

        {status && (
          <div className={`rounded-md p-4 ${
            status.state === 'completed' ? 'bg-green-50' :
            status.state === 'failed' ? 'bg-red-50' : 'bg-blue-50'
          }`}>
            <div className="flex items-center gap-2">
              {status.state === 'completed' && <CheckCircle className="h-5 w-5 text-green-600" />}
              {status.state === 'failed' && <XCircle className="h-5 w-5 text-red-600" />}
              {isRunning && <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />}
              <span className={
                status.state === 'completed' ? 'text-green-800' :
                status.state === 'failed' ? 'text-red-800' : 'text-blue-800'
              }>
                {status.state === 'queued' && 'Queued on Jenkins...'}
                {status.state === 'running' && 'Build running...'}
                {status.state === 'completed' && (status.result || 'SUCCESS')}
                {status.state === 'failed' && (status.result || 'FAILURE')}
              </span>
              {status.buildUrl && (
                <a
                  href={status.buildUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto flex items-center gap-1 text-sm text-blue-600 hover:underline"
                >
                  View build
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </div>
        )}

        {service && namespace && (
          <JenkinsPodsPanel
            customerId={customerId}
            namespace={namespace}
            kubeContext={kubeContext}
            service={service}
            active={isRunning}
          />
        )}
      </CardContent>
    </Card>
  );
}
