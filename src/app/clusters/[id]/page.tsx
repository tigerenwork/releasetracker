import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Server, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getClusterWithCustomers } from '@/lib/actions/clusters';

interface ClusterDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function ClusterDetailPage({ params }: ClusterDetailPageProps) {
  const { id } = await params;
  const cluster = await getClusterWithCustomers(parseInt(id));

  if (!cluster) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/clusters">
          <Button variant="outline" size="icon">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{cluster.name}</h1>
          <p className="text-slate-600">Cluster Details</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="w-5 h-5" />
              Cluster Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {cluster.kubeconfigPath && (
              <div>
                <label className="text-sm font-medium text-slate-500">Kubeconfig Path</label>
                <p className="text-slate-900">{cluster.kubeconfigPath}</p>
              </div>
            )}
            {cluster.description && (
              <div>
                <label className="text-sm font-medium text-slate-500">Description</label>
                <p className="text-slate-900">{cluster.description}</p>
              </div>
            )}
            <div>
              <label className="text-sm font-medium text-slate-500">Created</label>
              <p className="text-slate-900">{cluster.createdAt ? new Date(cluster.createdAt).toLocaleString() : 'N/A'}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Customers ({cluster.customers.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {cluster.customers.length === 0 ? (
              <p className="text-slate-500 text-sm">No customers in this cluster yet.</p>
            ) : (
              <ul className="space-y-2">
                {cluster.customers.map((customer) => (
                  <li key={customer.id}>
                    <Link 
                      href={`/customers/${customer.id}`}
                      className="block p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
                    >
                      <p className="font-medium text-slate-900">{customer.name}</p>
                      <p className="text-sm text-slate-500">{customer.namespace}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 pt-4 border-t">
              <Link href="/customers/new">
                <Button variant="outline" size="sm" className="w-full">
                  Add Customer
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
