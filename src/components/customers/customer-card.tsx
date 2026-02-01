'use client';

import Link from 'next/link';
import { Users, Edit, Trash2, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

interface CustomerCardProps {
  customer: Customer & { cluster?: { name: string } | null };
}

export function CustomerCard({ customer }: CustomerCardProps) {
  async function handleDelete() {
    try {
      await deleteCustomer(customer.id);
      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to delete customer');
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
              <Users className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <CardTitle className="text-lg">{customer.name}</CardTitle>
              <CardDescription className="flex items-center gap-1 mt-1">
                <Server className="w-3 h-3" />
                {customer.cluster?.name || 'Unknown Cluster'}
              </CardDescription>
            </div>
          </div>
          <div className="flex gap-1">
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
      </CardHeader>
      <CardContent>
        <div className="text-sm text-slate-600 mb-2">
          <span className="font-medium">Namespace:</span> {customer.namespace}
        </div>
        {customer.description && (
          <p className="text-sm text-slate-600 line-clamp-2">{customer.description}</p>
        )}
        <div className="mt-4 pt-4 border-t">
          <Link href={`/customers/${customer.id}`}>
            <Button variant="outline" size="sm" className="w-full">
              View Details
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
