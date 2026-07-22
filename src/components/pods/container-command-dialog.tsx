'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Loader2, Play, Square, Terminal } from 'lucide-react';
import { agentBridge, type ExecutionResult } from '@/lib/services/agent-bridge';

interface ContainerCommandDialogProps {
  kubeContext?: string;
  namespace: string;
  podName: string;
  containerName: string;
}

// Client-side cap per stream to keep the DOM manageable
const CLIENT_OUTPUT_CAP = 200000;

function appendCapped(prev: string, data: string): string {
  const next = prev + data;
  return next.length > CLIENT_OUTPUT_CAP ? next.slice(next.length - CLIENT_OUTPUT_CAP) : next;
}

/**
 * One-shot command execution in a specific pod container (kubectl exec)
 * with live streaming output
 */
export function ContainerCommandDialog({
  kubeContext,
  namespace,
  podName,
  containerName,
}: ContainerCommandDialogProps) {
  const [open, setOpen] = useState(false);
  const [command, setCommand] = useState('');
  const [interpreter, setInterpreter] = useState<'sh' | 'bash'>('sh');
  const [isRunning, setIsRunning] = useState(false);
  const [stdout, setStdout] = useState('');
  const [stderr, setStderr] = useState('');
  const [result, setResult] = useState<ExecutionResult | null>(null);

  const cancelRef = useRef<(() => void) | null>(null);
  const stdoutRef = useRef<HTMLPreElement>(null);
  const stderrRef = useRef<HTMLPreElement>(null);

  // Auto-scroll output to bottom as chunks arrive
  useEffect(() => {
    if (stdoutRef.current) stdoutRef.current.scrollTop = stdoutRef.current.scrollHeight;
  }, [stdout]);
  useEffect(() => {
    if (stderrRef.current) stderrRef.current.scrollTop = stderrRef.current.scrollHeight;
  }, [stderr]);

  const run = async () => {
    if (!agentBridge || !command.trim() || isRunning) return;

    setIsRunning(true);
    setStdout('');
    setStderr('');
    setResult(null);

    try {
      const stream = agentBridge.executeScriptStream(
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
        { interpreter, content: command },
        (chunk) => {
          if (chunk.type === 'stdout') {
            setStdout((prev) => appendCapped(prev, chunk.data));
          } else if (chunk.type === 'stderr') {
            setStderr((prev) => appendCapped(prev, chunk.data));
          }
        },
        300
      );

      cancelRef.current = stream.cancel;
      const finalResult = await stream.promise;
      setResult(finalResult);
    } catch (err) {
      setResult({
        success: false,
        executionId: '',
        type: 'script',
        duration: 0,
        timestamp: new Date().toISOString(),
        error: {
          code: 'BRIDGE_ERROR',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
      });
    } finally {
      setIsRunning(false);
      cancelRef.current = null;
    }
  };

  const stop = () => {
    cancelRef.current?.();
  };

  const handleOpenChange = (nextOpen: boolean) => {
    // Closing mid-run cancels the execution (kills the kubectl child)
    if (!nextOpen && isRunning) {
      cancelRef.current?.();
    }
    setOpen(nextOpen);
  };

  const hasOutput = stdout.length > 0 || stderr.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" title="Run command in container">
          <Terminal className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl w-[90vw]">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm break-all">
            {podName} <span className="text-slate-400">/</span> {containerName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 min-w-0">
          <div className="flex gap-2">
            <select
              value={interpreter}
              onChange={(e) => setInterpreter(e.target.value as 'sh' | 'bash')}
              className="rounded-md border bg-background px-2 text-sm"
              disabled={isRunning}
            >
              <option value="sh">sh</option>
              <option value="bash">bash</option>
            </select>
            <Input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="ls -la /app"
              className="font-mono text-sm"
              disabled={isRunning}
              onKeyDown={(e) => {
                if (e.key === 'Enter') run();
              }}
            />
            {isRunning ? (
              <Button variant="outline" onClick={stop}>
                <Square className="h-4 w-4" />
                <span className="ml-1">Stop</span>
              </Button>
            ) : (
              <Button onClick={run} disabled={!command.trim()}>
                <Play className="h-4 w-4" />
                <span className="ml-1">Run</span>
              </Button>
            )}
          </div>

          {(isRunning || result || hasOutput) && (
            <div className="space-y-2 min-w-0">
              <div className="flex items-center gap-3 text-xs">
                {isRunning ? (
                  <span className="flex items-center gap-1.5 text-slate-500">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Running…
                  </span>
                ) : result ? (
                  <span className={result.success ? 'text-green-600' : 'text-red-600'}>
                    {result.success ? 'Success' : 'Failed'}
                    {result.script && ` (exit ${result.script.exitCode})`}
                  </span>
                ) : null}
                {result && <span className="text-slate-400">{result.duration}ms</span>}
              </div>

              {(stdout.length > 0 || isRunning) && (
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-500 mb-1">stdout</p>
                  <pre
                    ref={stdoutRef}
                    className="max-h-[45vh] overflow-auto whitespace-pre-wrap break-all rounded-md bg-slate-950 p-3 text-xs text-slate-50"
                  >
                    {stdout}
                  </pre>
                  {result?.script?.stdoutTruncated && (
                    <p className="text-xs text-amber-600 mt-1">
                      Output truncated to 50,000 characters
                    </p>
                  )}
                </div>
              )}

              {stderr.length > 0 && (
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-500 mb-1">stderr</p>
                  <pre
                    ref={stderrRef}
                    className="max-h-[30vh] overflow-auto whitespace-pre-wrap break-all rounded-md bg-amber-50 p-3 text-xs text-amber-800"
                  >
                    {stderr}
                  </pre>
                  {result?.script?.stderrTruncated && (
                    <p className="text-xs text-amber-600 mt-1">
                      Output truncated to 50,000 characters
                    </p>
                  )}
                </div>
              )}

              {!isRunning && result && !result.script && result.error && (
                <pre className="max-h-[30vh] overflow-auto whitespace-pre-wrap break-all rounded-md bg-red-50 p-3 text-xs text-red-700">
                  {result.error.message}
                </pre>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
