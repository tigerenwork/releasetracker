import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ReleaseCard } from '@/components/releases/release-card';
import { listReleases } from '@/lib/actions/releases';

export default async function ReleasesPage() {
  const releases = await listReleases();

  const drafts = releases.filter(r => r.status === 'draft');
  const active = releases.filter(r => r.status === 'active');
  const archived = releases.filter(r => r.status === 'archived');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Releases</h1>
          <p className="text-slate-600 mt-1">
            Manage your deployment releases
          </p>
        </div>
        <Link href="/releases/new">
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            Create Release
          </Button>
        </Link>
      </div>

      <Tabs defaultValue="active" className="w-full">
        <TabsList>
          <TabsTrigger value="active">
            Active ({active.length})
          </TabsTrigger>
          <TabsTrigger value="draft">
            Drafts ({drafts.length})
          </TabsTrigger>
          <TabsTrigger value="archived">
            Archived ({archived.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-6">
          {active.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-lg border border-dashed border-slate-300">
              <p className="text-slate-600">No active releases.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {active.map((release) => (
                <ReleaseCard key={release.id} release={release} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="draft" className="mt-6">
          {drafts.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-lg border border-dashed border-slate-300">
              <p className="text-slate-600">No draft releases.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {drafts.map((release) => (
                <ReleaseCard key={release.id} release={release} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="archived" className="mt-6">
          {archived.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-lg border border-dashed border-slate-300">
              <p className="text-slate-600">No archived releases.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {archived.map((release) => (
                <ReleaseCard key={release.id} release={release} showActions={false} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
