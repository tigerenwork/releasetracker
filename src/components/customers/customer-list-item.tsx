'use client';

import Link from 'next/link';
import { Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { deleteCustomer } from '@/lib/actions/customers';
import type { Customer } from '@/lib/db/schema';

interface CustomerListItemProps {
  customer: Customer & { cluster?: { name: string } | null };
}

export function CustomerListItem({ customer }: CustomerListItemProps) {
  async function handleDelete() {
    try {
      await deleteCustomer(customer.id);
      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to delete customer');
    }
  }

  return (
    <div className="flex items-center gap-4 px-4 py-3 bg-white border-b last:border-b-0 hover:bg-slate-50 transition-colors">
      <div className="flex-1 min-w-0">
        <Link href={`/customers/${customer.id}`} className="font-medium text-slate-900 hover:underline">
          {customer.name}
        </Link>
        {customer.description && (
          <p className="text-sm text-slate-500 truncate">{customer.description}</p>
        )}
      </div>
      <div className="text-sm text-slate-600 w-40 truncate hidden sm:block">
        {customer.namespace}
      </div>
      <div className="flex items-center gap-1 ml-auto">
        <Link href={`/customers/${customer.id}/edit`}>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Edit className="w-4 h-4" />
          </Button>
        </Link>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:text-red-700">
              <Trash2 className="w-4 h-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Customer</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete the customer &quot;{customer.name}&quot;?
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
