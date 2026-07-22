'use client';

import { useState, useEffect } from 'react';
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
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { agentBridge, type PodInfo } from '@/lib/services/agent-bridge';
import { formatRelativeTime, statusVariant } from '@/components/pods/pod-utils';

interface ClusterPodsCardProps {
  clusterName: string;
  customers: { id: number; name: string; namespace: string }[];
  releaseId: number;
}

interface CustomerPodsState {
  status: 'idle' | 'loading' | 'loaded' | 'error';
  pods?: PodInfo[];
  error?: string;
  refreshedAt?: Date;
}

export function ClusterPodsCard({ clusterName, customers, releaseId }: ClusterPodsCardProps) {
  const [states, setStates] = useState<Record<number, CustomerPodsState>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);

  // agentBridge only exists in the browser; defer the check until after
  // mount so server-rendered HTML matches the first client render
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const extensionAvailable = mounted && !!agentBridge?.isAvailable();

  const updateState = (customerId: number, patch: Partial<CustomerPodsState>) => {
    setStates((prev) => ({
      ...prev,
      [customerId]: { ...prev[customerId], status: 'idle', ...patch } as CustomerPodsState,
    }));
  };

  const refreshCustomer = async (customer: ClusterPodsCardProps['customers'][number]) => {
    if (!agentBridge) return;

    updateState(customer.id, { status: 'loading', error: undefined });

    try {
      const result = await agentBridge.getPods({
        customerId: customer.id,
        namespace: customer.namespace,
        podSelector: '',
        kubeContext: clusterName,
        stepId: 0,
        releaseId,
      });

      if (result.success && result.pods) {
        updateState(customer.id, {
          status: 'loaded',
          pods: result.pods.items,
          refreshedAt: new Date(),
        });
      } else {
        updateState(customer.id, {
          status: 'error',
          error: result.error?.message || 'Failed to fetch pods',
        });
      }
    } catch (err) {
      updateState(customer.id, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  };

  const refreshAll = async () => {
    setIsRefreshingAll(true);
    for (const customer of customers) {
      await refreshCustomer(customer);
    }
    setIsRefreshingAll(false);
  };

  const toggleExpanded = (customerId: number) => {
    setExpanded((prev) => ({ ...prev, [customerId]: !prev[customerId] }));
  };

  const renderSummary = (customerId: number) => {
    const state = states[customerId];

    if (!state || state.status === 'idle') {
      return <span className="text-xs text-slate-400">Not loaded</span>;
    }
    if (state.status === 'loading') {
      return <Loader2 className="h-4 w-4 animate-spin text-slate-400" />;
    }
    if (state.status === 'error') {
      return <span className="text-xs text-red-600">{state.error}</span>;
    }

    const pods = state.pods || [];
    const running = pods.filter((p) => p.status === 'Running').length;
    const restarts = pods.reduce((sum, p) => sum + p.restarts, 0);
    const unhealthy = pods.filter((p) => p.status !== 'Running' && p.status !== 'Succeeded');

    return (
      <div className="flex items-center gap-2">
        <Badge variant={unhealthy.length > 0 ? 'destructive' : 'default'}>
          {running}/{pods.length} Running
        </Badge>
        {restarts > 0 && (
          <span className="text-xs text-amber-600 font-medium">{restarts} restarts</span>
        )}
        {unhealthy.length > 0 && (
          <span className="text-xs text-red-600">
            {unhealthy.map((p) => `${p.name}: ${p.status}`).join(', ')}
          </span>
        )}
        {state.refreshedAt && (
          <span className="text-xs text-slate-400">
            {formatRelativeTime(state.refreshedAt.toISOString())}
          </span>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <span className="w-3 h-3 bg-blue-500 rounded-full"></span>
            {clusterName}
            <span className="text-sm font-normal text-slate-500">Customer Pods</span>
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={refreshAll}
            disabled={isRefreshingAll || !extensionAvailable}
          >
            {isRefreshingAll ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-2">Refresh All</span>
          </Button>
        </CardTitle>
      </CardHeader>

      <CardContent>
        {!mounted ? (
          <p className="text-sm text-slate-400">Checking agent extension…</p>
        ) : !extensionAvailable ? (
          <p className="text-sm text-amber-700 bg-amber-50 rounded-md p-3">
            Agent extension not detected. Install the browser extension and start the local
            agent to view pod status.
          </p>
        ) : (
          <div className="divide-y">
            {customers.map((customer) => {
              const state = states[customer.id];
              const isExpanded = !!expanded[customer.id];
              const hasPods = state?.status === 'loaded' && (state.pods?.length || 0) > 0;

              return (
                <div key={customer.id} className="py-2">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => toggleExpanded(customer.id)}
                      disabled={!hasPods}
                      className="text-slate-400 disabled:opacity-30"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>
                    <div className="w-48">
                      <div className="text-sm font-medium">{customer.name}</div>
                      <div className="text-xs text-slate-400 font-mono">{customer.namespace}</div>
                    </div>
                    <div className="flex-1">{renderSummary(customer.id)}</div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => refreshCustomer(customer)}
                      disabled={state?.status === 'loading' || isRefreshingAll}
                    >
                      {state?.status === 'loading' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </Button>
                  </div>

                  {isExpanded && hasPods && (
                    <div className="mt-2 ml-7">
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
                          {state.pods!.map((pod) => (
                            <TableRow key={pod.name}>
                              <TableCell className="font-mono text-xs">{pod.name}</TableCell>
                              <TableCell>
                                <Badge variant={statusVariant(pod.status)}>{pod.status}</Badge>
                              </TableCell>
                              <TableCell>{pod.ready}</TableCell>
                              <TableCell
                                className={pod.restarts > 0 ? 'text-amber-600 font-medium' : ''}
                              >
                                {pod.restarts}
                              </TableCell>
                              <TableCell>{formatRelativeTime(pod.lastRestartAt)}</TableCell>
                              <TableCell>{formatRelativeTime(pod.createdAt)}</TableCell>
                              <TableCell className="font-mono text-xs">{pod.ip || '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
