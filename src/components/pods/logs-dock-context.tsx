'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface LogStreamTarget {
  kubeContext?: string;
  namespace: string;
  podName: string;
  containerName: string;
}

export type LogStreamStatus = 'idle' | 'streaming' | 'ended' | 'error';

export interface LogPane {
  id: string;
  /** Where the pane's pod picker looks (always set, even for an empty pane) */
  context: { kubeContext?: string; namespace: string };
  /** null = empty pane waiting for the user to pick a pod/container */
  target: LogStreamTarget | null;
  status: LogStreamStatus;
}

/** horizontal = side by side, vertical = stacked, grid = 2×2 */
export type DockLayout = 'horizontal' | 'vertical' | 'grid';

export const MAX_LOG_PANES = 4;

interface DockState {
  panes: LogPane[];
  layout: DockLayout;
  focusedId: string | null;
  minimized: boolean;
  maximized: boolean;
}

interface LogsDockContextValue extends DockState {
  openStream: (target: LogStreamTarget) => void;
  /** Append an empty pane (pod picker), optionally switching layout */
  addPane: (layout?: DockLayout) => void;
  closePane: (id: string) => void;
  closeAll: () => void;
  setFocused: (id: string) => void;
  setLayout: (layout: DockLayout) => void;
  retargetPane: (id: string, target: LogStreamTarget) => void;
  setMinimized: (minimized: boolean) => void;
  toggleMaximized: () => void;
  /** LogStreamView → dock: stream status changed */
  reportStatus: (paneId: string, status: LogStreamStatus) => void;
}

const LogsDockContext = createContext<LogsDockContextValue | null>(null);

const EMPTY_STATE: DockState = {
  panes: [],
  layout: 'horizontal',
  focusedId: null,
  minimized: false,
  maximized: false,
};

export function streamIdOf(target: LogStreamTarget): string {
  return `${target.kubeContext ?? ''}/${target.namespace}/${target.podName}/${target.containerName}`;
}

/**
 * State for the floating multi-pane logs viewer (see docs/TSD-LOGS-DOCK.md).
 * Single DockState object: panes, focus and layout are interdependent and
 * must update atomically inside one functional setState.
 */
export function LogsDockProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DockState>(EMPTY_STATE);
  const paneCounter = useRef(0);

  const openStream = useCallback((target: LogStreamTarget) => {
    const targetId = streamIdOf(target);
    setState((prev) => {
      // Same target already open → focus its pane
      const existing = prev.panes.find(
        (p) => p.target && streamIdOf(p.target) === targetId
      );
      if (existing) {
        return { ...prev, focusedId: existing.id, minimized: false };
      }

      // An empty (picker) pane exists → fill it
      const emptyPane = prev.panes.find((p) => !p.target);
      if (emptyPane) {
        return {
          ...prev,
          panes: prev.panes.map((p) =>
            p.id === emptyPane.id ? { ...p, target, status: 'idle' } : p
          ),
          focusedId: emptyPane.id,
          minimized: false,
        };
      }

      const pane: LogPane = {
        id: `pane-${++paneCounter.current}`,
        context: { kubeContext: target.kubeContext, namespace: target.namespace },
        target,
        status: 'idle',
      };

      if (prev.panes.length === 0) {
        return { ...prev, panes: [pane], focusedId: pane.id, minimized: false };
      }
      if (prev.panes.length < MAX_LOG_PANES) {
        return {
          ...prev,
          panes: [...prev.panes, pane],
          focusedId: pane.id,
          minimized: false,
        };
      }
      // Full: replace the focused pane's stream
      const replaceId = prev.focusedId ?? prev.panes[0].id;
      return {
        ...prev,
        panes: prev.panes.map((p) =>
          p.id === replaceId ? { ...pane, id: p.id } : p
        ),
        focusedId: replaceId,
        minimized: false,
      };
    });
  }, []);

  const addPane = useCallback((layout?: DockLayout) => {
    setState((prev) => {
      if (prev.panes.length >= MAX_LOG_PANES) {
        return layout && prev.layout !== layout ? { ...prev, layout } : prev;
      }
      const source = prev.panes.find((p) => p.target) ?? prev.panes[0];
      if (!source) return prev;
      const pane: LogPane = {
        id: `pane-${++paneCounter.current}`,
        context: { ...source.context },
        target: null,
        status: 'idle',
      };
      return {
        ...prev,
        panes: [...prev.panes, pane],
        ...(layout ? { layout } : {}),
        focusedId: pane.id,
      };
    });
  }, []);

  const closePane = useCallback((id: string) => {
    setState((prev) => {
      const panes = prev.panes.filter((p) => p.id !== id);
      if (panes.length === prev.panes.length) return prev;
      if (panes.length === 0) return { ...EMPTY_STATE, layout: prev.layout };
      return {
        ...prev,
        panes,
        focusedId: prev.focusedId === id ? panes[0].id : prev.focusedId,
      };
    });
  }, []);

  const closeAll = useCallback(
    () => setState((prev) => ({ ...EMPTY_STATE, layout: prev.layout })),
    []
  );

  const setFocused = useCallback((id: string) => {
    setState((prev) => (prev.focusedId === id ? prev : { ...prev, focusedId: id }));
  }, []);

  const setLayout = useCallback((layout: DockLayout) => {
    setState((prev) => (prev.layout === layout ? prev : { ...prev, layout }));
  }, []);

  const retargetPane = useCallback((id: string, target: LogStreamTarget) => {
    setState((prev) => ({
      ...prev,
      panes: prev.panes.map((p) =>
        p.id === id
          ? {
              ...p,
              context: { kubeContext: target.kubeContext, namespace: target.namespace },
              target,
              status: 'idle' as const,
            }
          : p
      ),
    }));
  }, []);

  const setMinimized = useCallback((minimized: boolean) => {
    setState((prev) => (prev.minimized === minimized ? prev : { ...prev, minimized }));
  }, []);

  const toggleMaximized = useCallback(() => {
    setState((prev) => ({ ...prev, maximized: !prev.maximized }));
  }, []);

  const reportStatus = useCallback((paneId: string, status: LogStreamStatus) => {
    setState((prev) => {
      if (!prev.panes.some((p) => p.id === paneId && p.status !== status)) return prev;
      return {
        ...prev,
        panes: prev.panes.map((p) => (p.id === paneId ? { ...p, status } : p)),
      };
    });
  }, []);

  const value = useMemo<LogsDockContextValue>(
    () => ({
      ...state,
      openStream,
      addPane,
      closePane,
      closeAll,
      setFocused,
      setLayout,
      retargetPane,
      setMinimized,
      toggleMaximized,
      reportStatus,
    }),
    [
      state,
      openStream,
      addPane,
      closePane,
      closeAll,
      setFocused,
      setLayout,
      retargetPane,
      setMinimized,
      toggleMaximized,
      reportStatus,
    ]
  );

  return <LogsDockContext.Provider value={value}>{children}</LogsDockContext.Provider>;
}

export function useLogsDock(): LogsDockContextValue {
  const ctx = useContext(LogsDockContext);
  if (!ctx) throw new Error('useLogsDock must be used within LogsDockProvider');
  return ctx;
}
