'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Eraser, Loader2, ScrollText, Download } from 'lucide-react';
import { agentBridge } from '@/lib/services/agent-bridge';

interface ContainerLogsDialogProps {
  kubeContext?: string;
  namespace: string;
  podName: string;
  containerName: string;
}

// Client-side cap to keep the DOM manageable
const CLIENT_LOG_CAP = 200000;

function appendCapped(prev: string, data: string): string {
  const next = prev + data;
  return next.length > CLIENT_LOG_CAP ? next.slice(next.length - CLIENT_LOG_CAP) : next;
}

type StreamState = 'idle' | 'streaming' | 'ended' | 'error';

/**
 * Live container log viewer (kubectl logs -f via the streaming lane)
 */
export function ContainerLogsDialog({
  kubeContext,
  namespace,
  podName,
  containerName,
}: ContainerLogsDialogProps) {
  const [open, setOpen] = useState(false);
  const [tailLines, setTailLines] = useState(200);
  const [logs, setLogs] = useState('');
  const [streamState, setStreamState] = useState<StreamState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);

  const cancelRef = useRef<(() => void) | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  // Auto-scroll to bottom as logs arrive (when follow is enabled)
  useEffect(() => {
    if (follow && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs, follow]);

  const stop = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
  }, []);

  // Save whatever has been streamed so far (capped buffer) as a .log file
  const handleDownload = useCallback(() => {
    if (!logs) return;
    const blob = new Blob([logs], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${podName}-${containerName}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }, [logs, podName, containerName]);

  const start = useCallback(() => {
    if (!agentBridge) return;

    stop();
    setLogs('');
    setErrorMessage(null);
    setStreamState('streaming');

    try {
      const stream = agentBridge.getLogsStream(
        {
          customerId: 0,
          namespace,
          podSelector: '',
          podName,
          containerName,
          kubeContext,
          stepId: 0,
          releaseId: 0,
        },
        { tailLines },
        (chunk) => {
          setLogs((prev) => appendCapped(prev, chunk.data));
        }
      );

      cancelRef.current = stream.cancel;

      stream.promise
        .then((result) => {
          if (result.error?.code !== 'CANCELLED') {
            setStreamState(result.success ? 'ended' : 'error');
            if (result.error) setErrorMessage(result.error.message);
          } else {
            setStreamState('idle');
          }
          cancelRef.current = null;
        })
        .catch((err) => {
          setStreamState('error');
          setErrorMessage(err instanceof Error ? err.message : 'Unknown error');
          cancelRef.current = null;
        });
    } catch (err) {
      setStreamState('error');
      setErrorMessage(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [agentBridge, namespace, podName, containerName, kubeContext, tailLines, stop]);

  // Auto-start when the dialog opens, stop when it closes
  useEffect(() => {
    if (open) {
      start();
    } else {
      stop();
      setStreamState('idle');
    }
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" title="View container logs">
          <ScrollText className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-4xl w-[92vw]">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm break-all flex items-center justify-between pr-6">
            <span>
              {podName} <span className="text-slate-400">/</span> {containerName}
              <span className="text-slate-400 font-normal"> logs</span>
            </span>
            {streamState === 'streaming' && (
              <span className="flex items-center gap-1.5 text-xs font-normal text-green-600">
                <Loader2 className="h-3 w-3 animate-spin" />
                streaming
              </span>
            )}
            {streamState === 'ended' && (
              <span className="text-xs font-normal text-slate-400">stream ended</span>
            )}
            {streamState === 'error' && (
              <span className="text-xs font-normal text-red-600">error</span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 min-w-0">
          <div className="flex items-center gap-3">
            <label className="text-xs text-slate-500 flex items-center gap-1.5">
              Tail
              <select
                value={tailLines}
                onChange={(e) => setTailLines(Number(e.target.value))}
                className="rounded-md border bg-background px-1.5 py-1 text-xs"
                disabled={streamState === 'streaming'}
              >
                <option value={100}>100</option>
                <option value={200}>200</option>
                <option value={500}>500</option>
                <option value={1000}>1000</option>
              </select>
            </label>

            {streamState === 'streaming' ? (
              <Button variant="outline" size="sm" onClick={stop}>
                Stop
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={start}>
                Start
              </Button>
            )}

            <Button variant="ghost" size="sm" onClick={() => setLogs('')} title="Clear">
              <Eraser className="h-4 w-4" />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleDownload}
              disabled={!logs}
              title="Download streamed logs"
            >
              <Download className="h-4 w-4" />
            </Button>

            <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={follow}
                onChange={(e) => setFollow(e.target.checked)}
              />
              Follow
            </label>
          </div>

          {errorMessage && (
            <p className="text-xs text-red-600">{errorMessage}</p>
          )}

          <pre
            ref={logRef}
            className="h-[60vh] w-full overflow-auto whitespace-pre-wrap break-all rounded-md bg-slate-950 p-3 text-xs text-slate-50"
          >
            {logs || (streamState === 'streaming' ? 'Waiting for logs…' : '')}
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  );
}
