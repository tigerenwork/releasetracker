import { getCustomersGroupedByCluster } from '@/lib/actions/customers';
import { ClusterPodsCard } from '@/components/pods/cluster-pods-card';

export const dynamic = 'force-dynamic';

export default async function PodsPage() {
  const customersByCluster = await getCustomersGroupedByCluster();
  const clusters = Object.values(customersByCluster);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Pods</h1>
        <p className="text-slate-600 mt-1">
          Kubernetes pod status across all clusters and customer namespaces
        </p>
      </div>

      {clusters.length === 0 ? (
        <p className="text-slate-500">
          No customers configured. Add a cluster and customer to monitor their pods.
        </p>
      ) : (
        <div className="space-y-4">
          {clusters.map((clusterData) => (
            <ClusterPodsCard
              key={clusterData.cluster?.id || 'unknown'}
              clusterName={clusterData.cluster?.name || 'Unknown Cluster'}
              customers={clusterData.customers.map((c) => ({
                id: c.id,
                name: c.name,
                namespace: c.namespace,
                websiteUrl: c.websiteUrl,
              }))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
