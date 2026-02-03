import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Edit } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { getReleaseById } from '@/lib/actions/releases';
import { getReleaseStepsGroupedByCluster, getStepStats } from '@/lib/actions/customer-steps';
import { listCustomers } from '@/lib/actions/customers';
import { ReleaseMatrixClient } from '@/components/releases/release-matrix-client';
import { ReleaseActions } from '@/components/releases/release-actions';

interface ReleaseDetailPageProps {
  params: Promise<{
    id: string;
  }>;
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

export const dynamic = 'force-dynamic';

export default async function ReleaseDetailPage({ params }: ReleaseDetailPageProps) {
  const { id } = await params;
  const releaseId = parseInt(id);
  const release = await getReleaseById(releaseId);

  if (!release) {
    notFound();
  }

  // Get steps grouped by cluster
  const stepsByCluster = release.status === 'active' 
    ? await getReleaseStepsGroupedByCluster(releaseId)
    : {};

  const stats = release.status === 'active' 
    ? await getStepStats(releaseId)
    : { total: 0, done: 0, skipped: 0, pending: 0, reverted: 0, percentage: 0 };

  const allCustomers = await listCustomers();

  // Get customer IDs already in this release
  const existingCustomerIds = Object.values(stepsByCluster).flatMap((clusterData: any) =>
    Object.values(clusterData.customers as Record<string, { customer: { id: number } }>).map(
      (c: { customer: { id: number } }) => c.customer.id
    )
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <Link href="/releases">
            <Button variant="outline" size="icon">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold text-slate-900">{release.name}</h1>
              <Badge className={getTypeColor(release.type || '')}>{release.type}</Badge>
              <Badge className={getStatusColor(release.status || '')}>{release.status}</Badge>
            </div>
            {release.versionNumber && (
              <p className="text-slate-600 mt-1">Version: {release.versionNumber}</p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/releases/${releaseId}/edit`}>
            <Button variant="outline" size="sm">
              <Edit className="w-4 h-4 mr-2" />
              Edit
            </Button>
          </Link>
          <ReleaseActions
            releaseId={releaseId}
            releaseName={release.name}
            releaseStatus={release.status}
            allCustomers={allCustomers}
            existingCustomerIds={existingCustomerIds}
          />
        </div>
      </div>

      {/* Release Info */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="text-sm font-medium text-slate-500">Release Date</label>
              <p className="text-slate-900">
                {release.releaseDate 
                  ? new Date(release.releaseDate).toLocaleDateString() 
                  : 'Not set'}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-500">Total Customers</label>
              <p className="text-slate-900">
                {release.status === 'active' ? existingCustomerIds.length : allCustomers.length}
                {release.status === 'active' && allCustomers.length > existingCustomerIds.length && (
                  <span className="text-slate-400 text-sm ml-1">
                    ({allCustomers.length - existingCustomerIds.length} not in release)
                  </span>
                )}
              </p>
            </div>
            {release.status === 'active' && (
              <div>
                <label className="text-sm font-medium text-slate-500">Progress</label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-slate-200 rounded-full h-2">
                    <div 
                      className="bg-green-500 h-2 rounded-full transition-all"
                      style={{ width: `${stats.percentage}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium">{stats.percentage}%</span>
                </div>
              </div>
            )}
          </div>
          {release.description && (
            <>
              <Separator className="my-4" />
              <div>
                <label className="text-sm font-medium text-slate-500">Description</label>
                <p className="text-slate-900 mt-1 whitespace-pre-wrap">{release.description}</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Steps Management (for draft) */}
      {release.status === 'draft' && (
        <Card>
          <CardHeader>
            <CardTitle>Template Steps</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h3 className="font-medium mb-3">Deploy Steps ({release.templates.filter(t => t.category === 'deploy').length})</h3>
                <Link href={`/releases/${releaseId}/steps`}>
                  <Button variant="outline" size="sm">
                    Manage Deploy Steps
                  </Button>
                </Link>
              </div>
              <div>
                <h3 className="font-medium mb-3">Verify Steps ({release.templates.filter(t => t.category === 'verify').length})</h3>
                <Link href={`/releases/${releaseId}/steps`}>
                  <Button variant="outline" size="sm">
                    Manage Verify Steps
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Matrix View (for active) */}
      {release.status === 'active' && (
        <Tabs defaultValue="deploy">
          <TabsList>
            <TabsTrigger value="deploy">
              Deploy ({stats.done + stats.skipped}/{stats.total})
            </TabsTrigger>
            <TabsTrigger value="verify">
              Verify 
            </TabsTrigger>
          </TabsList>

          <TabsContent value="deploy" className="mt-4">
            <ReleaseMatrixClient 
              stepsByCluster={stepsByCluster} 
              category="deploy"
              releaseId={releaseId}
            />
          </TabsContent>

          <TabsContent value="verify" className="mt-4">
            <ReleaseMatrixClient 
              stepsByCluster={stepsByCluster} 
              category="verify"
              releaseId={releaseId}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
