'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, RefreshCw } from 'lucide-react';
import { agentBridge, type PodInfo } from '@/lib/services/agent-bridge';
import { formatRelativeTime } from '@/components/pods/pod-utils';
import { PodTable } from '@/components/pods/pod-table';

interface PodStatusPanelProps {
  namespace: string;
  podSelector?: string;
  kubeContext?: string;
}

export function PodStatusPanel({ namespace, podSelector, kubeContext }: PodStatusPanelProps) {
  const [pods, setPods] = useState<PodInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    if (!agentBridge) {
      setError('Extension not available. Please install the browser extension.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await agentBridge.getPods({
        customerId: 0,
        namespace,
        podSelector: podSelector || '',
        kubeContext,
        stepId: 0,
        releaseId: 0,
      });

      if (result.success && result.pods) {
        setPods(result.pods.items);
        setLastRefreshed(new Date());
      } else {
        setError(result.error?.message || 'Failed to fetch pods');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, [namespace, podSelector, kubeContext]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span>
            Pods in <span className="font-mono">{kubeContext || 'current'}/{namespace}</span>
          </span>
          <div className="flex items-center gap-3">
            {lastRefreshed && (
              <span className="text-xs font-normal text-muted-foreground">
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
        </CardTitle>
      </CardHeader>

      <CardContent>
        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 mb-4">{error}</div>
        )}

        {!error && pods.length === 0 && !isLoading && (
          <p className="text-sm text-muted-foreground">No pods found.</p>
        )}

        {pods.length > 0 && <PodTable pods={pods} />}
      </CardContent>
    </Card>
  );
}
