'use client';

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

interface CustomerPodsSheetProps {
  clusters: {
    key: string | number;
    clusterName: string;
    customers: { id: number; name: string; namespace: string }[];
  }[];
  releaseId: number;
}

// Floating entry point for pod status: the trigger stays pinned to the right
// edge of the viewport so users can check pods without scrolling away from
// the release matrix. Content slides in as a wide right-side sheet.
export function CustomerPodsSheet({ clusters, releaseId }: CustomerPodsSheetProps) {
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
