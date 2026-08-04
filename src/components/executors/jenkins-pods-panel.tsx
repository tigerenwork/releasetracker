'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw } from 'lucide-react';
import { agentBridge, type PodInfo } from '@/lib/services/agent-bridge';
import { appFromPodName } from '@/lib/grafana';
import { getCustomerJenkinsConfig } from '@/lib/actions/jenkins';
import { formatRelativeTime } from '@/components/pods/pod-utils';
import { PodTable } from '@/components/pods/pod-table';

interface JenkinsPodsPanelProps {
  customerId: number;
  namespace: string;
  kubeContext?: string;
  /** The Jenkins service that was deployed, e.g. "aldebaran-chaitin-deploy" */
  service: string;
  /** True while a deploy is in flight — polls faster */
  active: boolean;
}

const POLL_ACTIVE_MS = 5000;
const POLL_IDLE_MS = 15000;

/**
 * Live pod status for the service a Jenkins step just deployed.
 * Maps service -> pods via the per-customer servicePodMap (service -> app name),
 * falling back to the app name derived from pod names (longest prefix match).
 */
export function JenkinsPodsPanel({ customerId, namespace, kubeContext, service, active }: JenkinsPodsPanelProps) {
  const [pods, setPods] = useState<PodInfo[]>([]);
  const [appName, setAppName] = useState<string | null>(null);
  const [servicePodMap, setServicePodMap] = useState<Record<string, string> | null | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const fetchingRef = useRef(false);

  // Load the per-customer service -> pod app mapping once
  useEffect(() => {
    getCustomerJenkinsConfig(customerId)
      .then((config) => setServicePodMap(config?.servicePodMap || null))
      .catch(() => setServicePodMap(null));
  }, [customerId]);

  const override = servicePodMap?.[service] || null;

  const refresh = useCallback(async () => {
    if (!agentBridge) {
      setError('Extension not available. Install the browser extension to see pod status here.');
      return;
    }
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const result = await agentBridge.getPods({
        customerId,
        namespace,
        podSelector: '',
        kubeContext,
        stepId: 0,
        releaseId: 0,
      });

      if (result.success && result.pods) {
        const all = result.pods.items;
        if (override) {
          setAppName(override);
          setPods(all.filter((p) => appFromPodName(p.name) === override));
        } else {
          // Longest app name that the service name starts with wins:
          // "aldebaran-chaitin-deploy" matches app "aldebaran"
          const apps = [...new Set(all.map((p) => appFromPodName(p.name)))]
            .filter((app) => service === app || service.startsWith(`${app}-`))
            .sort((a, b) => b.length - a.length);
          const match = apps[0] || null;
          setAppName(match);
          setPods(match ? all.filter((p) => appFromPodName(p.name) === match) : []);
        }
        setLastRefreshed(new Date());
      } else {
        setError(result.error?.message || 'Failed to fetch pods');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      fetchingRef.current = false;
      setIsLoading(false);
    }
  }, [customerId, namespace, kubeContext, service, override]);

  // Initial fetch once the mapping has resolved, then poll
  useEffect(() => {
    if (servicePodMap === undefined || !namespace) return;
    refresh();
    const interval = setInterval(refresh, active ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    return () => clearInterval(interval);
  }, [refresh, active, servicePodMap, namespace]);

  return (
    <div className="rounded-md border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          Pods{appName && <> · <span className="font-mono">{appName}</span></>}
        </span>
        <div className="flex items-center gap-3">
          {lastRefreshed && (
            <span className="text-xs text-muted-foreground">
              Refreshed {formatRelativeTime(lastRefreshed.toISOString())}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-2">Refresh</span>
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {!error && !isLoading && pods.length === 0 && lastRefreshed && (
        <p className="text-sm text-muted-foreground">
          No pods matched service <span className="font-mono">{service}</span> — add a
          Service → Pod App mapping on the customer edit page if the names differ.
        </p>
      )}

      {pods.length > 0 && (
        <PodTable pods={pods} namespace={namespace} kubeContext={kubeContext} onPodsChanged={refresh} />
      )}
    </div>
  );
}
