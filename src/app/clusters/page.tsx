import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ClusterCard } from '@/components/clusters/cluster-card';
import { listClusters } from '@/lib/actions/clusters';

// Force dynamic rendering to avoid static generation during build
export const dynamic = 'force-dynamic';

export default async function ClustersPage() {
  const clusters = await listClusters();
  
  // Get customer counts for each cluster
  const clustersWithCount = await Promise.all(
    clusters.map(async (cluster) => {
      // Use the server action to get customer count
      const { listCustomersByCluster } = await import('@/lib/actions/customers');
      const customers = await listCustomersByCluster(cluster.id);
      return {
        ...cluster,
        customerCount: customers.length,
      };
    })
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Clusters</h1>
          <p className="text-slate-600 mt-1">
            Manage your Kubernetes clusters
          </p>
        </div>
        <Link href="/clusters/new">
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            Add Cluster
          </Button>
        </Link>
      </div>

      {clustersWithCount.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-dashed border-slate-300">
          <p className="text-slate-600">No clusters yet. Create your first cluster to get started.</p>
          <Link href="/clusters/new" className="mt-4 inline-block">
            <Button>Create Cluster</Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {clustersWithCount.map((cluster) => (
            <ClusterCard key={cluster.id} cluster={cluster} />
          ))}
        </div>
      )}
    </div>
  );
}
