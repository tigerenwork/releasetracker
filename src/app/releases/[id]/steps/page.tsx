'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Plus, GripVertical, Trash2, FileText, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ConfigMapContentEditor } from '@/components/steps/configmap-content-editor';
import type { StepExecutionConfig } from '@/lib/db/schema';

interface Step {
  id: number;
  name: string;
  category: 'deploy' | 'verify';
  type: 'bash' | 'sql' | 'rest' | 'script' | 'text' | 'jenkins' | 'configmap';
  content: string;
  orderIndex: number;
  description?: string;
  executionConfig?: StepExecutionConfig | null;
}

// Step types whose auto-run target is a pod (+ optional container)
const POD_TARGET_TYPES = ['bash', 'sql', 'script', 'rest', 'configmap'];

// "Automation target" section of the template add/edit dialog: per-type
// defaults the auto-runner uses when no per-customer override exists.
function AutomationTargetFields({ type, config }: { type: string; config?: StepExecutionConfig | null }) {
  if (type === 'text') return null;
  const inputCls = 'w-full p-2 border rounded';

  return (
    <div className="border rounded p-3 space-y-3 bg-slate-50">
      <p className="text-sm font-medium text-slate-500">
        Automation target <span className="font-normal text-slate-400">(optional — used by auto-run)</span>
      </p>

      {POD_TARGET_TYPES.includes(type) && (
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Deployment / service name</label>
            <input name="ec_deployment" defaultValue={config?.target?.deployment ?? ''} placeholder="aldebaran" className={inputCls} />
            <p className="text-xs text-slate-400 mt-1">Stable name — the pod is located from it at run time, even across rollouts.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Pod selector</label>
              <input name="ec_podSelector" defaultValue={config?.target?.podSelector ?? ''} placeholder="app=my-service (advanced)" className={inputCls} />
            </div>
            <div>
              <label className="text-sm font-medium">Default container</label>
              <input name="ec_containerName" defaultValue={config?.target?.containerName ?? ''} placeholder="optional" className={inputCls} />
            </div>
          </div>
        </div>
      )}

      {type === 'jenkins' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium">Default service</label>
            <input name="ec_jenkinsService" defaultValue={config?.jenkins?.service ?? ''} placeholder="optional" className={inputCls} />
            <p className="text-xs text-slate-400 mt-1">Jenkins job name, or the k8s service name when the customer has a service→pod mapping.</p>
          </div>
          <div>
            <label className="text-sm font-medium">Default branch</label>
            <input name="ec_jenkinsBranch" defaultValue={config?.jenkins?.branch ?? ''} placeholder="optional" className={inputCls} />
          </div>
        </div>
      )}

      {type === 'script' && (
        <div>
          <label className="text-sm font-medium">Interpreter</label>
          <select name="ec_interpreter" defaultValue={config?.script?.interpreter ?? 'sh'} className={inputCls}>
            <option value="sh">sh</option>
            <option value="bash">bash</option>
            <option value="python">python</option>
            <option value="node">node</option>
          </select>
        </div>
      )}

      {type === 'configmap' && (
        <div className="grid grid-cols-2 gap-3 items-end">
          <div>
            <label className="text-sm font-medium">ConfigMap name</label>
            <input name="ec_configMapName" defaultValue={config?.configmap?.configMapName ?? ''} placeholder="optional" className={inputCls} />
          </div>
          <label className="flex items-center gap-2 text-sm font-medium pb-2">
            <input type="checkbox" name="ec_rolloutRestart" defaultChecked={config?.configmap?.rolloutRestart ?? false} />
            Rollout restart after apply
          </label>
        </div>
      )}
    </div>
  );
}

// Build the executionConfig payload from the dialog's ec_* fields; empty
// fields are omitted and an all-empty config becomes null (clears on edit).
function buildExecutionConfig(type: string, formData: FormData): StepExecutionConfig | null {
  const str = (key: string) => {
    const v = formData.get(key);
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };
  const config: StepExecutionConfig = {};

  if (POD_TARGET_TYPES.includes(type)) {
    const deployment = str('ec_deployment');
    const podSelector = str('ec_podSelector');
    const containerName = str('ec_containerName');
    if (deployment || podSelector || containerName) {
      config.target = {
        ...(deployment ? { deployment } : {}),
        ...(podSelector ? { podSelector } : {}),
        ...(containerName ? { containerName } : {}),
      };
    }
  }
  if (type === 'jenkins') {
    const service = str('ec_jenkinsService');
    const branch = str('ec_jenkinsBranch');
    if (service || branch) {
      config.jenkins = { ...(service ? { service } : {}), ...(branch ? { branch } : {}) };
    }
  }
  if (type === 'script') {
    const interpreter = str('ec_interpreter');
    if (interpreter && interpreter !== 'sh') {
      config.script = { interpreter: interpreter as 'sh' | 'bash' | 'python' | 'node' };
    }
  }
  if (type === 'configmap') {
    const configMapName = str('ec_configMapName');
    const rolloutRestart = formData.get('ec_rolloutRestart') === 'on';
    if (configMapName || rolloutRestart) {
      config.configmap = { ...(configMapName ? { configMapName } : {}), rolloutRestart };
    }
  }

  return Object.keys(config).length > 0 ? config : null;
}

interface PageProps {
  params: Promise<{
    id: string;
  }>;
}

export default function StepsPage({ params }: PageProps) {
  const [releaseId, setReleaseId] = useState<string>('');
  const [release, setRelease] = useState<{ name: string } | null>(null);
  const [deploySteps, setDeploySteps] = useState<Step[]>([]);
  const [verifySteps, setVerifySteps] = useState<Step[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    params.then(({ id }) => {
      setReleaseId(id);
      loadData(id);
    });
  }, [params]);

  async function loadData(id: string) {
    try {
      const response = await fetch(`/api/releases/${id}`);
      if (!response.ok) throw new Error('Failed to load');
      const data = await response.json();
      setRelease(data);
      setDeploySteps(data.templates.filter((s: Step) => s.category === 'deploy').sort((a: Step, b: Step) => a.orderIndex - b.orderIndex));
      setVerifySteps(data.templates.filter((s: Step) => s.category === 'verify').sort((a: Step, b: Step) => a.orderIndex - b.orderIndex));
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) return <div>Loading...</div>;
  if (!release) return notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href={`/releases/${releaseId}`}>
          <Button variant="outline" size="icon">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Manage Steps</h1>
          <p className="text-slate-600">{release.name}</p>
        </div>
      </div>

      <Tabs defaultValue="deploy" className="w-full">
        <TabsList>
          <TabsTrigger value="deploy">
            Deploy Steps ({deploySteps.length})
          </TabsTrigger>
          <TabsTrigger value="verify">
            Verify Steps ({verifySteps.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="deploy" className="mt-6">
          <StepList 
            steps={deploySteps} 
            category="deploy" 
            releaseId={parseInt(releaseId)}
            onUpdate={() => loadData(releaseId)}
          />
        </TabsContent>

        <TabsContent value="verify" className="mt-6">
          <StepList 
            steps={verifySteps} 
            category="verify" 
            releaseId={parseInt(releaseId)}
            onUpdate={() => loadData(releaseId)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface StepListProps {
  steps: Step[];
  category: 'deploy' | 'verify';
  releaseId: number;
  onUpdate: () => void;
}

function StepList({ steps, category, releaseId, onUpdate }: StepListProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [localSteps, setLocalSteps] = useState<Step[]>(steps);
  const [isReordering, setIsReordering] = useState(false);
  const [addType, setAddType] = useState('bash');
  const [addContent, setAddContent] = useState('');

  useEffect(() => {
    setLocalSteps(steps);
  }, [steps]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  async function handleAddStep(formData: FormData) {
    try {
      const type = String(formData.get('type'));
      const response = await fetch('/api/steps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          releaseId,
          category,
          name: formData.get('name'),
          type: formData.get('type'),
          content: formData.get('content'),
          description: formData.get('description'),
          executionConfig: buildExecutionConfig(type, formData),
        }),
      });
      if (response.ok) {
        setIsDialogOpen(false);
        setAddType('bash');
        setAddContent('');
        onUpdate();
      }
    } catch (error) {
      console.error(error);
    }
  }

  async function handleDeleteStep(stepId: number) {
    if (!confirm('Are you sure you want to delete this step?')) return;
    try {
      const response = await fetch(`/api/steps/${stepId}`, { method: 'DELETE' });
      if (response.ok) onUpdate();
    } catch (error) {
      console.error(error);
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setIsReordering(true);
      
      const oldIndex = localSteps.findIndex((s) => s.id === active.id);
      const newIndex = localSteps.findIndex((s) => s.id === over.id);
      
      const newSteps = arrayMove(localSteps, oldIndex, newIndex);
      setLocalSteps(newSteps);

      // Send reorder request to server
      try {
        const response = await fetch('/api/steps/reorder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            releaseId,
            category,
            orderedIds: newSteps.map(s => s.id),
          }),
        });
        
        if (!response.ok) {
          // Revert on error
          setLocalSteps(steps);
          alert('Failed to reorder steps');
        }
      } catch (error) {
        console.error('Reorder error:', error);
        setLocalSteps(steps);
      } finally {
        setIsReordering(false);
        onUpdate();
      }
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="capitalize">{category} Steps</CardTitle>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="w-4 h-4 mr-2" />
              Add Step
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Add {category} Step</DialogTitle>
            </DialogHeader>
            <form action={handleAddStep} className="space-y-4 mt-4">
              <div>
                <label className="text-sm font-medium">Name</label>
                <input name="name" className="w-full p-2 border rounded" required />
              </div>
              <div>
                <label className="text-sm font-medium">Type</label>
                <select name="type" className="w-full p-2 border rounded" value={addType} onChange={(e) => setAddType(e.target.value)}>
                  <option value="bash">Bash Script</option>
                  <option value="sql">SQL</option>
                  <option value="rest">REST</option>
                  <option value="script">Script</option>
                  <option value="text">Text</option>
                  <option value="jenkins">Jenkins Deploy</option>
                  <option value="configmap">ConfigMap Env</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Content</label>
                {addType === 'configmap' ? (
                  <>
                    <ConfigMapContentEditor value={addContent} onChange={setAddContent} />
                    <input type="hidden" name="content" value={addContent} />
                  </>
                ) : (
                  <textarea name="content" className="w-full p-2 border rounded font-mono" rows={6} required />
                )}
              </div>
              <div>
                <label className="text-sm font-medium">Description</label>
                <input name="description" className="w-full p-2 border rounded" />
              </div>
              <AutomationTargetFields type={addType} />
              <Button type="submit">Add Step</Button>
            </form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {localSteps.length === 0 ? (
          <p className="text-slate-500 text-center py-8">No {category} steps defined yet.</p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={localSteps.map(s => s.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className={`space-y-2 ${isReordering ? 'opacity-50' : ''}`}>
                {localSteps.map((step, index) => (
                  <SortableStepItem
                    key={step.id}
                    step={step}
                    index={index}
                    onDelete={() => handleDeleteStep(step.id)}
                    onUpdate={onUpdate}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </CardContent>
    </Card>
  );
}

interface SortableStepItemProps {
  step: Step;
  index: number;
  onDelete: () => void;
  onUpdate: () => void;
}

function SortableStepItem({ step, index, onDelete, onUpdate }: SortableStepItemProps) {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editType, setEditType] = useState(step.type);
  const [editContent, setEditContent] = useState(step.content);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
  };

  async function handleEditStep(formData: FormData) {
    try {
      const type = String(formData.get('type'));
      const response = await fetch(`/api/steps/${step.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.get('name'),
          type: formData.get('type'),
          content: formData.get('content'),
          description: formData.get('description'),
          executionConfig: buildExecutionConfig(type, formData),
        }),
      });
      if (response.ok) {
        setIsEditOpen(false);
        onUpdate();
      }
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 p-3 bg-slate-50 rounded-lg border ${
        isDragging ? 'shadow-lg ring-2 ring-blue-500' : ''
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing"
      >
        <GripVertical className="w-4 h-4 text-slate-400" />
      </button>
      <span className="text-sm text-slate-500 w-6">{index + 1}.</span>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-slate-400" />
          <span className="font-medium">{step.name}</span>
          <Badge variant="outline" className="text-xs capitalize">
            {step.type}
          </Badge>
        </div>
        {step.description && (
          <p className="text-sm text-slate-500">{step.description}</p>
        )}
      </div>
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Pencil className="w-4 h-4" />
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Step</DialogTitle>
          </DialogHeader>
          <form action={handleEditStep} className="space-y-4 mt-4">
            <div>
              <label className="text-sm font-medium">Name</label>
              <input name="name" defaultValue={step.name} className="w-full p-2 border rounded" required />
            </div>
            <div>
              <label className="text-sm font-medium">Type</label>
              <select name="type" value={editType} onChange={(e) => setEditType(e.target.value as Step['type'])} className="w-full p-2 border rounded">
                <option value="bash">Bash Script</option>
                <option value="sql">SQL</option>
                <option value="rest">REST</option>
                <option value="script">Script</option>
                <option value="text">Text</option>
                <option value="jenkins">Jenkins Deploy</option>
                <option value="configmap">ConfigMap Env</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Content</label>
              {editType === 'configmap' ? (
                <>
                  <ConfigMapContentEditor value={editContent} onChange={setEditContent} />
                  <input type="hidden" name="content" value={editContent} />
                </>
              ) : (
                <textarea name="content" defaultValue={step.content} className="w-full p-2 border rounded font-mono" rows={6} required />
              )}
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <input name="description" defaultValue={step.description ?? ''} className="w-full p-2 border rounded" />
            </div>
            <AutomationTargetFields type={editType} config={step.executionConfig} />
            <Button type="submit">Save Changes</Button>
          </form>
        </DialogContent>
      </Dialog>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-red-600"
        onClick={onDelete}
      >
        <Trash2 className="w-4 h-4" />
      </Button>
    </div>
  );
}
