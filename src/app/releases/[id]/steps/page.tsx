'use client';

import { useState } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Plus, GripVertical, Trash2 } from 'lucide-react';
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
import { useEffect } from 'react';

interface Step {
  id: number;
  name: string;
  category: 'deploy' | 'verify';
  type: 'bash' | 'sql' | 'text';
  content: string;
  orderIndex: number;
  description?: string;
}

interface PageProps {
  params: Promise<{
    id: string;
  }>;
}

export default function StepsPage({ params }: PageProps) {
  const [releaseId, setReleaseId] = useState<string>('');
  const [release, setRelease] = useState<any>(null);
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

  async function handleAddStep(formData: FormData) {
    try {
      const response = await fetch('/api/steps', {
        method: 'POST',
        body: JSON.stringify({
          releaseId,
          category,
          name: formData.get('name'),
          type: formData.get('type'),
          content: formData.get('content'),
          description: formData.get('description'),
        }),
      });
      if (response.ok) {
        setIsDialogOpen(false);
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
                <select name="type" className="w-full p-2 border rounded">
                  <option value="bash">Bash Script</option>
                  <option value="sql">SQL</option>
                  <option value="text">Text</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Content</label>
                <textarea name="content" className="w-full p-2 border rounded font-mono" rows={6} required />
              </div>
              <div>
                <label className="text-sm font-medium">Description</label>
                <input name="description" className="w-full p-2 border rounded" />
              </div>
              <Button type="submit">Add Step</Button>
            </form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {steps.length === 0 ? (
          <p className="text-slate-500 text-center py-8">No {category} steps defined yet.</p>
        ) : (
          <div className="space-y-2">
            {steps.map((step, index) => (
              <div
                key={step.id}
                className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border"
              >
                <GripVertical className="w-4 h-4 text-slate-400" />
                <span className="text-sm text-slate-500 w-6">{index + 1}.</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{step.name}</span>
                    <Badge variant="outline" className="text-xs capitalize">
                      {step.type}
                    </Badge>
                  </div>
                  {step.description && (
                    <p className="text-sm text-slate-500">{step.description}</p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-red-600"
                  onClick={() => handleDeleteStep(step.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
