'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createCluster, updateCluster } from '@/lib/actions/clusters';
import type { Cluster } from '@/lib/db/schema';

interface ClusterFormProps {
  cluster?: Cluster;
  isEdit?: boolean;
}

export function ClusterForm({ cluster, isEdit = false }: ClusterFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setIsSubmitting(true);
    setError(null);

    try {
      const data = {
        name: formData.get('name') as string,
        kubeconfigPath: formData.get('kubeconfigPath') as string || undefined,
        description: formData.get('description') as string || undefined,
      };

      if (isEdit && cluster) {
        await updateCluster(cluster.id, data);
      } else {
        await createCluster(data);
      }

      router.push('/clusters');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEdit ? 'Edit Cluster' : 'Create New Cluster'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={handleSubmit} className="space-y-6">
          {error && (
            <div className="p-3 bg-red-50 text-red-600 rounded-md text-sm">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="name">Cluster Name *</Label>
            <Input
              id="name"
              name="name"
              defaultValue={cluster?.name}
              placeholder="e.g., production-us"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="kubeconfigPath">Kubeconfig Path</Label>
            <Input
              id="kubeconfigPath"
              name="kubeconfigPath"
              defaultValue={cluster?.kubeconfigPath || ''}
              placeholder="~/.kube/config"
            />
            <p className="text-sm text-slate-500">
              Path to kubeconfig file (optional, for future auto-execution)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              defaultValue={cluster?.description || ''}
              placeholder="Description of this cluster..."
              rows={3}
            />
          </div>

          <div className="flex gap-4">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : isEdit ? 'Update Cluster' : 'Create Cluster'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push('/clusters')}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
