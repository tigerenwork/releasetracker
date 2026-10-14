'use client';

import { useState, useMemo } from 'react';
import { Users } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  CustomerMultiPicker,
  type CustomerWithCluster,
  type CollectionOption,
} from '@/components/customers/customer-multi-picker';

interface AddCustomerDialogProps {
  releaseId: number;
  releaseName: string;
  availableCustomers: CustomerWithCluster[];
  collections?: CollectionOption[];
  isOpen: boolean;
  onClose: () => void;
  onAdd: (customerIds: number[]) => Promise<void>;
}

export function AddCustomerDialog({
  releaseName,
  availableCustomers,
  collections,
  isOpen,
  onClose,
  onAdd
}: AddCustomerDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isLoading, setIsLoading] = useState(false);

  // Clear selection when dialog opens
  useMemo(() => {
    if (isOpen) {
      setSelectedIds(new Set());
    }
  }, [isOpen]);

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
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Add Customers to Release: {releaseName}</DialogTitle>
        </DialogHeader>

        <CustomerMultiPicker
          customers={availableCustomers}
          selectedIds={selectedIds}
          onChange={setSelectedIds}
          collections={collections}
        />

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleAdd}
            disabled={selectedIds.size === 0 || isLoading}
          >
            {isLoading ? 'Adding...' : `Add Customers (${selectedIds.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
