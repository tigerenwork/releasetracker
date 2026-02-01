'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Package, Play, Archive, Copy, Edit, Trash2, ChevronDown, ChevronUp, ArrowUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Release } from '@/lib/db/schema';

interface ReleaseListProps {
  releases: Release[];
  showActions?: boolean;
}

type SortField = 'name' | 'type' | 'status' | 'createdAt' | 'releaseDate';
type SortDirection = 'asc' | 'desc';

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

export function ReleaseList({ releases, showActions = true }: ReleaseListProps) {
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedReleases = [...releases].sort((a, b) => {
    let comparison = 0;
    
    switch (sortField) {
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'type':
        comparison = (a.type || '').localeCompare(b.type || '');
        break;
      case 'status':
        comparison = (a.status || '').localeCompare(b.status || '');
        break;
      case 'createdAt':
        comparison = new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
        break;
      case 'releaseDate':
        const dateA = a.releaseDate ? new Date(a.releaseDate).getTime() : 0;
        const dateB = b.releaseDate ? new Date(b.releaseDate).getTime() : 0;
        comparison = dateA - dateB;
        break;
    }
    
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 ml-1 text-slate-400" />;
    }
    return sortDirection === 'asc' 
      ? <ChevronUp className="w-3 h-3 ml-1 text-slate-600" />
      : <ChevronDown className="w-3 h-3 ml-1 text-slate-600" />;
  };

  async function handleActivate(id: number) {
    try {
      const { activateRelease } = await import('@/lib/actions/releases');
      await activateRelease(id);
      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to activate release');
    }
  }

  async function handleArchive(id: number) {
    try {
      const { archiveRelease } = await import('@/lib/actions/releases');
      await archiveRelease(id);
      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to archive release');
    }
  }

  async function handleClone(release: Release) {
    try {
      const { cloneRelease } = await import('@/lib/actions/releases');
      const newName = `${release.name} (Copy)`;
      await cloneRelease(release.id, newName);
      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to clone release');
    }
  }

  if (releases.length === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-lg border border-dashed border-slate-300">
        <p className="text-slate-600">No releases found.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[40px]"></TableHead>
            <TableHead 
              className="cursor-pointer hover:bg-slate-50"
              onClick={() => handleSort('name')}
            >
              <div className="flex items-center">
                Name
                <SortIcon field="name" />
              </div>
            </TableHead>
            <TableHead 
              className="cursor-pointer hover:bg-slate-50"
              onClick={() => handleSort('type')}
            >
              <div className="flex items-center">
                Type
                <SortIcon field="type" />
              </div>
            </TableHead>
            <TableHead 
              className="cursor-pointer hover:bg-slate-50"
              onClick={() => handleSort('status')}
            >
              <div className="flex items-center">
                Status
                <SortIcon field="status" />
              </div>
            </TableHead>
            <TableHead>Version</TableHead>
            <TableHead 
              className="cursor-pointer hover:bg-slate-50"
              onClick={() => handleSort('releaseDate')}
            >
              <div className="flex items-center">
                Release Date
                <SortIcon field="releaseDate" />
              </div>
            </TableHead>
            <TableHead 
              className="cursor-pointer hover:bg-slate-50"
              onClick={() => handleSort('createdAt')}
            >
              <div className="flex items-center">
                Created
                <SortIcon field="createdAt" />
              </div>
            </TableHead>
            {showActions && <TableHead className="w-[100px]">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedReleases.map((release) => (
            <TableRow key={release.id} className="hover:bg-slate-50">
              <TableCell>
                <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
                  <Package className="w-4 h-4 text-indigo-600" />
                </div>
              </TableCell>
              <TableCell>
                <Link 
                  href={`/releases/${release.id}`}
                  className="font-medium text-slate-900 hover:text-indigo-600"
                >
                  {release.name}
                </Link>
                {release.description && (
                  <p className="text-sm text-slate-500 truncate max-w-[200px]">
                    {release.description}
                  </p>
                )}
              </TableCell>
              <TableCell>
                <Badge className={getTypeColor(release.type || '')} variant="secondary">
                  {release.type}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge className={getStatusColor(release.status || '')} variant="secondary">
                  {release.status}
                </Badge>
              </TableCell>
              <TableCell className="text-slate-600">
                {release.versionNumber || '-'}
              </TableCell>
              <TableCell className="text-slate-600">
                {release.releaseDate 
                  ? new Date(release.releaseDate).toLocaleDateString() 
                  : '-'}
              </TableCell>
              <TableCell className="text-slate-600">
                {release.createdAt 
                  ? new Date(release.createdAt).toLocaleDateString() 
                  : '-'}
              </TableCell>
              {showActions && (
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm">
                        Actions
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {release.status === 'draft' && (
                        <DropdownMenuItem onClick={() => handleActivate(release.id)}>
                          <Play className="w-4 h-4 mr-2" />
                          Activate
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => handleClone(release)}>
                        <Copy className="w-4 h-4 mr-2" />
                        Clone
                      </DropdownMenuItem>
                      {release.status === 'active' && (
                        <DropdownMenuItem onClick={() => handleArchive(release.id)}>
                          <Archive className="w-4 h-4 mr-2" />
                          Archive
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem asChild>
                        <Link href={`/releases/${release.id}/edit`} className="flex items-center">
                          <Edit className="w-4 h-4 mr-2" />
                          Edit
                        </Link>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
