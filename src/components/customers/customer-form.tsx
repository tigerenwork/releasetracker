'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createCustomer, updateCustomer } from '@/lib/actions/customers';
import type { Customer, Cluster } from '@/lib/db/schema';

interface CustomerFormProps {
  customer?: Customer;
  clusters: Cluster[];
  isEdit?: boolean;
}

export function CustomerForm({ customer, clusters, isEdit = false }: CustomerFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setIsSubmitting(true);
    setError(null);

    try {
      const data = {
        clusterId: parseInt(formData.get('clusterId') as string),
        namespace: formData.get('namespace') as string,
        name: formData.get('name') as string,
        description: formData.get('description') as string || undefined,
      };

      if (isEdit && customer) {
        await updateCustomer(customer.id, data);
      } else {
        await createCustomer(data);
      }

      router.push('/customers');
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
        <CardTitle>{isEdit ? 'Edit Customer' : 'Create New Customer'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={handleSubmit} className="space-y-6">
          {error && (
            <div className="p-3 bg-red-50 text-red-600 rounded-md text-sm">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="clusterId">Cluster *</Label>
            <Select 
              name="clusterId" 
              defaultValue={customer?.clusterId?.toString()}
              required
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a cluster" />
              </SelectTrigger>
              <SelectContent>
                {clusters.map((cluster) => (
                  <SelectItem key={cluster.id} value={cluster.id.toString()}>
                    {cluster.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Customer Name *</Label>
            <Input
              id="name"
              name="name"
              defaultValue={customer?.name}
              placeholder="e.g., Acme Corporation"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="namespace">Namespace *</Label>
            <Input
              id="namespace"
              name="namespace"
              defaultValue={customer?.namespace}
              placeholder="e.g., acme-prod"
              required
            />
            <p className="text-sm text-slate-500">
              Kubernetes namespace for this customer
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              defaultValue={customer?.description || ''}
              placeholder="Description of this customer..."
              rows={3}
            />
          </div>

          <div className="flex gap-4">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : isEdit ? 'Update Customer' : 'Create Customer'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push('/customers')}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
