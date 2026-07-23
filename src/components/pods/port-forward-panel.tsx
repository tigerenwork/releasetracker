'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Cable, ExternalLink, Loader2, Plug, Unplug } from 'lucide-react';
import {
  agentBridge,
  supportsPortForward,
  type AgentStatus,
  type PortForwardInfo,
} from '@/lib/services/agent-bridge';

interface PortForwardPanelProps {
  clusterName: string;
  /** compact: just the trigger button (for card headers); default: full list */
  compact?: boolean;
}

const DEFAULTS = {
  namespace: 'cronicle',
  resource: 'service/cronicle',
  localPort: '3012',
  remotePort: '3012',
};

/**
 * On-demand kubectl port-forward proxies for a cluster.
 * Start/stop processes on the local agent via the browser extension.
 */
export function PortForwardPanel({ clusterName, compact = false }: PortForwardPanelProps) {
  const [mounted, setMounted] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({ connected: false });
  const [forwards, setForwards] = useState<PortForwardInfo[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(DEFAULTS);
  const [isConnecting, setIsConnecting] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // agentBridge only exists in the browser; defer until after mount so
  // server-rendered HTML matches the first client render
  useEffect(() => {
    setMounted(true);
    if (!agentBridge) return;
    return agentBridge.onStatusChange(setAgentStatus);
  }, []);

  const refresh = useCallback(async () => {
    if (!agentBridge?.isAvailable()) return;
    try {
      const all = await agentBridge.listPortForwards();
      setForwards(all.filter((f) => f.kubeContext === clusterName));
    } catch {
      // Agent unreachable or too old — leave the list as-is
    }
  }, [clusterName]);

  // Initial load + light polling while mounted
  useEffect(() => {
    if (!mounted || !agentStatus.connected) return;
    refresh();
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [mounted, agentStatus.connected, refresh]);

  const connect = async () => {
    if (!agentBridge || isConnecting) return;
    setIsConnecting(true);
    setActionError(null);
    try {
      await agentBridge.startPortForward({
        kubeContext: clusterName,
        namespace: form.namespace.trim(),
        resource: form.resource.trim(),
        localPort: parseInt(form.localPort, 10),
        remotePort: parseInt(form.remotePort, 10),
      });
      // Keep the dialog open so the new proxy (and its status) is visible
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to start proxy');
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = async (id: string) => {
    if (!agentBridge || stoppingId) return;
    setStoppingId(id);
    setActionError(null);
    try {
      await agentBridge.stopPortForward(id);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to stop proxy');
    } finally {
      setStoppingId(null);
    }
  };

  if (!mounted) return null;

  const available = !!agentBridge?.isAvailable();
  // The extension itself must also be new enough to relay port-forward calls
  // (an older extension lacks window.rtAgent.portForward until reloaded)
  const extensionSupported =
    typeof window !== 'undefined' && typeof window.rtAgent?.portForward === 'function';
  const supported =
    agentStatus.connected && extensionSupported && supportsPortForward(agentStatus.version);

  if (!available) return null;

  const forwardList = forwards.length > 0 && (
    <div className="divide-y rounded-md border">
      {forwards.map((f) => (
        <div key={f.id} className="flex items-center gap-3 px-3 py-2">
          <Cable className="h-4 w-4 text-slate-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">
              {f.namespace}/{f.resource}
            </div>
            <div className="text-xs text-slate-400 font-mono">
              localhost:{f.localPort} → :{f.remotePort}
            </div>
          </div>
          {f.status === 'starting' && (
            <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100">
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
              Starting
            </Badge>
          )}
          {f.status === 'ready' && (
            <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Ready</Badge>
          )}
          {f.status === 'failed' && (
            <Badge className="bg-red-100 text-red-700 hover:bg-red-100" title={f.error}>
              Failed
            </Badge>
          )}
          {f.status === 'ready' && (
            <a
              href={`http://localhost:${f.localPort}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800"
              title={`Open http://localhost:${f.localPort}`}
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => disconnect(f.id)}
            disabled={stoppingId === f.id}
            title="Disconnect"
          >
            {stoppingId === f.id ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Unplug className="h-4 w-4" />
            )}
          </Button>
        </div>
      ))}
    </div>
  );

  const connectDialog = (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Proxies for {clusterName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {forwardList}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="pf-namespace">Namespace</Label>
              <Input
                id="pf-namespace"
                value={form.namespace}
                onChange={(e) => setForm({ ...form, namespace: e.target.value })}
                placeholder="cronicle"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pf-resource">Resource</Label>
              <Input
                id="pf-resource"
                value={form.resource}
                onChange={(e) => setForm({ ...form, resource: e.target.value })}
                placeholder="service/cronicle"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pf-local-port">Local Port</Label>
              <Input
                id="pf-local-port"
                type="number"
                value={form.localPort}
                onChange={(e) => setForm({ ...form, localPort: e.target.value })}
                placeholder="3012"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pf-remote-port">Remote Port</Label>
              <Input
                id="pf-remote-port"
                type="number"
                value={form.remotePort}
                onChange={(e) => setForm({ ...form, remotePort: e.target.value })}
                placeholder="3012"
              />
            </div>
          </div>
          {actionError && <p className="text-sm text-red-600">{actionError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isConnecting}>
              Close
            </Button>
            <Button
              onClick={connect}
              disabled={
                isConnecting ||
                !form.namespace.trim() ||
                !form.resource.trim() ||
                !form.localPort ||
                !form.remotePort
              }
            >
              {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
              <span className="ml-2">Connect</span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );

  if (!supported) {
    if (compact) return null;
    return (
      <p className="text-sm text-amber-700 bg-amber-50 rounded-md p-3">
        {!agentStatus.connected
          ? 'Start the local agent to manage service proxies.'
          : !extensionSupported
            ? 'Reload the browser extension (chrome://extensions) and refresh this page to use service proxies.'
            : 'Update the local agent to v1.2.0 or newer to use service proxies.'}
      </p>
    );
  }

  const hasActive = forwards.length > 0;

  // Trigger button doubles as the connection indicator: green when proxies
  // are active for this cluster, plain "Connect" otherwise
  const triggerButton = hasActive ? (
    <Button variant="outline" size="sm" onClick={() => { setActionError(null); setDialogOpen(true); }}>
      <span className="w-2 h-2 rounded-full bg-green-500"></span>
      <span className="ml-2">
        {forwards.length === 1 ? `localhost:${forwards[0].localPort}` : `${forwards.length} proxies`}
      </span>
    </Button>
  ) : (
    <Button variant="outline" size="sm" onClick={() => { setActionError(null); setDialogOpen(true); }}>
      <Plug className="h-4 w-4" />
      <span className="ml-2">Connect</span>
    </Button>
  );

  if (compact) {
    return (
      <>
        {triggerButton}
        {connectDialog}
      </>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-500">
          {hasActive ? `${forwards.length} active` : 'No active proxies'}
        </span>
        {triggerButton}
      </div>

      {actionError && !dialogOpen && <p className="text-sm text-red-600">{actionError}</p>}

      {forwardList}

      {connectDialog}
    </div>
  );
}
