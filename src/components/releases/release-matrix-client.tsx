'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, CheckCircle, Circle, SkipForward, RotateCcw, FileText, Edit, Loader2, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StepDetailPanel } from '@/components/steps/step-detail-panel';
import { AddCustomStepDialog } from '@/components/steps/add-custom-step-dialog';

interface ReleaseMatrixClientProps {
  stepsByCluster: any;
  category: 'deploy' | 'verify';
  releaseId: number;
  // Archived releases render the matrix for viewing status/results only
  readOnly?: boolean;
}

function getDeployStatus(customerSteps: any[]): { done: number; total: number } {
  const deploySteps = customerSteps.filter((s: any) => s.category === 'deploy');
  const done = deploySteps.filter((s: any) => s.status === 'done' || s.status === 'skipped').length;
  return { done, total: deploySteps.length };
}

const statusIcons = {
  pending: <Circle className="w-5 h-5 text-slate-300" />,
  running: <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />,
  done: <CheckCircle className="w-5 h-5 text-green-500" />,
  failed: <XCircle className="w-5 h-5 text-red-500" />,
  skipped: <SkipForward className="w-5 h-5 text-amber-500" />,
  reverted: <RotateCcw className="w-5 h-5 text-red-500" />,
};

export function ReleaseMatrixClient({ stepsByCluster, category, releaseId, readOnly = false }: ReleaseMatrixClientProps) {
  const router = useRouter();
  const [selectedStep, setSelectedStep] = useState<any>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  // Local copy of the steps data so actions update the matrix immediately; a
  // soft router.refresh() then reconciles with the server without unmounting
  // (which is what keeps the horizontal scroll position and the panel open)
  const [stepsData, setStepsData] = useState(stepsByCluster);

  useEffect(() => setStepsData(stepsByCluster), [stepsByCluster]);

  // Keep the open panel's step in sync with optimistic/refreshed data
  useEffect(() => {
    if (!selectedStep) return;
    for (const clusterData of Object.values(stepsData) as any[]) {
      for (const customerData of Object.values(clusterData.customers) as any[]) {
        const found = customerData.steps.find((s: any) => s.id === selectedStep.id);
        if (found) {
          setSelectedStep(found);
          return;
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepsData]);

  const clusters = Object.values(stepsData);

  const patchStep = (id: number, patch: Record<string, any>) => {
    setStepsData((prev: any) => {
      const next: any = {};
      for (const [key, clusterData] of Object.entries(prev)) {
        const customers: any = {};
        for (const [cid, customerData] of Object.entries((clusterData as any).customers)) {
          customers[cid] = {
            ...(customerData as any),
            steps: (customerData as any).steps.map((s: any) => (s.id === id ? { ...s, ...patch } : s)),
          };
        }
        next[key] = { ...(clusterData as any), customers };
      }
      return next;
    });
  };

  const removeStep = (id: number) => {
    setStepsData((prev: any) => {
      const next: any = {};
      for (const [key, clusterData] of Object.entries(prev)) {
        const customers: any = {};
        for (const [cid, customerData] of Object.entries((clusterData as any).customers)) {
          customers[cid] = {
            ...(customerData as any),
            steps: (customerData as any).steps.filter((s: any) => s.id !== id),
          };
        }
        next[key] = { ...(clusterData as any), customers };
      }
      return next;
    });
  };

  const handleStepClick = (step: any, template: any = null) => {
    setSelectedStep(step);
    setSelectedTemplate(template);
    setIsPanelOpen(true);
  };

  // Server actions wrapped in async functions. Each applies its change
  // optimistically, then soft-refreshes — no full page reload.
  const markStepDone = async (id: number, notes?: string) => {
    const { markStepDone } = await import('@/lib/actions/customer-steps');
    await markStepDone(id, notes);
    patchStep(id, { status: 'done', ...(notes !== undefined ? { notes } : {}) });
    router.refresh();
  };

  const skipStep = async (id: number, reason: string) => {
    const { skipStep } = await import('@/lib/actions/customer-steps');
    await skipStep(id, reason);
    patchStep(id, { status: 'skipped', skipReason: reason });
    router.refresh();
  };

  const markStepReverted = async (id: number, reason?: string) => {
    const { markStepReverted } = await import('@/lib/actions/customer-steps');
    await markStepReverted(id, reason);
    patchStep(id, { status: 'reverted' });
    router.refresh();
  };

  const overrideStepContent = async (id: number, content: string) => {
    const { overrideStepContent } = await import('@/lib/actions/customer-steps');
    await overrideStepContent(id, content);
    patchStep(id, { content, isOverridden: 1 });
    router.refresh();
  };

  const resetToTemplate = async (id: number) => {
    const { resetToTemplate } = await import('@/lib/actions/customer-steps');
    await resetToTemplate(id);
    patchStep(id, { isOverridden: 0, ...(selectedTemplate ? { content: selectedTemplate.content } : {}) });
    router.refresh();
  };

  const editCustomStep = async (id: number, data: any) => {
    const { editCustomStep } = await import('@/lib/actions/customer-steps');
    await editCustomStep(id, data);
    patchStep(id, { ...data });
    router.refresh();
  };

  const deleteCustomStep = async (id: number) => {
    const { deleteCustomStep } = await import('@/lib/actions/customer-steps');
    await deleteCustomStep(id);
    removeStep(id);
    setIsPanelOpen(false);
    router.refresh();
  };

  if (clusters.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-slate-500">
          No customers found. Add customers to see the matrix view.
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-6">
        {clusters.map((clusterData: any) => {
          const customers = Object.values(clusterData.customers).sort((a: any, b: any) =>
            (a.customer.namespace || a.customer.name).localeCompare(b.customer.namespace || b.customer.name)
          );
          
          // Get all unique steps for this category, sorted by orderIndex
          const allSteps = new Map();
          customers.forEach((customer: any) => {
            customer.steps
              .filter((s: any) => s.category === category)
              .forEach((step: any) => {
                // Use a combination of name and templateId as key to handle custom steps
                const key = step.templateId ? `template-${step.templateId}` : `custom-${step.id}`;
                if (!allSteps.has(key)) {
                  allSteps.set(key, step);
                }
              });
          });
          
          // Sort by orderIndex (handles decimals for mixed ordering)
          const steps = Array.from(allSteps.values()).sort((a: any, b: any) => a.orderIndex - b.orderIndex);

          if (steps.length === 0) return null;

          return (
            <Card key={clusterData.cluster?.id || 'unknown'}>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <span className="w-3 h-3 bg-blue-500 rounded-full"></span>
                  {clusterData.cluster?.name || 'Unknown Cluster'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-auto max-h-[75vh]">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-3 font-medium text-slate-500 w-48 sticky left-0 top-0 z-30 bg-white after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:bg-slate-200">Step</th>
                        {customers.map((customer: any) => (
                          <th key={customer.customer.id} className="text-center py-2 px-3 font-medium text-slate-500 min-w-[140px] sticky top-0 z-20 bg-white">
                            <div>{customer.customer.name}</div>
                            <div className="text-xs text-slate-400 font-normal">{customer.customer.namespace}</div>
                            {category === 'verify' && (() => {
                              const { done, total } = getDeployStatus(customer.steps);
                              const isFullyDeployed = total > 0 && done === total;
                              const isPartial = total > 0 && done > 0 && done < total;
                              return total > 0 ? (
                                <div className={`mt-1 text-xs font-medium px-2 py-0.5 rounded-full inline-block ${
                                  isFullyDeployed
                                    ? 'bg-green-100 text-green-700'
                                    : isPartial
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-slate-100 text-slate-500'
                                }`}>
                                  {isFullyDeployed ? '✓ Deployed' : `${done}/${total} deployed`}
                                </div>
                              ) : null;
                            })()}
                            <div className="mt-2">
                              {!readOnly && (
                                <AddCustomStepDialog
                                  releaseId={releaseId}
                                  customerId={customer.customer.id}
                                  customerName={customer.customer.name}
                                  category={category}
                                  existingSteps={steps.map((s: any) => ({ id: s.id, name: s.name, orderIndex: s.orderIndex }))}
                                  onAdd={async (data) => {
                                    const { addCustomStep } = await import('@/lib/actions/customer-steps');
                                    await addCustomStep(releaseId, customer.customer.id, data);
                                    router.refresh();
                                  }}
                                />
                              )}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {steps.map((step: any, stepIndex: number) => (
                        <tr key={step.id} className="border-b hover:bg-slate-50 group">
                          <td className="py-3 px-3 sticky left-0 z-10 bg-white group-hover:bg-slate-50 after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:bg-slate-200">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-slate-400 w-6">{stepIndex + 1}.</span>
                              <div>
                                <p className="font-medium text-sm">{step.name}</p>
                                <div className="flex gap-1 mt-1">
                                  {step.isCustom && (
                                    <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200">
                                      <FileText className="w-3 h-3 mr-1" />
                                      custom
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                          {customers.map((customer: any) => {
                            // Find the customer step - match by templateId for template steps, or by id for custom steps
                            const customerStep = customer.steps.find(
                              (s: any) => {
                                if (step.templateId) {
                                  return s.templateId === step.templateId && s.category === category;
                                }
                                return s.id === step.id && s.category === category;
                              }
                            );
                            
                            if (!customerStep) return <td key={customer.customer.id} className="py-2 px-3"></td>;

                            const hasNotes = !!customerStep.notes;
                            const isStepOverridden = !!customerStep.isOverridden;

                            return (
                              <td key={customer.customer.id} className="p-0 text-center">
                                <button
                                  onClick={() => handleStepClick(customerStep, step.template)}
                                  className="w-full h-full min-h-[48px] px-3 py-2 flex items-center justify-center cursor-pointer hover:bg-slate-100 rounded transition-colors"
                                  title={hasNotes ? customerStep.notes : (isStepOverridden ? 'Content overridden from template' : undefined)}
                                >
                                  <span className="relative inline-flex hover:scale-110 transition-transform">
                                    {statusIcons[customerStep.status as keyof typeof statusIcons]}
                                    {hasNotes && (
                                      <span className="absolute -top-1 -right-1 w-2 h-2 bg-orange-400 rounded-full" />
                                    )}
                                    {isStepOverridden && (
                                      <span className="absolute -bottom-1 -right-1 w-2 h-2 bg-amber-500 rounded-full" />
                                    )}
                                  </span>
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <StepDetailPanel
        step={selectedStep}
        template={selectedTemplate}
        isOpen={isPanelOpen}
        onClose={() => setIsPanelOpen(false)}
        readOnly={readOnly}
        onMarkDone={markStepDone}
        onSkip={skipStep}
        onRevert={markStepReverted}
        onOverride={overrideStepContent}
        onResetToTemplate={resetToTemplate}
        onEditCustom={editCustomStep}
        onDeleteCustom={deleteCustomStep}
      />
    </>
  );
}
