'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { CronicleClusterView } from '@/components/cronicle/cronicle-cluster-view';
import { listClusters } from '@/lib/actions/clusters';
import { DEFAULT_CRONICLE_CONFIG } from '@/lib/cronicle/client';
import type { CronicleConfig } from '@/lib/cronicle/types';

interface ClusterEntry {
  id: number;
  name: string;
  config: CronicleConfig;
}

// Floating entry point for Cronicle tasks: the trigger stays pinned to the
// right edge of the viewport (below the Customer Pods trigger) so users can
// run/manage scheduled events from any page. Content slides in as a wide
// right-side sheet and reuses the same cluster view as the /cronicle page.
// Clusters are loaded client-side so static pages don't bake in stale data.
export function CronicleSheet() {
  const pathname = usePathname();
  const [clusters, setClusters] = useState<ClusterEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (clusters.length > 0) return;
    let cancelled = false;
    listClusters()
      .then((rows) => {
        if (cancelled) return;
        setClusters(
          rows.map((cluster) => ({
            id: cluster.id,
            name: cluster.name,
            config: {
              ...DEFAULT_CRONICLE_CONFIG,
              ...(cluster.metadata?.cronicle as Partial<CronicleConfig> | undefined),
            },
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

  // The /cronicle page already shows the panel inline; /login is public.
  if (!loaded || clusters.length === 0) return null;
  if (pathname === '/cronicle' || pathname === '/login') return null;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button className="fixed right-0 top-40 z-40 rounded-r-none shadow-lg">
          <CalendarClock className="w-4 h-4 mr-2" />
          Cronicle
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-6xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Cronicle</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-6">
          <CronicleClusterView clusters={clusters} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
