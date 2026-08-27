import { listClusters } from '@/lib/actions/clusters';
import { CronicleClusterView } from '@/components/cronicle/cronicle-cluster-view';
import { DEFAULT_CRONICLE_CONFIG } from '@/lib/cronicle/client';
import type { CronicleConfig } from '@/lib/cronicle/types';

export const dynamic = 'force-dynamic';

export default async function CroniclePage() {
  const clusters = await listClusters();

  const clusterConfigs = clusters.map((cluster) => ({
    id: cluster.id,
    name: cluster.name,
    config: {
      ...DEFAULT_CRONICLE_CONFIG,
      ...(cluster.metadata?.cronicle as Partial<CronicleConfig> | undefined),
    },
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Cronicle</h1>
        <p className="text-slate-600 mt-1">
          Scheduled events, jobs and history across clusters
        </p>
      </div>

      {clusterConfigs.length === 0 ? (
        <p className="text-slate-500">
          No clusters configured. Add a cluster first to manage its Cronicle events.
        </p>
      ) : (
        <CronicleClusterView clusters={clusterConfigs} />
      )}
    </div>
  );
}
