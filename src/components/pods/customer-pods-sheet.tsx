'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Boxes } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ClusterPodsCard } from '@/components/pods/cluster-pods-card';
import { getCustomersGroupedByCluster } from '@/lib/actions/customers';

interface ClusterEntry {
  key: string | number;
  clusterName: string;
  customers: { id: number; name: string; namespace: string; websiteUrl?: string | null }[];
}

// Floating entry point for pod status, available on every page: the trigger
// stays pinned to the right edge of the viewport so users can check pods
// without leaving the current page. Content slides in as a wide right-side
// sheet. Customers are loaded client-side so static pages don't bake in
// stale data. On a release detail page the release id is picked up from the
// URL so pod operations carry the release context.
export function CustomerPodsSheet() {
  const pathname = usePathname();
  const [clusters, setClusters] = useState<ClusterEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  const releaseMatch = pathname.match(/^\/releases\/(\d+)/);
  const releaseId = releaseMatch ? parseInt(releaseMatch[1]) : 0;

  useEffect(() => {
    if (clusters.length > 0) return;
    let cancelled = false;
    getCustomersGroupedByCluster()
      .then((grouped) => {
        if (cancelled) return;
        setClusters(
          Object.values(grouped).map((clusterData) => ({
            key: clusterData.cluster?.id || 'unknown',
            clusterName: clusterData.cluster?.name || 'Unknown Cluster',
            customers: clusterData.customers.map((c) => ({
              id: c.id,
              name: c.name,
              namespace: c.namespace,
              websiteUrl: c.websiteUrl,
            })),
          }))
        );
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname, clusters.length]);

  if (!loaded || clusters.length === 0) return null;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button className="fixed right-0 top-24 z-40 rounded-r-none shadow-lg">
          <Boxes className="w-4 h-4 mr-2" />
          Customer Pods
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-5xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Customer Pods</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          {clusters.map((cluster) => (
            <ClusterPodsCard
              key={cluster.key}
              clusterName={cluster.clusterName}
              customers={cluster.customers}
              releaseId={releaseId}
            />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
