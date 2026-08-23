'use client';

import { useState, useEffect } from 'react';
import { X, RotateCcw, Pencil, Trash2, FileText, AlertCircle, CheckCircle, Check, SkipForward, Copy, Globe, Loader2, XCircle, Save } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { CodeBlock } from './code-block';
import { JenkinsExecutor } from '@/components/executors/jenkins-executor';
import { BashExecutor } from '@/components/executors/bash-executor';
import { ConfigMapExecutor } from '@/components/executors/configmap-executor';
import { SqlExecutor } from '@/components/executors/sql-step-executor';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { getLastScriptExecution } from '@/lib/actions/step-executions';
import { getLastDeploy } from '@/lib/actions/jenkins';
import { saveStepTargetOverride } from '@/lib/actions/customers';
import { appFromPodName } from '@/lib/grafana';
import type { StepTargetOverride } from '@/lib/db/schema';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

// Copy button with subtle feedback
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      className={`h-7 px-2 transition-colors duration-200 ${
        copied 
          ? 'text-green-600 bg-green-50 hover:bg-green-100 hover:text-green-700' 
          : 'text-slate-500 hover:text-slate-700'
      }`}
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5 mr-1" />
          Copied
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5 mr-1" />
          Copy
        </>
      )}
    </Button>
  );
}

// Step types the auto-runner can execute unattended (text stays manual)
const AUTO_RUNNABLE_TYPES = ['bash', 'sql', 'script', 'rest', 'configmap', 'jenkins'];

// Persists the target of the last manual run as this customer's default for
// auto-run (stored as a per-step override in customerExecutionConfigs).
function SaveDefaultTargetButton({
  step,
}: {
  step: { id: number; customerId: number; templateId: number | null; type: string };
}) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'empty' | 'error'>('idle');

  const handleSave = async () => {
    setState('saving');
    try {
      const override: StepTargetOverride = {};
      if (step.type === 'jenkins') {
        const last = await getLastDeploy(step.id);
        if (last?.service) override.jenkinsService = last.service;
        if (last?.branch) override.jenkinsBranch = last.branch;
      } else {
        const last = await getLastScriptExecution(step.id, step.type === 'sql' ? 'sql' : 'script');
        const req = (last?.request ?? {}) as {
          deployment?: string;
          podSelector?: string;
          podName?: string;
          containerName?: string;
        };
        // Prefer the stable deployment name (derived from the pod when the
        // manual run only recorded a podName) over an ephemeral pod name
        if (req.deployment) override.deployment = req.deployment;
        else if (req.podSelector) override.podSelector = req.podSelector;
        else if (req.podName) override.deployment = appFromPodName(req.podName);
        if (req.containerName) override.containerName = req.containerName;
      }

      if (Object.keys(override).length === 0) {
        setState('empty');
      } else {
        await saveStepTargetOverride(step.customerId, String(step.templateId ?? step.id), override);
        setState('saved');
      }
    } catch {
      setState('error');
    }
    setTimeout(() => setState('idle'), 4000);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Button variant="outline" size="sm" onClick={handleSave} disabled={state === 'saving'}>
        <Save className="w-3.5 h-3.5 mr-1" />
        Save as default target
      </Button>
      {state === 'saved' && <span className="text-sm text-green-600">Saved — auto-run will use this target.</span>}
      {state === 'empty' && <span className="text-sm text-slate-500">Nothing to save — run the step once first.</span>}
      {state === 'error' && <span className="text-sm text-red-600">Failed to save the default target.</span>}
    </div>
  );
}

interface StepDetailPanelProps {
  step: any;
  template: any;
  isOpen: boolean;
  onClose: () => void;
  // Hide all mutation controls (mark done/skip/revert/override/delete) — used
  // when viewing an archived release's status and results
  readOnly?: boolean;
  onMarkDone: (id: number, notes?: string) => Promise<void>;
  onSkip: (id: number, reason: string) => Promise<void>;
  onRevert: (id: number, reason?: string) => Promise<void>;
  onOverride: (id: number, content: string) => Promise<void>;
  onResetToTemplate: (id: number) => Promise<void>;
  onEditCustom?: (id: number, data: any) => Promise<void>;
  onDeleteCustom?: (id: number) => Promise<void>;
}

const statusIcons = {
  pending: <div className="w-5 h-5 rounded-full border-2 border-slate-300" />,
  running: <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />,
  done: <CheckCircle className="w-5 h-5 text-green-500" />,
  failed: <XCircle className="w-5 h-5 text-red-500" />,
  skipped: <SkipForward className="w-5 h-5 text-amber-500" />,
  reverted: <RotateCcw className="w-5 h-5 text-red-500" />,
};

const statusLabels = {
  pending: 'Pending',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
  reverted: 'Reverted',
};

const typeLabels = {
  bash: 'Bash Script',
  sql: 'SQL',
  rest: 'REST',
  script: 'Script',
  text: 'Text',
  jenkins: 'Jenkins Deploy',
  configmap: 'ConfigMap Env',
};

export function StepDetailPanel({
  step,
  template,
  isOpen,
  onClose,
  readOnly = false,
  onMarkDone,
  onSkip,
  onRevert,
  onOverride,
  onResetToTemplate,
  onEditCustom,
  onDeleteCustom,
}: StepDetailPanelProps) {
  const [notes, setNotes] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [showOriginal, setShowOriginal] = useState(false);
  const [skipReason, setSkipReason] = useState('');
  const [isSkipping, setIsSkipping] = useState(false);

  // Sync state when step changes
  useEffect(() => {
    if (step) {
      setNotes(step.notes || '');
      setEditContent(step.content || '');
      setIsEditing(false);
      setShowOriginal(false);
      setSkipReason('');
      setIsSkipping(false);
    }
  }, [step?.id]);

  if (!step) return null;

  const isCustom = step.isCustom;
  const isOverridden = step.isOverridden;
  const hasTemplate = !!step.templateId;

  const handleMarkDone = async () => {
    await onMarkDone(step.id, notes);
    onClose();
  };

  const handleSkip = async () => {
    if (!skipReason.trim()) return;
    await onSkip(step.id, skipReason);
    onClose();
  };

  const handleRevert = async () => {
    await onRevert(step.id, notes);
    onClose();
  };

  const handleOverride = async () => {
    await onOverride(step.id, editContent);
    setIsEditing(false);
  };

  const handleResetToTemplate = async () => {
    await onResetToTemplate(step.id);
    onClose();
  };

  const handleDeleteCustom = async () => {
    if (!onDeleteCustom) return;
    if (confirm('Are you sure you want to delete this custom step?')) {
      await onDeleteCustom(step.id);
      onClose();
    }
  };

  const renderSourceBadge = () => {
    if (isCustom) {
      return (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="bg-purple-100 text-purple-800">
            <FileText className="w-3 h-3 mr-1" />
            Custom Step
          </Badge>
          {onEditCustom && onDeleteCustom && !readOnly && (
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
                <Pencil className="w-3 h-3 mr-1" />
                Edit
              </Button>
              <Button variant="ghost" size="sm" className="text-red-600" onClick={handleDeleteCustom}>
                <Trash2 className="w-3 h-3 mr-1" />
                Delete
              </Button>
            </div>
          )}
        </div>
      );
    }

    if (isOverridden) {
      return (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="bg-amber-100 text-amber-800">
            <AlertCircle className="w-3 h-3 mr-1" />
            Overridden from Template
          </Badge>
          <Button variant="ghost" size="sm" onClick={() => setShowOriginal(!showOriginal)}>
            {showOriginal ? 'Hide Original' : 'View Original'}
          </Button>
          {!readOnly && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditContent(step.content);
                  setIsEditing(true);
                }}
              >
                <Pencil className="w-3 h-3 mr-1" />
                Edit Content
              </Button>
              <Button variant="ghost" size="sm" onClick={handleResetToTemplate}>
                <RotateCcw className="w-3 h-3 mr-1" />
                Reset to Template
              </Button>
            </>
          )}
        </div>
      );
    }

    return (
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="bg-blue-100 text-blue-800">
          <FileText className="w-3 h-3 mr-1" />
          From Template
        </Badge>
        {!readOnly && (
          <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
            <Pencil className="w-3 h-3 mr-1" />
            Override Content
          </Button>
        )}
      </div>
    );
  };

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent key={step?.id} className="w-[800px] sm:max-w-[800px] overflow-hidden">
        <SheetHeader className="px-6">
          <div className="flex items-start justify-between">
            <div>
              <SheetTitle className="text-xl mb-2">{step.name}</SheetTitle>
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <span>{step.customer?.name}</span>
                {step.customer?.websiteUrl && (
                  <a
                    href={step.customer.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={step.customer.websiteUrl}
                    className="text-slate-400 hover:text-blue-600"
                  >
                    <Globe className="w-4 h-4" />
                  </a>
                )}
                <span>•</span>
                <span>{step.customer?.cluster?.name}</span>
                <span>•</span>
                <span>{step.customer?.namespace}</span>
              </div>
            </div>
          </div>
        </SheetHeader>

        <div style={{ width: '752px', maxWidth: '752px' }}>
          <ScrollArea className="h-[calc(100vh-180px)] mt-6 px-6 w-full">
            <div className="space-y-6" style={{ width: '704px', maxWidth: '704px' }}>
            {/* Status & Type */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                {statusIcons[step.status as keyof typeof statusIcons]}
                <span className="font-medium">{statusLabels[step.status as keyof typeof statusLabels]}</span>
              </div>
              <Badge variant="outline">{typeLabels[step.type as keyof typeof typeLabels]}</Badge>
              <Badge variant="outline" className="capitalize">{step.category}</Badge>
            </div>

            <Separator />

            {/* Source Info */}
            <div>
              <label className="text-sm font-medium text-slate-500 mb-2 block">Source</label>
              {renderSourceBadge()}
            </div>

            {/* Content */}
            <div className="min-w-0" style={{ maxWidth: '100%' }}>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-slate-500">Content</label>
                {!isEditing && (
                  <CopyButton text={step.content} />
                )}
              </div>
              
              {isEditing ? (
                <div className="space-y-3">
                  <Textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="font-mono min-h-[200px]"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleOverride}>
                      <Check className="w-4 h-4 mr-1" />
                      Save
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => {
                      setIsEditing(false);
                      setEditContent(step.content);
                    }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="overflow-hidden" style={{ maxWidth: '100%', width: '100%' }}>
                  <CodeBlock code={step.content} type={step.type} />
                </div>
              )}

              {/* Show original content if overridden */}
              {showOriginal && template && (
                <div className="mt-4">
                  <label className="text-sm font-medium text-slate-500 mb-2 block">Original Template Content</label>
                  <CodeBlock code={template.content} type={template.type} />
                </div>
              )}
            </div>

            <Separator />

            {/* Jenkins executor */}
            {step.type === 'jenkins' && (
              <JenkinsExecutor
                customerStepId={step.id}
                customerId={step.customerId}
                namespace={step.customer?.namespace || ''}
                kubeContext={step.customer?.cluster?.name}
              />
            )}

            {step.type === 'jenkins' && <Separator />}

            {/* Bash executor: pick pod/container and run the step's commands in-place */}
            {step.type === 'bash' && (
              <BashExecutor
                stepId={step.id}
                customerId={step.customerId}
                releaseId={step.releaseId}
                content={step.content}
                namespace={step.customer?.namespace || ''}
                kubeContext={step.customer?.cluster?.name}
              />
            )}

            {step.type === 'bash' && <Separator />}

            {/* SQL executor: runs the step's SQL in the target pod, connection
                string comes from an env var inside the container */}
            {step.type === 'sql' && (
              <SqlExecutor
                stepId={step.id}
                customerId={step.customerId}
                releaseId={step.releaseId}
                content={step.content}
                namespace={step.customer?.namespace || ''}
                kubeContext={step.customer?.cluster?.name}
              />
            )}

            {step.type === 'sql' && <Separator />}

            {/* ConfigMap executor: set KEY=VALUE env vars on a ConfigMap
                referenced by the selected pod's Deployment */}
            {step.type === 'configmap' && (
              <ConfigMapExecutor
                stepId={step.id}
                customerId={step.customerId}
                releaseId={step.releaseId}
                content={step.content}
                namespace={step.customer?.namespace || ''}
                kubeContext={step.customer?.cluster?.name}
              />
            )}

            {step.type === 'configmap' && <Separator />}

            {/* Save the last manual run's target as this customer's auto-run default */}
            {!readOnly && AUTO_RUNNABLE_TYPES.includes(step.type) && (
              <>
                <div>
                  <label className="text-sm font-medium text-slate-500 mb-2 block">Auto-run</label>
                  {/* key resets the feedback state when another step is opened */}
                  <SaveDefaultTargetButton key={step.id} step={step} />
                  <p className="text-xs text-slate-400 mt-1">
                    Defaults feed auto-run for this customer; per-customer overrides win over template defaults.
                  </p>
                </div>
                <Separator />
              </>
            )}

            {/* Execution Section */}
            {!readOnly && step.status !== 'done' && step.status !== 'skipped' && (
              <div className="space-y-3">
                <label className="text-sm font-medium text-slate-500 block">Execution Notes</label>
                <Textarea
                  placeholder="Add notes about this execution..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="min-h-[80px]"
                />

                {isSkipping ? (
                  <div className="space-y-2">
                    <Textarea
                      placeholder="Reason for skipping..."
                      value={skipReason}
                      onChange={(e) => setSkipReason(e.target.value)}
                      className="min-h-[60px]"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={handleSkip} disabled={!skipReason.trim()}>
                        Confirm Skip
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setIsSkipping(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button onClick={handleMarkDone}>
                      <Check className="w-4 h-4 mr-1" />
                      Mark as Done
                    </Button>
                    <Button variant="outline" onClick={() => setIsSkipping(true)}>
                      <SkipForward className="w-4 h-4 mr-1" />
                      Skip
                    </Button>
                  </div>
                )}
              </div>
            )}

            {step.status === 'done' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="w-5 h-5" />
                  <span className="font-medium">Completed</span>
                  {step.executedAt && (
                    <span className="text-sm text-slate-500">
                      at {new Date(step.executedAt).toLocaleString()}
                    </span>
                  )}
                </div>
                {step.notes && (
                  <div className="bg-slate-50 p-3 rounded-lg">
                    <label className="text-sm font-medium text-slate-500">Notes</label>
                    <p className="text-slate-700 mt-1">{step.notes}</p>
                  </div>
                )}
                {!readOnly && (
                  <Button variant="outline" onClick={handleRevert}>
                    <RotateCcw className="w-4 h-4 mr-1" />
                    Revert to Pending
                  </Button>
                )}
              </div>
            )}

            {step.status === 'skipped' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-amber-600">
                  <SkipForward className="w-5 h-5" />
                  <span className="font-medium">Skipped</span>
                </div>
                {step.skipReason && (
                  <div className="bg-amber-50 p-3 rounded-lg border border-amber-200">
                    <label className="text-sm font-medium text-amber-700">Skip Reason</label>
                    <p className="text-slate-700 mt-1">{step.skipReason}</p>
                  </div>
                )}
              </div>
            )}

            {/* History */}
            {(step.executedAt || step.updatedAt) && (
              <>
                <Separator />
                <div>
                  <label className="text-sm font-medium text-slate-500 mb-2 block">History</label>
                  <div className="space-y-1 text-sm text-slate-500">
                    <p>• Created: {new Date(step.createdAt).toLocaleString()}</p>
                    {step.isOverridden && <p>• Content overridden</p>}
                    {step.executedAt && <p>• Executed: {new Date(step.executedAt).toLocaleString()}</p>}
                    {step.status === 'skipped' && <p>• Skipped: {new Date(step.updatedAt).toLocaleString()}</p>}
                  </div>
                </div>
              </>
            )}
          </div>
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  );
}
