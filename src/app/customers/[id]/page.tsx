import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Users, Server, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getCustomerById } from '@/lib/actions/customers';
import { listReleases } from '@/lib/actions/releases';
import { getCustomerSteps } from '@/lib/actions/customer-steps';

interface CustomerDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function CustomerDetailPage({ params }: CustomerDetailPageProps) {
  const { id } = await params;
  const customer = await getCustomerById(parseInt(id));

  if (!customer) {
    notFound();
  }

  const releases = await listReleases();
  
  // Get steps for each active release
  const releasesWithSteps = await Promise.all(
    releases
      .filter(r => r.status === 'active')
      .map(async (release) => {
        const steps = await getCustomerSteps(release.id, customer.id);
        const done = steps.filter(s => s.status === 'done').length;
        const total = steps.length;
        return {
          ...release,
          steps,
          progress: total > 0 ? Math.round((done / total) * 100) : 0,
          done,
          total,
        };
      })
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/customers">
          <Button variant="outline" size="icon">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{customer.name}</h1>
          <p className="text-slate-600 flex items-center gap-2">
            <Server className="w-4 h-4" />
            {customer.cluster?.name} / {customer.namespace}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Customer Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-500">Namespace</label>
              <p className="text-slate-900 font-mono">{customer.namespace}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-500">Cluster</label>
              <p className="text-slate-900">{customer.cluster?.name}</p>
            </div>
            {customer.description && (
              <div>
                <label className="text-sm font-medium text-slate-500">Description</label>
                <p className="text-slate-900">{customer.description}</p>
              </div>
            )}
            <div>
              <label className="text-sm font-medium text-slate-500">Created</label>
              <p className="text-slate-900">{customer.createdAt ? new Date(customer.createdAt).toLocaleString() : 'N/A'}</p>
            </div>
          </CardContent>
        </Card>

        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="w-5 h-5" />
                Active Releases
              </CardTitle>
            </CardHeader>
            <CardContent>
              {releasesWithSteps.length === 0 ? (
                <p className="text-slate-500">No active releases.</p>
              ) : (
                <div className="space-y-4">
                  {releasesWithSteps.map((release) => (
                    <div key={release.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-slate-900">{release.name}</h3>
                          <Badge variant={release.type === 'hotfix' ? 'destructive' : 'default'}>
                            {release.type}
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-500 mt-1">
                          {release.done} / {release.total} steps completed
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <span className="text-2xl font-bold text-slate-900">{release.progress}%</span>
                        </div>
                        <Link href={`/releases/${release.id}`}>
                          <Button size="sm">View</Button>
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
