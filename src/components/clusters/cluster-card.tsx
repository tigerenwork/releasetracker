'use client';

import Link from 'next/link';
import { Server, Edit, Trash2, Users } from 'lucide-react';
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
import { deleteCluster } from '@/lib/actions/clusters';
import type { Cluster } from '@/lib/db/schema';

interface ClusterCardProps {
  cluster: Cluster & { customerCount?: number };
}

export function ClusterCard({ cluster }: ClusterCardProps) {
  async function handleDelete() {
    try {
      await deleteCluster(cluster.id);
      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to delete cluster');
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <Server className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <CardTitle className="text-lg">{cluster.name}</CardTitle>
              <CardDescription className="flex items-center gap-1 mt-1">
                <Users className="w-3 h-3" />
                {cluster.customerCount || 0} customers
              </CardDescription>
            </div>
          </div>
          <div className="flex gap-1">
            <Link href={`/clusters/${cluster.id}/edit`}>
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
                  <AlertDialogTitle>Delete Cluster</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete the cluster &quot;{cluster.name}&quot;? 
                    This action cannot be undone. You can only delete clusters with no active customers.
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
        {cluster.kubeconfigPath && (
          <div className="text-sm text-slate-600 mb-2">
            <span className="font-medium">Kubeconfig:</span> {cluster.kubeconfigPath}
          </div>
        )}
        {cluster.description && (
          <p className="text-sm text-slate-600 line-clamp-2">{cluster.description}</p>
        )}
        <div className="mt-4 pt-4 border-t">
          <Link href={`/clusters/${cluster.id}`}>
            <Button variant="outline" size="sm" className="w-full">
              View Details
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
