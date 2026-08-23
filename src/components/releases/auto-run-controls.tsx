'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Play,
  Square,
  Circle,
  Loader2,
  CheckCircle,
  XCircle,
  PauseCircle,
  MinusCircle,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { getCustomerRunPlan } from '@/lib/actions/customer-steps';
import {
  runCustomerPool,
  type CustomerRunResult,
  type PauseReason,
  type RunControl,
  type RunHooks,
  type RunPlan,
} from '@/lib/services/auto-runner';

interface AutoRunCustomer {
  id: number;
  name: string;
  namespace?: string | null;
  clusterName?: string | null;
}

interface AutoRunControlsProps {
  releaseId: number;
  customers: AutoRunCustomer[];
}

type PanelStatus = 'queued' | 'running' | 'done' | 'failed' | 'paused' | 'cancelled';

interface CustomerRunState {
  status: PanelStatus;
  currentStepName?: string;
  executed: number;
  total: number;
  pauseReason?: PauseReason;
  error?: string;
}

const CONCURRENCY_KEY = 'rt-auto-run-concurrency';

// Window event the matrix customer headers dispatch to trigger a single-customer
// run (the matrix and this card are independent component trees on the page)
export const RUN_CUSTOMER_EVENT = 'rt-auto-run-customer';

// Mirrors the runner's isRunnable policy (done/skipped are left alone)
const RUNNABLE_STATUSES = new Set(['pending', 'failed', 'running', 'reverted']);

function runnableCount(plan: RunPlan) {
  return plan.steps.filter((s) => RUNNABLE_STATUSES.has(s.status ?? '')).length;
}

const panelStatusIcons: Record<PanelStatus, React.ReactNode> = {
  queued: <Circle className="w-4 h-4 text-slate-300" />,
  running: <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />,
  done: <CheckCircle className="w-4 h-4 text-green-500" />,
  failed: <XCircle className="w-4 h-4 text-red-500" />,
  paused: <PauseCircle className="w-4 h-4 text-amber-500" />,
  cancelled: <MinusCircle className="w-4 h-4 text-slate-400" />,
};

export function AutoRunControls({ releaseId, customers }: AutoRunControlsProps) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [concurrency, setConcurrency] = useState(2);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [statuses, setStatuses] = useState<Record<number, CustomerRunState>>({});
  const controlRef = useRef<RunControl>({ cancelled: false });
  const lastRefreshRef = useRef(0);

  // Restore the last-used concurrency after mount (localStorage is client-only)
  useEffect(() => {
    const saved = Number(localStorage.getItem(CONCURRENCY_KEY));
    if (Number.isFinite(saved) && saved >= 1) setConcurrency(Math.min(saved, 10));
  }, []);

  // Default selection = all enrolled customers, re-applied each time the dialog opens
  useEffect(() => {
    if (dialogOpen) setSelected(new Set(customers.map((c) => c.id)));
  }, [dialogOpen, customers]);

  // The runner mutates steps itself; soft-refresh the matrix as steps settle,
  // throttled so a fast run doesn't hammer the server
  const throttledRefresh = () => {
    const now = Date.now();
    if (now - lastRefreshRef.current > 500) {
      lastRefreshRef.current = now;
      router.refresh();
    }
  };

  const patchState = (customerId: number, patch: Partial<CustomerRunState>) => {
    setStatuses((prev) => {
      const cur: CustomerRunState = prev[customerId] ?? { status: 'queued', executed: 0, total: 0 };
      return { ...prev, [customerId]: { ...cur, ...patch } };
    });
  };

  const makeHooks = (): RunHooks => ({
    onStepStart: (customerId, step) => {
      patchState(customerId, { status: 'running', currentStepName: step.name });
      throttledRefresh();
    },
    onStepDone: (customerId) => {
      setStatuses((prev) => {
        const cur = prev[customerId];
        if (!cur) return prev;
        return { ...prev, [customerId]: { ...cur, executed: cur.executed + 1 } };
      });
      throttledRefresh();
    },
    onStepFailed: () => throttledRefresh(),
    onPause: () => throttledRefresh(),
    onCustomerFinished: (result: CustomerRunResult) => {
      patchState(result.customerId, {
        status: result.status,
        executed: result.executed,
        currentStepName: undefined,
        pauseReason: result.pauseReason,
        error: result.error,
      });
      router.refresh();
    },
  });

  const startRun = async (customerIds: number[]) => {
    if (running || customerIds.length === 0) return;
    const control: RunControl = { cancelled: false };
    controlRef.current = control;
    setRunning(true);
    localStorage.setItem(CONCURRENCY_KEY, String(concurrency));

    const plans: RunPlan[] = [];
    for (const id of customerIds) {
      try {
        const plan = await getCustomerRunPlan(releaseId, id);
        plans.push(plan);
        patchState(id, { status: 'queued', executed: 0, total: runnableCount(plan), error: undefined, pauseReason: undefined });
      } catch (err) {
        patchState(id, {
          status: 'failed',
          executed: 0,
          total: 0,
          error: err instanceof Error ? err.message : 'Failed to load run plan',
        });
      }
    }

    try {
      await runCustomerPool(plans, { concurrency, hooks: makeHooks(), control });
    } finally {
      setRunning(false);
      router.refresh();
    }
  };

  // Resume a paused customer (or retry a failed one): re-fetch the plan so
  // newly saved targets / freshly completed manual steps are picked up, then
  // run it on its own, outside the pool.
  const rerunCustomer = async (customerId: number) => {
    if (statuses[customerId]?.status === 'running' || statuses[customerId]?.status === 'queued') return;
    // Reuse the pool's cancel flag while a pool run is active; otherwise start fresh
    if (!running) controlRef.current = { cancelled: false };
    try {
      const plan = await getCustomerRunPlan(releaseId, customerId);
      patchState(customerId, { status: 'queued', executed: 0, total: runnableCount(plan), error: undefined, pauseReason: undefined });
      await runCustomerPool([plan], { concurrency: 1, hooks: makeHooks(), control: controlRef.current });
    } catch (err) {
      patchState(customerId, {
        status: 'failed',
        error: err instanceof Error ? err.message : 'Run failed',
      });
    } finally {
      router.refresh();
    }
  };

  const toggleSelected = (id: number, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  // Single-customer run (matrix header button or the dialog's per-row play):
  // joins the active pool run alongside it, or starts a fresh run otherwise
  const startCustomerRun = (customerId: number) => {
    const st = statuses[customerId]?.status;
    if (st === 'running' || st === 'queued') return;
    if (running) {
      rerunCustomer(customerId);
    } else {
      startRun([customerId]);
    }
  };

  // Listen for per-customer run requests from the matrix column headers.
  // handlerRef always points at the latest closure, so the listener itself
  // is registered only once.
  const runRequestHandlerRef = useRef<(customerId: number) => void>(() => {});
  useEffect(() => {
    runRequestHandlerRef.current = startCustomerRun;
  });
  useEffect(() => {
    const listener = (e: Event) => {
      const customerId = (e as CustomEvent<{ customerId: number }>).detail?.customerId;
      if (typeof customerId === 'number') runRequestHandlerRef.current(customerId);
    };
    window.addEventListener(RUN_CUSTOMER_EVENT, listener);
    return () => window.removeEventListener(RUN_CUSTOMER_EVENT, listener);
  }, []);

  const customersWithStatus = customers.filter((c) => statuses[c.id]);
  const hasStatuses = customersWithStatus.length > 0;

  if (customers.length === 0) return null;

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" disabled={running}>
                  <Play className="w-4 h-4 mr-2" />
                  Run all
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Auto-run release steps</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 mt-2">
                  <div className="flex items-center gap-3">
                    <label htmlFor="auto-run-concurrency" className="text-sm font-medium flex-1">
                      Customers in parallel
                    </label>
                    <input
                      id="auto-run-concurrency"
                      type="number"
                      min={1}
                      max={10}
                      value={concurrency}
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        if (Number.isFinite(v)) setConcurrency(Math.max(1, Math.min(10, v)));
                      }}
                      className="w-20 p-2 border rounded"
                    />
                  </div>
                  <div className="space-y-2 max-h-72 overflow-auto">
                    {customers.map((c) => (
                      <div key={c.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`auto-run-customer-${c.id}`}
                          checked={selected.has(c.id)}
                          onCheckedChange={(checked) => toggleSelected(c.id, checked === true)}
                        />
                        <label htmlFor={`auto-run-customer-${c.id}`} className="flex-1 text-sm cursor-pointer">
                          {c.name}
                          {(c.namespace || c.clusterName) && (
                            <span className="text-slate-400 ml-1">
                              {[c.clusterName, c.namespace].filter(Boolean).join(' / ')}
                            </span>
                          )}
                        </label>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Run only this customer"
                          onClick={() => {
                            setDialogOpen(false);
                            startCustomerRun(c.id);
                          }}
                        >
                          <Play className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      disabled={selected.size === 0}
                      onClick={() => {
                        setDialogOpen(false);
                        startRun(customers.filter((c) => selected.has(c.id)).map((c) => c.id));
                      }}
                    >
                      <Play className="w-4 h-4 mr-1" />
                      Run selected ({selected.size})
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            {running && (
              <Button size="sm" variant="outline" onClick={() => { controlRef.current.cancelled = true; }}>
                <Square className="w-4 h-4 mr-2" />
                Cancel run
              </Button>
            )}
            {running && (
              <span className="text-sm text-slate-500 flex items-center gap-1.5">
                <Loader2 className="w-4 h-4 animate-spin" />
                Running…
              </span>
            )}
          </div>
          {hasStatuses && !running && (
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Dismiss" onClick={() => setStatuses({})}>
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>

        <p className="text-sm text-slate-500 mt-2">
          Auto-run executes each customer&apos;s steps (deploy, then verify) via the browser agent. Text steps and
          steps without a target pause that customer — handle them, then resume.
        </p>

        {hasStatuses && (
          <div className="mt-4 border-t pt-3 space-y-2">
            {customersWithStatus.map((c) => {
              const st = statuses[c.id];
              return (
                <div key={c.id} className="flex items-center gap-2 text-sm">
                  {panelStatusIcons[st.status]}
                  <span className="font-medium">{c.name}</span>
                  <span className="text-slate-400">
                    {st.executed}/{st.total}
                  </span>
                  {st.status === 'running' && st.currentStepName && (
                    <span className="text-slate-500 truncate">· {st.currentStepName}</span>
                  )}
                  {st.status === 'paused' && (
                    <span className="text-amber-600">
                      {st.pauseReason === 'manual-step'
                        ? 'paused at a manual step — mark it done, then resume'
                        : 'paused: no execution target — set one, then resume'}
                    </span>
                  )}
                  {st.status === 'failed' && st.error && (
                    <span className="text-red-600 truncate" title={st.error}>
                      {st.error}
                    </span>
                  )}
                  {(st.status === 'paused' || st.status === 'failed') && (
                    <Button size="sm" variant="outline" className="h-7 ml-auto" onClick={() => rerunCustomer(c.id)}>
                      {st.status === 'paused' ? 'Resume' : 'Retry'}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
