'use client';

import { useState } from 'react';
import { Plus, CheckCircle, Circle, SkipForward, RotateCcw, FileText, AlertCircle, Edit } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StepDetailPanel } from '@/components/steps/step-detail-panel';
import { AddCustomStepDialog } from '@/components/steps/add-custom-step-dialog';

interface ReleaseMatrixClientProps {
  stepsByCluster: any;
  category: 'deploy' | 'verify';
  releaseId: number;
}

const statusIcons = {
  pending: <Circle className="w-5 h-5 text-slate-300" />,
  done: <CheckCircle className="w-5 h-5 text-green-500" />,
  skipped: <SkipForward className="w-5 h-5 text-amber-500" />,
  reverted: <RotateCcw className="w-5 h-5 text-red-500" />,
};

export function ReleaseMatrixClient({ stepsByCluster, category, releaseId }: ReleaseMatrixClientProps) {
  const [selectedStep, setSelectedStep] = useState<any>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const clusters = Object.values(stepsByCluster);

  const handleStepClick = (step: any, template: any = null) => {
    setSelectedStep(step);
    setSelectedTemplate(template);
    setIsPanelOpen(true);
  };

  const handleActionComplete = () => {
    setRefreshKey(prev => prev + 1);
    setIsPanelOpen(false);
    // Refresh the page to get updated data
    window.location.reload();
  };

  // Server actions wrapped in async functions
  const markStepDone = async (id: number, notes?: string) => {
    const { markStepDone } = await import('@/lib/actions/customer-steps');
    await markStepDone(id, notes);
    handleActionComplete();
  };

  const skipStep = async (id: number, reason: string) => {
    const { skipStep } = await import('@/lib/actions/customer-steps');
    await skipStep(id, reason);
    handleActionComplete();
  };

  const markStepReverted = async (id: number, reason?: string) => {
    const { markStepReverted } = await import('@/lib/actions/customer-steps');
    await markStepReverted(id, reason);
    handleActionComplete();
  };

  const overrideStepContent = async (id: number, content: string) => {
    const { overrideStepContent } = await import('@/lib/actions/customer-steps');
    await overrideStepContent(id, content);
    handleActionComplete();
  };

  const resetToTemplate = async (id: number) => {
    const { resetToTemplate } = await import('@/lib/actions/customer-steps');
    await resetToTemplate(id);
    handleActionComplete();
  };

  const editCustomStep = async (id: number, data: any) => {
    const { editCustomStep } = await import('@/lib/actions/customer-steps');
    await editCustomStep(id, data);
    handleActionComplete();
  };

  const deleteCustomStep = async (id: number) => {
    const { deleteCustomStep } = await import('@/lib/actions/customer-steps');
    await deleteCustomStep(id);
    handleActionComplete();
  };

  const addCustomStep = async (customerId: number, customerName: string, existingSteps: any[]) => {
    // This will be handled by the dialog component
    return async (data: any) => {
      const { addCustomStep } = await import('@/lib/actions/customer-steps');
      await addCustomStep(releaseId, customerId, data);
      handleActionComplete();
    };
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
          const customers = Object.values(clusterData.customers);
          
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
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-3 font-medium text-slate-500 w-48">Step</th>
                        {customers.map((customer: any) => (
                          <th key={customer.customer.id} className="text-center py-2 px-3 font-medium text-slate-500 min-w-[140px]">
                            <div>{customer.customer.name}</div>
                            <div className="text-xs text-slate-400 font-normal">{customer.customer.namespace}</div>
                            <div className="mt-2">
                              <AddCustomStepDialog
                                releaseId={releaseId}
                                customerId={customer.customer.id}
                                customerName={customer.customer.name}
                                category={category}
                                existingSteps={steps.map((s: any) => ({ id: s.id, name: s.name, orderIndex: s.orderIndex }))}
                                onAdd={async (data) => {
                                  const { addCustomStep } = await import('@/lib/actions/customer-steps');
                                  await addCustomStep(releaseId, customer.customer.id, data);
                                  handleActionComplete();
                                }}
                              />
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {steps.map((step: any, stepIndex: number) => (
                        <tr key={step.id} className="border-b hover:bg-slate-50">
                          <td className="py-3 px-3">
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
                                  {step.isOverridden && (
                                    <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                                      <AlertCircle className="w-3 h-3 mr-1" />
                                      overridden
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

                            return (
                              <td key={customer.customer.id} className="py-2 px-3 text-center">
                                <button
                                  onClick={() => handleStepClick(customerStep, step.template)}
                                  className="hover:scale-110 transition-transform"
                                >
                                  {statusIcons[customerStep.status as keyof typeof statusIcons]}
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
