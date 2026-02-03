'use client';

import { useState } from 'react';
import { Play, Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ActivateReleaseDialog } from './activate-release-dialog';
import { AddCustomerDialog } from './add-customer-dialog';
import { activateRelease, addCustomersToRelease } from '@/lib/actions/releases';
import { useRouter } from 'next/navigation';

interface CustomerWithCluster {
  id: number;
  name: string;
  namespace: string;
  cluster: {
    id: number;
    name: string;
  };
}

interface ReleaseActionsProps {
  releaseId: number;
  releaseName: string;
  releaseStatus: string;
  allCustomers: CustomerWithCluster[];
  // Customers already in the release (for active releases)
  existingCustomerIds?: number[];
}

export function ReleaseActions({ 
  releaseId, 
  releaseName,
  releaseStatus,
  allCustomers,
  existingCustomerIds = []
}: ReleaseActionsProps) {
  const router = useRouter();
  const [isActivateDialogOpen, setIsActivateDialogOpen] = useState(false);
  const [isAddCustomerDialogOpen, setIsAddCustomerDialogOpen] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  const handleActivate = async (customerIds: number[]) => {
    await activateRelease(releaseId, customerIds);
    router.refresh();
  };

  const handleArchive = async () => {
    if (!confirm('Are you sure you want to archive this release?')) return;
    
    setIsArchiving(true);
    try {
      const { archiveRelease } = await import('@/lib/actions/releases');
      await archiveRelease(releaseId);
      router.refresh();
    } catch (error) {
      console.error('Failed to archive release:', error);
    } finally {
      setIsArchiving(false);
    }
  };

  const handleAddCustomers = async (customerIds: number[]) => {
    await addCustomersToRelease(releaseId, customerIds);
    router.refresh();
  };

  // Calculate available customers (not already in release)
  const availableCustomers = allCustomers.filter(
    c => !existingCustomerIds.includes(c.id)
  );

  if (releaseStatus === 'draft') {
    return (
      <>
        <Button size="sm" onClick={() => setIsActivateDialogOpen(true)}>
          <Play className="w-4 h-4 mr-2" />
          Activate
        </Button>

        <ActivateReleaseDialog
          releaseId={releaseId}
          releaseName={releaseName}
          customers={allCustomers}
          isOpen={isActivateDialogOpen}
          onClose={() => setIsActivateDialogOpen(false)}
          onActivate={handleActivate}
        />
      </>
    );
  }

  if (releaseStatus === 'active') {
    return (
      <>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={handleArchive}
          disabled={isArchiving}
        >
          <Archive className="w-4 h-4 mr-2" />
          {isArchiving ? 'Archiving...' : 'Archive'}
        </Button>

        {availableCustomers.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsAddCustomerDialogOpen(true)}
          >
            + Add Customer
          </Button>
        )}

        <AddCustomerDialog
          releaseId={releaseId}
          releaseName={releaseName}
          availableCustomers={availableCustomers}
          isOpen={isAddCustomerDialogOpen}
          onClose={() => setIsAddCustomerDialogOpen(false)}
          onAdd={handleAddCustomers}
        />
      </>
    );
  }

  return null;
}
