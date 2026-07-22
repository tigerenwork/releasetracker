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
import { formatRelativeTime, statusVariant } from '@/components/pods/pod-utils';
import { ContainerCommandDialog } from '@/components/pods/container-command-dialog';

interface PodTableProps {
  pods: PodInfo[];
  /** When provided, container rows get a "run command" action */
  namespace?: string;
  kubeContext?: string;
}

/**
 * Pod status table with expandable per-container details
 */
export function PodTable({ pods, namespace, kubeContext }: PodTableProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggle = (podName: string) => {
    setExpanded((prev) => ({ ...prev, [podName]: !prev[podName] }));
  };

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
        </TableRow>
      </TableHeader>
      <TableBody>
        {pods.map((pod) => {
          const isExpanded = !!expanded[pod.name];
          const containers = pod.containers || [];

          return (
            <Fragment key={pod.name}>
              <TableRow>
                <TableCell className="w-8 pr-0">
                  <button
                    onClick={() => toggle(pod.name)}
                    disabled={containers.length === 0}
                    className="text-slate-400 disabled:opacity-30"
                    title={isExpanded ? 'Hide containers' : 'Show containers'}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>
                </TableCell>
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

              {isExpanded && containers.length > 0 && (
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  <TableCell></TableCell>
                  <TableCell colSpan={7} className="py-2">
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
                                <Badge variant={statusVariant(container.state)}>
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
                                  <ContainerCommandDialog
                                    kubeContext={kubeContext}
                                    namespace={namespace}
                                    podName={pod.name}
                                    containerName={container.name}
                                  />
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
