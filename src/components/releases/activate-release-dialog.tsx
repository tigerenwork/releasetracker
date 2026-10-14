'use client';

import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  CustomerMultiPicker,
  type CustomerWithCluster,
  type CollectionOption,
} from '@/components/customers/customer-multi-picker';

interface ActivateReleaseDialogProps {
  releaseId: number;
  releaseName: string;
  customers: CustomerWithCluster[];
  collections?: CollectionOption[];
  isOpen: boolean;
  onClose: () => void;
  onActivate: (customerIds: number[]) => Promise<void>;
}

export function ActivateReleaseDialog({
  releaseName,
  customers,
  collections,
  isOpen,
  onClose,
  onActivate
}: ActivateReleaseDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isLoading, setIsLoading] = useState(false);

  // Initialize all customers as selected when dialog opens
  useMemo(() => {
    if (isOpen) {
      setSelectedIds(new Set(customers.map(c => c.id)));
    }
  }, [isOpen, customers]);

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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Activate Release: {releaseName}</DialogTitle>
        </DialogHeader>

        <CustomerMultiPicker
          customers={customers}
          selectedIds={selectedIds}
          onChange={setSelectedIds}
          collections={collections}
        />

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleActivate}
            disabled={selectedIds.size === 0 || isLoading}
          >
            {isLoading ? 'Activating...' : `Activate (${selectedIds.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
