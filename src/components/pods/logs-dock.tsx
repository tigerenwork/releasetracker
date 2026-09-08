'use client';

import { useState, useRef, useEffect, useCallback, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  ChevronsDown,
  ChevronsUp,
  Columns2,
  Download,
  Eraser,
  LayoutGrid,
  Loader2,
  Minus,
  Plus,
  Rows2,
  ScrollText,
  X,
} from 'lucide-react';
import { agentBridge, type PodInfo } from '@/lib/services/agent-bridge';
import {
  MAX_LOG_PANES,
  streamIdOf,
  useLogsDock,
  type DockLayout,
  type LogPane,
  type LogStreamStatus,
  type LogStreamTarget,
} from '@/components/pods/logs-dock-context';

// Client-side cap to keep the DOM manageable
const CLIENT_LOG_CAP = 200000;

const MIN_PANEL_W = 480;
const MIN_PANEL_H = 300;

function appendCapped(prev: string, data: string): string {
  const next = prev + data;
  return next.length > CLIENT_LOG_CAP ? next.slice(next.length - CLIENT_LOG_CAP) : next;
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

interface PanelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Log button on container rows — opens the container's stream in the floating
 * logs panel (first click opens the panel, further clicks add panes).
 */
export function ContainerLogsButton(target: LogStreamTarget) {
  const { openStream } = useLogsDock();
  return (
    <Button
      variant="ghost"
      size="sm"
      title="View container logs"
      onClick={() => openStream(target)}
    >
      <ScrollText className="h-4 w-4" />
    </Button>
  );
}

function StatusDot({ status }: { status: LogStreamStatus }) {
  const color =
    status === 'streaming'
      ? 'bg-green-500'
      : status === 'error'
        ? 'bg-red-500'
        : 'bg-slate-300';
  return <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} />;
}

/**
 * Floating, non-modal logs panel. Draggable by its header, resizable from the
 * bottom-right grip, up to 4 panes in side-by-side / stacked / 2×2 layouts.
 */
export function LogsDock() {
  const {
    panes,
    layout,
    focusedId,
    minimized,
    maximized,
    addPane,
    setLayout,
    closeAll,
    setMinimized,
    toggleMaximized,
  } = useLogsDock();

  const panelRef = useRef<HTMLDivElement>(null);
  // null = default anchor (bottom-right); set once the user drags/resizes
  const [rect, setRect] = useState<PanelRect | null>(null);

  const startDrag = useCallback(
    (e: ReactMouseEvent) => {
      if (maximized) return;
      if ((e.target as HTMLElement).closest('button,select,input,a')) return;
      const el = panelRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const start = { mx: e.clientX, my: e.clientY, ...{ x: r.left, y: r.top, w: r.width, h: r.height } };
      const onMove = (ev: MouseEvent) => {
        setRect({
          x: clamp(start.x + ev.clientX - start.mx, 0, window.innerWidth - 120),
          y: clamp(start.y + ev.clientY - start.my, 0, window.innerHeight - 60),
          w: start.w,
          h: start.h,
        });
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      e.preventDefault();
    },
    [maximized]
  );

  const startResize = useCallback(
    (e: ReactMouseEvent) => {
      if (maximized) return;
      const el = panelRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const start = { mx: e.clientX, my: e.clientY, x: r.left, y: r.top, w: r.width, h: r.height };
      const onMove = (ev: MouseEvent) => {
        setRect({
          x: start.x,
          y: start.y,
          w: clamp(start.w + ev.clientX - start.mx, MIN_PANEL_W, window.innerWidth - start.x - 8),
          h: clamp(start.h + ev.clientY - start.my, MIN_PANEL_H, window.innerHeight - start.y - 8),
        });
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      e.preventDefault();
    },
    [maximized]
  );

  if (panes.length === 0) return null;

  if (minimized) {
    return (
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg border bg-white px-3 py-1.5 shadow-lg">
        {panes.map((p) => (
          <span key={p.id} className="flex items-center gap-1.5 text-xs text-slate-600">
            <StatusDot status={p.status} />
            <span className="max-w-40 truncate font-mono">
              {p.target ? `${p.target.podName} / ${p.target.containerName}` : '(empty pane)'}
            </span>
          </span>
        ))}
        <Button variant="ghost" size="sm" onClick={() => setMinimized(false)} title="Expand">
          <ChevronsUp className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={closeAll} title="Close all streams">
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  const n = panes.length;
  const split = n > 1;

  const gridStyle: CSSProperties | undefined = !split
    ? undefined
    : layout === 'horizontal'
      ? { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }
      : layout === 'vertical'
        ? { gridTemplateRows: `repeat(${n}, minmax(0, 1fr))` }
        : { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' };

  const style: CSSProperties = maximized
    ? { left: 16, top: 16, right: 16, bottom: 16 }
    : rect
      ? { left: rect.x, top: rect.y, width: rect.w, height: rect.h }
      : {
          right: 16,
          bottom: 16,
          width: split && layout === 'horizontal' ? 'min(1500px, 94vw)' : 'min(960px, 92vw)',
          height: '50vh',
        };

  const layoutButtons: { mode: DockLayout; title: string; icon: typeof Columns2 }[] = [
    { mode: 'horizontal', title: 'Side by side', icon: Columns2 },
    { mode: 'vertical', title: 'Stacked', icon: Rows2 },
    { mode: 'grid', title: '2×2 grid', icon: LayoutGrid },
  ];

  return (
    <div
      ref={panelRef}
      style={style}
      className="fixed z-50 flex flex-col overflow-hidden rounded-lg border bg-white shadow-2xl"
    >
      {/* Panel header — drag handle */}
      <div
        className={`flex items-center gap-1 border-b px-2 py-1 ${maximized ? '' : 'cursor-move select-none'}`}
        onMouseDown={startDrag}
      >
        <span className="px-1 text-xs font-semibold text-slate-700">Logs</span>
        <div className="ml-auto flex items-center">
          {layoutButtons.map(({ mode, title, icon: Icon }) => (
            <Button
              key={mode}
              variant="ghost"
              size="sm"
              onClick={() => (split ? setLayout(mode) : addPane(mode))}
              title={split ? title : `${title} (add a pane to compare)`}
            >
              <Icon className={`h-4 w-4 ${split && layout === mode ? 'text-blue-600' : ''}`} />
            </Button>
          ))}
          {split && n < MAX_LOG_PANES && (
            <Button variant="ghost" size="sm" onClick={() => addPane()} title="Add pane">
              <Plus className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleMaximized}
            title={maximized ? 'Restore size' : 'Maximize'}
          >
            {maximized ? (
              <ChevronsDown className="h-4 w-4" />
            ) : (
              <ChevronsUp className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMinimized(true)}
            title="Minimize (streams keep running)"
          >
            <Minus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={closeAll} title="Close all streams">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Panes */}
      <div
        className={`grid min-h-0 flex-1 ${
          split ? (layout === 'vertical' ? 'divide-y' : 'divide-x') : ''
        }`}
        style={gridStyle}
      >
        {panes.map((pane) => (
          <div
            key={pane.id}
            className={`min-h-0 min-w-0 ${
              split && focusedId === pane.id ? 'ring-2 ring-inset ring-blue-200' : ''
            }`}
          >
            <LogPaneView pane={pane} showClose={split} />
          </div>
        ))}
      </div>

      {/* Resize grip */}
      {!maximized && (
        <div
          className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 cursor-nwse-resize rounded-br-md border-b-2 border-r-2 border-slate-300 hover:border-slate-500"
          onMouseDown={startResize}
          title="Drag to resize"
        />
      )}
    </div>
  );
}

function LogPaneView({ pane, showClose }: { pane: LogPane; showClose: boolean }) {
  const { closePane, retargetPane, setFocused } = useLogsDock();
  const [pods, setPods] = useState<PodInfo[] | null>(null);

  const { kubeContext, namespace } = pane.context;

  // Load the namespace's pods for the picker
  useEffect(() => {
    if (!agentBridge) return;
    let live = true;
    agentBridge
      .getPods({
        customerId: 0,
        namespace,
        podSelector: '',
        kubeContext,
        stepId: 0,
        releaseId: 0,
      })
      .then((result) => {
        if (live && result.success && result.pods) setPods(result.pods.items);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [namespace, kubeContext]);

  const handlePickPod = (podName: string) => {
    const pod = pods?.find((p) => p.name === podName);
    const containerName = pod?.containers[0]?.name;
    if (!podName || !containerName) return;
    retargetPane(pane.id, { kubeContext, namespace, podName, containerName });
  };

  const handlePickContainer = (containerName: string) => {
    if (!pane.target || !containerName) return;
    retargetPane(pane.id, { ...pane.target, containerName });
  };

  const selectClass =
    'max-w-56 truncate rounded-md border bg-background px-1.5 py-1 text-xs font-mono';

  return (
    <div className="flex h-full flex-col" onClick={() => setFocused(pane.id)}>
      {/* Pane header: pod/container picker + status + close */}
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-1.5">
        <StatusDot status={pane.status} />
        <select
          className={selectClass}
          value={pane.target?.podName ?? ''}
          onChange={(e) => handlePickPod(e.target.value)}
          title="Pick a pod"
        >
          <option value="">{pods ? 'Select pod…' : 'Loading pods…'}</option>
          {pods?.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        {pane.target && (
          <select
            className={selectClass}
            value={pane.target.containerName}
            onChange={(e) => handlePickContainer(e.target.value)}
            title="Pick a container"
          >
            {(pods?.find((p) => p.name === pane.target?.podName)?.containers ?? [
              { name: pane.target.containerName },
            ]).map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        {pane.status === 'streaming' && (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <Loader2 className="h-3 w-3 animate-spin" />
          </span>
        )}
        {showClose && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => closePane(pane.id)}
            title="Close pane"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {pane.target ? (
        <LogStreamView
          key={streamIdOf(pane.target)}
          paneId={pane.id}
          target={pane.target}
        />
      ) : (
        <p className="flex flex-1 items-center justify-center px-6 text-center text-xs text-slate-400">
          Pick a pod above to start streaming, or click a container&apos;s log icon in
          the table.
        </p>
      )}
    </div>
  );
}

interface LogStreamViewProps {
  paneId: string;
  target: LogStreamTarget;
}

/**
 * One live container log stream (kubectl logs -f via the extension bridge).
 * Remounts (via key) when the pane's target changes, which cancels the old
 * stream and starts the new one.
 */
function LogStreamView({ paneId, target }: LogStreamViewProps) {
  const { reportStatus } = useLogsDock();
  const { kubeContext, namespace, podName, containerName } = target;

  const [tailLines, setTailLines] = useState(200);
  const [logs, setLogs] = useState('');
  const [streamState, setStreamState] = useState<LogStreamStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);

  const cancelRef = useRef<(() => void) | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  // Report status up to the dock (drives the pane status dot)
  useEffect(() => {
    reportStatus(paneId, streamState);
  }, [reportStatus, paneId, streamState]);

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
  }, [namespace, podName, containerName, kubeContext, tailLines, stop]);

  // Auto-start on mount, stop on unmount (pane closed or retargeted)
  useEffect(() => {
    start();
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 px-3 py-1.5">
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

        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
          />
          Follow
        </label>

        <span className="ml-auto text-xs">
          {streamState === 'ended' && <span className="text-slate-400">stream ended</span>}
          {streamState === 'error' && <span className="text-red-600">error</span>}
        </span>
      </div>

      {errorMessage && <p className="px-3 pb-1 text-xs text-red-600">{errorMessage}</p>}

      <pre
        ref={logRef}
        className="mx-3 mb-3 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all rounded-md bg-slate-950 p-3 text-xs text-slate-50"
      >
        {logs || (streamState === 'streaming' ? 'Waiting for logs…' : '')}
      </pre>
    </div>
  );
}
