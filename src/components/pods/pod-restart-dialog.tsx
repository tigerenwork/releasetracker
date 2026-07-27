'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { RotateCw, Loader2 } from 'lucide-react';
import { agentBridge, supportsRestart, RESTART_MIN_VERSION } from '@/lib/services/agent-bridge';

interface PodRestartDialogProps {
  kubeContext?: string;
  namespace: string;
  podName: string;
  onRestarted?: () => void;
}

/**
 * Restart (delete) a pod with an explicit confirmation — this affects production.
 * Disabled when the connected agent is older than RESTART_MIN_VERSION.
 */
export function PodRestartDialog({ kubeContext, namespace, podName, onRestarted }: PodRestartDialogProps) {
  // agentBridge only exists in the browser; defer the check until after mount
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [open, setOpen] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!mounted) return null;

  const version = agentBridge?.getStatus().version;
  const supported = !!agentBridge?.isAvailable() && supportsRestart(version);

  const handleRestart = async () => {
    if (!agentBridge) return;
    setIsRestarting(true);
    setError(null);

    try {
      const res = await agentBridge.restartPod({
        customerId: 0,
        namespace,
        podSelector: '',
        podName,
        kubeContext,
        stepId: 0,
        releaseId: 0,
      });

      if (res.success) {
        setOpen(false);
        onRestarted?.();
      } else {
        setError(res.error?.message || 'Restart failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restart failed');
    } finally {
      setIsRestarting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-red-600 hover:text-red-700"
          title={supported ? 'Restart pod (deletes it — the controller recreates it)' : `Restart requires agent >= ${RESTART_MIN_VERSION}`}
          disabled={!supported}
          onClick={(e) => e.stopPropagation()}
        >
          <RotateCw className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Restart pod?</AlertDialogTitle>
          <AlertDialogDescription>
            This deletes <span className="font-mono">{podName}</span> in namespace{' '}
            <span className="font-mono">{namespace}</span>. The workload controller will
            recreate it, but the service may be briefly unavailable — this affects production.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <div className="p-3 bg-red-50 text-red-600 rounded-md text-sm">{error}</div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isRestarting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // Keep the dialog open while the async restart runs
              e.preventDefault();
              handleRestart();
            }}
            disabled={isRestarting}
            className="bg-red-600 hover:bg-red-700"
          >
            {isRestarting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Restart Pod'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
