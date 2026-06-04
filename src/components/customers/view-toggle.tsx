'use client';

import { useRouter } from 'next/navigation';
import { LayoutGrid, List } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ViewToggleProps {
  currentView: 'grid' | 'list';
}

export function ViewToggle({ currentView }: ViewToggleProps) {
  const router = useRouter();

  const switchView = (view: 'grid' | 'list') => {
    const params = new URLSearchParams(window.location.search);
    params.set('view', view);
    router.replace(`?${params.toString()}`);
  };

  return (
    <div className="flex gap-1 border rounded-md p-1">
      <Button
        variant={currentView === 'grid' ? 'secondary' : 'ghost'}
        size="icon"
        className="h-8 w-8"
        onClick={() => switchView('grid')}
        title="Grid view"
      >
        <LayoutGrid className="w-4 h-4" />
      </Button>
      <Button
        variant={currentView === 'list' ? 'secondary' : 'ghost'}
        size="icon"
        className="h-8 w-8"
        onClick={() => switchView('list')}
        title="List view"
      >
        <List className="w-4 h-4" />
      </Button>
    </div>
  );
}
