'use client';

import { useState, useMemo } from 'react';
import { Search, Users, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';

export interface CustomerWithCluster {
  id: number;
  name: string;
  namespace: string;
  cluster: {
    id: number;
    name: string;
  };
}

export interface CollectionOption {
  id: number;
  name: string;
  customerIds: number[];
}

interface CustomerMultiPickerProps {
  customers: CustomerWithCluster[];
  selectedIds: Set<number>;
  onChange: (next: Set<number>) => void;
  // When provided, a row of collection chips is shown above the search box;
  // clicking a chip replaces the selection with the collection's members.
  collections?: CollectionOption[];
}

// Shared customer picker: search + cluster-grouped checkboxes, with an
// optional collection chip row for one-click bulk selection. Used by the
// activate/add-customer dialogs and the collection editor.
export function CustomerMultiPicker({
  customers,
  selectedIds,
  onChange,
  collections,
}: CustomerMultiPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCollectionId, setActiveCollectionId] = useState<number | null>(null);

  const groupedByCluster = useMemo(() => {
    const query = searchQuery.toLowerCase();
    const filtered = customers.filter(c =>
      c.name.toLowerCase().includes(query) ||
      c.namespace.toLowerCase().includes(query) ||
      c.cluster.name.toLowerCase().includes(query)
    );

    return filtered.reduce((acc, customer) => {
      const clusterName = customer.cluster.name;
      if (!acc[clusterName]) {
        acc[clusterName] = [];
      }
      acc[clusterName].push(customer);
      return acc;
    }, {} as Record<string, CustomerWithCluster[]>);
  }, [customers, searchQuery]);

  // Manual edits detach from the highlighted collection chip
  const changeManually = (next: Set<number>) => {
    setActiveCollectionId(null);
    onChange(next);
  };

  const toggleCustomer = (customerId: number) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(customerId)) {
      newSelected.delete(customerId);
    } else {
      newSelected.add(customerId);
    }
    changeManually(newSelected);
  };

  const toggleCluster = (clusterCustomers: CustomerWithCluster[]) => {
    const clusterIds = clusterCustomers.map(c => c.id);
    const allSelected = clusterIds.every(id => selectedIds.has(id));

    const newSelected = new Set(selectedIds);
    if (allSelected) {
      clusterIds.forEach(id => newSelected.delete(id));
    } else {
      clusterIds.forEach(id => newSelected.add(id));
    }
    changeManually(newSelected);
  };

  const applyCollection = (collection: CollectionOption) => {
    const available = new Set(customers.map(c => c.id));
    const memberIds = collection.customerIds.filter(id => available.has(id));
    setActiveCollectionId(collection.id);
    onChange(new Set(memberIds));
  };

  const visibleCollections = (collections ?? []).filter(c => c.customerIds.length > 0);

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2">
      <div className="flex items-center justify-between py-2">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Users className="w-4 h-4" />
          <span>Selected {selectedIds.size} of {customers.length} customers</span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => changeManually(new Set(customers.map(c => c.id)))}>
            Select All
          </Button>
          <Button variant="outline" size="sm" onClick={() => changeManually(new Set())}>
            Deselect All
          </Button>
        </div>
      </div>

      {visibleCollections.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Layers className="w-4 h-4 text-slate-400 shrink-0" />
          {visibleCollections.map((collection) => {
            const isActive = collection.id === activeCollectionId;
            const memberCount = collection.customerIds.filter(id =>
              customers.some(c => c.id === id)
            ).length;
            return (
              <Button
                key={collection.id}
                variant={isActive ? 'default' : 'outline'}
                size="sm"
                onClick={() => applyCollection(collection)}
                title={collection.name}
              >
                {collection.name} ({memberCount})
              </Button>
            );
          })}
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <Input
          placeholder="Search customers..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto border rounded-lg p-4 my-2">
        <div className="space-y-4">
          {Object.entries(groupedByCluster).length === 0 ? (
            <p className="text-slate-500 text-center py-4">No customers found</p>
          ) : (
            Object.entries(groupedByCluster).map(([clusterName, clusterCustomers]) => {
              const allSelected = clusterCustomers.every(c => selectedIds.has(c.id));
              const someSelected = clusterCustomers.some(c => selectedIds.has(c.id)) && !allSelected;

              return (
                <div key={clusterName}>
                  <div className="flex items-center gap-2 mb-2 pb-2 border-b">
                    <Checkbox
                      checked={allSelected}
                      data-state={someSelected ? 'indeterminate' : allSelected ? 'checked' : 'unchecked'}
                      onCheckedChange={() => toggleCluster(clusterCustomers)}
                    />
                    <span className="font-medium text-slate-700">
                      {clusterName} ({clusterCustomers.length})
                    </span>
                  </div>
                  <div className="ml-6 space-y-2">
                    {clusterCustomers.map((customer) => (
                      <div key={customer.id} className="flex items-center gap-3">
                        <Checkbox
                          checked={selectedIds.has(customer.id)}
                          onCheckedChange={() => toggleCustomer(customer.id)}
                        />
                        <div className="flex-1">
                          <span className="font-medium text-sm">{customer.name}</span>
                          <span className="text-slate-500 text-sm ml-2">
                            namespace: {customer.namespace}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
