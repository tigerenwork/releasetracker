'use client';

import { useState, useEffect } from 'react';
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
import { updateCustomerJenkinsConfig, listServices } from '@/lib/actions/jenkins';
import { Plus, Trash2 } from 'lucide-react';
import type { Customer, Cluster } from '@/lib/db/schema';

type JenkinsMapping = {
  view?: string;
  job?: string;
  serviceParam?: string;
  branchParam?: string;
  servicePodMap?: Record<string, string>;
};

interface CustomerFormProps {
  customer?: Customer;
  clusters: Cluster[];
  jenkinsConfig?: JenkinsMapping | null;
  isEdit?: boolean;
}

export function CustomerForm({ customer, clusters, jenkinsConfig, isEdit = false }: CustomerFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Service -> pod app mapping rows, initialized from the saved config
  const [podMapRows, setPodMapRows] = useState<Array<{ service: string; app: string }>>(() =>
    Object.entries(jenkinsConfig?.servicePodMap || {}).map(([service, app]) => ({ service, app }))
  );
  const [services, setServices] = useState<string[]>([]);

  // Load the deployable services so the mapping rows can offer a dropdown
  useEffect(() => {
    if (!isEdit || !customer) return;
    listServices(customer.id)
      .then(setServices)
      .catch(() => setServices([]));
  }, [isEdit, customer]);

  async function handleSubmit(formData: FormData) {
    setIsSubmitting(true);
    setError(null);

    try {
      const data = {
        clusterId: parseInt(formData.get('clusterId') as string),
        namespace: formData.get('namespace') as string,
        name: formData.get('name') as string,
        description: formData.get('description') as string || undefined,
        websiteUrl: formData.get('websiteUrl') as string || undefined,
      };

      if (isEdit && customer) {
        await updateCustomer(customer.id, data);
        await updateCustomerJenkinsConfig(customer.id, {
          view: formData.get('jenkinsView') as string,
          job: formData.get('jenkinsJob') as string,
          serviceParam: formData.get('jenkinsServiceParam') as string,
          branchParam: formData.get('jenkinsBranchParam') as string,
          servicePodMap: Object.fromEntries(
            podMapRows
              .filter((r) => r.service.trim() && r.app.trim())
              .map((r) => [r.service.trim(), r.app.trim()])
          ),
        });
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

          <div className="space-y-2">
            <Label htmlFor="websiteUrl">Website URL</Label>
            <Input
              id="websiteUrl"
              name="websiteUrl"
              defaultValue={customer?.websiteUrl || ''}
              placeholder="e.g., https://acme.example.com"
            />
            <p className="text-sm text-slate-500">
              Link to the customer&apos;s deployment; https:// is added if omitted
            </p>
          </div>

          {isEdit && (
            <div className="space-y-4 border-t pt-6">
              <div>
                <h3 className="text-sm font-medium text-slate-900">Jenkins Integration</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Map this customer to a Jenkins view or job for deployment steps. Set either a view or a job, not both.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="jenkinsView">Jenkins View</Label>
                  <Input
                    id="jenkinsView"
                    name="jenkinsView"
                    defaultValue={jenkinsConfig?.view || ''}
                    placeholder="e.g., acme-deploys"
                  />
                  <p className="text-sm text-slate-500">Each job in the view is a deployable service</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="jenkinsJob">Jenkins Job</Label>
                  <Input
                    id="jenkinsJob"
                    name="jenkinsJob"
                    defaultValue={jenkinsConfig?.job || ''}
                    placeholder="e.g., deploys/acme"
                  />
                  <p className="text-sm text-slate-500">Single job; services come from its service parameter</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="jenkinsServiceParam">Service Parameter</Label>
                  <Input
                    id="jenkinsServiceParam"
                    name="jenkinsServiceParam"
                    defaultValue={jenkinsConfig?.serviceParam || ''}
                    placeholder="auto-detected (matches /service/i)"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="jenkinsBranchParam">Branch Parameter</Label>
                  <Input
                    id="jenkinsBranchParam"
                    name="jenkinsBranchParam"
                    defaultValue={jenkinsConfig?.branchParam || ''}
                    placeholder="auto-detected (matches /branch/i)"
                  />
                </div>

                <div className="space-y-2 col-span-2">
                  <Label>Service → Pod App Mapping</Label>
                  <p className="text-sm text-slate-500">
                    Maps each deployable service to its pod app name, used to show pod status after a deploy.
                    Leave empty to auto-match from the service name.
                  </p>
                  {podMapRows.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      {services.length > 0 ? (
                        <Select
                          value={row.service}
                          onValueChange={(v) => setPodMapRows((rows) => rows.map((r, j) => j === i ? { ...r, service: v } : r))}
                        >
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder="Select a service" />
                          </SelectTrigger>
                          <SelectContent>
                            {services.map((s) => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          className="flex-1"
                          value={row.service}
                          onChange={(e) => setPodMapRows((rows) => rows.map((r, j) => j === i ? { ...r, service: e.target.value } : r))}
                          placeholder="Service, e.g. aldebaran-chaitin-deploy"
                        />
                      )}
                      <span className="text-slate-400">→</span>
                      <Input
                        className="flex-1"
                        value={row.app}
                        onChange={(e) => setPodMapRows((rows) => rows.map((r, j) => j === i ? { ...r, app: e.target.value } : r))}
                        placeholder="Pod app, e.g. aldebaran"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setPodMapRows((rows) => rows.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPodMapRows((rows) => [...rows, { service: '', app: '' }])}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add mapping
                  </Button>
                </div>
              </div>
            </div>
          )}

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
