'use client';

import { useState, useMemo } from 'react';
import { Search, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

interface CustomerWithCluster {
  id: number;
  name: string;
  namespace: string;
  cluster: {
    id: number;
    name: string;
  };
}

interface ActivateReleaseDialogProps {
  releaseId: number;
  releaseName: string;
  customers: CustomerWithCluster[];
  isOpen: boolean;
  onClose: () => void;
  onActivate: (customerIds: number[]) => Promise<void>;
}

export function ActivateReleaseDialog({ 
  releaseName,
  customers,
  isOpen, 
  onClose,
  onActivate 
}: ActivateReleaseDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Initialize all customers as selected when dialog opens
  useMemo(() => {
    if (isOpen) {
      setSelectedIds(new Set(customers.map(c => c.id)));
    }
  }, [isOpen, customers]);

  // Group customers by cluster
  const groupedByCluster = useMemo(() => {
    const filtered = customers.filter(c => 
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
  }, [customers, searchQuery]);

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
      // Deselect all in cluster
      clusterIds.forEach(id => newSelected.delete(id));
    } else {
      // Select all in cluster
      clusterIds.forEach(id => newSelected.add(id));
    }
    setSelectedIds(newSelected);
  };

  const selectAll = () => {
    setSelectedIds(new Set(customers.map(c => c.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleActivate = async () => {
    if (selectedIds.size === 0) return;
    
    setIsLoading(true);
    try {
      await onActivate(Array.from(selectedIds));
      onClose();
    } catch (error) {
      console.error('Failed to activate release:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const totalCustomers = customers.length;
  const selectedCount = selectedIds.size;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Activate Release: {releaseName}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Users className="w-4 h-4" />
            <span>Selected {selectedCount} of {totalCustomers} customers</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={selectAll}>
              Select All
            </Button>
            <Button variant="outline" size="sm" onClick={deselectAll}>
              Deselect All
            </Button>
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
            onClick={handleActivate} 
            disabled={selectedCount === 0 || isLoading}
          >
            {isLoading ? 'Activating...' : `Activate (${selectedCount})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
