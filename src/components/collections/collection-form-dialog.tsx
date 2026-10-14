'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  CustomerMultiPicker,
  type CustomerWithCluster,
} from '@/components/customers/customer-multi-picker';

export interface CollectionFormValue {
  name: string;
  description: string;
  customerIds: number[];
}

interface CollectionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customers: CustomerWithCluster[];
  // When set, the dialog edits this collection; otherwise it creates a new one
  collection?: { id: number; name: string; description: string; customerIds: number[] } | null;
  onSave: (value: CollectionFormValue) => Promise<void>;
}

export function CollectionFormDialog({
  open,
  onOpenChange,
  customers,
  collection,
  onSave,
}: CollectionFormDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(collection?.name ?? '');
      setDescription(collection?.description ?? '');
      setSelectedIds(new Set(collection?.customerIds ?? []));
    }
  }, [open, collection]);

  const handleSave = async () => {
    if (!name.trim() || selectedIds.size === 0) return;
    setIsSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        customerIds: Array.from(selectedIds),
      });
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to save collection:', error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{collection ? 'Edit Collection' : 'New Collection'}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="collection-name">Name</Label>
            <Input
              id="collection-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Service A customers"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="collection-description">Description</Label>
            <Input
              id="collection-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>

        <CustomerMultiPicker
          customers={customers}
          selectedIds={selectedIds}
          onChange={setSelectedIds}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!name.trim() || selectedIds.size === 0 || isSaving}
          >
            {isSaving ? 'Saving...' : `Save (${selectedIds.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
