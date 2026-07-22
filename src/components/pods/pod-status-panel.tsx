'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, RefreshCw } from 'lucide-react';
import { agentBridge, type PodInfo } from '@/lib/services/agent-bridge';
import { formatRelativeTime, statusVariant } from '@/components/pods/pod-utils';

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

        {pods.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ready</TableHead>
                <TableHead>Restarts</TableHead>
                <TableHead>Last Restart</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pods.map((pod) => (
                <TableRow key={pod.name}>
                  <TableCell className="font-mono text-xs">{pod.name}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(pod.status)}>{pod.status}</Badge>
                  </TableCell>
                  <TableCell>{pod.ready}</TableCell>
                  <TableCell className={pod.restarts > 0 ? 'text-amber-600 font-medium' : ''}>
                    {pod.restarts}
                  </TableCell>
                  <TableCell>{formatRelativeTime(pod.lastRestartAt)}</TableCell>
                  <TableCell>{formatRelativeTime(pod.createdAt)}</TableCell>
                  <TableCell className="font-mono text-xs">{pod.ip || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
