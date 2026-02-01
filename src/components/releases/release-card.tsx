'use client';

import Link from 'next/link';
import { Package, Edit, Trash2, Play, Archive, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { activateRelease, archiveRelease, deleteRelease, cloneRelease } from '@/lib/actions/releases';
import type { Release } from '@/lib/db/schema';

interface ReleaseCardProps {
  release: Release;
  showActions?: boolean;
}

const typeColors: Record<string, string> = {
  onboarding: 'bg-purple-100 text-purple-800',
  release: 'bg-blue-100 text-blue-800',
  hotfix: 'bg-red-100 text-red-800',
};

const statusColors: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-800',
  active: 'bg-green-100 text-green-800',
  archived: 'bg-gray-100 text-gray-800',
};

function getTypeColor(type: string) {
  return typeColors[type] || 'bg-slate-100 text-slate-800';
}

function getStatusColor(status: string) {
  return statusColors[status] || 'bg-slate-100 text-slate-800';
}

export function ReleaseCard({ release, showActions = true }: ReleaseCardProps) {
  async function handleActivate() {
    try {
      await activateRelease(release.id);
      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to activate release');
    }
  }

  async function handleArchive() {
    try {
      await archiveRelease(release.id);
      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to archive release');
    }
  }

  async function handleDelete() {
    try {
      await deleteRelease(release.id);
      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to delete release');
    }
  }

  async function handleClone() {
    try {
      const newName = `${release.name} (Copy)`;
      await cloneRelease(release.id, newName);
      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to clone release');
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
              <Package className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <CardTitle className="text-lg">{release.name}</CardTitle>
              <CardDescription className="flex items-center gap-2 mt-1">
                <Badge className={getTypeColor(release.type || '')} variant="secondary">
                  {release.type}
                </Badge>
                <Badge className={getStatusColor(release.status || '')} variant="secondary">
                  {release.status}
                </Badge>
              </CardDescription>
            </div>
          </div>
          {showActions && (
            <div className="flex gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    Actions
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {release.status === 'draft' && (
                    <DropdownMenuItem onClick={handleActivate}>
                      <Play className="w-4 h-4 mr-2" />
                      Activate
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={handleClone}>
                    <Copy className="w-4 h-4 mr-2" />
                    Clone
                  </DropdownMenuItem>
                  {release.status === 'active' && (
                    <DropdownMenuItem onClick={handleArchive}>
                      <Archive className="w-4 h-4 mr-2" />
                      Archive
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => {}}>
                    <Link href={`/releases/${release.id}/edit`} className="flex items-center">
                      <Edit className="w-4 h-4 mr-2" />
                      Edit
                    </Link>
                  </DropdownMenuItem>
                  {release.status === 'draft' && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-red-600">
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Release</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete the release &quot;{release.name}&quot;? 
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
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {release.versionNumber && (
          <div className="text-sm text-slate-600 mb-2">
            <span className="font-medium">Version:</span> {release.versionNumber}
          </div>
        )}
        {release.releaseDate && (
          <div className="text-sm text-slate-600 mb-2">
            <span className="font-medium">Release Date:</span>{' '}
            {new Date(release.releaseDate).toLocaleDateString()}
          </div>
        )}
        {release.description && (
          <p className="text-sm text-slate-600 line-clamp-2">{release.description}</p>
        )}
        <div className="mt-4 pt-4 border-t">
          <Link href={`/releases/${release.id}`}>
            <Button variant="outline" size="sm" className="w-full">
              View Details
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
