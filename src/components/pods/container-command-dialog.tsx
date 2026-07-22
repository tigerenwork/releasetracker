'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Loader2, Play, Terminal } from 'lucide-react';
import { agentBridge, type ExecutionResult } from '@/lib/services/agent-bridge';

interface ContainerCommandDialogProps {
  kubeContext?: string;
  namespace: string;
  podName: string;
  containerName: string;
}

/**
 * One-shot command execution in a specific pod container (kubectl exec)
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
  const [result, setResult] = useState<ExecutionResult | null>(null);

  const run = async () => {
    if (!agentBridge || !command.trim()) return;

    setIsRunning(true);
    setResult(null);

    try {
      const executionResult = await agentBridge.executeScript(
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
        60
      );
      setResult(executionResult);
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
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
            <Button onClick={run} disabled={isRunning || !command.trim()}>
              {isRunning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              <span className="ml-1">Run</span>
            </Button>
          </div>

          {result && (
            <div className="space-y-2 min-w-0">
              <div className="flex items-center gap-3 text-xs">
                <span className={result.success ? 'text-green-600' : 'text-red-600'}>
                  {result.success ? 'Success' : 'Failed'}
                  {result.script && ` (exit ${result.script.exitCode})`}
                </span>
                <span className="text-slate-400">{result.duration}ms</span>
              </div>

              {result.script?.stdout && (
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-500 mb-1">stdout</p>
                  <pre className="max-h-[45vh] overflow-auto whitespace-pre-wrap break-all rounded-md bg-slate-950 p-3 text-xs text-slate-50">
                    {result.script.stdout}
                  </pre>
                  {result.script.stdoutTruncated && (
                    <p className="text-xs text-amber-600 mt-1">
                      Output truncated to 50,000 characters
                    </p>
                  )}
                </div>
              )}

              {result.script?.stderr && (
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-500 mb-1">stderr</p>
                  <pre className="max-h-[30vh] overflow-auto whitespace-pre-wrap break-all rounded-md bg-amber-50 p-3 text-xs text-amber-800">
                    {result.script.stderr}
                  </pre>
                  {result.script.stderrTruncated && (
                    <p className="text-xs text-amber-600 mt-1">
                      Output truncated to 50,000 characters
                    </p>
                  )}
                </div>
              )}

              {!result.script && result.error && (
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
