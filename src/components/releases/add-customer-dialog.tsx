'use client';

import { useState, useMemo } from 'react';
import { Search, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

interface CustomerWithCluster {
  id: number;
  name: string;
  namespace: string;
  cluster: {
    id: number;
    name: string;
  };
}

interface AddCustomerDialogProps {
  releaseId: number;
  releaseName: string;
  availableCustomers: CustomerWithCluster[];
  isOpen: boolean;
  onClose: () => void;
  onAdd: (customerIds: number[]) => Promise<void>;
}

export function AddCustomerDialog({ 
  releaseName,
  availableCustomers,
  isOpen, 
  onClose,
  onAdd 
}: AddCustomerDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Clear selection when dialog opens
  useMemo(() => {
    if (isOpen) {
      setSelectedIds(new Set());
    }
  }, [isOpen]);

  // Group customers by cluster
  const groupedByCluster = useMemo(() => {
    const filtered = availableCustomers.filter(c => 
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.namespace.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.cluster.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
    
    return filtered.reduce((acc, customer) => {
      const clusterName = customer.cluster.name;
      if (!acc[clusterName]) {
        acc[clusterName] = [];
      }
      acc[clusterName].push(customer);
      return acc;
    }, {} as Record<string, CustomerWithCluster[]>);
  }, [availableCustomers, searchQuery]);

  const toggleCustomer = (customerId: number) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(customerId)) {
      newSelected.delete(customerId);
    } else {
      newSelected.add(customerId);
    }
    setSelectedIds(newSelected);
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
    setSelectedIds(newSelected);
  };

  const handleAdd = async () => {
    if (selectedIds.size === 0) return;
    
    setIsLoading(true);
    try {
      await onAdd(Array.from(selectedIds));
      onClose();
    } catch (error) {
      console.error('Failed to add customers:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const selectedCount = selectedIds.size;

  if (availableCustomers.length === 0) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Customers to Release</DialogTitle>
          </DialogHeader>
          <div className="py-4 text-center">
            <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-600">
              All available customers are already in this release.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={onClose}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Add Customers to Release: {releaseName}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Users className="w-4 h-4" />
            <span>Selected {selectedCount} customers</span>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search customers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <ScrollArea className="flex-1 border rounded-lg p-4 my-2">
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
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button 
            onClick={handleAdd} 
            disabled={selectedCount === 0 || isLoading}
          >
            {isLoading ? 'Adding...' : `Add Customers (${selectedCount})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
