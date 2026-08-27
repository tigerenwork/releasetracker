'use client';

import { useState, useEffect } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CroniclePanel } from '@/components/cronicle/cronicle-panel';
import type { CronicleConfig } from '@/lib/cronicle/types';

const STORAGE_KEY = 'cronicle-cluster';

interface ClusterEntry {
  id: number;
  name: string;
  config: CronicleConfig;
}

/**
 * Cluster switcher + CroniclePanel for the /cronicle page.
 * The selected cluster is remembered in localStorage.
 */
export function CronicleClusterView({ clusters }: { clusters: ClusterEntry[] }) {
  // Start with the first cluster so SSR and the first client render match;
  // the persisted choice is applied after mount.
  const [selectedName, setSelectedName] = useState<string>(clusters[0]?.name ?? '');

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && clusters.some((c) => c.name === saved)) {
      setSelectedName(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = clusters.find((c) => c.name === selectedName) ?? clusters[0];
  if (!selected) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-500">Cluster</span>
        <Select
          value={selected.name}
          onValueChange={(name) => {
            setSelectedName(name);
            window.localStorage.setItem(STORAGE_KEY, name);
          }}
        >
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {clusters.map((c) => (
              <SelectItem key={c.id} value={c.name}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* key forces a clean remount (fresh state) on cluster switch */}
      <CroniclePanel
        key={selected.id}
        clusterId={selected.id}
        clusterName={selected.name}
        config={selected.config}
      />
    </div>
  );
}
