'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  CollectionFormDialog,
  type CollectionFormValue,
} from '@/components/collections/collection-form-dialog';
import type { CustomerWithCluster } from '@/components/customers/customer-multi-picker';
import {
  createCollection,
  updateCollection,
  deleteCollection,
} from '@/lib/actions/customer-collections';

export interface CollectionEntry {
  id: number;
  name: string;
  description: string | null;
  customerIds: number[];
  // cluster name -> member count, e.g. { pingcap: 8, eks: 2 }
  clusterSpread: Record<string, number>;
}

interface CollectionListProps {
  collections: CollectionEntry[];
  customers: CustomerWithCluster[];
}

export function CollectionList({ collections, customers }: CollectionListProps) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CollectionEntry | null>(null);
  const [deleting, setDeleting] = useState<CollectionEntry | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleSave = async (value: CollectionFormValue) => {
    if (editing) {
      await updateCollection(editing.id, value);
    } else {
      await createCollection(value);
    }
    router.refresh();
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setIsDeleting(true);
    try {
      await deleteCollection(deleting.id);
      setDeleting(null);
      router.refresh();
    } catch (error) {
      console.error('Failed to delete collection:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus className="w-4 h-4 mr-2" />
          New Collection
        </Button>
      </div>

      {collections.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-dashed border-slate-300">
          <Layers className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600">
            No collections yet. Create one to quickly pick a fixed set of customers when activating a release.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {collections.map((collection) => (
            <Card key={collection.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2 min-w-0">
                    <Layers className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="truncate">{collection.name}</span>
                  </span>
                  <span className="text-sm font-normal text-slate-500 shrink-0">
                    {collection.customerIds.length} customers
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {collection.description && (
                  <p className="text-sm text-slate-600 line-clamp-2">{collection.description}</p>
                )}
                <p className="text-xs text-slate-500">
                  {Object.entries(collection.clusterSpread)
                    .map(([cluster, count]) => `${count} in ${cluster}`)
                    .join(', ') || 'No active members'}
                </p>
                <div className="flex gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setEditing(collection); setFormOpen(true); }}
                  >
                    <Pencil className="w-3.5 h-3.5 mr-1" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-red-600 hover:text-red-700"
                    onClick={() => setDeleting(collection)}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CollectionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        customers={customers}
        collection={editing ? {
          id: editing.id,
          name: editing.name,
          description: editing.description ?? '',
          customerIds: editing.customerIds,
        } : null}
        onSave={handleSave}
      />

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete collection &quot;{deleting?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              This only removes the saved collection. Customers and releases are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
