'use client';

import '@xterm/xterm/css/xterm.css';
import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Plug, SquareTerminal } from 'lucide-react';
import { agentBridge, type ShellSession } from '@/lib/services/agent-bridge';

interface ContainerShellDialogProps {
  kubeContext?: string;
  namespace: string;
  podName: string;
  containerName: string;
}

type ConnectionState = 'idle' | 'connected' | 'exited' | 'error';

/**
 * Interactive shell into a specific pod container (kubectl exec -i -t via WebSocket)
 */
export function ContainerShellDialog({
  kubeContext,
  namespace,
  podName,
  containerName,
}: ContainerShellDialogProps) {
  const [open, setOpen] = useState(false);
  const [shell, setShell] = useState<'sh' | 'bash'>('bash');
  const [connState, setConnState] = useState<ConnectionState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const termRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<ShellSession | null>(null);
  const terminalRef = useRef<import('@xterm/xterm').Terminal | null>(null);

  const teardown = useCallback(() => {
    sessionRef.current?.close();
    sessionRef.current = null;
    terminalRef.current?.dispose();
    terminalRef.current = null;
  }, []);

  // Clean up when the dialog closes or the component unmounts
  useEffect(() => {
    if (!open) {
      teardown();
      setConnState('idle');
      setErrorMessage(null);
    }
    return teardown;
  }, [open, teardown]);

  const connect = async () => {
    if (!agentBridge || !termRef.current) return;

    setErrorMessage(null);

    const { Terminal } = await import('@xterm/xterm');
    const { FitAddon } = await import('@xterm/addon-fit');

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: { background: '#020617' },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(termRef.current);
    fitAddon.fit();

    terminalRef.current = term;

    // Re-fit when the container resizes (remote shell size is fixed at spawn)
    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(termRef.current);

    try {
      const session = agentBridge.openShell(
        {
          kubeContext,
          namespace,
          podName,
          containerName,
          shell,
          cols: term.cols,
          rows: term.rows,
        },
        {
          onOutput: (data) => term.write(data),
          onExit: (code) => {
            term.write(`\r\n\x1b[90m[session closed, exit ${code}]\x1b[0m\r\n`);
            setConnState('exited');
            sessionRef.current = null;
          },
          onError: (message) => {
            term.write(`\r\n\x1b[31m[error: ${message}]\x1b[0m\r\n`);
            setConnState('error');
            setErrorMessage(message);
            sessionRef.current = null;
          },
        }
      );

      sessionRef.current = session;
      term.onData((data) => sessionRef.current?.send(data));
      term.focus();
      setConnState('connected');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      term.write(`\x1b[31m[error: ${message}]\x1b[0m\r\n`);
      setConnState('error');
      setErrorMessage(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" title="Open interactive shell">
          <SquareTerminal className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-4xl w-[92vw]">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm break-all flex items-center justify-between pr-6">
            <span>
              {podName} <span className="text-slate-400">/</span> {containerName}
            </span>
            {connState === 'connected' && (
              <span className="text-xs font-normal text-green-600">connected</span>
            )}
            {connState === 'exited' && (
              <span className="text-xs font-normal text-slate-400">session closed</span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 min-w-0">
          {connState === 'idle' && (
            <div className="flex items-center gap-2">
              <select
                value={shell}
                onChange={(e) => setShell(e.target.value as 'sh' | 'bash')}
                className="rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                <option value="bash">bash</option>
                <option value="sh">sh</option>
              </select>
              <Button onClick={connect}>
                <Plug className="h-4 w-4" />
                <span className="ml-1">Connect</span>
              </Button>
            </div>
          )}

          {(connState === 'exited' || connState === 'error') && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => { teardown(); setConnState('idle'); }}>
                Reconnect
              </Button>
              {errorMessage && <span className="text-xs text-red-600">{errorMessage}</span>}
            </div>
          )}

          <div
            ref={termRef}
            className="h-[60vh] w-full rounded-md bg-slate-950 p-1 overflow-hidden"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
