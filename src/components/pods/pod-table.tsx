'use client';

import { Fragment, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { PodInfo } from '@/lib/services/agent-bridge';
import { appFromPodName } from '@/lib/grafana';
import { formatRelativeTime, statusBadgeClass } from '@/components/pods/pod-utils';
import { ContainerCommandDialog } from '@/components/pods/container-command-dialog';
import { ContainerShellDialog } from '@/components/pods/container-shell-dialog';
import { ContainerLogsDialog } from '@/components/pods/container-logs-dialog';
import { PodRestartDialog } from '@/components/pods/pod-restart-dialog';
import { GrafanaExploreDialog } from '@/components/grafana/grafana-explore-dialog';

interface PodTableProps {
  pods: PodInfo[];
  /** When provided, container rows get a "run command" action */
  namespace?: string;
  kubeContext?: string;
  /** When provided (with namespace), pod rows get a restart action */
  onPodsChanged?: () => void;
}

/**
 * Pod status table with expandable per-container details
 */
export function PodTable({ pods, namespace, kubeContext, onPodsChanged }: PodTableProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const showActions = !!namespace;

  const toggle = (podName: string) => {
    setExpanded((prev) => ({ ...prev, [podName]: !prev[podName] }));
  };

  // Alphabetical order — makes it easy to locate a specific service
  const sortedPods = [...pods].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8"></TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Ready</TableHead>
          <TableHead>Restarts</TableHead>
          <TableHead>Last Restart</TableHead>
          <TableHead>Age</TableHead>
          <TableHead>IP</TableHead>
          {showActions && <TableHead className="w-20"></TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedPods.map((pod) => {
          const isExpanded = !!expanded[pod.name];
          const containers = pod.containers || [];

          return (
            <Fragment key={pod.name}>
              <TableRow
                className={containers.length > 0 ? 'cursor-pointer' : ''}
                onClick={() => containers.length > 0 && toggle(pod.name)}
              >
                <TableCell className="w-8 pr-0">
                  <span
                    className={`text-slate-400 ${containers.length === 0 ? 'opacity-30' : ''}`}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs">{pod.name}</TableCell>
                <TableCell>
                  <Badge className={statusBadgeClass(pod.status)}>{pod.status}</Badge>
                </TableCell>
                <TableCell>{pod.ready}</TableCell>
                <TableCell className={pod.restarts > 0 ? 'text-amber-600 font-medium' : ''}>
                  {pod.restarts}
                </TableCell>
                <TableCell>{formatRelativeTime(pod.lastRestartAt)}</TableCell>
                <TableCell>{formatRelativeTime(pod.createdAt)}</TableCell>
                <TableCell className="font-mono text-xs">{pod.ip || '—'}</TableCell>
                {showActions && (
                  <TableCell>
                    <div className="flex items-center">
                      <GrafanaExploreDialog
                        cluster={kubeContext}
                        namespace={namespace}
                        defaultApp={appFromPodName(pod.name)}
                      />
                      {onPodsChanged && (
                        <PodRestartDialog
                          kubeContext={kubeContext}
                          namespace={namespace}
                          podName={pod.name}
                          onRestarted={onPodsChanged}
                        />
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>

              {isExpanded && containers.length > 0 && (
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  <TableCell></TableCell>
                  <TableCell colSpan={showActions ? 8 : 7} className="py-2">
                    <div className="rounded-md border bg-white">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Container</TableHead>
                            <TableHead>State</TableHead>
                            <TableHead>Ready</TableHead>
                            <TableHead>Restarts</TableHead>
                            <TableHead>Started</TableHead>
                            <TableHead>Last Terminated</TableHead>
                            {namespace && <TableHead className="w-12">Run</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {containers.map((container) => (
                            <TableRow key={container.name}>
                              <TableCell className="font-mono text-xs">
                                {container.name}
                              </TableCell>
                              <TableCell>
                                <Badge className={statusBadgeClass(container.state)}>
                                  {container.state}
                                </Badge>
                              </TableCell>
                              <TableCell>{container.ready ? 'Yes' : 'No'}</TableCell>
                              <TableCell
                                className={
                                  container.restartCount > 0 ? 'text-amber-600 font-medium' : ''
                                }
                              >
                                {container.restartCount}
                              </TableCell>
                              <TableCell>{formatRelativeTime(container.startedAt)}</TableCell>
                              <TableCell>
                                {container.lastTerminatedAt
                                  ? `${formatRelativeTime(container.lastTerminatedAt)}${
                                      container.lastTerminatedReason
                                        ? ` (${container.lastTerminatedReason})`
                                        : ''
                                    }`
                                  : '—'}
                              </TableCell>
                              {namespace && (
                                <TableCell>
                                  <div className="flex items-center">
                                    <ContainerCommandDialog
                                      kubeContext={kubeContext}
                                      namespace={namespace}
                                      podName={pod.name}
                                      containerName={container.name}
                                    />
                                    <ContainerShellDialog
                                      kubeContext={kubeContext}
                                      namespace={namespace}
                                      podName={pod.name}
                                      containerName={container.name}
                                    />
                                    <ContainerLogsDialog
                                      kubeContext={kubeContext}
                                      namespace={namespace}
                                      podName={pod.name}
                                      containerName={container.name}
                                    />
                                  </div>
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}
